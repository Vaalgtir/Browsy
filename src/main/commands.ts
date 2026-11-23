import type { Browser } from './Browser'

/**
 * Registre des commandes de Browsy : il alimente le menu de l'application,
 * les raccourcis personnalisables (Réglages > Raccourcis) et la Command bar.
 */

export type MenuName = 'Fichier' | 'Édition' | 'Présentation' | 'Historique' | 'Onglets' | 'Spaces'

export interface Command {
  id: string
  label: string
  menu: MenuName
  /** Raccourci par défaut (format accélérateur Electron). */
  accelerator?: string
  /** Raccourcis secondaires, non affichés dans le menu. */
  aliases?: string[]
  /** Séparateur avant la commande dans le menu. */
  separator?: boolean
  /** Proposée dans la Command bar (par défaut : oui). */
  palette?: boolean
  run(browser: Browser): void | Promise<void>
}

/** Métadonnées envoyées à l'UI (réglages des raccourcis). */
export interface CommandInfo {
  id: string
  label: string
  menu: MenuName
  accelerator?: string
}

const zoom = (b: Browser, delta: number) => {
  const wc = b.activeWebContents()
  if (wc) wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta)
}

/** Nouvelle fenêtre sur le même Space (ou privée), Command bar ouverte pour taper une adresse. */
const openWindow = (b: Browser, isPrivate: boolean) => {
  const browser = b.app.newWindow({ private: isPrivate, spaceId: isPrivate ? undefined : b.spaceId })
  browser.win.once('ready-to-show', () => browser.openCommandBar('new-tab'))
}

const numbered = (prefix: string, kind: 'tab' | 'space'): Command[] =>
  Array.from({ length: 9 }, (_, i) => ({
    id: `${kind}.${i + 1}`,
    label: kind === 'tab' ? (i === 8 ? 'Dernier onglet' : `Onglet ${i + 1}`) : `Space ${i + 1}`,
    menu: kind === 'tab' ? 'Onglets' : 'Spaces',
    accelerator: `${prefix}+${i + 1}`,
    separator: i === 0,
    palette: false,
    run: (b: Browser) => (kind === 'tab' ? b.selectTabAt(i + 1) : b.selectSpaceAt(i + 1)),
  }))

