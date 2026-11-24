/**
 * Interprétation d'un flux d'événements molette de trackpad en glissement horizontal paginé.
 *
 * Le DOM n'expose ni le début, ni la fin du contact, ni l'inertie : on les déduit.
 * - Un nouveau geste commence après un silence, ou quand l'amplitude remonte nettement
 *   pendant une inertie (les doigts reprennent le trackpad : on peut enchaîner les swipes).
 * - Le lâcher se reconnaît à la décroissance régulière de l'inertie macOS.
 * - L'axe est choisi au début du geste : un défilement vertical n'est jamais détourné.
 *
 * Convention : `offset` est le décalage du contenu en px (négatif = vers le Space suivant).
 */

export type Direction = 'next' | 'prev'

export type SwipeAction =
  | { type: 'move'; offset: number }
  | { type: 'commit'; direction: Direction }
  | { type: 'cancel' }

export interface SwipeContext {
  /** Largeur d'une page (px). */
  width: number
  canNext: boolean
  canPrev: boolean
  /** Décalage affiché à cet instant (une animation peut être en cours) : le geste le reprend. */
  visualOffset: number
}

export interface SwipeResult {
  /** Le geste est horizontal : empêcher le défilement natif. */
  consume: boolean
  action?: SwipeAction
}

/** Au-delà de ce silence (ms), le geste est terminé. */
export const GESTURE_GAP_MS = 90
/** Mouvement cumulé (px) avant de choisir l'axe. */
const AXIS_DECISION_PX = 4
/** Pendant le contact, au-delà de cette fraction de page on bascule sans attendre le lâcher. */
const COMMIT_WHILE_DRAGGING = 0.55
/** Au lâcher, à partir de cette fraction de page on bascule. */
const COMMIT_ON_RELEASE = 0.2
/** Au lâcher, vitesse (px/événement) qui suffit à basculer (geste vif et court). */
const FLICK_VELOCITY = 7
/** Nombre d'événements de décroissance régulière qui signent l'inertie (doigts levés). */
const MOMENTUM_STREAK = 4

type Phase = 'idle' | 'deciding' | 'x' | 'y' | 'locked'

export class SwipeTracker {
  private phase: Phase = 'idle'
  private lastTime = -Infinity
  private lastMag = 0
  private decay = 0
  private sumX = 0
  private sumY = 0
  /** Déplacement brut cumulé des doigts depuis le début du geste (px, convention `offset`). */
  private raw = 0
  /** Valeur de `raw` au début du geste : ce que les doigts ont parcouru se mesure depuis là. */
  private rawStart = 0
  private velocity = 0
  private lockedSign = 0
  /** Plus petite amplitude depuis que l'inertie a été reconnue (pour détecter une reprise). */
  private trough = Infinity
  private sawMomentum = false

  /** Événement molette. `t` en ms. */
  wheel(dx: number, dy: number, t: number, ctx: SwipeContext): SwipeResult {
    const mag = Math.hypot(dx, dy)
    const gap = t - this.lastTime
    if (this.phase === 'locked' || this.phase === 'y') {
      if (this.decay >= MOMENTUM_STREAK + 1) this.sawMomentum = true
      if (this.sawMomentum) this.trough = Math.min(this.trough, this.lastMag)
    }
    // Les doigts reprennent le trackpad pendant l'inertie : l'amplitude remonte au-dessus du creux.
    const rising = this.sawMomentum && mag > this.trough + Math.max(2.5, this.trough * 0.5)
    const flipped = this.phase === 'locked' && Math.abs(dx) > 2 && Math.sign(dx) !== this.lockedSign

    if (this.phase === 'idle' || gap > GESTURE_GAP_MS || ((this.phase === 'locked' || this.phase === 'y') && (rising || flipped))) {
      this.phase = 'deciding'
      this.sumX = 0
      this.sumY = 0
      this.decay = 0
      this.lastMag = 0
      this.trough = Infinity
      this.sawMomentum = false
    }
    this.trackDecay(mag)
    this.lastTime = t

    switch (this.phase) {
      case 'deciding': {
        this.sumX += dx
        this.sumY += dy
        if (Math.abs(this.sumX) + Math.abs(this.sumY) < AXIS_DECISION_PX) return { consume: false }
        if (Math.abs(this.sumX) <= Math.abs(this.sumY)) {
          this.phase = 'y'
          return { consume: false }
        }
        this.phase = 'x'
        this.raw = this.unrubber(ctx.visualOffset, ctx)
        this.rawStart = this.raw
        this.velocity = 0
        return this.drag(this.sumX, ctx)
      }
      case 'x':
        return this.drag(dx, ctx)
      case 'locked':
        return { consume: true }
      default:
        return { consume: false }
    }
  }

