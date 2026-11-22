import { join } from 'node:path'
import { BrowserWindow, Menu, clipboard, dialog, net, type WebContents } from 'electron'
import type { BrowserAction, OverlayAction, OverlayState, Suggestion, UiEvent, UiState } from '../shared/ipc'
import {
  SPACE_THEMES,
  activeSpace,
  addTab,
  archiveTab,
  createFolder,
  createSpace,
  deleteFolder,
  deleteSpace,
  findFolder,
  getSpace,
  locateTab,
  moveTab,
  newId,
  profileOfTab,
  removeTab,
  tabsToArchive,
  visibleTabOrder,
  type Id,
  type PersistedState,
  type TabLocation,
  type TabRecord,
} from '../shared/model'
import { Downloads } from './downloads'
import { History } from './history'
import { Overlay } from './Overlay'
import { Profiles, partitionOf, type ProfileContext } from './profiles'
import { StateStore } from './store'
import { TabViews, resolveInput } from './TabViews'

const ARCHIVE_CHECK_MS = 5 * 60 * 1000
const MAX_CLOSED = 30
const THEME_NAMES = ['Lavande', 'Pêche', 'Menthe', 'Rose', 'Citron', 'Ciel', 'Lilas', 'Gris']

interface ClosedTab {
  record: TabRecord
  location: TabLocation
}

/** Le navigateur : état de la sidebar + vues web + profils, piloté par les actions de l'UI. */
export class Browser {
  readonly win: BrowserWindow
  private readonly store = new StateStore()
  private readonly state: PersistedState
  private readonly views: TabViews
  private readonly overlay: Overlay
  private readonly profiles: Profiles
  private readonly loadedProfiles = new Map<Id, ProfileContext>()
  private readonly history = new History()
  private readonly downloads: Downloads
  private readonly closed: ClosedTab[] = []
  private sidebarVisible = true
  private sidebarWidth = 0
  private broadcastPending = false

  constructor() {
    this.state = this.store.load()
    this.win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 700,
      minHeight: 450,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/ui.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    this.views = new TabViews(this.win, {
      onRecordChange: (id, patch) => this.updateRecord(id, patch),
      onVisit: (_id, url, title) => this.history.recordVisit(url, title),
      onLiveChange: () => this.broadcast(),
      onOpenTab: (fromId, url, background) => void this.newTab(url, { background, profileId: profileOfTab(this.state, fromId) }),
      onFoundInPage: (id, matches, activeMatch) => {
        if (this.overlay.current.kind === 'find' && this.overlay.current.tabId === id) {
          this.overlay.set({ kind: 'find', tabId: id, matches, activeMatch })
        }
      },
      onClosedByPage: (id) => this.closeTab(id),
    })
    this.overlay = new Overlay(this.win, () => this.views.contentBounds(), (overlay) => this.sendOverlay(overlay))
    this.downloads = new Downloads(() => this.broadcast())
    this.profiles = new Profiles((profileId) => ({
      createTab: async (details) => {
        const id = await this.newTab(details.url, { background: details.active === false, profileId })
        return [this.views.get(id)!.webContents, this.win]
      },
      selectTab: (wc) => this.withTabOf(wc, (id) => this.selectTab(id)),
      removeTab: (wc) => this.withTabOf(wc, (id) => this.closeTab(id)),
      createWindow: async (details) => {
        const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : []
        for (const url of urls) await this.newTab(url, { profileId })
        return this.win
      },
    }))

    this.win.once('ready-to-show', () => this.win.show())
    if (process.env.ELECTRON_RENDERER_URL) this.win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else this.win.loadFile(join(__dirname, '../renderer/index.html'))

    setInterval(() => this.archiveStale(), ARCHIVE_CHECK_MS)
  }

  /** Charge le profil du Space actif et réaffiche son onglet actif. */
  async start(): Promise<void> {
    await this.profile(activeSpace(this.state).profileId)
    this.archiveStale()
    const space = activeSpace(this.state)
    if (space.activeTabId) await this.selectTab(space.activeTabId)
    this.broadcast()
  }

  flush(): void {
    this.store.saveNow(this.state)
    this.history.close()
  }

  // ── État envoyé à l'UI ──────────────────────────────────────────────────

  get activeTabId(): Id | null {
    return activeSpace(this.state).activeTabId ?? null
  }