export const COMMANDS: Command[] = [
  // Fichier
  { id: 'tab.new', label: 'Nouvel onglet', menu: 'Fichier', accelerator: 'CmdOrCtrl+T', palette: false, run: (b) => b.openCommandBar('new-tab') },
  { id: 'window.new', label: 'Nouvelle fenêtre', menu: 'Fichier', accelerator: 'CmdOrCtrl+N', run: (b) => openWindow(b, false) },
  { id: 'window.private', label: 'Nouvelle fenêtre de navigation privée', menu: 'Fichier', accelerator: 'CmdOrCtrl+Shift+N', run: (b) => openWindow(b, true) },
  { id: 'littleArc.new', label: 'Nouvelle mini-fenêtre', menu: 'Fichier', accelerator: 'Alt+CmdOrCtrl+N', run: (b) => void b.app.openLittle() },
  { id: 'url.edit', label: "Modifier l'URL", menu: 'Fichier', accelerator: 'CmdOrCtrl+L', palette: false, separator: true, run: (b) => b.openCommandBar('edit-url') },
  { id: 'tab.reopen', label: "Rouvrir l'onglet fermé", menu: 'Fichier', accelerator: 'CmdOrCtrl+Shift+T', run: (b) => b.reopenClosedTab() },
  {
    id: 'tab.close',
    label: "Fermer l'onglet",
    menu: 'Fichier',
    accelerator: 'CmdOrCtrl+W',
    separator: true,
    run: (b) => {
      const id = b.activeTabId
      if (id) b.closeTab(id)
      else if (b.isPrivate || b.app.windowCount > 1) b.win.close()
    },
  },
  { id: 'window.close', label: 'Fermer la fenêtre', menu: 'Fichier', accelerator: 'CmdOrCtrl+Shift+W', palette: false, run: (b) => b.win.close() },
  { id: 'arc.import', label: 'Importer depuis Arc…', menu: 'Fichier', separator: true, run: (b) => b.importFromArc() },
  { id: 'page.print', label: 'Imprimer…', menu: 'Fichier', accelerator: 'CmdOrCtrl+P', separator: true, run: (b) => b.activeWebContents()?.print() },

  // Édition (après les rôles standards Couper / Copier / Coller)
  { id: 'url.copy', label: "Copier l'URL", menu: 'Édition', accelerator: 'CmdOrCtrl+Shift+C', separator: true, run: (b) => b.copyUrl() },
  { id: 'url.copyMarkdown', label: "Copier l'URL en Markdown", menu: 'Édition', accelerator: 'Alt+CmdOrCtrl+Shift+C', run: (b) => b.copyUrl(undefined, true) },
  { id: 'page.find', label: 'Rechercher dans la page', menu: 'Édition', accelerator: 'CmdOrCtrl+F', run: (b) => b.openFind() },

  // Présentation
  { id: 'sidebar.toggle', label: 'Afficher/masquer la sidebar', menu: 'Présentation', accelerator: 'CmdOrCtrl+S', run: (b) => b.toggleSidebar() },
  {
    id: 'sidebar.side',
    label: 'Sidebar à gauche / à droite',
    menu: 'Présentation',
    run: (b) => b.dispatch({ type: 'settings.update', patch: { sidebarPosition: b.settings.sidebarPosition === 'left' ? 'right' : 'left' } }),
  },
  { id: 'devMode.toggle', label: 'Developer Mode pour ce site', menu: 'Présentation', accelerator: 'Alt+CmdOrCtrl+D', run: (b) => b.toggleDevMode() },
  { id: 'page.reload', label: 'Recharger', menu: 'Présentation', accelerator: 'CmdOrCtrl+R', separator: true, run: (b) => b.activeWebContents()?.reload() },
  { id: 'page.hardReload', label: 'Recharger sans cache', menu: 'Présentation', accelerator: 'CmdOrCtrl+Shift+R', run: (b) => b.activeWebContents()?.reloadIgnoringCache() },
  { id: 'devtools.toggle', label: 'Outils de développement', menu: 'Présentation', accelerator: 'Alt+CmdOrCtrl+I', separator: true, run: (b) => b.activeWebContents()?.toggleDevTools() },
  {
    id: 'page.source',
    label: 'Afficher le code source',
    menu: 'Présentation',
    accelerator: 'Alt+CmdOrCtrl+U',
    run: (b) => {
      const url = b.activeWebContents()?.getURL()
      if (url) void b.newTab(`view-source:${url}`)
    },
  },
  { id: 'devtools.ui', label: "DevTools de l'interface Browsy", menu: 'Présentation', accelerator: 'Alt+Shift+CmdOrCtrl+I', palette: false, run: (b) => b.win.webContents.toggleDevTools() },
  { id: 'zoom.in', label: 'Zoom avant', menu: 'Présentation', accelerator: 'CmdOrCtrl+Plus', aliases: ['CmdOrCtrl+='], separator: true, run: (b) => zoom(b, 0.5) },
  { id: 'zoom.out', label: 'Zoom arrière', menu: 'Présentation', accelerator: 'CmdOrCtrl+-', run: (b) => zoom(b, -0.5) },
  { id: 'zoom.reset', label: 'Taille réelle', menu: 'Présentation', accelerator: 'CmdOrCtrl+0', run: (b) => zoom(b, 0) },
  {
    id: 'fullscreen.toggle',
    label: 'Plein écran',
    menu: 'Présentation',
    accelerator: 'Ctrl+CmdOrCtrl+F',
    separator: true,
    run: (b) => b.win.setFullScreen(!b.win.isFullScreen()),
  },

  // Historique
  { id: 'history.back', label: 'Précédent', menu: 'Historique', accelerator: 'CmdOrCtrl+[', aliases: ['CmdOrCtrl+Left'], palette: false, run: (b) => b.activeWebContents()?.navigationHistory.goBack() },
  { id: 'history.forward', label: 'Suivant', menu: 'Historique', accelerator: 'CmdOrCtrl+]', aliases: ['CmdOrCtrl+Right'], palette: false, run: (b) => b.activeWebContents()?.navigationHistory.goForward() },
  { id: 'history.show', label: "Afficher l'historique", menu: 'Historique', accelerator: 'CmdOrCtrl+Y', separator: true, run: (b) => b.openLibrary('history') },
  { id: 'library.archive', label: 'Onglets archivés', menu: 'Historique', run: (b) => b.openLibrary('archive') },
  { id: 'library.downloads', label: 'Téléchargements', menu: 'Historique', accelerator: 'Alt+CmdOrCtrl+L', run: (b) => b.openLibrary('downloads') },

  // Onglets
  { id: 'tab.pin', label: 'Épingler / désépingler', menu: 'Onglets', accelerator: 'CmdOrCtrl+D', run: (b) => b.togglePinActive() },
  { id: 'tab.split', label: 'Split View', menu: 'Onglets', accelerator: 'Ctrl+Shift+=', run: (b) => b.splitActiveWithNext() },
  { id: 'today.clear', label: "Effacer les onglets du jour", menu: 'Onglets', run: (b) => b.dispatch({ type: 'today.clear', spaceId: b.activeSpaceId }) },
  { id: 'tab.next', label: 'Onglet suivant', menu: 'Onglets', accelerator: 'Ctrl+Tab', aliases: ['Alt+CmdOrCtrl+Down'], separator: true, palette: false, run: (b) => b.selectRelativeTab(1) },
  { id: 'tab.previous', label: 'Onglet précédent', menu: 'Onglets', accelerator: 'Ctrl+Shift+Tab', aliases: ['Alt+CmdOrCtrl+Up'], palette: false, run: (b) => b.selectRelativeTab(-1) },
  ...numbered('CmdOrCtrl', 'tab'),

  // Spaces
  { id: 'space.next', label: 'Space suivant', menu: 'Spaces', accelerator: 'Alt+CmdOrCtrl+Right', palette: false, run: (b) => b.selectRelativeSpace(1) },
  { id: 'space.previous', label: 'Space précédent', menu: 'Spaces', accelerator: 'Alt+CmdOrCtrl+Left', palette: false, run: (b) => b.selectRelativeSpace(-1) },
  { id: 'space.new', label: 'Nouveau Space', menu: 'Spaces', separator: true, run: (b) => b.dispatch({ type: 'space.new' }) },
  { id: 'folder.new', label: 'Nouveau dossier', menu: 'Spaces', run: (b) => b.dispatch({ type: 'folder.new', spaceId: b.activeSpaceId }) },
  { id: 'space.theme', label: 'Thème et icône du Space…', menu: 'Spaces', run: (b) => b.openThemeEditor() },
  ...numbered('Ctrl', 'space'),
]

export function commandInfos(): CommandInfo[] {
  return COMMANDS.map(({ id, label, menu, accelerator }) => ({ id, label, menu, accelerator }))
}

/** Raccourci effectif d'une commande (personnalisé, sinon par défaut ; chaîne vide = aucun). */
export function acceleratorOf(command: Command, overrides: Record<string, string>): string | undefined {
  const custom = overrides[command.id]
  if (custom !== undefined) return custom || undefined
  return command.accelerator
}
