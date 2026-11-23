import { Menu, MenuItem, WebContentsView, clipboard, type BrowserWindow } from 'electron'
import { computeLayout, roundRect, splitPanes, type Layout, type LayoutInput } from '../shared/layout'
import type { Id, LiveTab } from '../shared/model'
import type { ProfileContext } from './profiles'

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
  /** Survol d'un lien dans la page (chaîne vide : plus de survol). */
  onHoverLink(id: Id, url: string): void
  onFocusTab(id: Id): void
  searchUrl(query: string): string
  /** Lien d'un onglet épinglé ou favori vers un autre site : ouvert dans Peek plutôt que dans l'onglet. */
  shouldPeek(id: Id, url: string): boolean
  onPeek(id: Id, url: string): void
}

interface Entry {
  view: WebContentsView
  profile: ProfileContext
  /** Fenêtre qui affiche l'onglet : change quand l'onglet passe dans une autre fenêtre. */
  owner: TabViews
}

/**
 * La lib d'extensions associe chaque onglet à une fenêtre à son ajout, et son retrait
 * déclenche la fermeture de l'onglet : pour un déplacement, on met à jour l'association.
 */
function moveExtensionTab(profile: ProfileContext, wc: Electron.WebContents, win: BrowserWindow): void {
  const store = (profile.extensions as unknown as { ctx?: { store?: { tabToWindow: Map<unknown, unknown>; addWindow(w: unknown): void } } })?.ctx?.store
  if (!store) return
  store.tabToWindow.set(wc, win)
  store.addWindow(win)
}

/**
 * Vues web des onglets. Une vue n'est créée qu'au premier affichage de l'onglet
 * et peut être déchargée (fermeture d'un onglet épinglé, archivage).
 * Plusieurs vues peuvent être affichées côte à côte (Split View).
 */
export class TabViews {
  private readonly views = new Map<Id, Entry>()
  /** Erreurs et avertissements de la console par onglet, remis à zéro à chaque navigation. */
  private readonly consoleCounts = new Map<Id, { errors: number; warnings: number }>()
  private shownIds: Id[] = []
  private shownSizes: number[] = []
  private focusedId: Id | null = null
  private layoutInput: Omit<LayoutInput, 'width' | 'height'> = {
    sidebarVisible: true,
    sidebarWidth: 260,
    position: 'left',
    fullscreen: false,
    devBar: false,
  }

  constructor(
    private readonly win: BrowserWindow,
    readonly events: TabViewEvents,
  ) {
    win.on('resize', () => this.layout())
  }

  has(id: Id): boolean {
    return this.views.has(id)
  }

  get(id: Id): WebContentsView | undefined {
    return this.views.get(id)?.view
  }

  get shown(): Id[] {
    return this.shownIds
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
    view.setBackgroundColor('#ffffff')
    const entry: Entry = { view, profile, owner: this }
    this.views.set(id, entry)
    profile.extensions?.addTab(view.webContents, this.win)
    this.wire(id, entry)
    view.webContents.loadURL(url)
    return view
  }

  /** Prend en charge une vue déjà chargée (Peek, mini-fenêtre) comme onglet de cette fenêtre. */
  adoptView(id: Id, view: WebContentsView, profile: ProfileContext): void {
    const entry: Entry = { view, profile, owner: this }
    view.setBackgroundColor('#ffffff')
    this.views.set(id, entry)
    profile.extensions?.addTab(view.webContents, this.win)
    moveExtensionTab(profile, view.webContents, this.win)
    this.wire(id, entry)
    this.events.onLiveChange()
  }

  /** Retire la vue de cette fenêtre sans la fermer (elle part dans une autre fenêtre). */
  release(id: Id): Entry | undefined {
    const entry = this.views.get(id)
    if (!entry) return undefined
    this.views.delete(id)
    if (this.shownIds.includes(id)) {
      this.win.contentView.removeChildView(entry.view)
      this.shownIds = this.shownIds.filter((x) => x !== id)
      if (this.focusedId === id) this.focusedId = this.shownIds[0] ?? null
      this.layout()
    }
    return entry
  }

  /** Accueille une vue venue d'une autre fenêtre. */
  adopt(id: Id, entry: Entry): void {
    entry.owner = this
    this.views.set(id, entry)
    moveExtensionTab(entry.profile, entry.view.webContents, this.win)
  }

  /** Identifiant de l'onglet affiché par ce webContents. */
  idOf(wc: Electron.WebContents): Id | undefined {
    for (const [id, entry] of this.views) if (entry.view.webContents === wc) return id
    return undefined
  }

  /** Toutes les vues (fermeture de la fenêtre). */
  destroyAll(): void {
    for (const id of [...this.views.keys()]) this.destroy(id)
  }

  /** Affiche un onglet, ou plusieurs côte à côte (Split View), et donne le focus à `focusId`. */
  show(ids: Id[], sizes: number[] = [], focusId: Id | null = ids[0] ?? null): void {
    const visible = ids.filter((id) => this.views.has(id))
    for (const id of this.shownIds) {
      if (!visible.includes(id)) {
        const entry = this.views.get(id)
        if (entry) this.win.contentView.removeChildView(entry.view)
      }
    }
    // Sous l'overlay et la sidebar flottante : les pages sont insérées juste au-dessus de l'UI (index 0).
    visible.forEach((id, i) => {
      if (!this.shownIds.includes(id)) this.win.contentView.addChildView(this.views.get(id)!.view, i)
    })
    this.shownIds = visible
    this.shownSizes = sizes.length === visible.length ? sizes : visible.map(() => 1 / Math.max(1, visible.length))
    this.focusedId = focusId && visible.includes(focusId) ? focusId : (visible[0] ?? null)
    if (this.focusedId) {
      const entry = this.views.get(this.focusedId)!
      entry.profile.extensions?.selectTab(entry.view.webContents)
      entry.view.webContents.focus()
    }
    this.layout()
  }

