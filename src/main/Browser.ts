import { join } from 'node:path'
import { BrowserWindow, Menu, WebContentsView, app as electronApp, clipboard, dialog, net, type WebContents } from 'electron'
import type { BrowserAction, ExtensionInfo, LittleAction, OverlayAction, OverlayState, SiteInfo, Suggestion, Toast, UiEvent, UiState } from '../shared/ipc'
import { CARD_INSET, type Rect } from '../shared/layout'
import {
  DEFAULT_PROFILE_ID,
  SPACE_PALETTE,
  addTab,
  archiveTab,
  createFolder,
  createInitialState,
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
  visibleTabOrder,
  type Id,
  type PersistedState,
  type Space,
  type TabLocation,
  type TabRecord,
} from '../shared/model'
import { SEARCH_ENGINES, hostOf, isDevModeUrl, resolveInput } from '../shared/search'
import type { App } from './App'
import { hasArcData, importArc, readArcData } from './arcImport'
import { COMMANDS } from './commands'
import { Bubble, FloatingSidebar, FLOATING_MARGIN, loadUi } from './floating'
import { Overlay } from './Overlay'
import { permissionsFor, setPermission } from './permissions'
import { partitionOf, type ProfileContext } from './profiles'
import { TabViews } from './TabViews'

const TOAST_MS = 1800
const TOAST_SIZE = { width: 300, height: 76 }
const STATUS_SIZE = { width: 520, height: 34 }
const COLOR_NAMES = ['Bleuet', 'Lilas', 'Rose', 'Pêche', 'Citron', 'Pistache', 'Menthe', 'Ciel', 'Gris', 'Ardoise']
/** Marge du panneau Peek dans la carte de contenu. */
const PEEK_INSET = { x: 56, top: 64, bottom: 28 }

/** Script de page : Picture-in-Picture sur la vidéo en cours de lecture. */
const ENTER_PIP = `(async () => {
  const video = [...document.querySelectorAll('video')].find((v) => !v.paused && !v.ended && v.readyState > 2 && !v.disablePictureInPicture)
  if (video && document.pictureInPictureElement !== video) await video.requestPictureInPicture()
})().catch(() => {})`
const EXIT_PIP = `document.pictureInPictureElement && document.exitPictureInPicture().catch(() => {})`
/** Script de page : lecture/pause du média principal. */
const TOGGLE_MEDIA = `(() => {
  const media = [...document.querySelectorAll('video, audio')]
  const playing = media.find((m) => !m.paused && !m.ended)
  if (playing) { playing.pause(); return false }
  const candidate = media.find((m) => m.currentTime > 0) ?? media[0]
  if (candidate) { candidate.play(); return true }
  return false
})()`

export interface BrowserOptions {
  private: boolean
  privateIndex: number
  spaceId?: Id
}

/** Une fenêtre de Browsy : sidebar, pages, overlay. L'état est partagé par l'application. */
export class Browser {
  readonly win: BrowserWindow
  readonly isPrivate: boolean
  spaceId: Id
  private readonly ownState: PersistedState | null
  private readonly privateProfile: ProfileContext | null
  private readonly views: TabViews
  private readonly overlay: Overlay
  private readonly floating: FloatingSidebar
  private readonly toastBubble: Bubble
  private readonly statusBubble: Bubble
  private sidebarVisible = true
  private devBar = false
  private broadcastPending = false
  private toastTimer: NodeJS.Timeout | null = null
  private toastId = 0
  /** Vue de sidebar (fixe ou flottante) qui a ouvert le menu des extensions. */
  private extensionsMenuSender: WebContents | null = null
  /** Onglets qui ont joué un média dans cette session (contrôles dans la sidebar). */
  private readonly mediaTabs = new Set<Id>()
  /** Onglets passés en Picture-in-Picture automatique. */
  private readonly pipTabs = new Set<Id>()
  private peek: { view: WebContentsView; profile: ProfileContext; fromId: Id } | null = null