  /** Dev : vue de l'overlay (captures automatisées). */
  get overlayWebContents(): WebContents {
    return this.overlay.view.webContents
  }

  viewOf(id: Id) {
    return this.views.get(id)
  }

  activeWebContents(): WebContents | undefined {
    const id = this.activeTabId
    return id ? this.views.get(id)?.webContents : undefined
  }

  uiState(): UiState {
    return {
      persisted: this.state,
      live: this.views.live(),
      activeTabId: this.activeTabId,
      sidebarVisible: this.sidebarVisible,
      downloads: this.downloads.list(),
      partition: partitionOf(activeSpace(this.state).profileId),
    }
  }

  overlayState(): OverlayState {
    return this.overlay.current
  }

  /** Regroupe les mises à jour d'une même frame, sauvegarde et notifie l'UI. */
  private broadcast(): void {
    if (this.broadcastPending) return
    this.broadcastPending = true
    setImmediate(() => {
      this.broadcastPending = false
      this.store.scheduleSave(this.state)
      const state = this.uiState()
      for (const wc of [this.win.webContents, this.overlay.view.webContents]) {
        if (!wc.isDestroyed()) wc.send('ui:state', state)
      }
    })
  }

  private sendOverlay(overlay: OverlayState): void {
    for (const wc of [this.win.webContents, this.overlay.view.webContents]) {
      if (!wc.isDestroyed()) wc.send('ui:overlay', overlay)
    }
  }

  private sendEvent(event: UiEvent): void {
    this.win.webContents.send('ui:event', event)
  }

  // ── Profils ─────────────────────────────────────────────────────────────

  private async profile(profileId: Id): Promise<ProfileContext> {
    const loaded = this.loadedProfiles.get(profileId)
    if (loaded) return loaded
    const context = await this.profiles.get(profileId)
    this.loadedProfiles.set(profileId, context)
    this.downloads.watch(context.session)
    return context
  }

  private withTabOf(wc: WebContents, fn: (id: Id) => void): void {
    const id = this.views.ids().find((tabId) => this.views.get(tabId)?.webContents === wc)
    if (id) fn(id)
  }

  // ── Onglets ─────────────────────────────────────────────────────────────

  async newTab(url?: string, options: { background?: boolean; profileId?: Id } = {}): Promise<Id> {
    let space = activeSpace(this.state)
    if (options.profileId && options.profileId !== space.profileId) {
      space = this.state.spaces.find((s) => s.profileId === options.profileId) ?? space
    }
    const now = Date.now()
    const record: TabRecord = {
      id: newId(),
      url: url ? resolveInput(url) : 'https://www.google.com/',
      title: '',
      createdAt: now,
      lastActiveAt: now,
    }
    addTab(this.state, record, space.id)
    this.views.ensure(record.id, record.url, await this.profile(space.profileId))
    if (!options.background) await this.selectTab(record.id)
    else this.broadcast()
    return record.id
  }

  async selectTab(id: Id): Promise<void> {
    const tab = this.state.tabs[id]
    const location = locateTab(this.state, id)
    if (!tab || !location) return
    // Un onglet d'un autre Space : on bascule sur ce Space (sauf favoris, visibles partout dans le profil).
    if (location.spaceId && location.spaceId !== this.state.activeSpaceId) this.state.activeSpaceId = location.spaceId
    const space = activeSpace(this.state)
    space.activeTabId = id
    tab.lastActiveAt = Date.now()
    this.views.ensure(id, tab.url, await this.profile(location.profileId))
    if (this.overlay.current.kind === 'find') this.closeOverlay()
    this.views.show(id)
    this.broadcast()
  }

  /**
   * Fermer un onglet épinglé ou favori le décharge (il reste dans la sidebar, revenu à son URL d'origine) ;
   * fermer un onglet du jour le supprime.
   */
  closeTab(id: Id): void {
    const location = locateTab(this.state, id)
    const tab = this.state.tabs[id]
    if (!location || !tab) return
    const space = activeSpace(this.state)
    const wasActive = space.activeTabId === id
    let next: Id | undefined
    if (wasActive) {
      const order = space.today
      const i = order.indexOf(id)
      next = i >= 0 ? (order[i + 1] ?? order[i - 1]) : order[0]
    }

    this.views.destroy(id)
    if (location.section === 'today') {
      const record = removeTab(this.state, id)
      if (record) {
        this.closed.unshift({ record, location })
        this.closed.length = Math.min(this.closed.length, MAX_CLOSED)
      }
    } else if (tab.pinnedUrl) {
      tab.url = tab.pinnedUrl
    }
    if (wasActive) {
      space.activeTabId = undefined
      if (next) void this.selectTab(next)
      else this.views.show(null)
    }
    this.broadcast()
  }