  destroy(id: Id): void {
    const entry = this.views.get(id)
    if (!entry) return
    this.views.delete(id)
    this.consoleCounts.delete(id)
    if (this.shownIds.includes(id)) {
      this.win.contentView.removeChildView(entry.view)
      this.shownIds = this.shownIds.filter((x) => x !== id)
      if (this.focusedId === id) this.focusedId = this.shownIds[0] ?? null
    }
    entry.profile.extensions?.removeTab(entry.view.webContents)
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    this.layout()
    this.events.onLiveChange()
  }

  setLayout(patch: Partial<Omit<LayoutInput, 'width' | 'height'>>): void {
    this.layoutInput = { ...this.layoutInput, ...patch }
    this.layout()
  }

  currentLayout(): Layout {
    const [width, height] = this.win.getContentSize()
    return computeLayout({ ...this.layoutInput, width, height })
  }

  layout(): void {
    const { page, radius } = this.currentLayout()
    const panes = splitPanes(page, this.shownSizes)
    this.shownIds.forEach((id, i) => {
      const view = this.views.get(id)?.view
      if (!view) return
      view.setBorderRadius(radius)
      view.setBounds(roundRect(panes[i] ?? page))
    })
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

  private wire(id: Id, entry: Entry): void {
    const { view } = entry
    const wc = view.webContents
    // Toujours la fenêtre propriétaire du moment : l'onglet peut changer de fenêtre.
    const ev = () => entry.owner.events
    const owner = () => entry.owner
    const live = () => ev().onLiveChange()
    wc.on('did-start-loading', live)
    wc.on('did-stop-loading', live)
    wc.on('audio-state-changed', live)
    wc.on('zoom-changed', live)
    wc.on('page-title-updated', (_e, title) => ev().onRecordChange(id, { title }))
    wc.on('page-favicon-updated', (_e, favicons) => ev().onRecordChange(id, { favicon: favicons[0] }))
    const navigated = () => {
      ev().onRecordChange(id, { url: wc.getURL(), title: wc.getTitle() })
      live()
    }
    wc.on('console-message', (event) => {
      if (event.level !== 'error' && event.level !== 'warning') return
      const counts = owner().consoleCounts.get(id) ?? { errors: 0, warnings: 0 }
      if (event.level === 'error') counts.errors++
      else counts.warnings++
      owner().consoleCounts.set(id, counts)
      live()
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) owner().consoleCounts.delete(id)
    })
    wc.on('will-navigate', (event) => {
      if (event.isMainFrame && ev().shouldPeek(id, event.url)) {
        event.preventDefault()
        ev().onPeek(id, event.url)
      }
    })
    wc.on('did-navigate', () => {
      navigated()
      ev().onVisit(id, wc.getURL(), wc.getTitle())
    })
    wc.on('did-navigate-in-page', (_e, _url, isMainFrame) => isMainFrame && navigated())
    wc.on('found-in-page', (_e, result) => ev().onFoundInPage(id, result.matches, result.activeMatchOrdinal))
    wc.on('update-target-url', (_e, url) => ev().onHoverLink(id, url))
    wc.on('focus', () => ev().onFocusTab(id))
    wc.on('destroyed', () => {
      const current = owner()
      if (current.views.get(id) === entry) {
        current.views.delete(id)
        current.events.onClosedByPage(id)
      }
    })

    // target=_blank et clic molette → onglet (ou Peek) ; vraies popups (OAuth…) → fenêtre.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'new-window') return { action: 'allow' }
      if (disposition === 'foreground-tab' && ev().shouldPeek(id, url)) ev().onPeek(id, url)
      else ev().onOpenTab(id, url, disposition === 'background-tab')
      return { action: 'deny' }
    })

    wc.on('context-menu', (_e, params) => owner().pageContextMenu(id, view, params))
  }

  pageContextMenu(id: Id, view: WebContentsView, params: Electron.ContextMenuParams): void {
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
      add({ label: `Rechercher « ${text} »`, click: () => this.events.onOpenTab(id, this.events.searchUrl(params.selectionText), false) })
      add({ type: 'separator' })
    } else if (!params.linkURL && params.mediaType === 'none') {
      add({ label: 'Précédent', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() })
      add({ label: 'Suivant', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() })
      add({ label: 'Recharger', click: () => wc.reload() })
      add({ type: 'separator' })
    }

    const extensionItems = entry?.profile.extensions?.getContextMenuItems(wc, params) ?? []
    if (extensionItems.length) {
      extensionItems.forEach((item) => menu.append(item))
      add({ type: 'separator' })
    }
    add({ label: 'Afficher le code source', click: () => this.events.onOpenTab(id, `view-source:${wc.getURL()}`, false) })
    add({ label: "Inspecter l'élément", click: () => wc.inspectElement(params.x, params.y) })
    menu.popup({ window: this.win })
  }
}
