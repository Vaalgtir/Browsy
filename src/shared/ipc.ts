import type { Id, LiveTab, PersistedState, SpaceTheme, TabLocation } from './model'

/** État envoyé à l'UI (sidebar et overlay). */
export interface UiState {
  persisted: PersistedState
  live: Record<Id, LiveTab>
  activeTabId: Id | null
  sidebarVisible: boolean
  downloads: DownloadInfo[]
  /** Partition de session du profil actif (pour <browser-action-list>). */
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
  | { type: 'tab.contextMenu'; id: Id }
  | { type: 'folder.new'; spaceId: Id }
  | { type: 'folder.toggle'; spaceId: Id; id: Id }
  | { type: 'folder.rename'; spaceId: Id; id: Id; title: string }
  | { type: 'folder.contextMenu'; spaceId: Id; id: Id }
  | { type: 'space.select'; id: Id }
  | { type: 'space.new' }
  | { type: 'space.update'; id: Id; name?: string; icon?: string; theme?: SpaceTheme }
  | { type: 'space.contextMenu'; id: Id }
  | { type: 'today.clear'; spaceId: Id }
  | { type: 'download.open'; id: string }
  | { type: 'download.reveal'; id: string }
  | { type: 'download.clear' }
  | { type: 'ui.sidebarWidth'; width: number }
  | { type: 'ui.commandBar'; mode: CommandBarMode }

export type CommandBarMode = 'new-tab' | 'edit-url'

export interface Suggestion {
  kind: 'tab' | 'history' | 'search' | 'url' | 'command'
  title: string
  subtitle?: string
  url?: string
  tabId?: Id
  favicon?: string
}

/** Ce que l'overlay affiche. */
export type OverlayState =
  | { kind: 'hidden' }
  | { kind: 'command-bar'; mode: CommandBarMode; initial: string; tabId: Id | null }
  | { kind: 'find'; tabId: Id; matches: number; activeMatch: number }

/** Actions propres à l'overlay. */
export type OverlayAction =
  | { type: 'overlay.close' }
  | { type: 'commandBar.submit'; input: string; suggestion?: Suggestion }
  | { type: 'find.query'; text: string; forward: boolean; findNext: boolean }

/** Événements ponctuels envoyés à la sidebar. */
export type UiEvent = { type: 'rename-space'; id: Id } | { type: 'rename-folder'; spaceId: Id; id: Id }

export interface UiApi {
  dispatch(action: BrowserAction | OverlayAction): Promise<void>
  getState(): Promise<UiState>
  onState(listener: (state: UiState) => void): () => void
  onEvent(listener: (event: UiEvent) => void): () => void
  suggest(query: string): Promise<Suggestion[]>
  getOverlay(): Promise<OverlayState>
  onOverlay(listener: (overlay: OverlayState) => void): () => void
}
