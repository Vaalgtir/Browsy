import { join } from 'node:path'
import { BrowserWindow, session, type WebContents } from 'electron'
import type { BrowserAction, OverlayAction } from '../shared/ipc'
import { archiveTab, getSpace, type Id, type LinkDestination, type PersistedState, type TabLocation, type TabRecord, tabsToArchive } from '../shared/model'
import { hasArcData } from './arcImport'
import { Browser } from './Browser'
import { installChromeIdentity } from './chromeIdentity'
import { commandInfos } from './commands'
import { Downloads } from './downloads'
import { loadUi } from './floating'
import { History } from './history'
import { LittleWindow } from './LittleWindow'
import { buildMenu } from './menu'
import { installPermissionHandler } from './permissions'
import { Profiles, type ProfileContext } from './profiles'
import { StateStore } from './store'

const ARCHIVE_CHECK_MS = 5 * 60 * 1000
const MAX_CLOSED = 30

export interface ClosedTab {
  record: TabRecord
  location: TabLocation
}

/**
 * L'application : état partagé (Spaces, onglets, réglages), profils, historique,
 * téléchargements, et les fenêtres. Chaque fenêtre (Browser) affiche un Space.
 */
export class App {
  readonly store = new StateStore()
  readonly state: PersistedState
  readonly history = new History()
  readonly downloads: Downloads
  readonly closed: ClosedTab[] = []
  readonly windows = new Set<Browser>()
  readonly littles = new Set<LittleWindow>()
  private readonly profiles: Profiles
  private readonly loaded = new Map<Id, ProfileContext>()
  private lastFocused: Browser | null = null
  private settingsWindow: BrowserWindow | null = null
  private privateCount = 0
  private changePending = false

  constructor() {
    this.state = this.store.load()
    this.downloads = new Downloads(() => this.changed())
    this.profiles = new Profiles((profileId) => ({
      createTab: async (details) => {
        const browser = this.windowForProfile(profileId)
        const id = await browser.newTab(details.url, { background: details.active === false, profileId })
        return [browser.viewOf(id)!.webContents, browser.win]
      },
      selectTab: (wc) => this.withTab(wc, (browser, id) => browser.selectTab(id)),
      removeTab: (wc) => this.withTab(wc, (browser, id) => browser.closeTab(id)),
      createWindow: async (details) => {
        const browser = this.newWindow()
        const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : []
        for (const url of urls) await browser.newTab(url, { profileId })
        return browser.win
      },
    }))
    setInterval(() => this.archiveStale(), ARCHIVE_CHECK_MS)
  }

  async start(): Promise<Browser> {
    this.archiveStale()
    this.rebuildMenu()
    const browser = this.newWindow({ spaceId: this.state.activeSpaceId })
    await browser.restore()
    if (!this.state.settings.arcImport && hasArcData()) setTimeout(() => void browser.importFromArc(true), 800)
    return browser
  }

  flush(): void {
    this.store.saveNow(this.state)
    this.history.close()
  }

  // ── Fenêtres ────────────────────────────────────────────────────────────

  get windowCount(): number {
    return this.windows.size
  }

  newWindow(options: { private?: boolean; spaceId?: Id } = {}): Browser {
    const browser = new Browser(this, { private: options.private ?? false, privateIndex: options.private ? ++this.privateCount : 0, spaceId: options.spaceId })
    this.windows.add(browser)
    browser.win.on('focus', () => {
      this.lastFocused = browser
    })
    browser.win.on('closed', () => {
      this.windows.delete(browser)
      if (this.lastFocused === browser) this.lastFocused = null
    })
    this.lastFocused = browser
    return browser
  }

  /** Fenêtre active (ou la dernière utilisée), hors navigation privée si possible. */
  focused(): Browser | undefined {
    const focusedWin = BrowserWindow.getFocusedWindow()
    const byFocus = [...this.windows].find((b) => b.win === focusedWin)
    return byFocus ?? this.lastFocused ?? [...this.windows].find((b) => !b.isPrivate) ?? [...this.windows][0]
  }

  /** Dernière fenêtre normale (pour ouvrir un lien), créée au besoin. */
  mainWindow(): Browser {
    const focused = this.focused()
    if (focused && !focused.isPrivate) return focused
    return [...this.windows].find((b) => !b.isPrivate) ?? this.newWindow()
  }

  private windowForProfile(profileId: Id): Browser {
    const focused = this.focused()
    if (focused && !focused.isPrivate && focused.space.profileId === profileId) return focused
    return [...this.windows].find((b) => !b.isPrivate && b.space.profileId === profileId) ?? this.mainWindow()
  }

  /** Fenêtre propriétaire d'une vue d'interface (sidebar, overlay…) ou d'un onglet. */
  windowFor(wc: WebContents): Browser | undefined {
    return [...this.windows].find((b) => b.ownsUi(wc) || b.tabIdOf(wc))
  }

