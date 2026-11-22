import { join } from 'node:path'
import { BrowserWindow, Menu, app, ipcMain, session, type Session } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore } from 'electron-chrome-web-store'
import { BROWSING_PARTITION, type BrowserState } from '../shared/ipc'
import { loadArcExtensions } from './arcExtensions'
import { attachDevProbe } from './devProbe'
import { CHROME_USER_AGENT, installChromeIdentity } from './chromeIdentity'
import { TabManager, resolveInput } from './TabManager'

app.userAgentFallback = CHROME_USER_AGENT
app.setName('Browsy')
// Dev : profil séparé (tests automatisés sans toucher aux sessions de l'utilisateur).
if (process.env.BROWSY_USER_DATA) app.setPath('userData', process.env.BROWSY_USER_DATA)

// FedCM (« Se connecter avec Google » géré par le navigateur) : Electron expose l'API
// mais pas le sélecteur de compte, donc navigator.credentials.get() échoue
// (« FedCM get() rejects with NetworkError »). Sans FedCM, Google Identity Services
// bascule sur la popup classique, comme dans Brave.
app.commandLine.appendSwitch('disable-features', 'FedCm')

let win: BrowserWindow | null = null
let tabs: TabManager | null = null

function sendState(state: BrowserState): void {
  if (win && !win.isDestroyed()) win.webContents.send('browser:state', state)
}

function createWindow(browsing: Session, extensions: ElectronChromeExtensions): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/ui.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  tabs = new TabManager(win, browsing, extensions, sendState)
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
    tabs = null
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  win.webContents.once('did-finish-load', () => {
    const first = tabs?.create(process.env.BROWSY_START_URL || undefined)
    if (first && win) attachDevProbe(win, first)
  })
}

function registerIpc(): void {
  const withTab = (id: number, fn: (wc: Electron.WebContents) => void) => {
    const view = tabs?.get(id)
    if (view) fn(view.webContents)
  }
  ipcMain.handle('tab:new', (_e, url?: string) => void tabs?.create(url ? resolveInput(url) : undefined))
  ipcMain.handle('tab:close', (_e, id: number) => tabs?.close(id))
  ipcMain.handle('tab:select', (_e, id: number) => tabs?.select(id))
  ipcMain.handle('tab:navigate', (_e, id: number, input: string) =>
    withTab(id, (wc) => {
      wc.loadURL(resolveInput(input))
      wc.focus()
    }),
  )
  ipcMain.handle('tab:back', (_e, id: number) => withTab(id, (wc) => wc.navigationHistory.goBack()))
  ipcMain.handle('tab:forward', (_e, id: number) => withTab(id, (wc) => wc.navigationHistory.goForward()))
  ipcMain.handle('tab:reload', (_e, id: number) => withTab(id, (wc) => wc.reload()))
  ipcMain.handle('ui:sidebar-width', (_e, width: number) => tabs?.setSidebarWidth(width))
  ipcMain.handle('browser:get-state', () => tabs?.getState() ?? { tabs: [], activeTabId: null })
}

function buildMenu(): void {
  const active = () => tabs?.active?.webContents
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Fichier',
        submenu: [
          { label: 'Nouvel onglet', accelerator: 'CmdOrCtrl+T', click: () => tabs?.create() },
          { label: "Barre d'adresse", accelerator: 'CmdOrCtrl+L', click: () => win?.webContents.send('ui:focus-address') },
          {
            label: "Fermer l'onglet",
            accelerator: 'CmdOrCtrl+W',
            click: () => {
              const id = tabs?.getState().activeTabId
              if (id != null) tabs?.close(id)
            },
          },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'Présentation',
        submenu: [
          { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: () => active()?.reload() },
          { label: 'Recharger sans cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => active()?.reloadIgnoringCache() },
          { type: 'separator' },
          { label: 'Outils de développement', accelerator: 'Alt+CmdOrCtrl+I', click: () => active()?.toggleDevTools() },
          { label: "DevTools de l'interface Browsy", accelerator: 'Alt+Shift+CmdOrCtrl+I', click: () => win?.webContents.toggleDevTools() },
          { type: 'separator' },
          { label: 'Zoom avant', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.5) },
          { label: 'Zoom arrière', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
          { label: 'Taille réelle', accelerator: 'CmdOrCtrl+0', click: () => active()?.setZoomLevel(0) },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Historique',
        submenu: [
          { label: 'Précédent', accelerator: 'CmdOrCtrl+[', click: () => active()?.navigationHistory.goBack() },
          { label: 'Suivant', accelerator: 'CmdOrCtrl+]', click: () => active()?.navigationHistory.goForward() },
        ],
      },
      {
        label: 'Onglets',
        submenu: [
          { label: 'Onglet suivant', accelerator: 'Ctrl+Tab', click: () => tabs?.selectRelative(1) },
          { label: 'Onglet précédent', accelerator: 'Ctrl+Shift+Tab', click: () => tabs?.selectRelative(-1) },
        ],
      },
      { role: 'windowMenu' },
    ]),
  )

  function zoom(delta: number) {
    const wc = active()
    if (wc) wc.setZoomLevel(wc.getZoomLevel() + delta)
  }
}

app.whenReady().then(async () => {
  const browsing = session.fromPartition(BROWSING_PARTITION)
  installChromeIdentity(browsing)

  const extensions = new ElectronChromeExtensions({
    session: browsing,
    async createTab(details) {
      if (!win || !tabs) throw new Error('Aucune fenêtre')
      const view = tabs.create(details.url, { activate: details.active !== false })
      return [view.webContents, win]
    },
    selectTab(wc) {
      tabs?.select(wc.id)
    },
    removeTab(wc) {
      tabs?.close(wc.id)
    },
    async createWindow(details) {
      // Phase 0 : une seule fenêtre, on ouvre les URLs demandées dans des onglets.
      const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : []
      for (const url of urls) tabs?.create(url)
      if (!win) throw new Error('Aucune fenêtre')
      return win
    },
  })
  // Après le preload de la lib : correctifs de compatibilité (voir src/preload/compat.ts).
  const compatPreload = join(__dirname, '../preload/compat.js')
  browsing.registerPreloadScript({ id: 'browsy-compat-frame', type: 'frame', filePath: compatPreload })
  browsing.registerPreloadScript({ id: 'browsy-compat-sw', type: 'service-worker', filePath: compatPreload })
  // Icônes d'extensions (<browser-action-list>) affichées dans l'UI, qui vit dans la session par défaut.
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)

  await installChromeWebStore({ session: browsing, allowUnpackedExtensions: true })
  if (process.env.BROWSY_DEBUG_SW === '1') {
    // Phase 0 : affiche les logs des service workers d'extensions dans le terminal.
    browsing.serviceWorkers.on('console-message', (_event, details) => {
      console.log(`[sw] ${details.sourceUrl}:${details.lineNumber} ${details.message}`)
    })
  }
  if (process.env.BROWSY_LOAD_EXTENSION) {
    await browsing.extensions.loadExtension(process.env.BROWSY_LOAD_EXTENSION, { allowFileAccess: true })
  }
  if (process.env.BROWSY_ARC_EXTENSIONS === '1') await loadArcExtensions(browsing)

  registerIpc()
  buildMenu()
  createWindow(browsing, extensions)

  app.on('activate', () => {
    if (!win) createWindow(browsing, extensions)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
