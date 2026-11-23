import { app, ipcMain, session, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { BrowserAction, LittleAction, OverlayAction } from '../shared/ipc'
import { DEFAULT_PROFILE_ID } from '../shared/model'
import { App } from './App'
import { loadArcExtensions } from './arcExtensions'
import type { Browser } from './Browser'
import { CHROME_USER_AGENT } from './chromeIdentity'
import { attachDevProbe } from './devProbe'
import { runScenarios } from './devScenario'
import { partitionOf } from './profiles'

app.setName('Browsy')
app.userAgentFallback = CHROME_USER_AGENT
// Dev : profil séparé (tests automatisés sans toucher aux sessions de l'utilisateur).
if (process.env.BROWSY_USER_DATA) app.setPath('userData', process.env.BROWSY_USER_DATA)
// Dev : captures automatisées même quand la fenêtre est cachée derrière d'autres fenêtres.
if (process.env.BROWSY_CAPTURE) {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
}

// FedCM (« Se connecter avec Google » géré par le navigateur) : Electron expose l'API
// mais pas le sélecteur de compte, donc navigator.credentials.get() échoue
// (« FedCM get() rejects with NetworkError »). Sans FedCM, Google Identity Services
// bascule sur la popup classique, comme dans Brave.
app.commandLine.appendSwitch('disable-features', 'FedCm')

// Une seule instance : un lien ouvert depuis une autre app arrive dans l'instance existante.
if (!app.requestSingleInstanceLock()) app.quit()

let browsy: App | null = null
/** Liens reçus avant que l'application soit prête (lancement via un lien). */
const pendingUrls: string[] = []

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (browsy) void browsy.openExternalUrl(url)
  else pendingUrls.push(url)
})

/** Fenêtre à qui s'adresse un message de l'UI. */
function windowOf(sender: WebContents): Browser | undefined {
  return browsy?.windowFor(sender)
}

function registerIpc(): void {
  ipcMain.handle('ui:dispatch', async (e, action: BrowserAction | OverlayAction | LittleAction) => {
    if (!browsy) return
    const little = [...browsy.littles].find((l) => l.owns(e.sender))
    if (little) return little.dispatch(action as LittleAction)
    if (browsy.isSettingsWindow(e.sender)) return browsy.dispatchFromSettings(action as BrowserAction)
    return windowOf(e.sender)?.dispatch(action, e.sender)
  })
  ipcMain.handle('ui:get-state', (e) => {
    if (!browsy) return null
    if (browsy.isSettingsWindow(e.sender)) return browsy.mainWindow().uiState()
    return windowOf(e.sender)?.uiState() ?? null
  })
  ipcMain.handle('ui:get-overlay', (e) => windowOf(e.sender)?.overlayState() ?? { kind: 'hidden' })
  ipcMain.handle('ui:suggest', (e, query: string) => windowOf(e.sender)?.suggest(query) ?? [])
  ipcMain.handle('ui:history', (e, query: string) => (windowOf(e.sender) ?? browsy?.mainWindow())?.searchHistory(query) ?? [])
  ipcMain.handle('ui:commands', () => browsy?.commands() ?? [])
}

app.whenReady().then(async () => {
  // Icônes d'extensions (crx://) affichées dans l'UI, qui vit dans la session par défaut.
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  registerIpc()

  browsy = new App()
  const browser = await browsy.start()

  if (process.env.BROWSY_ARC_EXTENSIONS === '1') await loadArcExtensions(session.fromPartition(partitionOf(DEFAULT_PROFILE_ID)))
  if (process.env.BROWSY_LOAD_EXTENSION) {
    await session.fromPartition(partitionOf(DEFAULT_PROFILE_ID)).extensions.loadExtension(process.env.BROWSY_LOAD_EXTENSION, { allowFileAccess: true })
  }
  const startUrl = process.env.BROWSY_START_URL
  if (startUrl) {
    const id = await browser.newTab(startUrl)
    const view = browser.viewOf(id)
    if (view) attachDevProbe(browser.win, view)
  }
  if (process.env.BROWSY_SCENARIO && process.env.BROWSY_CAPTURE) {
    void runScenarios(browsy, browser, process.env.BROWSY_SCENARIO.split(','), process.env.BROWSY_CAPTURE)
  }
  for (const url of pendingUrls.splice(0)) await browsy.openExternalUrl(url)
})

app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => /^https?:\/\//.test(arg))
  if (url) void browsy?.openExternalUrl(url)
  else browsy?.mainWindow().win.show()
})

app.on('activate', () => {
  if (browsy && !browsy.windowCount) void browsy.newWindow().restore()
})
app.on('window-all-closed', () => {
  // macOS : l'application reste ouverte sans fenêtre, comme les autres navigateurs.
})
app.on('before-quit', () => browsy?.flush())
