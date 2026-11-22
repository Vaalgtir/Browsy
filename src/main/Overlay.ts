import { join } from 'node:path'
import { WebContentsView, type BrowserWindow } from 'electron'
import type { OverlayState } from '../shared/ipc'

/** Taille de la barre de recherche dans la page, ancrée en haut à droite du contenu. */
const FIND_BAR = { width: 360, height: 52, margin: 12 }

/**
 * Vue transparente posée au-dessus de la page, pour ce qui doit la recouvrir :
 * Command bar et recherche dans la page. (L'UI de la sidebar est sous les vues web.)
 */
export class Overlay {
  readonly view: WebContentsView
  private state: OverlayState = { kind: 'hidden' }
  private attached = false

  constructor(
    private readonly win: BrowserWindow,
    private readonly contentBounds: () => Electron.Rectangle,
    private readonly onChange: (state: OverlayState) => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/ui.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    this.view.setBackgroundColor('#00000000')
    const query = { view: 'overlay' }
    if (process.env.ELECTRON_RENDERER_URL) this.view.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=overlay`)
    else this.view.webContents.loadFile(join(__dirname, '../renderer/index.html'), { query })
    win.on('resize', () => this.layout())
  }

  get current(): OverlayState {
    return this.state
  }

  set(state: OverlayState): void {
    this.state = state
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
    if (this.state.kind === 'find') {
      const content = this.contentBounds()
      this.view.setBounds({
        x: content.x + content.width - FIND_BAR.width - FIND_BAR.margin,
        y: content.y + FIND_BAR.margin,
        width: FIND_BAR.width,
        height: FIND_BAR.height,
      })
    } else {
      const [width, height] = this.win.getContentSize()
      this.view.setBounds({ x: 0, y: 0, width, height })
    }
  }
}
