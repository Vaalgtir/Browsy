import { useEffect, useState } from 'react'
import type { OverlayState, UiState } from '../../shared/ipc'

export const browsy = () => window.browsy

/** État du navigateur, poussé par le process main. */
export function useUiState(): UiState | null {
  const [state, setState] = useState<UiState | null>(null)
  useEffect(() => {
    browsy().getState().then(setState)
    return browsy().onState(setState)
  }, [])
  return state
}

export function useOverlayState(): OverlayState {
  const [overlay, setOverlay] = useState<OverlayState>({ kind: 'hidden' })
  useEffect(() => {
    browsy().getOverlay().then(setOverlay)
    return browsy().onOverlay(setOverlay)
  }, [])
  return overlay
}

/** Nom d'hôte lisible : « github.com » plutôt que l'URL complète. */
export function displayHost(url: string): string {
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') return hostname.replace(/^www\./, '')
    return url
  } catch {
    return url
  }
}