  async reopenClosedTab(): Promise<void> {
    const closed = this.closed.shift()
    if (!closed) return
    const space = getSpace(this.state, closed.location.spaceId ?? '') ?? activeSpace(this.state)
    const record = { ...closed.record, lastActiveAt: Date.now() }
    addTab(this.state, record, space.id)
    await this.selectTab(record.id)
  }

  private updateRecord(id: Id, patch: { url?: string; title?: string; favicon?: string }): void {
    const tab = this.state.tabs[id]
    if (!tab) return
    if (patch.url !== undefined && patch.url !== '') tab.url = patch.url
    if (patch.title) {
      tab.title = patch.title
      this.history.updateTitle(tab.url, patch.title)
    }
    if (patch.favicon) tab.favicon = patch.favicon
    this.broadcast()
  }

  private archiveStale(): void {
    const stale = tabsToArchive(this.state)
    for (const id of stale) {
      this.views.destroy(id)
      archiveTab(this.state, id)
    }
    if (stale.length) this.broadcast()
  }

  /** Sélectionne le n-ième onglet visible (⌘1…⌘9 ; ⌘9 = dernier). */
  selectTabAt(n: number): void {
    const order = visibleTabOrder(this.state, this.state.activeSpaceId)
    const id = n === 9 ? order.at(-1) : order[n - 1]
    if (id) void this.selectTab(id)
  }

  selectRelativeTab(delta: number): void {
    const order = visibleTabOrder(this.state, this.state.activeSpaceId)
    if (!order.length) return
    const i = this.activeTabId ? order.indexOf(this.activeTabId) : -1
    void this.selectTab(order[(i + delta + order.length) % order.length])
  }

  togglePinActive(): void {
    const id = this.activeTabId
    if (!id) return
    const section = locateTab(this.state, id)?.section
    moveTab(this.state, id, { section: section === 'today' ? 'pinned' : 'today', spaceId: this.state.activeSpaceId }, 0)
    this.broadcast()
  }

  copyActiveUrl(): void {
    const url = this.activeWebContents()?.getURL()
    if (url) clipboard.writeText(url)
  }

  // ── Spaces ──────────────────────────────────────────────────────────────

  async selectSpace(id: Id): Promise<void> {
    const space = getSpace(this.state, id)
    if (!space) return
    this.state.activeSpaceId = id
    await this.profile(space.profileId)
    if (space.activeTabId) await this.selectTab(space.activeTabId)
    else this.views.show(null)
    this.broadcast()
  }

  selectRelativeSpace(delta: number): void {
    const i = this.state.spaces.findIndex((s) => s.id === this.state.activeSpaceId)
    const n = this.state.spaces.length
    void this.selectSpace(this.state.spaces[(i + delta + n) % n].id)
  }

  selectSpaceAt(n: number): void {
    const space = this.state.spaces[n - 1]
    if (space) void this.selectSpace(space.id)
  }

  // ── UI ──────────────────────────────────────────────────────────────────

  toggleSidebar(): void {
    this.sidebarVisible = !this.sidebarVisible
    this.views.setSidebarWidth(this.sidebarVisible ? this.sidebarWidth : 0)
    this.overlay.layout()
    this.broadcast()
  }

  openCommandBar(mode: 'new-tab' | 'edit-url'): void {
    const tabId = this.activeTabId
    const initial = mode === 'edit-url' && tabId ? (this.state.tabs[tabId]?.url ?? '') : ''
    this.overlay.set({ kind: 'command-bar', mode: tabId ? mode : 'new-tab', initial, tabId })
  }

  openFind(): void {
    const tabId = this.activeTabId
    if (tabId) this.overlay.set({ kind: 'find', tabId, matches: 0, activeMatch: 0 })
  }