  constructor(
    readonly app: App,
    options: BrowserOptions,
  ) {
    this.isPrivate = options.private
    if (this.isPrivate) {
      const state = createInitialState()
      const profile = app.privateProfile(options.privateIndex)
      state.profiles = [{ id: profile.id, name: 'Navigation privée' }]
      state.favorites = { [profile.id]: [] }
      state.spaces[0] = {
        ...state.spaces[0],
        name: 'Navigation privée',
        icon: 'icon:moon',
        profileId: profile.id,
        theme: { colors: ['#3a3a44'], grain: 0.4, appearance: 'dark' },
      }
      state.settings = { ...app.state.settings, archiveAfterHours: 0 }
      this.ownState = state
      this.privateProfile = profile
    } else {
      this.ownState = null
      this.privateProfile = null
    }
    this.spaceId = (options.spaceId && getSpace(this.state, options.spaceId) ? options.spaceId : this.state.spaces[0].id) as Id

    const offset = app.windowCount * 24
    this.win = new BrowserWindow({
      width: 1400,
      height: 900,
      x: offset ? 80 + offset : undefined,
      y: offset ? 60 + offset : undefined,
      minWidth: 700,
      minHeight: 450,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 16, y: 17 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      show: false,
      webPreferences: { preload: join(__dirname, '../preload/ui.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    this.views = new TabViews(this.win, {
      onRecordChange: (id, patch) => this.updateRecord(id, patch),
      onVisit: (_id, url, title) => !this.isPrivate && app.history.recordVisit(url, title),
      onLiveChange: () => this.onLiveChange(),
      onOpenTab: (fromId, url, background) => void this.newTab(url, { background, profileId: profileOfTab(this.state, fromId) }),
      onFoundInPage: (id, matches, activeMatch) => {
        if (this.overlay.current.kind === 'find' && this.overlay.current.tabId === id) this.overlay.set({ kind: 'find', tabId: id, matches, activeMatch })
      },
      onClosedByPage: (id) => this.closeTab(id),
      onHoverLink: (_id, url) => this.showStatus(url),
      onFocusTab: (id) => this.focusPane(id),
      searchUrl: (q) => SEARCH_ENGINES[this.state.settings.searchEngine].url(q),
      shouldPeek: (id, url) => this.shouldPeek(id, url),
      onPeek: (id, url) => void this.openPeek(url, id),
    })
    this.overlay = new Overlay(this.win, () => this.views.currentLayout().card, (overlay) => this.onOverlayChange(overlay))
    this.floating = new FloatingSidebar(
      this.win,
      () => ({ width: this.state.settings.sidebarWidth, position: this.state.settings.sidebarPosition }),
      () => this.updateChrome(),
    )
    this.toastBubble = new Bubble(this.win, 'toast', () => {
      const { card } = this.views.currentLayout()
      return { x: card.x + Math.round((card.width - TOAST_SIZE.width) / 2), y: card.y + card.height - TOAST_SIZE.height - 8, ...TOAST_SIZE }
    })
    this.statusBubble = new Bubble(this.win, 'status', () => {
      const { page } = this.views.currentLayout()
      return { x: page.x, y: page.y + page.height - STATUS_SIZE.height, width: Math.min(STATUS_SIZE.width, page.width), height: STATUS_SIZE.height }
    })

    this.win.on('enter-full-screen', () => this.updateChrome())
    this.win.on('leave-full-screen', () => this.updateChrome())
    this.win.on('resize', () => this.layoutPeek())
    this.win.on('closed', () => {
      this.floating.setEnabled(false)
      this.closePeek()
      this.views.destroyAll()
    })
    this.win.once('ready-to-show', () => this.win.show())
    loadUi(this.win.webContents, 'sidebar')
    this.updateChrome()
  }

  /** Réaffiche l'onglet actif du Space (au lancement). */
  async restore(): Promise<void> {
    await this.profile(this.space.profileId)
    if (this.space.activeTabId) await this.selectTab(this.space.activeTabId)
    this.broadcast()
  }

  // ── Accès ───────────────────────────────────────────────────────────────

  get state(): PersistedState {
    return this.ownState ?? this.app.state
  }

  get settings() {
    return this.state.settings
  }

  get space(): Space {
    return getSpace(this.state, this.spaceId) ?? this.state.spaces[0]
  }

  get activeSpaceId(): Id {
    return this.space.id
  }

  get activeTabId(): Id | null {
    return this.space.activeTabId ?? null
  }

  viewOf(id: Id) {
    return this.views.get(id)
  }

  hasView(id: Id): boolean {
    return this.views.has(id)
  }

  tabIdOf(wc: WebContents): Id | undefined {
    return this.views.idOf(wc)
  }

  destroyView(id: Id): void {
    this.views.destroy(id)
  }

  activeWebContents(): WebContents | undefined {
    const id = this.activeTabId
    return id ? this.views.get(id)?.webContents : undefined
  }

  ownsUi(wc: WebContents): boolean {
    return this.uiContents().includes(wc) || wc === this.toastBubble.view.webContents || wc === this.statusBubble.view.webContents
  }

  /** Dev : vues de l'interface (captures automatisées). */
  devViews() {
    return { floating: this.floating, toast: this.toastBubble.view.webContents, overlay: this.overlay.view.webContents }
  }

  get overlayWebContents(): WebContents {
    return this.overlay.view.webContents
  }

  private async profile(profileId: Id): Promise<ProfileContext> {
    return this.privateProfile ?? this.app.profile(profileId)
  }

  /** L'état a changé : toutes les fenêtres (état partagé) ou celle-ci (navigation privée). */
  private changed(): void {
    if (this.isPrivate) this.broadcast()
    else this.app.changed()
  }

  private resolve(input: string): string {
    return resolveInput(input, this.state.settings.searchEngine)
  }

  // ── État envoyé à l'UI ──────────────────────────────────────────────────

  private devModeActive(): boolean {
    const id = this.activeTabId
    const url = id ? this.state.tabs[id]?.url : undefined
    return !!url && this.views.shown.length <= 1 && isDevModeUrl(url, this.state.settings.devModeHosts)
  }

  uiState(): UiState {
    const live = this.views.live()
    const shown = this.views.shown
    return {
      persisted: this.state,
      spaceId: this.space.id,
      isPrivate: this.isPrivate,
      mediaTabIds: [...this.mediaTabs].filter((id) => live[id] && this.state.tabs[id] && !shown.includes(id)),
      live,
      activeTabId: this.activeTabId,
      shownTabIds: shown,
      sidebarVisible: this.sidebarVisible,
      fullscreen: this.win.isFullScreen(),
      layout: this.views.currentLayout(),
      devMode: this.devModeActive(),
      downloads: this.app.downloads.list(),
      partition: this.privateProfile ? this.privateProfile.id : partitionOf(this.space.profileId),
    }
  }

  overlayState(): OverlayState {
    return this.overlay.current
  }

  private uiContents(): WebContents[] {
    return [this.win.webContents, this.floating.view.webContents, this.overlay.view.webContents].filter((wc) => !wc.isDestroyed())
  }

  /** Regroupe les mises à jour d'une même frame et notifie l'UI de cette fenêtre. */
  broadcast(): void {
    if (this.broadcastPending || this.win.isDestroyed()) return
    this.broadcastPending = true
    setImmediate(() => {
      this.broadcastPending = false
      if (this.win.isDestroyed()) return
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

  private onLiveChange(): void {
    for (const [id, live] of Object.entries(this.views.live())) if (live.audible) this.mediaTabs.add(id)
    this.broadcast()
  }

  private onOverlayChange(overlay: OverlayState): void {
    for (const wc of this.uiContents()) wc.send('ui:overlay', overlay)
    if (overlay.kind !== 'peek') this.closePeek(false)
  }

  private sendEvent(event: UiEvent): void {
    for (const wc of [this.win.webContents, this.floating.view.webContents]) if (!wc.isDestroyed()) wc.send('ui:event', event)
  }

  /** Mise en page de la fenêtre : sidebar, plein écran, feux tricolores, sidebar flottante. */
  updateChrome(): void {
    if (this.win.isDestroyed()) return
    const { sidebarWidth, sidebarPosition } = this.state.settings
    const fullscreen = this.win.isFullScreen()
    this.devBar = this.devModeActive()
    this.views.setLayout({ sidebarVisible: this.sidebarVisible, sidebarWidth, position: sidebarPosition, fullscreen, devBar: this.devBar })
    this.floating.setEnabled(!this.sidebarVisible)
    // Feux tricolores : avec la sidebar (fixe ou flottante), comme dans Arc.
    this.win.setWindowButtonVisibility(this.sidebarVisible || this.floating.isShown)
    this.win.setWindowButtonPosition(this.floating.isShown && sidebarPosition === 'left' ? { x: 16 + FLOATING_MARGIN, y: 17 + CARD_INSET } : { x: 16, y: 17 })
    this.overlay.layout()
    this.layoutPeek()
    this.broadcast()
  }

  // ── Notifications ───────────────────────────────────────────────────────

  showToast(message: string, detail?: string): void {
    const toast: Toast = { id: ++this.toastId, message, detail }
    this.toastBubble.show()
    const wc = this.toastBubble.view.webContents
    const send = () => wc.send('ui:toast', toast)
    if (wc.isLoading()) wc.once('did-finish-load', send)
    else send()
    if (this.toastTimer) clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => {
      wc.send('ui:toast', null)
      // Laisse l'animation de sortie se jouer avant de retirer la vue.
      this.toastTimer = setTimeout(() => this.toastBubble.hide(), 200)
    }, TOAST_MS)
  }

  private showStatus(url: string): void {
    this.statusBubble.view.webContents.send('ui:status', url)
    if (url) this.statusBubble.show()
    else this.statusBubble.hide()
  }

  // ── Onglets ─────────────────────────────────────────────────────────────

  async newTab(url?: string, options: { background?: boolean; profileId?: Id } = {}): Promise<Id> {
    let space = this.space
    if (options.profileId && options.profileId !== space.profileId) {
      space = this.state.spaces.find((s) => s.profileId === options.profileId) ?? space
    }
    const now = Date.now()
    const record: TabRecord = { id: newId(), url: this.resolve(url ?? ''), title: '', createdAt: now, lastActiveAt: now }
    addTab(this.state, record, space.id)
    this.views.ensure(record.id, record.url, await this.profile(space.profileId))
    if (!options.background) await this.selectTab(record.id)
    else this.changed()
    return record.id
  }

  /** Fait venir dans cette fenêtre la vue d'un onglet affiché ailleurs. */
  private claim(id: Id): void {
    if (this.views.has(id)) return
    const owner = this.app.ownerOf(id)
    if (!owner || owner === this) return
    const entry = owner.views.release(id)
    if (entry) this.views.adopt(id, entry)
    owner.broadcast()
  }

  async selectTab(id: Id): Promise<void> {
    const tab = this.state.tabs[id]
    const location = locateTab(this.state, id)
    if (!tab || !location) return
    // Un onglet d'un autre Space : on bascule sur ce Space (sauf favoris, visibles partout dans le profil).
    if (location.spaceId && location.spaceId !== this.spaceId) this.setSpace(location.spaceId)
    const space = this.space
    space.activeTabId = id
    tab.lastActiveAt = Date.now()
    const profile = await this.profile(location.profileId)
    // Split View : on affiche tous les onglets du groupe, avec le focus sur celui choisi.
    const { split, tabs } = splitMembers(this.state, id)
    for (const memberId of tabs) {
      const member = this.state.tabs[memberId]
      if (!member) continue
      this.claim(memberId)
      this.views.ensure(memberId, member.url, profile)
    }
    if (this.overlay.current.kind === 'find') this.closeOverlay()
    this.showTabs(tabs, split?.sizes, id)
    this.updateChrome()
    this.changed()
  }

  /** Affiche des onglets, avec Picture-in-Picture automatique pour la vidéo qu'on quitte. */
  private showTabs(ids: Id[], sizes?: number[], focus?: Id): void {
    const leaving = this.views.shown.filter((id) => !ids.includes(id))
    if (this.state.settings.autoPip) {
      for (const id of leaving) {
        const wc = this.views.get(id)?.webContents
        if (wc && wc.isCurrentlyAudible()) {
          void wc.executeJavaScript(ENTER_PIP, true)
          this.pipTabs.add(id)
        }
      }
      for (const id of ids) {
        if (this.pipTabs.delete(id)) void this.views.get(id)?.webContents.executeJavaScript(EXIT_PIP, true)
      }
    }
    this.views.show(ids, sizes, focus)
  }

  /** Clic dans un autre panneau d'un Split View : il devient l'onglet actif. */
  private focusPane(id: Id): void {
    if (!this.views.shown.includes(id) || this.activeTabId === id) return
    this.space.activeTabId = id
    const tab = this.state.tabs[id]
    if (tab) tab.lastActiveAt = Date.now()
    this.changed()
  }

  /**
   * Fermer un onglet épinglé ou favori le décharge (il reste dans la sidebar, revenu à son URL d'origine) ;
   * fermer un onglet du jour le supprime.
   */
  closeTab(id: Id): void {
    const location = locateTab(this.state, id)
    const tab = this.state.tabs[id]
    if (!location || !tab) return
    const space = this.space
    const wasActive = space.activeTabId === id
    const others = this.views.shown.filter((x) => x !== id)
    let next: Id | undefined
    if (wasActive && !others.length) {
      const order = tabIdsIn(space.today)
      const i = order.indexOf(id)
      next = i >= 0 ? (order[i + 1] ?? order[i - 1]) : order[0]
    }

    ;(this.app.ownerOf(id) ?? this).views.destroy(id)
    this.mediaTabs.delete(id)
    if (location.section === 'today') {
      const record = removeTab(this.state, id)
      if (record && !this.isPrivate) this.app.pushClosed({ record, location })
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
    this.changed()
  }

  async reopenClosedTab(): Promise<void> {
    const closed = this.app.closed.shift()
    if (!closed) return
    const space = getSpace(this.state, closed.location.spaceId ?? '') ?? this.space
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
      if (!this.isPrivate) this.app.history.updateTitle(tab.url, patch.title)
    }
    if (patch.favicon) tab.favicon = patch.favicon
    if (patch.url && id === this.activeTabId) this.updateChrome()
    this.changed()
  }

  /** Sélectionne le n-ième onglet visible (⌘1…⌘9 ; ⌘9 = dernier). */
  selectTabAt(n: number): void {
    const order = visibleTabOrder(this.state, this.spaceId)
    const id = n === 9 ? order.at(-1) : order[n - 1]
    if (id) void this.selectTab(id)
  }

  selectRelativeTab(delta: number): void {
    const order = visibleTabOrder(this.state, this.spaceId)
    if (!order.length) return
    const i = this.activeTabId ? order.indexOf(this.activeTabId) : -1
    void this.selectTab(order[(i + delta + order.length) % order.length])
  }

  togglePinActive(): void {
    const id = this.activeTabId
    if (!id) return
    const section = locateTab(this.state, id)?.section
    moveTab(this.state, id, { section: section === 'today' ? 'pinned' : 'today', spaceId: this.spaceId }, 0)
    this.changed()
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
    const order = visibleTabOrder(this.state, this.spaceId).filter((x) => x !== id && locateTab(this.state, x)?.section !== 'favorites')
    const members = splitMembers(this.state, id).tabs
    const candidate = order.find((x) => !members.includes(x))
    if (!candidate) return
    createSplit(this.state, [...members, candidate])
    void this.selectTab(id)
  }

  // ── Peek ────────────────────────────────────────────────────────────────

  /** Arc : un lien d'un onglet épinglé ou favori vers un autre site s'ouvre dans Peek. */
  private shouldPeek(id: Id, url: string): boolean {
    const tab = this.state.tabs[id]
    const section = locateTab(this.state, id)?.section
    if (!tab?.pinnedUrl || section === 'today' || !/^https?:/.test(url)) return false
    const from = hostOf(this.views.get(id)?.webContents.getURL() || tab.url)
    return !!from && hostOf(url) !== from && !hostOf(url).endsWith(`.${from}`) && !from.endsWith(`.${hostOf(url)}`)
  }

  async openPeek(url: string, fromId: Id): Promise<void> {
    this.closePeek(false)
    const profile = await this.profile(profileOfTab(this.state, fromId))
    const view = new WebContentsView({ webPreferences: { session: profile.session, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    view.setBorderRadius(12)
    view.setBackgroundColor('#ffffff')
    this.peek = { view, profile, fromId }
    const update = () => {
      if (this.peek?.view !== view || view.webContents.isDestroyed()) return
      this.overlay.set({ kind: 'peek', url: view.webContents.getURL() || url, title: view.webContents.getTitle(), loading: view.webContents.isLoading() })
    }
    view.webContents.on('page-title-updated', update)
    view.webContents.on('did-start-loading', update)
    view.webContents.on('did-stop-loading', update)
    view.webContents.on('did-navigate', update)
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      void this.newTab(target)
      return { action: 'deny' }
    })
    view.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.closePeek()
    })
    this.overlay.set({ kind: 'peek', url, title: '', loading: true })
    this.win.contentView.addChildView(view)
    this.layoutPeek()
    view.webContents.loadURL(url)
    view.webContents.focus()
  }

  private layoutPeek(): void {
    if (!this.peek) return
    const { card } = this.views.currentLayout()
    this.peek.view.setBounds({
      x: card.x + PEEK_INSET.x,
      y: card.y + PEEK_INSET.top,
      width: Math.max(200, card.width - PEEK_INSET.x * 2),
      height: Math.max(200, card.height - PEEK_INSET.top - PEEK_INSET.bottom),
    })
  }

  /** Ferme Peek (et l'overlay qui l'encadre). */
  private closePeek(hideOverlay = true): void {
    const peek = this.peek
    if (!peek) return
    this.peek = null
    this.win.contentView.removeChildView(peek.view)
    if (!peek.view.webContents.isDestroyed()) peek.view.webContents.close()
    if (hideOverlay && this.overlay.current.kind === 'peek') this.overlay.set({ kind: 'hidden' })
  }

  /** Peek → onglet du jour (la page continue, sans rechargement). */
  private async expandPeek(): Promise<void> {
    const peek = this.peek
    if (!peek) return
    this.peek = null
    this.win.contentView.removeChildView(peek.view)
    this.overlay.set({ kind: 'hidden' })
    await this.adoptPage(peek.view, peek.profile)
  }

  /** Prend une page déjà chargée (Peek, mini-fenêtre) comme nouvel onglet du jour. */
  async adoptPage(view: WebContentsView, profile: ProfileContext): Promise<void> {
    const now = Date.now()
    const wc = view.webContents
    const record: TabRecord = { id: newId(), url: wc.getURL(), title: wc.getTitle(), createdAt: now, lastActiveAt: now }
    const space = this.state.spaces.find((s) => s.profileId === profile.id) ?? this.space
    addTab(this.state, record, space.id)
    view.setBorderRadius(0)
    this.views.adoptView(record.id, view, profile)
    await this.selectTab(record.id)
  }

  // ── Import Arc ──────────────────────────────────────────────────────────

  /** Importe Spaces, épinglés, favoris, Developer Mode et Air Traffic Control depuis Arc. */
  async importFromArc(firstLaunch = false): Promise<void> {
    if (this.isPrivate) return
    if (!hasArcData()) {
      await dialog.showMessageBox(this.win, { type: 'info', message: "Aucune donnée d'Arc trouvée sur ce Mac." })
      return
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'question',
      message: 'Importer tes Spaces depuis Arc ?',
      detail:
        "Spaces (thèmes et icônes), onglets épinglés, dossiers, Split Views, favoris, extensions épinglées, sites en Developer Mode et règles d'Air Traffic Control. " +
        "Les données d'Arc ne sont pas modifiées. Les connexions aux sites (cookies) ne sont pas reprises.",
      buttons: firstLaunch ? ['Importer', 'Plus tard', 'Ne plus demander'] : ['Importer', 'Annuler'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 2) {
      this.state.settings.arcImport = 'declined'
      this.changed()
    }
    if (response !== 0) return
    try {
      const summary = importArc(this.state, readArcData())
      await this.selectSpace(this.state.activeSpaceId)
      this.app.rebuildMenu()
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

  private setSpace(id: Id): void {
    this.spaceId = id
    if (!this.isPrivate) this.state.activeSpaceId = id
  }

  async selectSpace(id: Id): Promise<void> {
    const space = getSpace(this.state, id)
    if (!space) return
    this.setSpace(id)
    await this.profile(space.profileId)
    if (space.activeTabId) await this.selectTab(space.activeTabId)
    else this.showTabs([])
    this.updateChrome()
    this.changed()
  }

  selectRelativeSpace(delta: number): void {
    const spaces = this.state.spaces
    const i = spaces.findIndex((s) => s.id === this.spaceId)
    void this.selectSpace(spaces[(i + delta + spaces.length) % spaces.length].id)
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
    const initial = mode === 'edit-url' && tabId ? this.views.get(tabId)?.webContents.getURL() || this.state.tabs[tabId]?.url || '' : ''
    this.overlay.set({ kind: 'command-bar', mode: tabId ? mode : 'new-tab', initial, tabId })
  }

  openFind(): void {
    const tabId = this.activeTabId
    if (tabId) this.overlay.set({ kind: 'find', tabId, matches: 0, activeMatch: 0 })
  }

  openLibrary(tab: 'downloads' | 'archive' | 'history'): void {
    if (!this.sidebarVisible) this.toggleSidebar()
    this.sendEvent({ type: 'open-library', tab })
  }

  openThemeEditor(spaceId: Id = this.spaceId, anchor?: Rect): void {
    const { sidebarWidth, sidebarPosition } = this.state.settings
    const [width] = this.win.getContentSize()
    const fallback = { x: sidebarPosition === 'left' ? sidebarWidth - 40 : width - sidebarWidth, y: 160, width: 0, height: 0 }
    this.overlay.set({ kind: 'theme-editor', spaceId }, anchor ?? fallback)
  }

  private closeOverlay(): void {
    const current = this.overlay.current
    if (current.kind === 'find') this.views.get(current.tabId)?.webContents.stopFindInPage('clearSelection')
    if (current.kind === 'peek') this.closePeek()
    else this.overlay.set({ kind: 'hidden' })
    this.activeWebContents()?.focus()
  }

  toggleDevMode(host = hostOf(this.state.tabs[this.activeTabId ?? '']?.url ?? '')): void {
    if (!host) return
    const hosts = this.state.settings.devModeHosts
    const enabled = hosts.includes(host)
    this.state.settings.devModeHosts = enabled ? hosts.filter((h) => h !== host) : [...hosts, host]
    this.showToast(enabled ? 'Developer Mode désactivé' : 'Developer Mode activé', host)
    this.updateChrome()
    this.changed()
    if (this.overlay.current.kind === 'site-controls') void this.openSiteControls()
  }

  // ── Contrôles du site et extensions ─────────────────────────────────────

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
    if (site) this.overlay.set({ kind: 'site-controls', site }, anchor)
  }

  /** Extensions du profil affiché ayant un bouton, avec leur état épinglé. */
  private async extensionList(): Promise<ExtensionInfo[]> {
    if (this.isPrivate) return []
    const profileId = this.space.profileId
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
    this.overlay.set({ kind: 'extensions', extensions, partition: partitionOf(this.space.profileId) }, anchor)
  }

  /** Position d'un élément de la sidebar flottante, ramenée aux coordonnées de la fenêtre. */
  private translateAnchor(sender: WebContents | undefined, anchor: Rect): Rect {
    if (sender !== this.floating.view.webContents) return anchor
    const bounds = this.floating.view.getBounds()
    return { ...anchor, x: anchor.x + bounds.x, y: anchor.y + bounds.y }
  }

  /** Library > Historique : recherche, ou dernières pages visitées si la requête est vide. */
  searchHistory(query: string) {
    if (this.isPrivate) return []
    const entries = query.trim() ? this.app.history.search(query, 60) : this.app.history.recent(60)
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
    for (const t of openTabs) results.push({ kind: 'tab', title: tabTitle(t), subtitle: 'Passer à cet onglet', url: t.url, tabId: t.id, favicon: t.favicon })

    // Commandes (« nouveau space », « réglages », « historique »…) et Spaces.
    const words = lower.split(/\s+/)
    const matches = (label: string) => {
      const l = label.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
      return words.every((w) => l.includes(w.normalize('NFD').replace(/\p{Diacritic}/gu, '')))
    }
    const commands: Suggestion[] = [
      ...this.state.spaces.filter((s) => s.id !== this.spaceId && matches(`space ${s.name}`)).map((s) => ({ kind: 'command' as const, title: `Aller au Space « ${s.name} »`, command: `goto-space:${s.id}` })),
      ...COMMANDS.filter((c) => c.palette !== false && matches(c.label)).map((c) => ({ kind: 'command' as const, title: c.label, subtitle: 'Commande', command: c.id })),
    ]
    if (matches('réglages preferences settings')) commands.push({ kind: 'command', title: 'Réglages de Browsy', subtitle: 'Commande', command: 'settings.open' })
    results.push(...commands.slice(0, 3))

    if (!this.isPrivate) {
      const openUrls = new Set(openTabs.map((t) => t.url))
      for (const entry of this.app.history.search(q, 5)) {
        if (!openUrls.has(entry.url)) results.push({ kind: 'history', title: entry.title || entry.url, subtitle: entry.url, url: entry.url })
      }
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
    if (this.isPrivate) return []
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

  private async runCommand(id: string): Promise<void> {
    if (id.startsWith('goto-space:')) return this.selectSpace(id.slice('goto-space:'.length))
    if (id === 'settings.open') return this.app.openSettings()
    await COMMANDS.find((c) => c.id === id)?.run(this)
  }

  // ── Actions de l'UI ─────────────────────────────────────────────────────

  async dispatch(action: BrowserAction | OverlayAction | LittleAction, sender?: WebContents): Promise<void> {
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
        this.changed()
        break
      case 'tab.rename': {
        const tab = s.tabs[action.id]
        if (tab) tab.customTitle = action.title.trim() && action.title.trim() !== tab.title ? action.title.trim() : undefined
        this.changed()
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
      case 'split.create':
        if (createSplit(s, action.ids)) await this.selectTab(action.ids[0])
        break
      case 'split.dissolve': {
        const active = this.activeTabId
        dissolveSplit(s, action.id)
        if (active) await this.selectTab(active)
        break
      }
      case 'folder.new': {
        const folder = createFolder(s, action.spaceId)
        this.changed()
        if (folder) this.sendEvent({ type: 'rename-folder', spaceId: action.spaceId, id: folder.id })
        break
      }
      case 'folder.toggle': {
        const folder = findFolder(getSpace(s, action.spaceId)?.pinned ?? [], action.id)
        if (folder) folder.open = !folder.open
        this.changed()
        break
      }
      case 'folder.rename': {
        const folder = findFolder(getSpace(s, action.spaceId)?.pinned ?? [], action.id)
        if (folder && action.title.trim()) folder.title = action.title.trim()
        this.changed()
        break
      }
      case 'folder.contextMenu':
        this.folderContextMenu(action.spaceId, action.id)
        break
      case 'space.select':
        await this.selectSpace(action.id)
        break
      case 'space.new': {
        if (this.isPrivate) break
        const space = createSpace(s, `Space ${s.spaces.length + 1}`, this.space.profileId)
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
        this.changed()
        break
      }
      case 'space.contextMenu':
        this.spaceContextMenu(action.id)
        break
      case 'space.newMenu':
        Menu.buildFromTemplate([
          { label: 'Nouvel onglet', accelerator: 'CmdOrCtrl+T', click: () => this.openCommandBar('new-tab') },
          { label: 'Nouveau dossier', click: () => void this.dispatch({ type: 'folder.new', spaceId: this.spaceId }) },
          { type: 'separator' },
          { label: 'Nouveau Space', enabled: !this.isPrivate, click: () => void this.dispatch({ type: 'space.new' }) },
        ]).popup({ window: this.win })
        break
      case 'today.clear': {
        const space = getSpace(s, action.spaceId)
        if (!space) break
        for (const id of tabIdsIn(space.today)) {
          ;(this.app.ownerOf(id) ?? this).views.destroy(id)
          archiveTab(s, id)
        }
        if (space.id === this.spaceId && !space.activeTabId) this.showTabs([])
        this.updateChrome()
        this.changed()
        break
      }
      case 'download.open':
        this.app.downloads.open(action.id)
        break
      case 'download.reveal':
        this.app.downloads.reveal(action.id)
        break
      case 'download.clear':
        this.app.downloads.clearFinished()
        break
      case 'devMode.toggle':
        this.toggleDevMode(action.host)
        break
      case 'extension.pin': {
        const profileId = this.space.profileId
        const current = s.settings.pinnedExtensions[profileId] ?? (await this.extensionList()).filter((e) => e.pinned).map((e) => e.id)
        s.settings.pinnedExtensions[profileId] = action.pinned ? [...new Set([...current, action.id])] : current.filter((x) => x !== action.id)
        this.changed()
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
        await this.openExtensionsMenu(this.translateAnchor(sender, action.anchor))
        break
      case 'settings.update':
        Object.assign(this.app.state.settings, action.patch)
        if (this.isPrivate) Object.assign(s.settings, action.patch)
        if (action.patch.shortcuts) this.app.rebuildMenu()
        for (const browser of this.app.windows) browser.updateChrome()
        this.app.changed()
        break
      case 'ui.sidebarWidth':
        s.settings.sidebarWidth = Math.round(action.width)
        if (s !== this.app.state) this.app.state.settings.sidebarWidth = s.settings.sidebarWidth
        for (const browser of this.app.windows) browser.updateChrome()
        if (action.commit) this.app.changed()
        break
      case 'ui.toggleSidebar':
        this.toggleSidebar()
        break
      case 'ui.commandBar':
        this.openCommandBar(action.mode)
        break
      case 'ui.siteControls':
        await this.openSiteControls(this.translateAnchor(sender, action.anchor))
        break
      case 'ui.themeEditor':
        this.openThemeEditor(action.spaceId, action.anchor ? this.translateAnchor(sender, action.anchor) : undefined)
        break
      case 'ui.openSettings':
        this.app.openSettings()
        break
      case 'archive.restore': {
        const [entry] = s.archive.splice(action.index, 1)
        if (!entry) break
        const space = getSpace(s, entry.spaceId) ?? this.space
        if (space.id !== this.spaceId) await this.selectSpace(space.id)
        await this.newTab(entry.url)
        break
      }
      case 'history.open':
        await this.newTab(action.url)
        break
      case 'media.toggle': {
        const wc = (this.app.ownerOf(action.id) ?? this).views.get(action.id)?.webContents
        if (wc) await wc.executeJavaScript(TOGGLE_MEDIA, true).catch(() => {})
        this.broadcast()
        break
      }
      case 'profile.create': {
        const profile = { id: newId(), name: action.name.trim() || 'Nouveau profil' }
        this.app.state.profiles.push(profile)
        this.app.state.favorites[profile.id] = []
        this.app.changed()
        break
      }
      case 'profile.rename': {
        const profile = this.app.state.profiles.find((p) => p.id === action.id)
        if (profile && action.name.trim()) profile.name = action.name.trim()
        this.app.changed()
        break
      }
      case 'profile.delete': {
        const state = this.app.state
        if (action.id === DEFAULT_PROFILE_ID || state.spaces.some((sp) => sp.profileId === action.id)) break
        const profile = state.profiles.find((p) => p.id === action.id)
        const { response } = await dialog.showMessageBox(this.win, {
          type: 'warning',
          message: `Supprimer le profil « ${profile?.name ?? ''} » ?`,
          detail: 'Ses cookies, connexions, extensions et favoris seront effacés.',
          buttons: ['Supprimer', 'Annuler'],
          defaultId: 1,
          cancelId: 1,
        })
        if (response !== 0) break
        for (const id of state.favorites[action.id] ?? []) removeTab(state, id)
        delete state.favorites[action.id]
        state.profiles = state.profiles.filter((p) => p.id !== action.id)
        delete state.settings.pinnedExtensions[action.id]
        await (await this.app.profile(action.id)).session.clearStorageData()
        this.app.changed()
        break
      }
      case 'arc.import':
        await this.importFromArc()
        break
      case 'command.run':
        await this.runCommand(action.id)
        break
      case 'browser.setDefault':
        electronApp.setAsDefaultProtocolClient('http')
        electronApp.setAsDefaultProtocolClient('https')
        this.app.rebuildMenu()
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
        if (suggestion?.kind === 'command' && suggestion.command) {
          await this.runCommand(suggestion.command)
          break
        }
        const url = suggestion?.url ?? this.resolve(input)
        if (current.kind === 'command-bar' && current.mode === 'edit-url' && current.tabId) this.views.get(current.tabId)?.webContents.loadURL(url)
        else await this.newTab(url)
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
        const index = levels.findIndex((l) => l >= wc.getZoomFactor() - 0.001)
        wc.setZoomFactor(action.delta === 0 ? 1 : levels[Math.min(levels.length - 1, Math.max(0, index + action.delta))])
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
      case 'peek.expand':
        await this.expandPeek()
        break
      case 'peek.close':
        this.closePeek()
        break
      case 'little.expand':
      case 'little.back':
      case 'little.forward':
      case 'little.reload':
      case 'little.copy':
        break
    }
  }

  // ── Menus contextuels natifs ────────────────────────────────────────────

  private tabContextMenu(id: Id): void {
    const s = this.state
    const tab = s.tabs[id]
    const location = locateTab(s, id)
    if (!tab || !location) return
    const spaceId = location.spaceId ?? this.spaceId
    const move = (to: TabLocation) => () => {
      moveTab(s, id, to, to.section === 'today' ? 0 : -1)
      this.changed()
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
          : { label: 'Épingler dans ce Space', click: move({ section: 'pinned', spaceId: this.spaceId }) },
      ...(location.section !== 'today' ? [{ label: 'Renommer…', click: () => this.sendEvent({ type: 'rename-tab', id }) }] : []),
      ...(tab.pinnedUrl && tab.pinnedUrl !== tab.url ? [{ label: "Revenir à l'URL d'origine", click: () => void this.dispatch({ type: 'tab.resetToPinned', id }) }] : []),
      { type: 'separator' },
      ...(location.splitId
        ? [{ label: 'Quitter le Split View', click: () => void this.dispatch({ type: 'split.dissolve', id: location.splitId! }) }]
        : active && active !== id && location.section !== 'favorites' && locateTab(s, active)?.section !== 'favorites'
          ? [{ label: "Split View avec l'onglet actif", click: () => void this.dispatch({ type: 'split.create', ids: [active, id] }) }]
          : []),
      { label: 'Copier le lien', click: () => this.copyUrl(id) },
      { label: 'Dupliquer', click: () => void this.newTab(tab.url, { background: true, profileId: location.profileId }) },
      ...(!this.isPrivate ? [{ label: 'Ouvrir dans une nouvelle fenêtre', click: () => void this.openInNewWindow(id) }] : []),
      ...(otherSpaces.length && location.section !== 'favorites'
        ? [
            {
              label: 'Déplacer vers',
              submenu: otherSpaces.map((sp) => ({ label: sp.name, click: move({ section: location.section === 'pinned' ? 'pinned' : 'today', spaceId: sp.id }) })),
            },
          ]
        : []),
      { type: 'separator' },
      {
        label: location.section === 'today' ? "Fermer l'onglet" : this.views.has(id) ? 'Décharger' : 'Supprimer',
        click: () => {
          if (location.section !== 'today' && !this.views.has(id)) {
            removeTab(s, id)
            this.changed()
          } else this.closeTab(id)
        },
      },
    ]
    Menu.buildFromTemplate(template).popup({ window: this.win })
  }

  /** Ouvre l'onglet dans une nouvelle fenêtre, sur son Space. */
  private async openInNewWindow(id: Id): Promise<void> {
    const spaceId = locateTab(this.state, id)?.spaceId ?? this.spaceId
    const browser = this.app.newWindow({ spaceId })
    await browser.selectTab(id)
  }

  private folderContextMenu(spaceId: Id, folderId: Id): void {
    Menu.buildFromTemplate([
      { label: 'Renommer', click: () => this.sendEvent({ type: 'rename-folder', spaceId, id: folderId }) },
      {
        label: 'Supprimer le dossier',
        click: () => {
          deleteFolder(this.state, spaceId, folderId)
          this.changed()
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
      { label: 'Thème et icône…', click: () => this.openThemeEditor(spaceId) },
      {
        label: 'Couleur rapide',
        submenu: SPACE_PALETTE.map((color, i) => ({
          label: COLOR_NAMES[i] ?? color,
          type: 'radio' as const,
          checked: space.theme.colors.length === 1 && space.theme.colors[0] === color,
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
      ...(!this.isPrivate
        ? [
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
          ]
        : []),
      { type: 'separator' },
      { label: 'Nouveau dossier', click: () => void this.dispatch({ type: 'folder.new', spaceId }) },
      { label: 'Nouveau Space', enabled: !this.isPrivate, click: () => void this.dispatch({ type: 'space.new' }) },
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
          for (const id of deleteSpace(s, spaceId)) (this.app.ownerOf(id) ?? this).views.destroy(id)
          for (const browser of this.app.windows) if (!getSpace(s, browser.spaceId)) await browser.selectSpace(s.spaces[0].id)
          this.changed()
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
    for (const browser of this.app.windows) {
      for (const id of tabIdsIn([...space.pinned, ...space.today])) browser.views.destroy(id)
    }
    space.profileId = profileId
    if (spaceId === this.spaceId) void this.selectSpace(spaceId)
    this.changed()
  }
}
