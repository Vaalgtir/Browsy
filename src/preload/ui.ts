import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import type { OverlayState, UiApi, UiEvent, UiState } from '../shared/ipc'

// Élément <browser-action-list> pour afficher les boutons d'extensions dans la sidebar.
if (!location.search.includes('view=overlay')) injectBrowserAction()

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
}

contextBridge.exposeInMainWorld('browsy', api)
