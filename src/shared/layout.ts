/**
 * Géométrie de la fenêtre, partagée par le process main (placement des vues web)
 * et l'UI (ombre de la carte, barre du Developer Mode) pour qu'elles restent alignées au pixel.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutInput {
  width: number
  height: number
  sidebarVisible: boolean
  sidebarWidth: number
  position: 'left' | 'right'
  fullscreen: boolean
  devBar: boolean
}

export interface Layout {
  /** Carte de contenu (fond blanc, ombre, coins arrondis). */
  card: Rect
  /** Zone des pages web (carte moins la barre du Developer Mode). */
  page: Rect
  radius: number
  /** Plein écran sans sidebar : page bord à bord, sans marge ni coins arrondis. */
  edgeToEdge: boolean
}

export const CARD_INSET = 8
export const CARD_RADIUS = 10
export const DEV_BAR_HEIGHT = 38
/** Bande réservée aux feux tricolores quand la sidebar est à droite. */
export const TRAFFIC_STRIP = 30
export const SPLIT_GAP = 6
export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 420

export function computeLayout(input: LayoutInput): Layout {
  const { width, height, sidebarVisible, sidebarWidth, position, fullscreen, devBar } = input
  const edgeToEdge = fullscreen && !sidebarVisible
  let card: Rect
  if (edgeToEdge) {
    card = { x: 0, y: 0, width, height }
  } else {
    const left = sidebarVisible && position === 'left' ? sidebarWidth : CARD_INSET
    const right = sidebarVisible && position === 'right' ? sidebarWidth : CARD_INSET
    const top = CARD_INSET + (sidebarVisible && position === 'right' && !fullscreen ? TRAFFIC_STRIP : 0)
    card = { x: left, y: top, width: Math.max(0, width - left - right), height: Math.max(0, height - top - CARD_INSET) }
  }
  const bar = devBar ? Math.min(DEV_BAR_HEIGHT, card.height) : 0
  const page = { x: card.x, y: card.y + bar, width: card.width, height: card.height - bar }
  return { card, page, radius: edgeToEdge ? 0 : CARD_RADIUS, edgeToEdge }
}

/** Panneaux d'un Split View, côte à côte dans la zone des pages. */
export function splitPanes(page: Rect, sizes: number[], gap = SPLIT_GAP): Rect[] {
  if (sizes.length <= 1) return [page]
  const total = sizes.reduce((a, b) => a + b, 0) || 1
  const available = page.width - gap * (sizes.length - 1)
  const rects: Rect[] = []
  let x = page.x
  sizes.forEach((size, i) => {
    const w = i === sizes.length - 1 ? page.x + page.width - x : Math.round((available * size) / total)
    rects.push({ x, y: page.y, width: Math.max(0, w), height: page.height })
    x += w + gap
  })
  return rects
}

export function roundRect(r: Rect): Rect {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
}
