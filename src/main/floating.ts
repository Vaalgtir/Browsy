import { join } from 'node:path'
import { WebContentsView, screen, type BrowserWindow } from 'electron'
import type { Rect } from '../shared/layout'

/** Charge une vue de l'UI (même page React, choisie par `?view=`). */
export function loadUi(wc: Electron.WebContents, view: string, extra: Record<string, string> = {}): void {
  const query = { view, ...extra }
  if (process.env.ELECTRON_RENDERER_URL) wc.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  else wc.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

export function createUiView(view: string, extra: Record<string, string> = {}): WebContentsView {
  const ui = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/ui.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  ui.setBackgroundColor('#00000000')
  loadUi(ui.webContents, view, extra)
  return ui
}

/**
 * Petite vue posée au-dessus de la page, sans prendre le focus :
 * notification (« Lien copié ») ou URL du lien survolé.
 */
export class Bubble {
  readonly view: WebContentsView
  private attached = false

  constructor(
    private readonly win: BrowserWindow,
    kind: 'toast' | 'status',
    private readonly place: () => Rect,
  ) {
    this.view = createUiView(kind)
    win.on('resize', () => this.attached && this.view.setBounds(this.place()))
  }

  show(): void {
    this.view.setBounds(this.place())
    if (!this.attached) this.win.contentView.addChildView(this.view)
    this.attached = true
  }

  hide(): void {
    if (this.attached) this.win.contentView.removeChildView(this.view)
    this.attached = false
  }

  get visible(): boolean {
    return this.attached
  }
}

/** Distance au bord (px) qui fait apparaître la sidebar masquée. */
const EDGE_TRIGGER = 6
/** Marge autour du panneau flottant (pour son ombre). */
export const FLOATING_MARGIN = 14
const POLL_MS = 50
const HIDE_DELAY_MS = 250

/**
 * Sidebar masquée (⌘S) : elle réapparaît par-dessus la page quand la souris touche le bord,
 * et se cache quand elle le quitte. Suivi du curseur par interrogation (la page web,
 * au-dessus de l'UI, ne nous transmet pas ses mouvements de souris).
 */
export class FloatingSidebar {
  readonly view: WebContentsView
  private timer: NodeJS.Timeout | null = null
  private shown = false
  private leftAt = 0

  constructor(
    private readonly win: BrowserWindow,
    private readonly geometry: () => { width: number; position: 'left' | 'right' },
    private readonly onChange: (shown: boolean) => void,
  ) {
    this.view = createUiView('sidebar', { floating: '1' })
  }

  /** Active la surveillance du bord (sidebar masquée) ou la coupe (sidebar visible). */
  setEnabled(enabled: boolean): void {
    if (enabled && !this.timer) this.timer = setInterval(() => this.poll(), POLL_MS)
    if (!enabled) {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      this.hide()
    }
  }

  get isShown(): boolean {
    return this.shown
  }

  private bounds(): Rect {
    const [width, height] = this.win.getContentSize()
    const { width: sidebar, position } = this.geometry()
    const w = sidebar + FLOATING_MARGIN * 2
    return { x: position === 'left' ? 0 : width - w, y: 0, width: w, height }
  }

  private poll(): void {
    if (this.win.isDestroyed() || !this.win.isVisible() || !this.win.isFocused()) {
      if (this.shown && !this.win.isFocused()) this.hide()
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const content = this.win.getContentBounds()
    const x = cursor.x - content.x
    const y = cursor.y - content.y
    const inside = y >= 0 && y <= content.height
    const { position } = this.geometry()
    const atEdge = inside && (position === 'left' ? x >= -2 && x <= EDGE_TRIGGER : x >= content.width - EDGE_TRIGGER && x <= content.width + 2)
    if (!this.shown) {
      if (atEdge) this.show()
      return
    }
    const b = this.bounds()
    const over = inside && x >= b.x && x <= b.x + b.width
    if (over) this.leftAt = 0
    else if (!this.leftAt) this.leftAt = Date.now()
    else if (Date.now() - this.leftAt > HIDE_DELAY_MS) this.hide()
  }

  show(): void {
    if (this.shown) return
    this.shown = true
    this.leftAt = 0
    this.view.setBounds(this.bounds())
    this.win.contentView.addChildView(this.view)
    this.view.webContents.send('ui:event', { type: 'floating-show' })
    this.onChange(true)
  }

  hide(): void {
    if (!this.shown) return
    this.shown = false
    this.win.contentView.removeChildView(this.view)
    this.onChange(false)
  }
}
