import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Overlay } from './Overlay'
import { Sidebar } from './Sidebar'
import './styles.css'

/** La même page sert la sidebar (fenêtre) et l'overlay (Command bar, recherche dans la page). */
const isOverlay = new URLSearchParams(location.search).get('view') === 'overlay'
document.documentElement.dataset.view = isOverlay ? 'overlay' : 'sidebar'

createRoot(document.getElementById('root')!).render(<StrictMode>{isOverlay ? <Overlay /> : <Sidebar />}</StrictMode>)
