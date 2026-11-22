import { app, ipcMain, session } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { BrowserAction, OverlayAction } from '../shared/ipc'
import { DEFAULT_PROFILE_ID } from '../shared/model'
import { loadArcExtensions } from './arcExtensions'
import { Browser } from './Browser'
import { CHROME_USER_AGENT } from './chromeIdentity'
import { attachDevProbe } from './devProbe'
import { runScenarios } from './devScenario'
import { buildMenu } from './menu'
import { partitionOf } from './profiles'

app.setName('Browsy')
app.userAgentFallback = CHROME_USER_AGENT
// Dev : profil séparé (tests automatisés sans toucher aux sessions de l'utilisateur).
if (process.env.BROWSY_USER_DATA) app.setPath('userData', process.env.BROWSY_USER_DATA)

// FedCM (« Se connecter avec Google » géré par le navigateur) : Electron expose l'API
// mais pas le sélecteur de compte, donc navigator.credentials.get() échoue
// (« FedCM get() rejects with NetworkError »). Sans FedCM, Google Identity Services
// bascule sur la popup classique, comme dans Brave.
app.commandLine.appendSwitch('disable-features', 'FedCm')

// Une seule instance : un lien ouvert depuis une autre app arrive dans la fenêtre existante.
if (!app.requestSingleInstanceLock()) app.quit()

let browser: Browser | null = null
/** Liens reçus avant que le navigateur soit prêt (lancement via un lien). */
const pendingUrls: string[] = []

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (browser) void browser.newTab(url)
  else pendingUrls.push(url)
})

function registerIpc(): void {
  ipcMain.handle('ui:dispatch', (e, action: BrowserAction | OverlayAction) => browser?.dispatch(action, e.sender))
  ipcMain.handle('ui:get-state', () => browser?.uiState())
  ipcMain.handle('ui:get-overlay', () => browser?.overlayState() ?? { kind: 'hidden' })
  ipcMain.handle('ui:suggest', (_e, query: string) => browser?.suggest(query) ?? [])
  ipcMain.handle('ui:history', (_e, query: string) => browser?.searchHistory(query) ?? [])
}

app.whenReady().then(async () => {
  // Icônes d'extensions (<browser-action-list>) affichées dans l'UI, qui vit dans la session par défaut.
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  registerIpc()

  browser = new Browser()
  buildMenu(browser)
  await browser.start()

  if (process.env.BROWSY_ARC_EXTENSIONS === '1') {
    await loadArcExtensions(session.fromPartition(partitionOf(DEFAULT_PROFILE_ID)))
  }
  if (process.env.BROWSY_LOAD_EXTENSION) {
    await session.fromPartition(partitionOf(DEFAULT_PROFILE_ID)).extensions.loadExtension(process.env.BROWSY_LOAD_EXTENSION, { allowFileAccess: true })
  }
  const startUrl = process.env.BROWSY_START_URL
  if (startUrl) {
    const id = await browser.newTab(startUrl)
    const view = browser.viewOf(id)
    if (view) attachDevProbe(browser.win, view)
  }
  const commandBarQuery = process.env.BROWSY_PROBE_COMMANDBAR
  if (commandBarQuery !== undefined && process.env.BROWSY_CAPTURE) {
    // Dev : ouvre la Command bar, tape une requête et capture l'overlay.
    const b = browser
    setTimeout(async () => {
      b.openCommandBar('new-tab')
      await new Promise((r) => setTimeout(r, 500))
      b.overlayWebContents.insertText(commandBarQuery)
      await new Promise((r) => setTimeout(r, 1500))
      const { writeFileSync } = await import('node:fs')
      writeFileSync(`${process.env.BROWSY_CAPTURE}-overlay.png`, (await b.overlayWebContents.capturePage()).toPNG())
      console.log('[capture] overlay ok')
    }, 6000)
  }
  if (process.env.BROWSY_SCENARIO && process.env.BROWSY_CAPTURE) {
    void runScenarios(browser, process.env.BROWSY_SCENARIO.split(','), process.env.BROWSY_CAPTURE)
  }
  for (const url of pendingUrls.splice(0)) await browser.newTab(url)
})

app.on('second-instance', (_event, argv) => {
  browser?.win.show()
  const url = argv.find((arg) => /^https?:\/\//.test(arg))
  if (url) void browser?.newTab(url)
})

app.on('activate', () => browser?.win.show())
app.on('before-quit', () => browser?.flush())
