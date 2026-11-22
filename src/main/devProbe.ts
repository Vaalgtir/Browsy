import { readFileSync, writeFileSync } from 'node:fs'
import { BrowserWindow, type WebContentsView } from 'electron'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Outils de dev, actifs seulement via variables d'environnement :
 * - BROWSY_CAPTURE=<préfixe> : captures PNG de l'UI et de l'onglet (sans permission d'enregistrement d'écran)
 * - BROWSY_PROBE_SCRIPT=<fichier.js> : script exécuté dans l'onglet après chargement, puis nouvelle capture
 */
export function attachDevProbe(win: BrowserWindow, tab: WebContentsView): void {
  const capture = process.env.BROWSY_CAPTURE
  if (!capture) return
  const wc = tab.webContents
  wc.once('did-stop-loading', async () => {
    await delay(3000)
    writeFileSync(`${capture}-ui.png`, (await win.webContents.capturePage()).toPNG())
    writeFileSync(`${capture}-tab.png`, (await wc.capturePage()).toPNG())
    const env = await wc.executeJavaScript(`({
      h264: document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'),
      ua: navigator.userAgent,
      brands: navigator.userAgentData && navigator.userAgentData.brands,
    })`)
    console.log('[probe-page]', JSON.stringify(env))

    const script = process.env.BROWSY_PROBE_SCRIPT
    if (!script) return
    try {
      console.log('[probe-script]', JSON.stringify(await wc.executeJavaScript(readFileSync(script, 'utf8'))))
    } catch (error) {
      console.log('[probe-script] erreur', error)
    }
    const click = process.env.BROWSY_PROBE_CLICK
    if (click) {
      // Clic simulé (coordonnées CSS dans l'onglet), utile pour les iframes cross-origin.
      const [x, y] = click.split(',').map(Number)
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
    }
    await delay(8000)
    writeFileSync(`${capture}-after.png`, (await wc.capturePage()).toPNG())
    console.log('[probe-script] après :', wc.getURL())
    const popups = BrowserWindow.getAllWindows().filter((w) => w !== win)
    for (const [i, popup] of popups.entries()) {
      console.log(`[probe-popup] ${popup.webContents.getURL().slice(0, 120)}`)
      writeFileSync(`${capture}-popup${i}.png`, (await popup.webContents.capturePage()).toPNG())
    }
  })
}