  private closeOverlay(): void {
    const current = this.overlay.current
    if (current.kind === 'find') this.views.get(current.tabId)?.webContents.stopFindInPage('clearSelection')
    this.overlay.set({ kind: 'hidden' })
    this.activeWebContents()?.focus()
  }

  // ── Command bar ─────────────────────────────────────────────────────────

  async suggest(query: string): Promise<Suggestion[]> {
    const q = query.trim()
    if (!q) return this.recentTabs()
    const lower = q.toLowerCase()
    const results: Suggestion[] = []
    const looksLikeUrl = !/\s/.test(q) && (/^[a-z]+:\/\//i.test(q) || /^[^/\s]+\.[a-z]{2,}/i.test(q) || /^localhost/i.test(q))
    if (looksLikeUrl) results.push({ kind: 'url', title: q, url: resolveInput(q) })

    const openTabs = Object.values(this.state.tabs)
      .filter((t) => t.title.toLowerCase().includes(lower) || t.url.toLowerCase().includes(lower))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 4)
    for (const t of openTabs) {
      results.push({ kind: 'tab', title: t.title || t.url, subtitle: 'Passer à cet onglet', url: t.url, tabId: t.id, favicon: t.favicon })
    }

    const openUrls = new Set(openTabs.map((t) => t.url))
    for (const entry of this.history.search(q, 5)) {
      if (!openUrls.has(entry.url)) results.push({ kind: 'history', title: entry.title || entry.url, subtitle: entry.url, url: entry.url })
    }

    if (!looksLikeUrl) results.unshift({ kind: 'search', title: q, subtitle: 'Rechercher sur Google', url: resolveInput(q) })
    for (const s of await this.searchSuggestions(q)) {
      if (s.toLowerCase() !== lower) results.push({ kind: 'search', title: s, url: resolveInput(s) })
    }
    return results.slice(0, 10)
  }

