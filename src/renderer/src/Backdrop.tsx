import type { UiState } from '../../shared/ipc'
import { DEV_BAR_HEIGHT } from '../../shared/layout'
import { IconCode, IconLock, IconReload, IconWarning } from './icons'
import { browsy } from './useBrowser'

/**
 * Sous les pages web : la carte de contenu (fond, ombre, coins arrondis) et,
 * en Developer Mode, la barre au-dessus de la page. Positionnées avec la même
 * géométrie que les vues web (src/shared/layout.ts).
 */
export function Backdrop({ state }: { state: UiState }) {
  const { card, radius, edgeToEdge } = state.layout
  const id = state.activeTabId
  const tab = id ? state.persisted.tabs[id] : undefined
  const empty = state.shownTabIds.length === 0
  return (
    <div
      className="card"
      data-edge={edgeToEdge || undefined}
      style={{ left: card.x, top: card.y, width: card.width, height: card.height, borderRadius: radius }}
    >
      {state.devMode && id && tab && <DevBar state={state} id={id} url={tab.url} />}
      {empty && (
        <div className="card-empty">
          <span>
            <kbd>⌘</kbd>
            <kbd>T</kbd> pour ouvrir un onglet
          </span>
        </div>
      )}
    </div>
  )
}

/** Barre du Developer Mode (comme Arc) : URL complète, console, DevTools. */
function DevBar({ state, id, url }: { state: UiState; id: string; url: string }) {
  const live = state.live[id]
  const secure = url.startsWith('https:')
  let display = url
  try {
    const u = new URL(url)
    display = `${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`
  } catch {
    /* URL interne */
  }
  const dispatch = browsy().dispatch
  return (
    <div className="dev-bar" style={{ height: DEV_BAR_HEIGHT }}>
      <button className="dev-url" onClick={() => dispatch({ type: 'ui.commandBar', mode: 'edit-url' })} title={url}>
        <span className={secure ? 'dev-scheme secure' : 'dev-scheme'}>{secure ? <IconLock /> : url.split(':')[0]}</span>
        <span className="dev-path">{display}</span>
      </button>
      <div className="dev-actions">
        {!!live?.consoleErrors && (
          <button className="dev-badge error" onClick={() => dispatch({ type: 'tab.devtools', id })} title="Erreurs de la console">
            {live.consoleErrors}
          </button>
        )}
        {!!live?.consoleWarnings && (
          <button className="dev-badge warning" onClick={() => dispatch({ type: 'tab.devtools', id })} title="Avertissements de la console">
            <IconWarning /> {live.consoleWarnings}
          </button>
        )}
        <button className="dev-button" onClick={() => dispatch({ type: 'tab.reload', id })} title="Recharger (⌘R)">
          <IconReload />
        </button>
        <button className="dev-button" onClick={() => dispatch({ type: 'tab.devtools', id })} title="Outils de développement (⌥⌘I)">
          <IconCode />
        </button>
      </div>
    </div>
  )
}
