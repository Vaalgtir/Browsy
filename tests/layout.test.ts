import { describe, expect, it } from 'vitest'
import { CARD_INSET, DEV_BAR_HEIGHT, computeLayout, splitPanes } from '../src/shared/layout'
import { isDevModeUrl, resolveInput } from '../src/shared/search'

const base = { width: 1400, height: 900, sidebarVisible: true, sidebarWidth: 260, position: 'left' as const, fullscreen: false, devBar: false }

describe('géométrie de la fenêtre', () => {
  it('place la carte à droite de la sidebar avec une marge', () => {
    const { card, radius, edgeToEdge } = computeLayout(base)
    expect(card).toEqual({ x: 260, y: CARD_INSET, width: 1400 - 260 - CARD_INSET, height: 900 - 2 * CARD_INSET })
    expect(radius).toBeGreaterThan(0)
    expect(edgeToEdge).toBe(false)
  })

  it('plein écran sans sidebar : page bord à bord, sans coins arrondis', () => {
    const { card, radius, edgeToEdge } = computeLayout({ ...base, sidebarVisible: false, fullscreen: true })
    expect(card).toEqual({ x: 0, y: 0, width: 1400, height: 900 })
    expect(radius).toBe(0)
    expect(edgeToEdge).toBe(true)
  })

  it('plein écran avec sidebar : on garde les marges', () => {
    expect(computeLayout({ ...base, fullscreen: true }).edgeToEdge).toBe(false)
  })

  it('sidebar à droite : la carte commence à gauche', () => {
    const { card } = computeLayout({ ...base, position: 'right' })
    expect(card.x).toBe(CARD_INSET)
    expect(card.x + card.width).toBe(1400 - 260)
  })

  it('le Developer Mode réserve sa barre en haut de la carte', () => {
    const { card, page } = computeLayout({ ...base, devBar: true })
    expect(page.y).toBe(card.y + DEV_BAR_HEIGHT)
    expect(page.height).toBe(card.height - DEV_BAR_HEIGHT)
  })

  it('découpe un Split View en panneaux jointifs', () => {
    const page = { x: 100, y: 10, width: 1006, height: 500 }
    const panes = splitPanes(page, [0.5, 0.5], 6)
    expect(panes[0]).toEqual({ x: 100, y: 10, width: 500, height: 500 })
    expect(panes[1].x + panes[1].width).toBe(1106)
  })
})

describe('barre d\'adresse', () => {
  it('reconnaît URL, localhost, IP et recherche', () => {
    expect(resolveInput('github.com')).toBe('https://github.com')
    expect(resolveInput('localhost:5173')).toBe('http://localhost:5173')
    expect(resolveInput('37.187.113.57:8000')).toBe('http://37.187.113.57:8000')
    expect(resolveInput('recette crêpes', 'duckduckgo')).toBe('https://duckduckgo.com/?q=recette%20cr%C3%AApes')
  })

  it('active le Developer Mode sur localhost et les hôtes choisis', () => {
    expect(isDevModeUrl('http://localhost:3000/', [])).toBe(true)
    expect(isDevModeUrl('https://www.domadi.fr/a', ['www.domadi.fr'])).toBe(true)
    expect(isDevModeUrl('https://github.com/x', ['github.com'])).toBe(true)
    expect(isDevModeUrl('https://example.com/', ['github.com'])).toBe(false)
  })
})
