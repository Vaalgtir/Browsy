import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import type { OverlayState, Toast, UiApi, UiEvent, UiState } from '../shared/ipc'

// API browserAction (boutons d'extensions) pour la sidebar.
if (location.search.includes('view=sidebar')) injectBrowserAction()

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: UiApi = {
  dispatch: (action) => ipcRenderer.invoke('ui:dispatch', action),
  getState: () => ipcRenderer.invoke('ui:get-state'),
  onState: (listener) => subscribe<UiState>('ui:state', listener),
  onEvent: (listener) => subscribe<UiEvent>('ui:event', listener),
  suggest: (query) => ipcRenderer.invoke('ui:suggest', query),
  getOverlay: () => ipcRenderer.invoke('ui:get-overlay'),
  onOverlay: (listener) => subscribe<OverlayState>('ui:overlay', listener),
  onToast: (listener) => subscribe<Toast | null>('ui:toast', listener),
  onStatus: (listener) => subscribe<string>('ui:status', listener),
  searchHistory: (query) => ipcRenderer.invoke('ui:history', query),
}

contextBridge.exposeInMainWorld('browsy', api)
