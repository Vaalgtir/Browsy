import type { BrowserWindow, WebContentsView } from 'electron'
import type { Rect } from '../shared/layout'
import type { OverlayState } from '../shared/ipc'
import { createUiView } from './floating'

/** Taille de la barre de recherche dans la page, ancrée en haut à droite du contenu. */
const FIND_BAR = { width: 380, height: 56, margin: 10 }
/** Taille des menus ancrés sous la barre d'URL (ombre comprise). */
const POPOVER_WIDTH = 320
const SITE_CONTROLS_HEIGHT = 440
const EXTENSION_ROW = 38
const EXTENSIONS_CHROME = 112
const THEME_EDITOR_HEIGHT = 500

/**
 * Vue transparente posée au-dessus de la page, pour ce qui doit la recouvrir :
 * Command bar, recherche dans la page, menu des contrôles du site.
 */
export class Overlay {
  readonly view: WebContentsView
  private state: OverlayState = { kind: 'hidden' }
  private attached = false
  private anchor: Rect | null = null

  constructor(
    private readonly win: BrowserWindow,
    private readonly cardBounds: () => Rect,
    private readonly onChange: (state: OverlayState) => void,
  ) {
    this.view = createUiView('overlay')
    win.on('resize', () => this.layout())
    // Les menus ancrés se ferment quand on clique ailleurs (comme un popover).
    this.view.webContents.on('blur', () => {
      if (this.state.kind === 'site-controls' || this.state.kind === 'extensions' || this.state.kind === 'theme-editor') this.set({ kind: 'hidden' })
    })
  }

  get current(): OverlayState {
    return this.state
  }

  set(state: OverlayState, anchor?: Rect): void {
    this.state = state
    if (anchor) this.anchor = anchor
    if (state.kind === 'hidden') {
      if (this.attached) this.win.contentView.removeChildView(this.view)
      this.attached = false
    } else {
      // Toujours au premier plan.
      this.win.contentView.addChildView(this.view)
      this.attached = true
      this.layout()
      this.view.webContents.focus()
    }
    this.onChange(state)
  }

  layout(): void {
    if (!this.attached) return
    const [width, height] = this.win.getContentSize()
    if (this.state.kind === 'find') {
      const card = this.cardBounds()
      this.view.setBounds({
        x: card.x + card.width - FIND_BAR.width - FIND_BAR.margin,
        y: card.y + FIND_BAR.margin,
        width: FIND_BAR.width,
        height: FIND_BAR.height,
      })
    } else if (this.state.kind === 'site-controls' || this.state.kind === 'extensions' || this.state.kind === 'theme-editor') {
      const a = this.anchor ?? { x: 20, y: 40, width: 0, height: 0 }
      const wanted =
        this.state.kind === 'extensions'
          ? EXTENSIONS_CHROME + Math.max(1, this.state.extensions.length) * EXTENSION_ROW
          : this.state.kind === 'theme-editor'
            ? THEME_EDITOR_HEIGHT
            : SITE_CONTROLS_HEIGHT
      // L'éditeur de thème s'ouvre à côté de la sidebar ; les menus, sous leur bouton.
      const top = this.state.kind === 'theme-editor' ? Math.max(8, Math.min(Math.round(a.y - 20), height - wanted - 8)) : Math.round(a.y + a.height + 2)
      const x = Math.min(Math.max(4, Math.round(a.x + a.width / 2 - 28)), width - POPOVER_WIDTH - 4)
      this.view.setBounds({ x, y: top, width: POPOVER_WIDTH, height: Math.max(120, Math.min(wanted, height - top - 8)) })
    } else {
      this.view.setBounds({ x: 0, y: 0, width, height })
    }
  }
}
