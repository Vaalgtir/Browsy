/** Contrat IPC entre l'UI du navigateur (renderer) et le process main. */

export const BROWSING_PARTITION = 'persist:profile-default'

export interface TabState {
  id: number
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export interface BrowserState {
  tabs: TabState[]
  activeTabId: number | null
}

/** Canaux invoke (renderer → main). */
export interface UiApi {
  newTab(url?: string): Promise<void>
  closeTab(id: number): Promise<void>
  selectTab(id: number): Promise<void>
  navigate(id: number, input: string): Promise<void>
  goBack(id: number): Promise<void>
  goForward(id: number): Promise<void>
  reload(id: number): Promise<void>
  /** Largeur de la sidebar, pour placer la vue web à côté. */
  setSidebarWidth(width: number): Promise<void>
  getState(): Promise<BrowserState>
  onState(listener: (state: BrowserState) => void): () => void
  onFocusAddressBar(listener: () => void): () => void
}
