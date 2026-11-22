import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import type { BrowserState, UiApi } from '../shared/ipc'

// Élément <browser-action-list> pour afficher les boutons d'extensions dans la sidebar.
injectBrowserAction()

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: UiApi = {
  newTab: (url) => ipcRenderer.invoke('tab:new', url),
  closeTab: (id) => ipcRenderer.invoke('tab:close', id),
  selectTab: (id) => ipcRenderer.invoke('tab:select', id),
  navigate: (id, input) => ipcRenderer.invoke('tab:navigate', id, input),
  goBack: (id) => ipcRenderer.invoke('tab:back', id),
  goForward: (id) => ipcRenderer.invoke('tab:forward', id),
  reload: (id) => ipcRenderer.invoke('tab:reload', id),
  setSidebarWidth: (width) => ipcRenderer.invoke('ui:sidebar-width', width),
  getState: () => ipcRenderer.invoke('browser:get-state'),
  onState: (listener) => subscribe<[BrowserState]>('browser:state', listener),
  onFocusAddressBar: (listener) => subscribe('ui:focus-address', listener),
}

contextBridge.exposeInMainWorld('browsy', api)