  private withTab(wc: WebContents, fn: (browser: Browser, id: Id) => void): void {
    for (const browser of this.windows) {
      const id = browser.tabIdOf(wc)
      if (id) return fn(browser, id)
    }
  }

  /** Fenêtre qui affiche actuellement la vue d'un onglet. */
  ownerOf(tabId: Id): Browser | undefined {
    return [...this.windows].find((b) => b.hasView(tabId))
  }

  // ── Mini-fenêtres (Little Arc) ──────────────────────────────────────────

  openLittle(url?: string, profileId?: Id): LittleWindow {
    const little = new LittleWindow(this, url ?? 'https://www.google.com/', profileId ?? this.mainWindow().space.profileId)
    this.littles.add(little)
    little.win.on('closed', () => this.littles.delete(little))
    return little
  }

  /** Lien venu d'une autre application : Air Traffic Control décide où l'ouvrir. */
  async openExternalUrl(url: string): Promise<void> {
    const destination = this.routeFor(url)
    if (destination.kind === 'littleArc') {
      this.openLittle(url)
      return
    }
    let browser = this.mainWindow()
    if (destination.kind === 'space' && getSpace(this.state, destination.spaceId)) {
      browser = [...this.windows].find((b) => !b.isPrivate && b.spaceId === destination.spaceId) ?? browser
      if (browser.spaceId !== destination.spaceId) await browser.selectSpace(destination.spaceId)
    }
    browser.win.show()
    browser.win.focus()
    await browser.newTab(url)
  }

  routeFor(url: string): LinkDestination {
    let host = ''
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      /* URL invalide : destination par défaut */
    }
    for (const rule of this.state.settings.linkRules) {
      const value = rule.match.value.trim().toLowerCase()
      if (!value) continue
      const matches =
        rule.match.kind === 'contains' ? url.toLowerCase().includes(value) : host === value.replace(/^www\./, '') || host.endsWith(`.${value}`)
      if (matches) return rule.destination
    }
    return this.state.settings.defaultLinkDestination
  }

  // ── Profils ─────────────────────────────────────────────────────────────

  async profile(profileId: Id): Promise<ProfileContext> {
    const loaded = this.loaded.get(profileId)
    if (loaded) return loaded
    const context = await this.profiles.get(profileId)
    this.loaded.set(profileId, context)
    this.downloads.watch(context.session)
    return context
  }

  /** Session éphémère d'une fenêtre de navigation privée (ni extensions, ni historique). */
  privateProfile(index: number): ProfileContext {
    const id = `private-${index}`
    const ses = session.fromPartition(id)
    installChromeIdentity(ses)
    installPermissionHandler(ses)
    this.downloads.watch(ses)
    return { id, session: ses }
  }

  // ── État partagé ────────────────────────────────────────────────────────

  /** L'état partagé a changé : sauvegarde et notification de toutes les fenêtres. */
  changed(): void {
    if (this.changePending) return
    this.changePending = true
    setImmediate(() => {
      this.changePending = false
      this.store.scheduleSave(this.state)
      for (const browser of this.windows) browser.broadcast()
      for (const little of this.littles) little.broadcast()
      const settings = this.settingsWindow?.webContents
      const reference = this.mainWindowIfAny()
      if (settings && !settings.isDestroyed() && reference) settings.send('ui:state', reference.uiState())
    })
  }

  private mainWindowIfAny(): Browser | undefined {
    return [...this.windows].find((b) => !b.isPrivate)
  }

  pushClosed(closed: ClosedTab): void {
    this.closed.unshift(closed)
    this.closed.length = Math.min(this.closed.length, MAX_CLOSED)
  }

  private archiveStale(): void {
    const stale = tabsToArchive(this.state)
    for (const id of stale) {
      this.ownerOf(id)?.destroyView(id)
      archiveTab(this.state, id)
    }
    if (stale.length) this.changed()
  }

  rebuildMenu(): void {
    buildMenu(() => this.focused(), this.state.settings.shortcuts, () => this.openSettings())
  }

  // ── Réglages ────────────────────────────────────────────────────────────

  openSettings(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show()
      this.settingsWindow.focus()
      return
    }
    const win = new BrowserWindow({
      width: 780,
      height: 600,
      minWidth: 640,
      minHeight: 460,
      title: 'Réglages',
      titleBarStyle: 'hiddenInset',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
      show: false,
      webPreferences: { preload: join(__dirname, '../preload/ui.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    loadUi(win.webContents, 'settings')
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.settingsWindow = null
    })
    this.settingsWindow = win
  }

  isSettingsWindow(wc: WebContents): boolean {
    return this.settingsWindow?.webContents === wc
  }

  commands() {
    return commandInfos()
  }

  /** Actions venues de la fenêtre de réglages : appliquées via la fenêtre principale. */
  async dispatchFromSettings(action: BrowserAction | OverlayAction): Promise<void> {
    const browser = this.mainWindowIfAny() ?? this.newWindow()
    await browser.dispatch(action)
  }
}
