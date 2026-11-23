import type { OverlayState } from '../../shared/ipc'
import { IconClose, IconExpand } from './icons'
import { browsy, displayHost, useUiState } from './useBrowser'

/** Hauteur de l'en-tête de Peek, au-dessus de la page (marges identiques au process main). */
const PEEK_INSET = { x: 56, top: 64, bottom: 28 }

/**
 * Cadre de Peek (Arc) : la page s'ouvre par-dessus l'onglet épinglé, sans le quitter.
 * La page elle-même est une vue web posée au-dessus de cet overlay.
 */
export function PeekFrame({ peek }: { peek: Extract<OverlayState, { kind: 'peek' }> }) {
  const state = useUiState()
  const dispatch = browsy().dispatch
  if (!state) return null
  const { card } = state.layout
  const left = card.x + PEEK_INSET.x
  const width = card.width - PEEK_INSET.x * 2
  return (
    <div className="peek-scrim" onMouseDown={(e) => e.target === e.currentTarget && dispatch({ type: 'peek.close' })}>
      <div className="peek-header" style={{ left, width, top: card.y + PEEK_INSET.top - 44 }}>
        <span className="peek-title">
          <span className="peek-name">{peek.title || displayHost(peek.url)}</span>
          <span className="peek-host">{displayHost(peek.url)}</span>
        </span>
        <button className="peek-button" onClick={() => dispatch({ type: 'peek.expand' })} title="Ouvrir dans un onglet">
          <IconExpand />
          Ouvrir en onglet
        </button>
        <button className="peek-button icon" onClick={() => dispatch({ type: 'peek.close' })} aria-label="Fermer" title="Fermer (Échap)">
          <IconClose />
        </button>
      </div>
      <div className="peek-shadow" style={{ left, width, top: card.y + PEEK_INSET.top, height: card.height - PEEK_INSET.top - PEEK_INSET.bottom }} />
    </div>
  )
}
