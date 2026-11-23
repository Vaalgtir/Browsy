import { useEffect, useState } from 'react'
import type { LittleState } from '../../shared/ipc'
import { IconBack, IconExpand, IconForward, IconLink, IconReload } from './icons'
import { Favicon } from './Sidebar'
import { browsy, displayHost } from './useBrowser'

/** Barre de la mini-fenêtre (Little Arc) : page, navigation, « Ouvrir dans Browsy » (⌘O). */
export function Little() {
  const [state, setState] = useState<LittleState | null>(null)
  useEffect(() => browsy().onLittle(setState), [])
  const dispatch = browsy().dispatch
  return (
    <header className="little-bar">
      <div className="little-traffic" />
      <button className="icon-button" disabled={!state?.canGoBack} onClick={() => dispatch({ type: 'little.back' })} aria-label="Précédent">
        <IconBack />
      </button>
      <button className="icon-button" disabled={!state?.canGoForward} onClick={() => dispatch({ type: 'little.forward' })} aria-label="Suivant">
        <IconForward />
      </button>
      <div className="little-title" title={state?.url}>
        {state && <Favicon src={state.favicon} url={state.url} />}
        <span className="little-name">{state ? state.title || displayHost(state.url) : 'Chargement…'}</span>
        {state && <span className="little-host">{displayHost(state.url)}</span>}
      </div>
      <button className="icon-button" onClick={() => dispatch({ type: 'little.reload' })} aria-label="Recharger">
        <IconReload />
      </button>
      <button className="icon-button" onClick={() => dispatch({ type: 'little.copy' })} aria-label="Copier le lien" title="Copier le lien (⌘⇧C)">
        <IconLink />
      </button>
      <button className="little-open" onClick={() => dispatch({ type: 'little.expand' })} title="Ouvrir dans Browsy (⌘O)">
        <IconExpand />
        {state ? `Ouvrir dans ${state.spaceName}` : 'Ouvrir dans Browsy'}
      </button>
    </header>
  )
}
