import type { Layout, Rect } from './layout'
import type { Id, LiveTab, PersistedState, Settings, SpaceTheme, TabLocation } from './model'

/** État envoyé à l'UI (sidebar, sidebar flottante, overlay). Propre à chaque fenêtre. */
export interface UiState {
  persisted: PersistedState
  /** Space affiché dans cette fenêtre. */
  spaceId: Id
  /** Fenêtre de navigation privée. */
  isPrivate: boolean
  /** Onglets avec un média en cours (contrôles dans la sidebar), hors onglet affiché. */
  mediaTabIds: Id[]
  live: Record<Id, LiveTab>
  activeTabId: Id | null
  /** Onglets affichés (plusieurs en Split View). */
  shownTabIds: Id[]
  sidebarVisible: boolean
  fullscreen: boolean
  layout: Layout
  /** Developer Mode actif pour l'onglet affiché. */
  devMode: boolean
  downloads: DownloadInfo[]
  /** Partition de session du profil actif (pour les boutons d'extensions). */
  partition: string
}

export interface DownloadInfo {
  id: string
  filename: string
  path: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  startedAt: number
}

/** Actions déclenchées depuis l'UI, exécutées par le process main. */
export type BrowserAction =
  | { type: 'tab.new'; url?: string }
  | { type: 'tab.select'; id: Id }
  | { type: 'tab.close'; id: Id }
  | { type: 'tab.navigate'; id: Id; input: string }
  | { type: 'tab.back'; id: Id }
  | { type: 'tab.forward'; id: Id }
  | { type: 'tab.reload'; id: Id }
  | { type: 'tab.resetToPinned'; id: Id }
  | { type: 'tab.toggleMute'; id: Id }
  | { type: 'tab.move'; id: Id; to: TabLocation; index: number }
  | { type: 'tab.rename'; id: Id; title: string }
  | { type: 'tab.contextMenu'; id: Id }
  | { type: 'tab.copyUrl'; id?: Id; markdown?: boolean }
  | { type: 'tab.devtools'; id: Id }
  | { type: 'split.create'; ids: Id[] }
  | { type: 'split.dissolve'; id: Id }
  | { type: 'folder.new'; spaceId: Id }
  | { type: 'folder.toggle'; spaceId: Id; id: Id }
  | { type: 'folder.rename'; spaceId: Id; id: Id; title: string }
  | { type: 'folder.contextMenu'; spaceId: Id; id: Id }
  | { type: 'space.select'; id: Id }
  | { type: 'space.new' }
  | { type: 'space.update'; id: Id; name?: string; icon?: string; theme?: SpaceTheme; archiveAfterHours?: number | null }
  | { type: 'space.contextMenu'; id: Id }
  | { type: 'space.newMenu' }
  | { type: 'today.clear'; spaceId: Id }
  | { type: 'download.open'; id: string }
  | { type: 'download.reveal'; id: string }
  | { type: 'download.clear' }
  | { type: 'devMode.toggle'; host: string }
  | { type: 'extension.pin'; id: string; pinned: boolean }
  | { type: 'settings.update'; patch: Partial<Settings> }
  | { type: 'ui.sidebarWidth'; width: number; commit?: boolean }
  | { type: 'ui.toggleSidebar' }
  | { type: 'ui.commandBar'; mode: CommandBarMode }
  | { type: 'ui.siteControls'; anchor: Rect }
  | { type: 'ui.extensionsMenu'; anchor: Rect }
  | { type: 'extension.activate'; id: string }
  | { type: 'ui.openSettings' }
  | { type: 'archive.restore'; index: number }
  | { type: 'history.open'; url: string }
  | { type: 'media.toggle'; id: Id }
  | { type: 'ui.themeEditor'; spaceId: Id; anchor?: Rect }
  | { type: 'profile.create'; name: string }
  | { type: 'profile.rename'; id: Id; name: string }
  | { type: 'profile.delete'; id: Id }
  | { type: 'arc.import' }
  | { type: 'command.run'; id: string }
  | { type: 'browser.setDefault' }