  /** À appeler après GESTURE_GAP_MS sans événement. */
  timeout(ctx: SwipeContext): SwipeAction | undefined {
    const wasDragging = this.phase === 'x'
    this.phase = 'idle'
    this.decay = 0
    return wasDragging ? this.release(ctx, false) : undefined
  }

  private trackDecay(mag: number): void {
    const ratio = this.lastMag > 0 ? mag / this.lastMag : 1
    if (ratio >= 0.6 && ratio < 0.995) this.decay++
    else if (ratio > 1) this.decay = 0
    this.lastMag = mag
  }

  private drag(dx: number, ctx: SwipeContext): SwipeResult {
    this.raw -= dx
    this.velocity = this.velocity * 0.5 + dx * 0.5
    const offset = this.rubber(this.raw, ctx)
    const allowed = this.raw < 0 ? ctx.canNext : ctx.canPrev

    if (allowed && Math.abs(offset) >= ctx.width * COMMIT_WHILE_DRAGGING) {
      return { consume: true, action: this.lock(this.raw < 0 ? 'next' : 'prev') }
    }
    // Inertie : les doigts sont levés, on tranche tout de suite.
    if (this.decay >= MOMENTUM_STREAK || (this.decay >= 2 && this.lastMag < 1)) {
      return { consume: true, action: this.release(ctx, true) }
    }
    return { consume: true, action: { type: 'move', offset } }
  }

  private release(ctx: SwipeContext, useVelocity: boolean): SwipeAction {
    const offset = this.rubber(this.raw, ctx)
    // Un geste lancé pendant l'animation du précédent compte pour lui-même : on regarde aussi
    // la distance parcourue par les doigts, pas seulement la position affichée.
    const moved = this.raw - this.rawStart
    const direction: Direction = (Math.abs(moved) >= 8 ? moved : offset) < 0 ? 'next' : 'prev'
    const towards = direction === 'next' ? -1 : 1
    const allowed = direction === 'next' ? ctx.canNext : ctx.canPrev
    const threshold = ctx.width * COMMIT_ON_RELEASE
    const far = offset * towards >= threshold || moved * towards >= threshold
    // Vitesse > 0 : doigts vers la gauche, donc vers le Space suivant.
    const flick = useVelocity && Math.abs(this.velocity) >= FLICK_VELOCITY && (this.velocity > 0) === (direction === 'next')
    if (allowed && (far || flick)) return this.lock(direction)
    this.lockedSign = Math.sign(this.velocity)
    if (this.phase === 'x') this.phase = 'locked'
    return { type: 'cancel' }
  }

  private lock(direction: Direction): SwipeAction {
    this.phase = 'locked'
    this.lockedSign = direction === 'next' ? 1 : -1
    return { type: 'commit', direction }
  }

  /** Élastique au bord quand il n'y a pas de Space de ce côté ; borné à une page sinon. */
  private rubber(raw: number, ctx: SwipeContext): number {
    const allowed = raw < 0 ? ctx.canNext : ctx.canPrev
    const sign = Math.sign(raw)
    if (allowed) return sign * Math.min(Math.abs(raw), ctx.width)
    return sign * (1 - 1 / ((Math.abs(raw) * 0.55) / ctx.width + 1)) * ctx.width
  }

  private unrubber(offset: number, ctx: SwipeContext): number {
    const allowed = offset < 0 ? ctx.canNext : ctx.canPrev
    if (allowed || offset === 0) return offset
    const f = Math.min(Math.abs(offset) / ctx.width, 0.99)
    return (Math.sign(offset) * (1 / (1 - f) - 1) * ctx.width) / 0.55
  }
}
