import { writeFileSync } from 'node:fs'
import type { Browser } from './Browser'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Dev : scénarios de captures automatisées (BROWSY_SCENARIO=site-controls,toast,floating,fullscreen),
 * pour vérifier le rendu sans permission d'enregistrement d'écran.
 */
export async function runScenarios(browser: Browser, names: string[], prefix: string): Promise<void> {
  const shot = async (wc: Electron.WebContents, name: string) => {
    writeFileSync(`${prefix}-${name}.png`, (await wc.capturePage()).toPNG())
    console.log(`[scenario] ${name}`)
  }
  const views = browser.devViews()
  await delay(4000)
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
    } else if (name === 'ui') {
      await shot(browser.win.webContents, name)
    }
  }
}
