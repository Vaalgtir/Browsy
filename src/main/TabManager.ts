import { BrowserWindow, Menu, MenuItem, WebContentsView, clipboard, type Session } from 'electron'
import type { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { BrowserState, TabState } from '../shared/ipc'

/** Marge autour de la carte de contenu, comme dans Arc. */
const CONTENT_INSET = 8
const CONTENT_RADIUS = 10

export const NEW_TAB_URL = 'https://www.google.com/'

interface Tab {
  view: WebContentsView
  favicon?: string
}

/** Transforme ce qui est tapé dans la barre d'adresse en URL. */
export function resolveInput(input: string): string {
  const text = input.trim()
  if (!text) return NEW_TAB_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|chrome|data|file):/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

export class TabManager {
  private tabs = new Map<number, Tab>()
  private order: number[] = []
  private activeId: number | null = null
  private sidebarWidth = 240

  constructor(
    private readonly win: BrowserWindow,
    private readonly session: Session,
    private readonly extensions: ElectronChromeExtensions,
    private readonly onChange: (state: BrowserState) => void,
  ) {
    win.on('resize', () => this.layout())
  }

  get active(): WebContentsView | undefined {
    return this.activeId === null ? undefined : this.tabs.get(this.activeId)?.view
  }

  create(url = NEW_TAB_URL, { activate = true } = {}): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    view.setBorderRadius(CONTENT_RADIUS)
    view.setBackgroundColor('#ffffff')
    const wc = view.webContents
    const id = wc.id
    this.tabs.set(id, { view })
    this.order.push(id)
    this.extensions.addTab(wc, this.win)
    this.wireEvents(id, view)
    wc.loadURL(url)
    if (activate || this.activeId === null) this.select(id)
    else this.emit()
    return view
  }

  select(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const previous = this.active
    if (previous && previous !== tab.view) this.win.contentView.removeChildView(previous)
    this.activeId = id
    this.win.contentView.addChildView(tab.view)
    this.layout()
    this.extensions.selectTab(tab.view.webContents)
    tab.view.webContents.focus()
    this.emit()
  }

  close(id: number): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    const index = this.order.indexOf(id)
    this.order.splice(index, 1)
    this.tabs.delete(id)
    this.extensions.removeTab(tab.view.webContents)
    this.win.contentView.removeChildView(tab.view)
    tab.view.webContents.close()
    if (this.activeId === id) {
      this.activeId = null
      const next = this.order[Math.min(index, this.order.length - 1)]
      if (next !== undefined) this.select(next)
    }
    this.emit()
  }

  selectRelative(delta: number): void {
    if (this.activeId === null || this.order.length < 2) return
    const index = this.order.indexOf(this.activeId)
    const next = this.order[(index + delta + this.order.length) % this.order.length]
    this.select(next)
  }

  get(id: number): WebContentsView | undefined {
    return this.tabs.get(id)?.view
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = Math.max(0, Math.round(width))
    this.layout()
  }

  layout(): void {
    const view = this.active
    if (!view) return
    const [width, height] = this.win.getContentSize()
    view.setBounds({
      x: this.sidebarWidth,
      y: CONTENT_INSET,
      width: Math.max(0, width - this.sidebarWidth - CONTENT_INSET),
      height: Math.max(0, height - CONTENT_INSET * 2),
    })
  }

  getState(): BrowserState {
    const tabs: TabState[] = this.order.map((id) => {
      const tab = this.tabs.get(id)!
      const wc = tab.view.webContents
      return {
        id,
        url: wc.getURL(),
        title: wc.getTitle() || wc.getURL(),
        favicon: tab.favicon,
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
      }
    })
    return { tabs, activeTabId: this.activeId }
  }

  private emit(): void {
    this.onChange(this.getState())
  }

  private wireEvents(id: number, view: WebContentsView): void {
    const wc = view.webContents
    const update = () => this.emit()
    wc.on('page-title-updated', update)
    wc.on('did-start-loading', update)
    wc.on('did-stop-loading', update)
    wc.on('did-navigate', update)
    wc.on('did-navigate-in-page', update)
    wc.on('page-favicon-updated', (_event, favicons) => {
      const tab = this.tabs.get(id)
      if (tab) tab.favicon = favicons[0]
      update()
    })

    // Liens target=_blank → nouvel onglet ; vraies popups (OAuth…) → fenêtre.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'new-window') return { action: 'allow' }
      this.create(url, { activate: disposition !== 'background-tab' })
      return { action: 'deny' }
    })

    wc.on('context-menu', (_event, params) => this.showContextMenu(view, params))
  }

  private showContextMenu(view: WebContentsView, params: Electron.ContextMenuParams): void {
    const wc = view.webContents
    const items: Electron.MenuItemConstructorOptions[] = []

    if (params.linkURL) {
      items.push(
        { label: 'Ouvrir le lien dans un nouvel onglet', click: () => this.create(params.linkURL, { activate: false }) },
        { label: "Copier l'adresse du lien", click: () => clipboard.writeText(params.linkURL) },
        { type: 'separator' },
      )
    }
    if (params.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' })
    } else if (params.selectionText) {
      items.push({ role: 'copy' }, { type: 'separator' })
    }
    items.push(
      { label: 'Précédent', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Suivant', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Recharger', click: () => wc.reload() },
    )

    const extensionItems = this.extensions.getContextMenuItems(wc, params)
    const menu = Menu.buildFromTemplate(items)
    if (extensionItems.length) {
      menu.append(new MenuItem({ type: 'separator' }))
      for (const item of extensionItems) menu.append(item)
    }
    menu.append(new MenuItem({ type: 'separator' }))
    menu.append(
      new MenuItem({
        label: "Inspecter l'élément",
        click: () => wc.inspectElement(params.x, params.y),
      }),
    )
    menu.popup({ window: this.win })
  }
}
