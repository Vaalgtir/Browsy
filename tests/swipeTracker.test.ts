import { describe, expect, it } from 'vitest'
import { GESTURE_GAP_MS, SwipeTracker, type SwipeAction, type SwipeContext } from '../src/renderer/src/swipeTracker'

const WIDTH = 260

/** Rejoue un flux [dx, dy] à 60 Hz ; `pauseAfter` insère un silence (doigts levés sans inertie). */
function play(
  tracker: SwipeTracker,
  events: Array<[number, number] | 'pause'>,
  ctx: Partial<SwipeContext> = {},
): { actions: SwipeAction[]; consumed: boolean[] } {
  const full: SwipeContext = { width: WIDTH, canNext: true, canPrev: true, visualOffset: 0, ...ctx }
  const actions: SwipeAction[] = []
  const consumed: boolean[] = []
  let t = 1000
  for (const e of events) {
    if (e === 'pause') {
      t += GESTURE_GAP_MS + 10
      const a = tracker.timeout(full)
      if (a) actions.push(a)
      continue
    }
    t += 16
    const r = tracker.wheel(e[0], e[1], t, full)
    consumed.push(r.consume)
    if (r.action) actions.push(r.action)
  }
  return { actions, consumed }
}

/** Contact des doigts : montée puis plateau. */
const finger = (dx: number, n = 8): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [Math.sign(dx) * Math.min(Math.abs(dx), 2 + i * 3), i % 3 === 0 ? 1 : 0])
/** Inertie macOS : décroissance exponentielle. */
const momentum = (from: number, n = 40): Array<[number, number]> =>
  Array.from({ length: n }, (_, i) => [from * 0.9 ** (i + 1), 0])

const commits = (actions: SwipeAction[]) => actions.filter((a) => a.type === 'commit')

describe('SwipeTracker', () => {
  it('un swipe avec inertie bascule une seule fois, vers le Space suivant', () => {
    const { actions } = play(new SwipeTracker(), [...finger(14), ...momentum(14)])
    expect(commits(actions)).toEqual([{ type: 'commit', direction: 'next' }])
  })

  it('le contenu suit les doigts avant la bascule', () => {
    const { actions } = play(new SwipeTracker(), finger(-6, 5))
    const moves = actions.filter((a) => a.type === 'move')
    expect(moves.length).toBeGreaterThan(2)
    expect(moves.at(-1)).toMatchObject({ offset: expect.any(Number) })
    expect((moves.at(-1) as { offset: number }).offset).toBeGreaterThan(0)
  })

  it('enchaîne trois swipes sans attendre la fin de l’inertie', () => {
    const swipe = [...finger(14), ...momentum(14, 6)]
    const { actions } = play(new SwipeTracker(), [...swipe, ...swipe, ...swipe])
    expect(commits(actions)).toHaveLength(3)
  })

  it('enchaîne aussi quand un court silence sépare les swipes', () => {
    const swipe = [...finger(14), ...momentum(14, 10)]
    const { actions } = play(new SwipeTracker(), [...swipe, 'pause', ...swipe, 'pause', ...swipe])
    expect(commits(actions)).toHaveLength(3)
  })

  it('un swipe lancé pendant l’animation du précédent compte pour lui-même', () => {
    // La page précédente revient encore de la gauche : le geste démarre à -120 px.
    const { actions } = play(new SwipeTracker(), [...finger(-14), ...momentum(-14, 6)], { visualOffset: -120 })
    expect(commits(actions)).toEqual([{ type: 'commit', direction: 'prev' }])
  })

  it('un long swipe appuyé ne saute qu’un seul Space', () => {
    const long: Array<[number, number]> = [...Array(30)].map((_, i) => [10 + ((i * 7) % 9), 0])
    const { actions } = play(new SwipeTracker(), [...long, ...momentum(16)])
    expect(commits(actions)).toHaveLength(1)
  })

  it('ne détourne jamais un défilement vertical', () => {
    const vertical: Array<[number, number]> = [...Array(10)].map((_, i) => [i % 2, 12])
    const { actions, consumed } = play(new SwipeTracker(), [...vertical, ...momentum(0, 5).map(([, ]) => [0, 5] as [number, number])])
    expect(actions).toEqual([])
    expect(consumed.every((c) => !c)).toBe(true)
  })

  it('un glissement lent puis lâché bascule s’il est assez long', () => {
    const slow: Array<[number, number]> = [...Array(35)].map(() => [2, 0])
    const { actions } = play(new SwipeTracker(), [...slow, 'pause'])
    expect(actions.at(-1)).toEqual({ type: 'commit', direction: 'next' })
  })

  it('un petit glissement lâché revient en place', () => {
    const small: Array<[number, number]> = [...Array(10)].map(() => [2, 0])
    const { actions } = play(new SwipeTracker(), [...small, 'pause'])
    expect(actions.at(-1)).toEqual({ type: 'cancel' })
  })

  it('au bord sans Space voisin : élastique puis retour, jamais de bascule', () => {
    const { actions } = play(new SwipeTracker(), [...finger(-14, 15), ...momentum(-14)], { canPrev: false })
    expect(commits(actions)).toEqual([])
    const offsets = actions.flatMap((a) => (a.type === 'move' ? [a.offset] : []))
    expect(Math.max(...offsets)).toBeLessThan(WIDTH * 0.4)
    expect(actions.at(-1)).toEqual({ type: 'cancel' })
  })
})
