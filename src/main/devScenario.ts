import { writeFileSync } from 'node:fs'
import type { App } from './App'
import type { Browser } from './Browser'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Dev : scénarios de captures automatisées (BROWSY_SCENARIO=site-controls,toast,floating,fullscreen),
 * pour vérifier le rendu sans permission d'enregistrement d'écran.
 */
export async function runScenarios(app: App, browser: Browser, names: string[], prefix: string): Promise<void> {
  const shot = async (wc: Electron.WebContents, name: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        writeFileSync(`${prefix}-${name}.png`, (await wc.capturePage()).toPNG())
        console.log(`[scenario] ${name}`)
        return
      } catch (error) {
        await delay(600)
        if (attempt === 2) console.log(`[scenario] ${name} : capture impossible (${String(error)})`)
      }
    }
  }
  const views = browser.devViews()
  views.overlay.on('console-message', (event) => event.level === 'error' && console.log('[overlay]', event.message.slice(0, 400)))
  await delay(9000)
  for (const name of names) {
    if (name === 'site-controls') {
      await browser.openSiteControls({ x: 200, y: 50, width: 28, height: 28 })
      await delay(700)
      await shot(views.overlay, name)
      await browser.dispatch({ type: 'overlay.close' })
    } else if (name === 'extensions') {
      await browser.openExtensionsMenu({ x: 230, y: 50, width: 28, height: 28 })
      await delay(700)
      await shot(views.overlay, name)
      await browser.dispatch({ type: 'overlay.close' })
    } else if (name === 'toast') {
      browser.copyUrl()
      await delay(500)
      await shot(views.toast, name)
    } else if (name === 'floating') {
      browser.toggleSidebar()
      await delay(300)
      await shot(browser.win.webContents, 'hidden')
      views.floating.show()
      await delay(700)
      await shot(views.floating.view.webContents, name)
      views.floating.hide()
      browser.toggleSidebar()
    } else if (name === 'fullscreen') {
      browser.toggleSidebar()
      browser.win.setFullScreen(true)
      await delay(1800)
      await shot(browser.win.webContents, name)
      const id = browser.activeTabId
      const view = id ? browser.viewOf(id) : undefined
      console.log('[scenario] bounds page', JSON.stringify(view?.getBounds()), 'window', JSON.stringify(browser.win.getContentSize()))
      browser.win.setFullScreen(false)
      await delay(1500)
      browser.toggleSidebar()
    } else if (name === 'swipe') {
      // Gestes de trackpad simulés (contact puis inertie), enchaînés sans pause, à plusieurs hauteurs.
      while (browser.uiState().persisted.spaces.length < 4) {
        await browser.dispatch({ type: 'space.new' })
        await delay(300)
      }
      await browser.dispatch({ type: 'overlay.close' })
      await browser.dispatch({ type: 'space.select', id: browser.uiState().persisted.spaces[0].id })
      await delay(600)
      const wc = browser.win.webContents
      const [, height] = browser.win.getContentSize()
      const index = () => browser.uiState().persisted.spaces.findIndex((sp) => sp.id === browser.uiState().spaceId)
      const wheel = (y: number, dx: number) =>
        wc.sendInputEvent({ type: 'mouseWheel', x: 120, y, deltaX: -dx, deltaY: 0, hasPreciseScrollingDeltas: true, canScroll: true } as Electron.MouseWheelInputEvent)
      const swipe = async (y: number, sign: number, momentumEvents: number) => {
        for (let i = 0; i < 8; i++) {
          wheel(y, sign * Math.min(14, 2 + i * 3))
          await delay(16)
        }
        for (let i = 1; i <= momentumEvents; i++) {
          wheel(y, sign * 14 * 0.9 ** i)
          await delay(16)
        }
      }
      for (const [label, y] of [['bas (sous les onglets)', height - 120], ['milieu', Math.round(height / 2)], ['favoris', 130]] as const) {
        const sign = index() === 0 ? 1 : -1
        const before = index()
        for (let k = 0; k < 3; k++) await swipe(y, sign, 6)
        await delay(800)
        console.log(`[scenario] swipe ${label} : 3 swipes enchaînés → ${Math.abs(index() - before)} Space(s) parcouru(s)`)
      }
      // Capture en plein glissement : le contenu ne doit pas déborder de la sidebar.
      await delay(400)
      const y = height - 120
      const sign = index() === 0 ? 1 : -1
      for (let i = 0; i < 6; i++) {
        wheel(y, sign * 9)
        await delay(16)
      }
      await shot(wc, 'swipe-mid')
      await delay(300)
    } else if (name === 'ui') {
      await shot(browser.win.webContents, name)
    } else if (name === 'theme') {
      browser.openThemeEditor()
      await delay(1200)
      await shot(views.overlay, name)
      await browser.dispatch({ type: 'overlay.close' })
    } else if (name === 'settings') {
      app.openSettings()
      await delay(2500)
      const { BrowserWindow } = await import('electron')
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Réglages' || w.webContents.getURL().includes('view=settings'))
      if (win) await shot(win.webContents, name)
    } else if (name === 'private') {
      const priv = app.newWindow({ private: true })
      await delay(2500)
      await shot(priv.win.webContents, name)
      priv.win.close()
    } else if (name === 'little') {
      const little = app.openLittle('https://example.com/')
      await delay(3500)
      await shot(little.win.webContents, name)
      await little.expand()
      await delay(1500)
      await shot(browser.win.webContents, 'little-expanded')
    } else if (name === 'peek') {
      const id = browser.activeTabId
      if (id) await browser.openPeek('https://example.com/', id)
      await delay(3000)
      await shot(views.overlay, name)
      await browser.dispatch({ type: 'peek.close' })
    }
  }
}
