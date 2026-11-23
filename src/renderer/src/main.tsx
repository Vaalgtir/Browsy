import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { StatusView, ToastView } from './Bubbles'
import { Little } from './Little'
import { Overlay } from './Overlay'
import { Settings } from './Settings'
import { Sidebar } from './Sidebar'
import './styles.css'

/**
 * La même page sert toutes les vues de l'interface, choisie par `?view=` :
 * sidebar (fenêtre, avec la carte de contenu), sidebar flottante, overlay
 * (Command bar, recherche, contrôles du site), notification, URL survolée.
 */
const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'sidebar'
const floating = params.get('floating') === '1'
document.documentElement.dataset.view = floating ? 'floating' : view

const views: Record<string, ReactNode> = {
  sidebar: <Sidebar floating={floating} />,
  overlay: <Overlay />,
  toast: <ToastView />,
  status: <StatusView />,
  settings: <Settings />,
  little: <Little />,
}

createRoot(document.getElementById('root')!).render(<StrictMode>{views[view] ?? null}</StrictMode>)
