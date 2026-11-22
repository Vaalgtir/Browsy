import { join } from 'node:path'
import { BrowserWindow, Menu, clipboard, dialog, net, type WebContents } from 'electron'
import type { BrowserAction, ExtensionInfo, OverlayAction, OverlayState, SiteInfo, Suggestion, Toast, UiEvent, UiState } from '../shared/ipc'
import { CARD_INSET, type Rect } from '../shared/layout'
import {
  SPACE_PALETTE,
  activeSpace,
  addTab,
  archiveTab,
  createFolder,
  createSpace,
  createSplit,
  deleteFolder,
  deleteSpace,
  dissolveSplit,
  findFolder,
  getSpace,
  locateTab,
  moveTab,
  newId,
  profileOfTab,
  removeTab,
  splitMembers,
  tabIdsIn,
  tabTitle,
  tabsToArchive,
  visibleTabOrder,
  type Id,
  type PersistedState,
  type TabLocation,
  type TabRecord,
} from '../shared/model'
import { SEARCH_ENGINES, hostOf, isDevModeUrl, resolveInput } from '../shared/search'
import { hasArcData, importArc, readArcData } from './arcImport'
import { Downloads } from './downloads'
import { Bubble, FloatingSidebar, FLOATING_MARGIN, loadUi } from './floating'
import { History } from './history'
import { Overlay } from './Overlay'
import { permissionsFor, setPermission } from './permissions'
import { Profiles, partitionOf, type ProfileContext } from './profiles'
import { StateStore } from './store'
import { TabViews } from './TabViews'

