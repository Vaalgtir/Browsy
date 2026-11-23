import { join } from 'node:path'
import { BrowserWindow, WebContentsView, clipboard, type WebContents } from 'electron'
import type { LittleAction, LittleState } from '../shared/ipc'
import type { Id } from '../shared/model'
import type { App } from './App'
import { loadUi } from './floating'
import type { ProfileContext } from './profiles'

const BAR_HEIGHT = 40
const INSET = 6

/**
 * Mini-fenêtre (Little Arc) : pour les liens venus d'autres applications.
 * ⌘O (ou le bouton) la bascule en onglet dans la fenêtre principale, sans recharger la page.
 */
export class LittleWindow {
  readonly win: BrowserWindow
  private view: WebContentsView | null = null
  private profile: ProfileContext | null = null

  constructor(
    private readonly app: App,
    url: string,
    profileId: Id,
  ) {
    this.win = new BrowserWindow({
      width: 980,
      height: 700,
      minWidth: 420,
      minHeight: 300,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 13 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      show: false,
      webPreferences: { preload: join(__dirname, '../preload/ui.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    loadUi(this.win.webContents, 'little')
    this.win.webContents.on('did-finish-load', () => this.broadcast())
    this.win.once('ready-to-show', () => this.win.show())
    this.win.on('resize', () => this.layout())
    this.win.webContents.on('before-input-event', (event, input) => this.shortcut(event, input))
    this.win.on('closed', () => {
      const wc = this.view?.webContents
      if (wc && !wc.isDestroyed()) {
        this.profile?.extensions?.removeTab(wc)
        wc.close()
      }
      this.view = null
    })
    void this.load(url, profileId)
  }

  private async load(url: string, profileId: Id): Promise<void> {
    const profile = await this.app.profile(profileId)
    if (this.win.isDestroyed()) return
    this.profile = profile
    const view = new WebContentsView({ webPreferences: { session: profile.session, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    view.setBorderRadius(10)
    view.setBackgroundColor('#ffffff')
    this.view = view
    this.win.contentView.addChildView(view)
    profile.extensions?.addTab(view.webContents, this.win)
    const wc = view.webContents
    for (const event of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'page-favicon-updated', 'did-navigate', 'did-navigate-in-page'] as const) {
      wc.on(event as 'did-stop-loading', () => this.broadcast())
    }
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicon = favicons[0]
      this.broadcast()
    })
    wc.on('before-input-event', (event, input) => this.shortcut(event, input))
    wc.setWindowOpenHandler(({ url: target, disposition }) => {
      if (disposition === 'new-window') return { action: 'allow' }
      void this.app.mainWindow().newTab(target)
      return { action: 'deny' }
    })
    this.layout()
    wc.loadURL(url)
  }

  private favicon: string | undefined

  owns(wc: WebContents): boolean {
    return wc === this.win.webContents || wc === this.view?.webContents
  }

  private shortcut(event: Electron.Event, input: Electron.Input): void {
    if (input.type !== 'keyDown' || !input.meta) return
    const key = input.key.toLowerCase()
    if (key === 'o') {
      event.preventDefault()
      void this.expand()
    } else if (key === 'w') {
      event.preventDefault()
      this.win.close()
    } else if (key === 'c' && input.shift) {
      event.preventDefault()
      this.copy()
    }
  }

  private layout(): void {
    if (!this.view) return
    const [width, height] = this.win.getContentSize()
    this.view.setBounds({ x: INSET, y: BAR_HEIGHT, width: width - INSET * 2, height: height - BAR_HEIGHT - INSET })
  }

  state(): LittleState | null {
    const wc = this.view?.webContents
    if (!wc || wc.isDestroyed()) return null
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      favicon: this.favicon,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      spaceName: this.app.mainWindow().space.name,
    }
  }

  broadcast(): void {
    const state = this.state()
    if (state && !this.win.isDestroyed()) this.win.webContents.send('ui:little', state)
  }

  private copy(): void {
    const url = this.view?.webContents.getURL()
    if (url) clipboard.writeText(url)
  }

  /** Bascule la page en onglet de la fenêtre principale. */
  async expand(): Promise<void> {
    const view = this.view
    const profile = this.profile
    if (!view || !profile) return
    this.view = null
    this.win.contentView.removeChildView(view)
    const target = this.app.mainWindow()
    await target.adoptPage(view, profile)
    target.win.show()
    target.win.focus()
    this.win.close()
  }

  async dispatch(action: LittleAction): Promise<void> {
    const wc = this.view?.webContents
    switch (action.type) {
      case 'little.expand':
        await this.expand()
        break
      case 'little.back':
        wc?.navigationHistory.goBack()
        break
      case 'little.forward':
        wc?.navigationHistory.goForward()
        break
      case 'little.reload':
        wc?.reload()
        break
      case 'little.copy':
        this.copy()
        break
    }
  }
}
