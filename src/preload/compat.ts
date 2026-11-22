import { contextBridge } from 'electron'

/**
 * Preload de compatibilité pour la session de navigation (frames et service workers).
 * S'exécute après celui d'electron-chrome-extensions.
 */

/**
 * Electron expose un namespace `browser` natif, distinct de `chrome` et incomplet.
 * electron-chrome-extensions ne complète que `chrome` : les extensions qui
 * préfèrent `browser` (LastPass, AdGuard via webextension-polyfill…) plantent.
 * On aligne `browser` sur `chrome`, comme dans Chrome.
 */
function alignBrowserNamespace(): void {
  const g = globalThis as { chrome?: unknown; browser?: unknown }
  if (!g.chrome || g.browser === g.chrome) return
  Object.defineProperty(globalThis, 'browser', { value: g.chrome, configurable: true, writable: true })
}

/**
 * Dans Chrome, `window.chrome` expose app, csi et loadTimes sur toutes les pages ;
 * dans Electron il est vide, ce que Google repère (voir main/chromeIdentity.ts).
 * On recrée ces objets avec les valeurs qu'ils ont dans Chrome.
 */
function addChromeGlobals(): void {
  const w = window as unknown as { chrome?: Record<string, unknown> }
  const chrome = (w.chrome ??= {})
  if (chrome.app) return
  const timing = () => performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const define = (name: string, value: unknown) =>
    Object.defineProperty(chrome, name, { value, configurable: true, enumerable: true, writable: true })

  define('app', {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: () => null,
    getIsInstalled: () => false,
    installState: (callback?: (state: string) => void) => callback?.('not_installed'),
    runningState: () => 'cannot_run',
  })
  define('csi', () => {
    const t = timing()
    return { startE: performance.timeOrigin, onloadT: performance.timeOrigin + (t?.domContentLoadedEventEnd ?? 0), pageT: performance.now(), tran: 15 }
  })
  define('loadTimes', () => {
    const t = timing()
    const start = performance.timeOrigin / 1000
    const protocol = t?.nextHopProtocol ?? 'h2'
    return {
      requestTime: start,
      startLoadTime: start,
      commitLoadTime: start + (t?.responseStart ?? 0) / 1000,
      finishDocumentLoadTime: start + (t?.domContentLoadedEventEnd ?? 0) / 1000,
      finishLoadTime: start + (t?.loadEventEnd ?? 0) / 1000,
      firstPaintTime: start + (t?.responseEnd ?? 0) / 1000,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: protocol === 'h2' || protocol === 'h3',
      wasNpnNegotiated: protocol !== 'http/1.1',
      npnNegotiatedProtocol: protocol,
      wasAlternateProtocolAvailable: false,
      connectionInfo: protocol,
    }
  })
}

function runInMainWorld(func: () => void): void {
  if ('executeInMainWorld' in contextBridge) contextBridge.executeInMainWorld({ func })
}

const href = typeof location !== 'undefined' ? location.href : ''

if (process.type === 'service-worker' || href.startsWith('chrome-extension://')) {
  runInMainWorld(alignBrowserNamespace)
} else if (href.startsWith('http')) {
  runInMainWorld(addChromeGlobals)
}
