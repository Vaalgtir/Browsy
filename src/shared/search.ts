import type { SearchEngineId } from './model'

export interface SearchEngine {
  id: SearchEngineId
  name: string
  url: (query: string) => string
  /** URL d'accueil (nouvel onglet vide). */
  home: string
}

export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngine> = {
  google: { id: 'google', name: 'Google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`, home: 'https://www.google.com/' },
  duckduckgo: { id: 'duckduckgo', name: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`, home: 'https://duckduckgo.com/' },
  bing: { id: 'bing', name: 'Bing', url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`, home: 'https://www.bing.com/' },
  ecosia: { id: 'ecosia', name: 'Ecosia', url: (q) => `https://www.ecosia.org/search?q=${encodeURIComponent(q)}`, home: 'https://www.ecosia.org/' },
  kagi: { id: 'kagi', name: 'Kagi', url: (q) => `https://kagi.com/search?q=${encodeURIComponent(q)}`, home: 'https://kagi.com/' },
  qwant: { id: 'qwant', name: 'Qwant', url: (q) => `https://www.qwant.com/?q=${encodeURIComponent(q)}`, home: 'https://www.qwant.com/' },
  perplexity: { id: 'perplexity', name: 'Perplexity', url: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`, home: 'https://www.perplexity.ai/' },
}

/** Transforme ce qui est tapé dans la barre d'adresse en URL. */
export function resolveInput(input: string, engine: SearchEngineId = 'google'): string {
  const search = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.google
  const text = input.trim()
  if (!text) return search.home
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(about|chrome|data|file|view-source):/i.test(text)) return text
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (/^[\w-]+\.(local|test|localhost)(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return `http://${text}`
  if (!/\s/.test(text) && /^[^/\s]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return search.url(text)
}

/** Hôte d'une URL, sans « www. ». */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Le Developer Mode est-il actif pour cette URL ? (localhost et réseaux locaux : toujours.) */
export function isDevModeUrl(url: string, hosts: string[]): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  if (!hostname) return false
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(hostname) || /\.(local|test|localhost)$/.test(hostname)) return true
  const bare = hostname.replace(/^www\./, '')
  return hosts.some((h) => h === hostname || h === bare || h.replace(/^www\./, '') === bare)
}