const ARCHIVE_CHECK_MS = 5 * 60 * 1000
const MAX_CLOSED = 30
const TOAST_MS = 1800
const TOAST_SIZE = { width: 300, height: 76 }
const STATUS_SIZE = { width: 520, height: 34 }
const COLOR_NAMES = ['Bleuet', 'Lilas', 'Rose', 'Pêche', 'Citron', 'Pistache', 'Menthe', 'Ciel', 'Gris', 'Ardoise']

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
  private readonly floating: FloatingSidebar
  private readonly toastBubble: Bubble
  private readonly statusBubble: Bubble
  private readonly profiles: Profiles
  private readonly loadedProfiles = new Map<Id, ProfileContext>()
  private readonly history = new History()
  private readonly downloads: Downloads
  private readonly closed: ClosedTab[] = []
  private sidebarVisible = true
  private devBar = false
  private broadcastPending = false
  private toastTimer: NodeJS.Timeout | null = null
  /** Vue de sidebar (fixe ou flottante) qui a ouvert le menu des extensions. */
  private extensionsMenuSender: WebContents | null = null
  private toastId = 0
  private onOpenSettings: () => void = () => {}

  constructor() {
    this.state = this.store.load()
    this.win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 700,
      minHeight: 450,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 17 },
      vibrancy: 'under-window',
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
      onHoverLink: (_id, url) => this.showStatus(url),
      onFocusTab: (id) => this.focusPane(id),
      searchUrl: (q) => SEARCH_ENGINES[this.state.settings.searchEngine].url(q),
    })
    this.overlay = new Overlay(this.win, () => this.views.currentLayout().card, (overlay) => this.sendOverlay(overlay))
    this.floating = new FloatingSidebar(
      this.win,
      () => ({ width: this.state.settings.sidebarWidth, position: this.state.settings.sidebarPosition }),
      () => this.updateChrome(),
    )
    this.toastBubble = new Bubble(this.win, 'toast', () => {
      const { card } = this.views.currentLayout()
      return {
        x: card.x + Math.round((card.width - TOAST_SIZE.width) / 2),
        y: card.y + card.height - TOAST_SIZE.height - 8,
        ...TOAST_SIZE,
      }
    })
    this.statusBubble = new Bubble(this.win, 'status', () => {
      const { page } = this.views.currentLayout()
      return { x: page.x, y: page.y + page.height - STATUS_SIZE.height, width: Math.min(STATUS_SIZE.width, page.width), height: STATUS_SIZE.height }
    })
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

    this.win.on('enter-full-screen', () => this.updateChrome())
    this.win.on('leave-full-screen', () => this.updateChrome())
    this.win.once('ready-to-show', () => this.win.show())
    loadUi(this.win.webContents, 'sidebar')
    this.updateChrome()

    setInterval(() => this.archiveStale(), ARCHIVE_CHECK_MS)
  }

  /** Charge le profil du Space actif et réaffiche son onglet actif. */
  async start(): Promise<void> {
    await this.profile(activeSpace(this.state).profileId)
    this.archiveStale()
    const space = activeSpace(this.state)
    if (space.activeTabId) await this.selectTab(space.activeTabId)
    this.broadcast()
    if (!this.state.settings.arcImport && hasArcData()) setTimeout(() => void this.importFromArc(true), 800)
  }

  flush(): void {
    this.store.saveNow(this.state)
    this.history.close()
  }

  setSettingsOpener(open: () => void): void {
    this.onOpenSettings = open
  }

  get settings() {
    return this.state.settings
  }

  // ── État envoyé à l'UI ──────────────────────────────────────────────────

  get activeTabId(): Id | null {
    return activeSpace(this.state).activeTabId ?? null
  }

  /** Dev : vue de l'overlay (captures automatisées). */
  get overlayWebContents(): WebContents {
    return this.overlay.view.webContents
  }

  /** Dev : vues de l'interface (captures automatisées). */
  devViews() {
    return { floating: this.floating, toast: this.toastBubble.view.webContents, overlay: this.overlay.view.webContents }
  }

  viewOf(id: Id) {
    return this.views.get(id)
  }

  activeWebContents(): WebContents | undefined {
    const id = this.activeTabId
    return id ? this.views.get(id)?.webContents : undefined
  }

  private devModeActive(): boolean {
    const id = this.activeTabId
    const url = id ? this.state.tabs[id]?.url : undefined
    return !!url && this.views.shown.length <= 1 && isDevModeUrl(url, this.state.settings.devModeHosts)
  }

  uiState(): UiState {
    return {
      persisted: this.state,
      live: this.views.live(),
      activeTabId: this.activeTabId,
      shownTabIds: this.views.shown,
      sidebarVisible: this.sidebarVisible,
      fullscreen: this.win.isFullScreen(),
      layout: this.views.currentLayout(),
      devMode: this.devModeActive(),
      downloads: this.downloads.list(),
      partition: partitionOf(activeSpace(this.state).profileId),
    }
  }

  overlayState(): OverlayState {
    return this.overlay.current
  }

  private uiContents(): WebContents[] {
    return [this.win.webContents, this.floating.view.webContents, this.overlay.view.webContents].filter((wc) => !wc.isDestroyed())
  }

  /** Regroupe les mises à jour d'une même frame, sauvegarde et notifie l'UI. */
  private broadcast(): void {
    if (this.broadcastPending) return
    this.broadcastPending = true
    setImmediate(() => {
      this.broadcastPending = false
      this.store.scheduleSave(this.state)
      // La barre du Developer Mode dépend de l'onglet affiché.
      const devBar = this.devModeActive()
      if (devBar !== this.devBar) {
        this.devBar = devBar
        this.views.setLayout({ devBar })
      }
      const state = this.uiState()
      for (const wc of this.uiContents()) wc.send('ui:state', state)
    })
  }

  private sendOverlay(overlay: OverlayState): void {
    for (const wc of this.uiContents()) wc.send('ui:overlay', overlay)
  }

  private sendEvent(event: UiEvent): void {
    for (const wc of [this.win.webContents, this.floating.view.webContents]) if (!wc.isDestroyed()) wc.send('ui:event', event)
  }

  /** Mise en page de la fenêtre : sidebar, plein écran, feux tricolores, sidebar flottante. */
  private updateChrome(): void {
    const { sidebarWidth, sidebarPosition } = this.state.settings
    const fullscreen = this.win.isFullScreen()
    this.devBar = this.devModeActive()
    this.views.setLayout({ sidebarVisible: this.sidebarVisible, sidebarWidth, position: sidebarPosition, fullscreen, devBar: this.devBar })
    this.floating.setEnabled(!this.sidebarVisible)
    // Feux tricolores : avec la sidebar (docked ou flottante), comme dans Arc.
    this.win.setWindowButtonVisibility(this.sidebarVisible || this.floating.isShown)
    this.win.setWindowButtonPosition(
      this.floating.isShown && sidebarPosition === 'left' ? { x: 16 + FLOATING_MARGIN, y: 17 + CARD_INSET } : { x: 16, y: 17 },
    )
    this.overlay.layout()
    this.broadcast()
  }

  // ── Notifications ───────────────────────────────────────────────────────

  showToast(message: string, detail?: string): void {
    const toast: Toast = { id: ++this.toastId, message, detail }
    this.toastBubble.show()
    const send = () => this.toastBubble.view.webContents.send('ui:toast', toast)
    if (this.toastBubble.view.webContents.isLoading()) this.toastBubble.view.webContents.once('did-finish-load', send)
    else send()
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      this.toastBubble.view.webContents.send('ui:toast', null)
      // Laisse l'animation de sortie se jouer avant de retirer la vue.
      this.toastTimer = setTimeout(() => this.toastBubble.hide(), 200)
    }, TOAST_MS)
  }

  private showStatus(url: string): void {
    this.statusBubble.view.webContents.send('ui:status', url)
    if (url) this.statusBubble.show()
    else this.statusBubble.hide()
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

  private resolve(input: string): string {
    return resolveInput(input, this.state.settings.searchEngine)
  }

  async newTab(url?: string, options: { background?: boolean; profileId?: Id } = {}): Promise<Id> {
    let space = activeSpace(this.state)
    if (options.profileId && options.profileId !== space.profileId) {
      space = this.state.spaces.find((s) => s.profileId === options.profileId) ?? space
    }
    const now = Date.now()
    const record: TabRecord = { id: newId(), url: this.resolve(url ?? ''), title: '', createdAt: now, lastActiveAt: now }
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
    const profile = await this.profile(location.profileId)
    // Split View : on affiche tous les onglets du groupe, avec le focus sur celui choisi.
    const { split, tabs } = splitMembers(this.state, id)
    for (const memberId of tabs) {
      const member = this.state.tabs[memberId]
      if (member) this.views.ensure(memberId, member.url, profile)
    }
    if (this.overlay.current.kind === 'find') this.closeOverlay()
    this.views.show(tabs, split?.sizes, id)
    this.updateChrome()
  }

  /** Clic dans un autre panneau d'un Split View : il devient l'onglet actif. */
  private focusPane(id: Id): void {
    if (!this.views.shown.includes(id) || this.activeTabId === id) return
    const space = activeSpace(this.state)
    space.activeTabId = id
    const tab = this.state.tabs[id]
    if (tab) tab.lastActiveAt = Date.now()
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
    const others = this.views.shown.filter((x) => x !== id)
    let next: Id | undefined
    if (wasActive && !others.length) {
      const order = tabIdsIn(space.today)
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
      if (others.length) void this.selectTab(others[0])
      else if (next) void this.selectTab(next)
      else this.views.show([])
    }
    this.updateChrome()
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
    if (patch.url && id === this.activeTabId) this.updateChrome()
    else this.broadcast()
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

  copyUrl(id: Id | null = this.activeTabId, markdown = false): void {
    const tab = id ? this.state.tabs[id] : undefined
    const url = (id && this.views.get(id)?.webContents.getURL()) || tab?.url
    if (!url || !tab) return
    clipboard.writeText(markdown ? `[${tabTitle(tab).replace(/[[\]]/g, '')}](${url})` : url)
    this.showToast(markdown ? 'Lien Markdown copié' : 'Lien copié', url)
  }

  /** Split View de l'onglet actif avec l'onglet suivant de la liste (⌃⇧=). */
  splitActiveWithNext(): void {
    const id = this.activeTabId
    if (!id) return
    const order = visibleTabOrder(this.state, this.state.activeSpaceId).filter((x) => x !== id && locateTab(this.state, x)?.section !== 'favorites')
    const members = splitMembers(this.state, id).tabs
    const candidate = order.find((x) => !members.includes(x))
    if (!candidate) return
    createSplit(this.state, [...members, candidate])
    void this.selectTab(id)
  }

  // ── Import Arc ──────────────────────────────────────────────────────────

  /** Importe Spaces, épinglés, favoris, Developer Mode et Air Traffic Control depuis Arc. */
  async importFromArc(firstLaunch = false): Promise<void> {
    if (!hasArcData()) {
      await dialog.showMessageBox(this.win, { type: 'info', message: "Aucune donnée d'Arc trouvée sur ce Mac." })
      return
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question',
      message: 'Importer tes Spaces depuis Arc ?',
      detail:
        "Spaces (thèmes et icônes), onglets épinglés, dossiers, Split Views, favoris, sites en Developer Mode et règles d'Air Traffic Control. " +
        "Les données d'Arc ne sont pas modifiées. Les connexions aux sites (cookies) ne sont pas reprises.",
      buttons: firstLaunch ? ['Importer', 'Plus tard', 'Ne plus demander'] : ['Importer', 'Annuler'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 2) {
      this.state.settings.arcImport = 'declined'
      this.broadcast()
    }
    if (response !== 0) return
    try {
      const summary = importArc(this.state, readArcData())
      await this.selectSpace(this.state.activeSpaceId)
      await dialog.showMessageBox(this.win, {
        type: 'info',
        message: 'Import terminé',
        detail: `${summary.spaces} Spaces, ${summary.pinned} onglets épinglés, ${summary.favorites} favoris, ${summary.devModeHosts} sites en Developer Mode, ${summary.linkRules} règle(s) de liens.`,
      })
    } catch (error) {
      await dialog.showMessageBox(this.win, { type: 'error', message: "L'import a échoué", detail: String(error) })
    }
  }

  // ── Spaces ──────────────────────────────────────────────────────────────

  async selectSpace(id: Id): Promise<void> {
    const space = getSpace(this.state, id)
    if (!space) return
    this.state.activeSpaceId = id
    await this.profile(space.profileId)
    if (space.activeTabId) await this.selectTab(space.activeTabId)
    else this.views.show([])
    this.updateChrome()
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
    if (this.sidebarVisible) this.floating.hide()
    this.updateChrome()
  }

  openCommandBar(mode: 'new-tab' | 'edit-url'): void {
    const tabId = this.activeTabId
    const initial = mode === 'edit-url' && tabId ? (this.views.get(tabId)?.webContents.getURL() || this.state.tabs[tabId]?.url || '') : ''
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

  toggleDevMode(host = hostOf(this.state.tabs[this.activeTabId ?? '']?.url ?? '')): void {
    if (!host) return
    const hosts = this.state.settings.devModeHosts
    const enabled = hosts.includes(host)
    this.state.settings.devModeHosts = enabled ? hosts.filter((h) => h !== host) : [...hosts, host]
    this.showToast(enabled ? 'Developer Mode désactivé' : 'Developer Mode activé', host)
    this.updateChrome()
    if (this.overlay.current.kind === 'site-controls') void this.openSiteControls()
  }

  // ── Contrôles du site ───────────────────────────────────────────────────

  private async siteInfo(tabId: Id): Promise<SiteInfo | undefined> {
    const tab = this.state.tabs[tabId]
    if (!tab) return undefined
    const wc = this.views.get(tabId)?.webContents
    const url = wc?.getURL() || tab.url
    let origin = ''
    let secure = false
    try {
      const parsed = new URL(url)
      origin = parsed.origin
      secure = parsed.protocol === 'https:'
    } catch {
      /* URL interne */
    }
    return {
      tabId,
      url,
      host: hostOf(url),
      origin,
      secure,
      zoom: wc?.getZoomFactor() ?? 1,
      devMode: isDevModeUrl(url, this.state.settings.devModeHosts),
      permissions: origin ? permissionsFor(origin) : [],
    }
  }

  async openSiteControls(anchor?: Rect): Promise<void> {
    const tabId = this.activeTabId
    const site = tabId ? await this.siteInfo(tabId) : undefined
    if (!site) return
    this.overlay.set({ kind: 'site-controls', site }, anchor)
  }

  // ── Extensions ──────────────────────────────────────────────────────────

  /** Extensions du profil actif ayant un bouton, avec leur état épinglé. */
  private async extensionList(): Promise<ExtensionInfo[]> {
    const profileId = activeSpace(this.state).profileId
    const profile = await this.profile(profileId)
    const pinned = this.state.settings.pinnedExtensions[profileId]
    return profile.session.extensions
      .getAllExtensions()
      .filter((e) => e.manifest.action || e.manifest.browser_action)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e, i) => ({ id: e.id, name: e.name, pinned: pinned ? pinned.includes(e.id) : i < 3 }))
  }

  /** Petit menu des extensions (bouton puzzle de la barre d'URL). */
  async openExtensionsMenu(anchor?: Rect): Promise<void> {
    const extensions = await this.extensionList()
    this.overlay.set({ kind: 'extensions', extensions, partition: partitionOf(activeSpace(this.state).profileId) }, anchor)
  }

  /** Position d'un élément de la sidebar flottante, ramenée aux coordonnées de la fenêtre. */
  translateAnchor(sender: WebContents, anchor: Rect): Rect {
    if (sender !== this.floating.view.webContents) return anchor
    const bounds = this.floating.view.getBounds()
    return { ...anchor, x: anchor.x + bounds.x, y: anchor.y + bounds.y }
  }

  /** Library > Historique : recherche, ou dernières pages visitées si la requête est vide. */
  searchHistory(query: string) {
    const entries = query.trim() ? this.history.search(query, 60) : this.history.recent(60)
    return entries.map(({ url, title, lastVisitAt }) => ({ url, title, lastVisitAt }))
  }

  // ── Command bar ─────────────────────────────────────────────────────────

  async suggest(query: string): Promise<Suggestion[]> {
    const q = query.trim()
    if (!q) return this.recentTabs()
    const lower = q.toLowerCase()
    const results: Suggestion[] = []
    const looksLikeUrl = !/\s/.test(q) && (/^[a-z]+:\/\//i.test(q) || /^[^/\s]+\.[a-z]{2,}/i.test(q) || /^localhost/i.test(q))
    if (looksLikeUrl) results.push({ kind: 'url', title: q, url: this.resolve(q) })

    const openTabs = Object.values(this.state.tabs)
      .filter((t) => tabTitle(t).toLowerCase().includes(lower) || t.url.toLowerCase().includes(lower))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 4)
    for (const t of openTabs) {
      results.push({ kind: 'tab', title: tabTitle(t), subtitle: 'Passer à cet onglet', url: t.url, tabId: t.id, favicon: t.favicon })
    }

    const openUrls = new Set(openTabs.map((t) => t.url))
    for (const entry of this.history.search(q, 5)) {
      if (!openUrls.has(entry.url)) results.push({ kind: 'history', title: entry.title || entry.url, subtitle: entry.url, url: entry.url })
    }

    const engine = SEARCH_ENGINES[this.state.settings.searchEngine]
    if (!looksLikeUrl) results.unshift({ kind: 'search', title: q, subtitle: `Rechercher sur ${engine.name}`, url: this.resolve(q) })
    for (const s of await this.searchSuggestions(q)) {
      if (s.toLowerCase() !== lower) results.push({ kind: 'search', title: s, url: engine.url(s) })
    }
    return results.slice(0, 10)
  }

  private recentTabs(): Suggestion[] {
    return Object.values(this.state.tabs)
      .filter((t) => t.id !== this.activeTabId)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 6)
      .map((t) => ({ kind: 'tab', title: tabTitle(t), subtitle: 'Passer à cet onglet', url: t.url, tabId: t.id, favicon: t.favicon }))
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

  async dispatch(action: BrowserAction | OverlayAction, sender?: WebContents): Promise<void> {
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
        this.views.get(action.id)?.webContents.loadURL(this.resolve(action.input))
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
      case 'tab.rename': {
        const tab = s.tabs[action.id]
        if (tab) tab.customTitle = action.title.trim() && action.title.trim() !== tab.title ? action.title.trim() : undefined
        this.broadcast()
        break
      }
      case 'tab.contextMenu':
        this.tabContextMenu(action.id)
        break
      case 'tab.copyUrl':
        this.copyUrl(action.id ?? this.activeTabId, action.markdown)
        break
      case 'tab.devtools':
        this.views.get(action.id)?.webContents.openDevTools()
        break
      case 'split.create': {
        const split = createSplit(s, action.ids)
        if (split) await this.selectTab(action.ids[0])
        break
      }
      case 'split.dissolve': {
        const active = this.activeTabId
        dissolveSplit(s, action.id)
        if (active) await this.selectTab(active)
        break
      }
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
        if (action.archiveAfterHours !== undefined) space.archiveAfterHours = action.archiveAfterHours ?? undefined
        this.broadcast()
        break
      }
      case 'space.contextMenu':
        this.spaceContextMenu(action.id)
        break
      case 'space.newMenu':
        Menu.buildFromTemplate([
          { label: 'Nouvel onglet', accelerator: 'CmdOrCtrl+T', click: () => this.openCommandBar('new-tab') },
          { label: 'Nouveau dossier', click: () => void this.dispatch({ type: 'folder.new', spaceId: s.activeSpaceId }) },
          { type: 'separator' },
          { label: 'Nouveau Space', click: () => void this.dispatch({ type: 'space.new' }) },
        ]).popup({ window: this.win })
        break
      case 'today.clear': {
        const space = getSpace(s, action.spaceId)
        if (!space) break
        for (const id of tabIdsIn(space.today)) {
          this.views.destroy(id)
          archiveTab(s, id)
        }
        if (space.id === s.activeSpaceId && !space.activeTabId) this.views.show([])
        this.updateChrome()
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
      case 'devMode.toggle':
        this.toggleDevMode(action.host)
        break
      case 'extension.pin': {
        const profileId = activeSpace(s).profileId
        const current = s.settings.pinnedExtensions[profileId] ?? (await this.extensionList()).filter((e) => e.pinned).map((e) => e.id)
        s.settings.pinnedExtensions[profileId] = action.pinned ? [...new Set([...current, action.id])] : current.filter((x) => x !== action.id)
        this.broadcast()
        if (this.overlay.current.kind === 'extensions') void this.openExtensionsMenu()
        break
      }
      case 'extension.activate': {
        // Le popup de l'extension s'ouvre depuis la sidebar, ancré sur le bouton puzzle.
        const target = this.extensionsMenuSender && !this.extensionsMenuSender.isDestroyed() ? this.extensionsMenuSender : this.win.webContents
        this.closeOverlay()
        target.send('ui:event', { type: 'activate-extension', id: action.id } satisfies UiEvent)
        break
      }
      case 'ui.extensionsMenu':
        this.extensionsMenuSender = sender ?? null
        await this.openExtensionsMenu(sender ? this.translateAnchor(sender, action.anchor) : action.anchor)
        break
      case 'settings.update':
        Object.assign(s.settings, action.patch)
        this.updateChrome()
        break
      case 'ui.sidebarWidth':
        s.settings.sidebarWidth = Math.round(action.width)
        this.updateChrome()
        break
      case 'ui.toggleSidebar':
        this.toggleSidebar()
        break
      case 'ui.commandBar':
        this.openCommandBar(action.mode)
        break
      case 'ui.siteControls':
        await this.openSiteControls(sender ? this.translateAnchor(sender, action.anchor) : action.anchor)
        break
      case 'ui.openSettings':
        this.onOpenSettings()
        break
      case 'archive.restore': {
        const [entry] = s.archive.splice(action.index, 1)
        if (!entry) break
        const space = getSpace(s, entry.spaceId) ?? activeSpace(s)
        if (space.id !== s.activeSpaceId) await this.selectSpace(space.id)
        await this.newTab(entry.url)
        break
      }
      case 'history.open':
        await this.newTab(action.url)
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
        const url = suggestion?.url ?? this.resolve(input)
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
      case 'site.zoom': {
        const wc = this.views.get(action.tabId)?.webContents
        if (!wc) break
        const levels = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
        const current = wc.getZoomFactor()
        const index = levels.findIndex((l) => l >= current - 0.001)
        const next = action.delta === 0 ? 1 : levels[Math.min(levels.length - 1, Math.max(0, index + action.delta))]
        wc.setZoomFactor(next)
        if (this.overlay.current.kind === 'site-controls') void this.openSiteControls()
        break
      }
      case 'site.permission':
        setPermission(action.key, action.decision)
        if (this.overlay.current.kind === 'site-controls') void this.openSiteControls()
        break
      case 'site.clearData': {
        const site = await this.siteInfo(action.tabId)
        const wc = this.views.get(action.tabId)?.webContents
        if (!site?.origin || !wc) break
        await wc.session.clearStorageData({ origin: site.origin })
        this.closeOverlay()
        this.showToast('Données du site effacées', site.host)
        wc.reload()
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
    const active = this.activeTabId
    const template: Electron.MenuItemConstructorOptions[] = [
      location.section === 'favorites'
        ? { label: 'Retirer des favoris', click: move({ section: 'pinned', spaceId }) }
        : { label: 'Ajouter aux favoris', click: move({ section: 'favorites', spaceId }) },
      location.section === 'pinned'
        ? { label: 'Désépingler', click: move({ section: 'today', spaceId }) }
        : location.section === 'today'
          ? { label: 'Épingler', click: move({ section: 'pinned', spaceId }) }
          : { label: 'Épingler dans ce Space', click: move({ section: 'pinned', spaceId: s.activeSpaceId }) },
      ...(location.section !== 'today' ? [{ label: 'Renommer…', click: () => this.sendEvent({ type: 'rename-tab', id }) }] : []),
      ...(tab.pinnedUrl && tab.pinnedUrl !== tab.url
        ? [{ label: "Revenir à l'URL d'origine", click: () => void this.dispatch({ type: 'tab.resetToPinned', id }) }]
        : []),
      { type: 'separator' },
      ...(location.splitId
        ? [{ label: 'Quitter le Split View', click: () => void this.dispatch({ type: 'split.dissolve', id: location.splitId! }) }]
        : active && active !== id && location.section !== 'favorites' && locateTab(s, active)?.section !== 'favorites'
          ? [{ label: "Split View avec l'onglet actif", click: () => void this.dispatch({ type: 'split.create', ids: [active, id] }) }]
          : []),
      { label: 'Copier le lien', click: () => this.copyUrl(id) },
      { label: 'Dupliquer', click: () => void this.newTab(tab.url, { background: true, profileId: location.profileId }) },
      ...(otherSpaces.length && location.section !== 'favorites'
        ? [
            {
              label: 'Déplacer vers',
              submenu: otherSpaces.map((sp) => ({
                label: sp.name,
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
    const archiveOptions: [string, number | null][] = [
      ['Réglage général', null],
      ['12 heures', 12],
      ['24 heures', 24],
      ['7 jours', 24 * 7],
      ['30 jours', 24 * 30],
      ['Jamais', 0],
    ]
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Renommer…', click: () => this.sendEvent({ type: 'rename-space', id: spaceId }) },
      {
        label: 'Couleur',
        submenu: SPACE_PALETTE.map((color, i) => ({
          label: COLOR_NAMES[i] ?? color,
          type: 'radio' as const,
          checked: space.theme.colors[0] === color,
          click: () => void this.dispatch({ type: 'space.update', id: spaceId, theme: { ...space.theme, colors: [color] } }),
        })),
      },
      {
        label: 'Archiver les onglets après',
        submenu: archiveOptions.map(([label, hours]) => ({
          label,
          type: 'radio' as const,
          checked: (space.archiveAfterHours ?? null) === hours,
          click: () => void this.dispatch({ type: 'space.update', id: spaceId, archiveAfterHours: hours }),
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
