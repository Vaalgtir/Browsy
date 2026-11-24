import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { Id } from '../../shared/model'
import { GESTURE_GAP_MS, SwipeTracker, type Direction, type SwipeAction, type SwipeContext } from './swipeTracker'

/** Retour en place ou fin de bascule, après le lâcher. */
const SETTLE = 'transform 340ms cubic-bezier(0.22, 1, 0.36, 1)'
/** Décalage d'arrivée quand on change de Space sans geste (clic, raccourci). */
const CLICK_SHIFT = 56

/**
 * Carrousel des Spaces dans la sidebar : la piste (`trackRef`) contient le Space courant
 * et ses voisins côte à côte ; elle suit les doigts puis se cale sur une page.
 *
 * Le geste est écouté sur toute la sidebar (`sidebarRef`). Au changement de Space, la piste
 * est recentrée avant l'affichage en conservant la position visible : aucun saut.
 */
export function useSpaceSwipe(
  sidebarRef: RefObject<HTMLElement | null>,
  trackRef: RefObject<HTMLElement | null>,
  spaceIds: Id[],
  activeId: Id | undefined,
  enabled: boolean,
  select: (id: Id) => void,
): void {
  const latest = useRef({ spaceIds, activeId, enabled, select })
  latest.current = { spaceIds, activeId, enabled, select }
  /** Bascule lancée par le geste, en attente du nouvel état. */
  const pending = useRef<Direction | null>(null)
  const previousId = useRef(activeId)

  useEffect(() => {
    const tracker = new SwipeTracker()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: number | undefined
    let commits = 0

    const context = (): SwipeContext => {
      const { spaceIds: ids, activeId: current } = latest.current
      const i = ids.indexOf(current as Id)
      return {
        width: trackRef.current?.clientWidth || 1,
        canNext: !pending.current && i >= 0 && i < ids.length - 1,
        canPrev: !pending.current && i > 0,
        visualOffset: visualOffset(trackRef.current),
      }
    }

    const apply = (action: SwipeAction | undefined) => {
      const track = trackRef.current
      if (!action || !track) return
      if (action.type === 'move') {
        place(track, action.offset, 'none')
      } else if (action.type === 'cancel') {
        place(track, 0, reducedMotion.matches ? 'none' : SETTLE)
      } else {
        const { spaceIds: ids, activeId: current } = latest.current
        const target = ids[ids.indexOf(current as Id) + (action.direction === 'next' ? 1 : -1)]
        if (!target) return place(track, 0, SETTLE)
        pending.current = action.direction
        const token = ++commits
        // Garde-fou : si le nouvel état n'arrive pas, on revient en place au lieu de rester bloqué.
        window.setTimeout(() => {
          if (token !== commits || !pending.current) return
          pending.current = null
          place(track, 0, SETTLE)
        }, 1000)
        place(track, (action.direction === 'next' ? -1 : 1) * track.clientWidth, reducedMotion.matches ? 'none' : SETTLE)
        latest.current.select(target)
      }
    }

    const onWheel = (e: WheelEvent) => {
      // La sidebar peut ne pas encore exister au montage : on écoute la fenêtre et on filtre.
      if (!latest.current.enabled || e.ctrlKey || !sidebarRef.current?.contains(e.target as Node)) return
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1
      const result = tracker.wheel(e.deltaX * scale, e.deltaY * scale, e.timeStamp, context())
      if (result.consume) e.preventDefault()
      apply(result.action)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => apply(tracker.timeout(context())), GESTURE_GAP_MS)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.clearTimeout(timer)
    }
  }, [sidebarRef, trackRef])

  // Nouveau Space : les pages ont changé de place, on compense pour garder l'image, puis on cale.
  useLayoutEffect(() => {
    const track = trackRef.current
    const from = previousId.current
    previousId.current = activeId
    if (!track || !from || from === activeId) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const width = track.clientWidth
    let start: number
    if (pending.current) {
      start = visualOffset(track) + (pending.current === 'next' ? width : -width)
    } else {
      const ids = latest.current.spaceIds
      start = (ids.indexOf(activeId as Id) > ids.indexOf(from) ? 1 : -1) * CLICK_SHIFT
    }
    pending.current = null
    place(track, start, 'none')
    void track.offsetWidth // force la position de départ avant la transition
    place(track, 0, reduced ? 'none' : SETTLE)
  }, [activeId, trackRef])
}

function place(track: HTMLElement, offset: number, transition: string): void {
  track.style.transition = transition
  track.style.transform = offset ? `translate3d(${offset}px, 0, 0)` : ''
}

/** Décalage affiché, animation en cours comprise. */
function visualOffset(track: HTMLElement | null): number {
  if (!track) return 0
  const transform = getComputedStyle(track).transform
  return transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m41 : 0
}