  private recentTabs(): Suggestion[] {
    return Object.values(this.state.tabs)
      .filter((t) => t.id !== this.activeTabId)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 6)
      .map((t) => ({ kind: 'tab', title: t.title || t.url, subtitle: 'Passer à cet onglet', url: t.url, tabId: t.id, favicon: t.favicon }))
  }

  private async searchSuggestions(q: string): Promise<string[]> {
    try {
      const response = await net.fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(800),
      })
      const [, suggestions] = (await response.json()) as [string, string[]]
      return suggestions.slice(0, 4)
    } catch {
      return []
    }
  }

  // ── Actions de l'UI ─────────────────────────────────────────────────────

  async dispatch(action: BrowserAction | OverlayAction): Promise<void> {
    const s = this.state
    switch (action.type) {
      case 'tab.new':
        await this.newTab(action.url)
        break
      case 'tab.select':
        await this.selectTab(action.id)
        break
      case 'tab.close':
        this.closeTab(action.id)
        break
      case 'tab.navigate':
        this.views.get(action.id)?.webContents.loadURL(resolveInput(action.input))
        break
      case 'tab.back':
        this.views.get(action.id)?.webContents.navigationHistory.goBack()
        break
      case 'tab.forward':
        this.views.get(action.id)?.webContents.navigationHistory.goForward()
        break
      case 'tab.reload':
        this.views.get(action.id)?.webContents.reload()
        break
      case 'tab.resetToPinned': {
        const tab = s.tabs[action.id]
        if (tab?.pinnedUrl) this.views.get(action.id)?.webContents.loadURL(tab.pinnedUrl)
        break
      }
      case 'tab.toggleMute': {
        const wc = this.views.get(action.id)?.webContents
        wc?.setAudioMuted(!wc.isAudioMuted())
        this.broadcast()
        break
      }
      case 'tab.move':
        moveTab(s, action.id, action.to, action.index)
        this.broadcast()
        break
      case 'tab.contextMenu':
        this.tabContextMenu(action.id)
        break
      case 'folder.new': {
        const folder = createFolder(s, action.spaceId)
        this.broadcast()
        if (folder) this.sendEvent({ type: 'rename-folder', spaceId: action.spaceId, id: folder.id })
        break
      }
      case 'folder.toggle': {
        const folder = findFolder(getSpace(s, action.spaceId)?.pinned ?? [], action.id)
        if (folder) folder.open = !folder.open
        this.broadcast()
        break
      }
      case 'folder.rename': {
        const folder = findFolder(getSpace(s, action.spaceId)?.pinned ?? [], action.id)
        if (folder && action.title.trim()) folder.title = action.title.trim()
        this.broadcast()
        break
      }
      case 'folder.contextMenu':
        this.folderContextMenu(action.spaceId, action.id)
        break
      case 'space.select':
        await this.selectSpace(action.id)
        break
      case 'space.new': {
        const space = createSpace(s, `Space ${s.spaces.length + 1}`)
        await this.selectSpace(space.id)
        this.sendEvent({ type: 'rename-space', id: space.id })
        break
      }
      case 'space.update': {
        const space = getSpace(s, action.id)
        if (!space) break
        if (action.name?.trim()) space.name = action.name.trim()
        if (action.icon !== undefined) space.icon = action.icon
        if (action.theme) space.theme = action.theme
        this.broadcast()
        break
      }
      case 'space.contextMenu':
        this.spaceContextMenu(action.id)
        break
      case 'today.clear': {
        const space = getSpace(s, action.spaceId)
        if (!space) break
        for (const id of [...space.today]) {
          this.views.destroy(id)
          archiveTab(s, id)
        }
        if (space.id === s.activeSpaceId && !space.activeTabId) this.views.show(null)
        this.broadcast()
        break
      }
      case 'download.open':
        this.downloads.open(action.id)
        break
      case 'download.reveal':
        this.downloads.reveal(action.id)
        break
      case 'download.clear':
        this.downloads.clearFinished()
        break
      case 'ui.sidebarWidth':
        this.sidebarWidth = action.width
        if (this.sidebarVisible) this.views.setSidebarWidth(action.width)
        this.overlay.layout()
        break
      case 'ui.commandBar':
        this.openCommandBar(action.mode)
        break
      case 'overlay.close':
        this.closeOverlay()
        break
      case 'commandBar.submit': {
        const current = this.overlay.current
        this.closeOverlay()
        const { suggestion, input } = action
        if (suggestion?.kind === 'tab' && suggestion.tabId) {
          await this.selectTab(suggestion.tabId)
          break
        }
        const url = suggestion?.url ?? resolveInput(input)
        if (current.kind === 'command-bar' && current.mode === 'edit-url' && current.tabId) {
          this.views.get(current.tabId)?.webContents.loadURL(url)
        } else {
          await this.newTab(url)
        }
        break
      }
      case 'find.query': {
        const current = this.overlay.current
        if (current.kind !== 'find') break
        const wc = this.views.get(current.tabId)?.webContents
        if (!action.text) {
          wc?.stopFindInPage('clearSelection')
          this.overlay.set({ ...current, matches: 0, activeMatch: 0 })
        } else {
          wc?.findInPage(action.text, { forward: action.forward, findNext: action.findNext })
        }
        break
      }
    }
  }

  // ── Menus contextuels natifs ────────────────────────────────────────────

  private tabContextMenu(id: Id): void {
    const s = this.state
    const tab = s.tabs[id]
    const location = locateTab(s, id)
    if (!tab || !location) return
    const spaceId = location.spaceId ?? s.activeSpaceId
    const move = (to: TabLocation) => () => {
      moveTab(s, id, to, to.section === 'today' ? 0 : -1)
      this.broadcast()
    }
    const otherSpaces = s.spaces.filter((sp) => sp.id !== location.spaceId)
    const template: Electron.MenuItemConstructorOptions[] = [
      location.section === 'favorites'
        ? { label: 'Retirer des favoris', click: move({ section: 'pinned', spaceId }) }
        : { label: 'Ajouter aux favoris', click: move({ section: 'favorites', spaceId }) },
      location.section === 'pinned'
        ? { label: 'Désépingler', click: move({ section: 'today', spaceId }) }
        : location.section === 'today'
          ? { label: 'Épingler', click: move({ section: 'pinned', spaceId }) }
          : { label: 'Épingler dans ce Space', click: move({ section: 'pinned', spaceId: s.activeSpaceId }) },
      ...(tab.pinnedUrl && tab.pinnedUrl !== tab.url
        ? [{ label: "Revenir à l'URL d'origine", click: () => void this.dispatch({ type: 'tab.resetToPinned', id }) }]
        : []),
      { type: 'separator' },
      { label: 'Copier le lien', click: () => clipboard.writeText(tab.url) },
      { label: 'Dupliquer', click: () => void this.newTab(tab.url, { background: true, profileId: location.profileId }) },
      ...(otherSpaces.length && location.section !== 'favorites'
        ? [
            {
              label: 'Déplacer vers',
              submenu: otherSpaces.map((sp) => ({
                label: `${sp.icon ? `${sp.icon} ` : ''}${sp.name}`,
                click: move({ section: location.section === 'pinned' ? 'pinned' : 'today', spaceId: sp.id }),
              })),
            },
          ]
        : []),
      { type: 'separator' },
      {
        label: location.section === 'today' ? "Fermer l'onglet" : this.views.has(id) ? 'Décharger' : 'Supprimer',
        click: () => {
          if (location.section !== 'today' && !this.views.has(id)) {
            removeTab(s, id)
            this.broadcast()
          } else this.closeTab(id)
        },
      },
    ]
    Menu.buildFromTemplate(template).popup({ window: this.win })
  }

  private folderContextMenu(spaceId: Id, folderId: Id): void {
    Menu.buildFromTemplate([
      { label: 'Renommer', click: () => this.sendEvent({ type: 'rename-folder', spaceId, id: folderId }) },
      {
        label: 'Supprimer le dossier',
        click: () => {
          deleteFolder(this.state, spaceId, folderId)
          this.broadcast()
        },
      },
    ]).popup({ window: this.win })
  }

  private spaceContextMenu(spaceId: Id): void {
    const s = this.state
    const space = getSpace(s, spaceId)
    if (!space) return
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Renommer…', click: () => this.sendEvent({ type: 'rename-space', id: spaceId }) },
      {
        label: 'Couleur',
        submenu: SPACE_THEMES.map((theme, i) => ({
          label: THEME_NAMES[i] ?? `Thème ${i + 1}`,
          type: 'radio' as const,
          checked: space.theme.from === theme.from,
          click: () => void this.dispatch({ type: 'space.update', id: spaceId, theme }),
        })),
      },
      {
        label: 'Profil',
        submenu: [
          ...s.profiles.map((p) => ({
            label: p.name,
            type: 'radio' as const,
            checked: space.profileId === p.id,
            click: () => this.setSpaceProfile(spaceId, p.id),
          })),
          { type: 'separator' as const },
          {
            label: `Nouveau profil « ${space.name} »`,
            click: () => {
              const profile = { id: newId(), name: space.name }
              s.profiles.push(profile)
              s.favorites[profile.id] = []
              this.setSpaceProfile(spaceId, profile.id)
            },
          },
        ],
      },
      { type: 'separator' },
      { label: 'Nouveau dossier', click: () => void this.dispatch({ type: 'folder.new', spaceId }) },
      { label: 'Nouveau Space', click: () => void this.dispatch({ type: 'space.new' }) },
      { type: 'separator' },
      {
        label: 'Supprimer le Space…',
        enabled: s.spaces.length > 1,
        click: async () => {
          const { response } = await dialog.showMessageBox(this.win, {
            type: 'warning',
            message: `Supprimer le Space « ${space.name} » ?`,
            detail: 'Ses onglets épinglés et ses onglets du jour seront supprimés.',
            buttons: ['Supprimer', 'Annuler'],
            defaultId: 1,
            cancelId: 1,
          })
          if (response !== 0) return
          for (const id of deleteSpace(s, spaceId)) this.views.destroy(id)
          await this.selectSpace(s.activeSpaceId)
        },
      },
    ]
    Menu.buildFromTemplate(template).popup({ window: this.win })
  }

  /**
   * Changer le profil d'un Space : ses onglets basculent dans l'autre session (cookies, logins).
   * On décharge leurs vues ; elles se rechargeront dans la bonne session.
   */
  private setSpaceProfile(spaceId: Id, profileId: Id): void {
    const space = getSpace(this.state, spaceId)
    if (!space || space.profileId === profileId) return
    for (const id of this.views.ids()) {
      if (locateTab(this.state, id)?.spaceId === spaceId) this.views.destroy(id)
    }
    space.profileId = profileId
    if (spaceId === this.state.activeSpaceId) void this.selectSpace(spaceId)
    this.broadcast()
  }
}