export type CommandBarMode = 'new-tab' | 'edit-url'

export interface Suggestion {
  kind: 'tab' | 'history' | 'search' | 'url' | 'command'
  title: string
  subtitle?: string
  url?: string
  tabId?: Id
  favicon?: string
  /** Identifiant de commande (kind = command). */
  command?: string
}

export type PermissionDecision = 'allow' | 'deny'

export interface SitePermission {
  key: string
  label: string
  decision: PermissionDecision
}

export interface ExtensionInfo {
  id: string
  name: string
  pinned: boolean
}

/** Contenu du menu « Contrôles du site ». */
export interface SiteInfo {
  tabId: Id
  url: string
  host: string
  origin: string
  secure: boolean
  zoom: number
  devMode: boolean
  permissions: SitePermission[]
}

/** Ce que l'overlay affiche. */
export type OverlayState =
  | { kind: 'hidden' }
  | { kind: 'command-bar'; mode: CommandBarMode; initial: string; tabId: Id | null }
  | { kind: 'find'; tabId: Id; matches: number; activeMatch: number }
  | { kind: 'site-controls'; site: SiteInfo }
  | { kind: 'extensions'; extensions: ExtensionInfo[]; partition: string }
  | { kind: 'theme-editor'; spaceId: Id }
  | { kind: 'peek'; url: string; title: string; loading: boolean }

/** Actions propres à l'overlay. */
export type OverlayAction =
  | { type: 'overlay.close' }
  | { type: 'commandBar.submit'; input: string; suggestion?: Suggestion }
  | { type: 'find.query'; text: string; forward: boolean; findNext: boolean }
  | { type: 'site.zoom'; tabId: Id; delta: number }
  | { type: 'site.permission'; origin: string; key: string; decision: PermissionDecision | null }
  | { type: 'site.clearData'; tabId: Id }
  | { type: 'peek.expand' }
  | { type: 'peek.close' }

/** Événements ponctuels envoyés à la sidebar. */
export type UiEvent =
  | { type: 'rename-space'; id: Id }
  | { type: 'rename-folder'; spaceId: Id; id: Id }
  | { type: 'rename-tab'; id: Id }
  | { type: 'floating-show' }
  /** Ouvrir le popup d'une extension, ancré sur le bouton puzzle de la barre d'URL. */
  | { type: 'activate-extension'; id: string }
  | { type: 'open-library'; tab: 'downloads' | 'archive' | 'history' }

/** Petite notification (« Lien copié »). */
export interface Toast {
  id: number
  message: string
  detail?: string
}

export interface HistoryItem {
  url: string
  title: string
  lastVisitAt: number
}

export interface CommandInfo {
  id: string
  label: string
  menu: string
  accelerator?: string
}

/** État d'une mini-fenêtre (Little Arc). */
export interface LittleState {
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  spaceName: string
}

export type LittleAction = { type: 'little.expand' } | { type: 'little.back' } | { type: 'little.forward' } | { type: 'little.reload' } | { type: 'little.copy' }

export interface UiApi {
  dispatch(action: BrowserAction | OverlayAction | LittleAction): Promise<void>
  getState(): Promise<UiState>
  onState(listener: (state: UiState) => void): () => void
  onEvent(listener: (event: UiEvent) => void): () => void
  suggest(query: string): Promise<Suggestion[]>
  getOverlay(): Promise<OverlayState>
  onOverlay(listener: (overlay: OverlayState) => void): () => void
  onToast(listener: (toast: Toast | null) => void): () => void
  onStatus(listener: (url: string) => void): () => void
  searchHistory(query: string): Promise<HistoryItem[]>
  commands(): Promise<CommandInfo[]>
  onLittle(listener: (state: LittleState) => void): () => void
}
