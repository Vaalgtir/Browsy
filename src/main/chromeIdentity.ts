import { app, type Session, type WebContents } from 'electron'

/**
 * Fait passer Browsy pour Google Chrome auprès des sites.
 *
 * Google refuse la connexion aux navigateurs « embarqués » (« Ce navigateur ou cette
 * application ne sont peut-être pas sécurisés »). Electron n'annonce que la marque
 * « Chromium » dans les Client Hints (en-têtes Sec-CH-UA et navigator.userAgentData).
 * On annonce les mêmes marques que Chrome via le protocole DevTools, onglet par onglet.
 *
 * On n'utilise PAS session.webRequest : ça désactiverait chrome.webRequest pour les
 * extensions (uBlock Origin, AdGuard…).
 */

const CHROME_MAJOR = process.versions.chrome.split('.')[0]
const CHROME_FULL = process.versions.chrome

export const CHROME_USER_AGENT = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`

const brands = (version: string) => [
  { brand: 'Chromium', version },
  { brand: 'Google Chrome', version },
  { brand: 'Not:A-Brand', version: version.includes('.') ? '8.0.0.0' : '8' },
]

const USER_AGENT_OVERRIDE = {
  userAgent: CHROME_USER_AGENT,
  platform: 'MacIntel',
  userAgentMetadata: {
    brands: brands(CHROME_MAJOR),
    fullVersionList: brands(CHROME_FULL),
    platform: 'macOS',
    platformVersion: process.getSystemVersion(),
    architecture: process.arch === 'arm64' ? 'arm' : 'x86',
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false,
  },
}

/** Types de webContents qui affichent des pages web (onglets, popups OAuth, popups d'extensions). */
const PAGE_TYPES = new Set(['window', 'browserView', 'webview'])

async function applyChromeIdentity(wc: WebContents): Promise<void> {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    await wc.debugger.sendCommand('Emulation.setUserAgentOverride', USER_AGENT_OVERRIDE)
  } catch (error) {
    console.warn('[chrome-identity] échec', wc.id, error)
  }
}

export function installChromeIdentity(session: Session): void {
  session.setUserAgent(CHROME_USER_AGENT)
  app.on('web-contents-created', (_event, wc) => {
    if (wc.session !== session || !PAGE_TYPES.has(wc.getType())) return
    void applyChromeIdentity(wc)
    // Après une fermeture des DevTools ou un crash du renderer, le débogueur peut être détaché.
    wc.debugger.on('detach', () => {
      if (!wc.isDestroyed()) setTimeout(() => void applyChromeIdentity(wc), 0)
    })
  })
}
