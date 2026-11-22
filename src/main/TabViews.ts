import { Menu, MenuItem, WebContentsView, clipboard, type BrowserWindow } from 'electron'
import type { Id, LiveTab } from '../shared/model'
import type { ProfileContext } from './profiles'

/** Marge autour de la carte de contenu et rayon de ses coins, comme dans Arc. */
export const CONTENT_INSET = 8
const CONTENT_RADIUS = 10

export const DEFAULT_SEARCH = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`

/** Transforme ce qui est tapé dans la barre d'adresse en URL. */
export function resolveInput(input: string): string {
  const text = input.trim()
  if (!text) return 'https://www.google.com/'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|chrome|data|file|view-source):/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (/^[\w-]+\.(local|test|localhost)(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (!/\s/.test(text) && /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return DEFAULT_SEARCH(text)
}

export interface TabViewEvents {
  /** URL, titre ou favicon ont changé. */
  onRecordChange(id: Id, patch: { url?: string; title?: string; favicon?: string }): void
  /** Navigation terminée (pour l'historique). */
  onVisit(id: Id, url: string, title: string): void
  onLiveChange(): void
  /** La page veut ouvrir un nouvel onglet (target=_blank, clic molette…). */
  onOpenTab(fromId: Id, url: string, background: boolean): void
  onFoundInPage(id: Id, matches: number, activeMatch: number): void
  onClosedByPage(id: Id): void
}

/**
 * Vues web des onglets. Une vue n'est créée qu'au premier affichage de l'onglet
 * et peut être déchargée (fermeture d'un onglet épinglé, archivage).
 */
export class TabViews {
  private readonly views = new Map<Id, { view: WebContentsView; profile: ProfileContext }>()
  private shownId: Id | null = null
  /** Erreurs et avertissements de la console par onglet, remis à zéro à chaque navigation. */
  private readonly consoleCounts = new Map<Id, { errors: number; warnings: number }>()
  private sidebarWidth = 0

  constructor(
    private readonly win: BrowserWindow,
    private readonly events: TabViewEvents,
  ) {
    win.on('resize', () => this.layout())
  }

  has(id: Id): boolean {
    return this.views.has(id)
  }

  get(id: Id): WebContentsView | undefined {
    return this.views.get(id)?.view
  }

  get shown(): Id | null {
    return this.shownId
  }

  ids(): Id[] {
    return [...this.views.keys()]
  }

  /** Crée la vue si besoin, puis charge l'URL. */
  ensure(id: Id, url: string, profile: ProfileContext): WebContentsView {
    const existing = this.views.get(id)
    if (existing) return existing.view
    const view = new WebContentsView({
      webPreferences: { session: profile.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    view.setBorderRadius(CONTENT_RADIUS)
    view.setBackgroundColor('#ffffff')
    this.views.set(id, { view, profile })
    profile.extensions.addTab(view.webContents, this.win)
    this.wire(id, view)
    view.webContents.loadURL(url)
    return view
  }

  show(id: Id | null): void {
    if (this.shownId === id) return this.layout()
    const previous = this.shownId ? this.views.get(this.shownId) : undefined
    if (previous) this.win.contentView.removeChildView(previous.view)
    this.shownId = id
    const next = id ? this.views.get(id) : undefined
    if (next) {
      // Sous l'overlay éventuel : on insère la vue juste au-dessus de l'UI (index 0).
      this.win.contentView.addChildView(next.view, 0)
      next.profile.extensions.selectTab(next.view.webContents)
      next.view.webContents.focus()
    }
    this.layout()
  }

  destroy(id: Id): void {
    const entry = this.views.get(id)
    if (!entry) return
    this.views.delete(id)
    this.consoleCounts.delete(id)
    if (this.shownId === id) {
      this.win.contentView.removeChildView(entry.view)
      this.shownId = null
    }
    entry.profile.extensions.removeTab(entry.view.webContents)
    entry.view.webContents.close()
    this.events.onLiveChange()
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = Math.max(0, Math.round(width))
    this.layout()
  }

  /** Zone occupée par la carte de contenu (aussi utilisée pour placer l'overlay). */
  contentBounds(): Electron.Rectangle {
    const [width, height] = this.win.getContentSize()
    const left = this.sidebarWidth || CONTENT_INSET
    return {
      x: left,
      y: CONTENT_INSET,
      width: Math.max(0, width - left - CONTENT_INSET),
      height: Math.max(0, height - CONTENT_INSET * 2),
    }
  }

  layout(): void {
    const entry = this.shownId ? this.views.get(this.shownId) : undefined
    if (entry) entry.view.setBounds(this.contentBounds())
  }

  live(): Record<Id, LiveTab> {
    const result: Record<Id, LiveTab> = {}
    for (const [id, { view }] of this.views) {
      const wc = view.webContents
      result[id] = {
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        audible: wc.isCurrentlyAudible(),
        muted: wc.isAudioMuted(),
        consoleErrors: this.consoleCounts.get(id)?.errors ?? 0,
        consoleWarnings: this.consoleCounts.get(id)?.warnings ?? 0,
        zoom: wc.getZoomFactor(),
      }
    }
    return result
  }

  private wire(id: Id, view: WebContentsView): void {
    const wc = view.webContents
    const live = () => this.events.onLiveChange()
    wc.on('did-start-loading', live)
    wc.on('did-stop-loading', live)
    wc.on('audio-state-changed', live)
    wc.on('page-title-updated', (_e, title) => {
      this.events.onRecordChange(id, { title })
    })
    wc.on('page-favicon-updated', (_e, favicons) => this.events.onRecordChange(id, { favicon: favicons[0] }))
    const navigated = () => {
      this.events.onRecordChange(id, { url: wc.getURL(), title: wc.getTitle() })
      live()
    }
    wc.on('console-message', (event) => {
      if (event.level !== 'error' && event.level !== 'warning') return
      const counts = this.consoleCounts.get(id) ?? { errors: 0, warnings: 0 }
      if (event.level === 'error') counts.errors++
      else counts.warnings++
      this.consoleCounts.set(id, counts)
      live()
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.consoleCounts.delete(id)
    })
    wc.on('did-navigate', () => {
      navigated()
      this.events.onVisit(id, wc.getURL(), wc.getTitle())
    })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => isMainFrame && navigated())
    wc.on('found-in-page', (_e, result) => this.events.onFoundInPage(id, result.matches, result.activeMatchOrdinal))
    wc.on('destroyed', () => {
      if (this.views.has(id)) {
        this.views.delete(id)
        this.events.onClosedByPage(id)
      }
    })

    // target=_blank et clic molette → onglet ; vraies popups (OAuth…) → fenêtre.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'new-window') return { action: 'allow' }
      this.events.onOpenTab(id, url, disposition === 'background-tab')
      return { action: 'deny' }
    })

    wc.on('context-menu', (_e, params) => this.pageContextMenu(id, view, params))
  }

  private pageContextMenu(id: Id, view: WebContentsView, params: Electron.ContextMenuParams): void {
    const wc = view.webContents
    const entry = this.views.get(id)
    const menu = new Menu()
    const add = (options: Electron.MenuItemConstructorOptions) => menu.append(new MenuItem(options))

    if (params.linkURL) {
      add({ label: 'Ouvrir le lien dans un nouvel onglet', click: () => this.events.onOpenTab(id, params.linkURL, true) })
      add({ label: "Copier l'adresse du lien", click: () => clipboard.writeText(params.linkURL) })
      add({ type: 'separator' })
    }
    if (params.mediaType === 'image' && params.srcURL) {
      add({ label: "Ouvrir l'image dans un nouvel onglet", click: () => this.events.onOpenTab(id, params.srcURL, true) })
      add({ label: "Copier l'image", click: () => wc.copyImageAt(params.x, params.y) })
      add({ label: "Enregistrer l'image…", click: () => wc.downloadURL(params.srcURL) })
      add({ type: 'separator' })
    }
    if (params.isEditable) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 4)) {
        add({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) })
      }
      if (params.dictionarySuggestions.length) add({ type: 'separator' })
      add({ role: 'undo', label: 'Annuler' })
      add({ role: 'redo', label: 'Rétablir' })
      add({ type: 'separator' })
      add({ role: 'cut', label: 'Couper' })
      add({ role: 'copy', label: 'Copier' })
      add({ role: 'paste', label: 'Coller' })
      add({ role: 'pasteAndMatchStyle', label: 'Coller sans mise en forme' })
      add({ role: 'selectAll', label: 'Tout sélectionner' })
      add({ type: 'separator' })
    } else if (params.selectionText) {
      const text = params.selectionText.trim().slice(0, 40)
      add({ role: 'copy', label: 'Copier' })
      add({ label: `Rechercher « ${text} »`, click: () => this.events.onOpenTab(id, DEFAULT_SEARCH(params.selectionText), false) })
      add({ type: 'separator' })
    } else if (!params.linkURL && params.mediaType === 'none') {
      add({ label: 'Précédent', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() })
      add({ label: 'Suivant', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() })
      add({ label: 'Recharger', click: () => wc.reload() })
      add({ type: 'separator' })
    }

    const extensionItems = entry?.profile.extensions.getContextMenuItems(wc, params) ?? []
    if (extensionItems.length) {
      extensionItems.forEach((item) => menu.append(item))
      add({ type: 'separator' })
    }
    add({ label: 'Afficher le code source', click: () => this.events.onOpenTab(id, `view-source:${wc.getURL()}`, false) })
    add({ label: "Inspecter l'élément", click: () => wc.inspectElement(params.x, params.y) })
    menu.popup({ window: this.win })
  }
}
