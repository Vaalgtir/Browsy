import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BROWSING_PARTITION, type BrowserState, type TabState } from '../../shared/ipc'

const SIDEBAR_WIDTH = 240

function displayUrl(url: string): string {
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') return hostname.replace(/^www\./, '')
    return url
  } catch {
    return url
  }
}

export function App() {
  const [state, setState] = useState<BrowserState>({ tabs: [], activeTabId: null })
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const addressRef = useRef<HTMLInputElement>(null)

  const active = state.tabs.find((t) => t.id === state.activeTabId)

  useEffect(() => {
    window.browsy.setSidebarWidth(SIDEBAR_WIDTH)
    window.browsy.getState().then(setState)
    const offState = window.browsy.onState(setState)
    const offFocus = window.browsy.onFocusAddressBar(() => {
      addressRef.current?.focus()
      addressRef.current?.select()
    })
    return () => {
      offState()
      offFocus()
    }
  }, [])

  useEffect(() => {
    if (!editing) setAddress(active?.url ?? '')
  }, [active?.url, editing])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (active) window.browsy.navigate(active.id, address)
    else window.browsy.newTab(address)
    addressRef.current?.blur()
  }

  return (
    <aside className="sidebar" style={{ width: SIDEBAR_WIDTH }}>
      <div className="toolbar">
        <div className="traffic-lights-space" />
        <button disabled={!active?.canGoBack} onClick={() => active && window.browsy.goBack(active.id)} title="Précédent">
          ‹
        </button>
        <button disabled={!active?.canGoForward} onClick={() => active && window.browsy.goForward(active.id)} title="Suivant">
          ›
        </button>
        <button disabled={!active} onClick={() => active && window.browsy.reload(active.id)} title="Recharger">
          ↻
        </button>
      </div>

      <form className="address" onSubmit={submit}>
        <input
          ref={addressRef}
          value={editing ? address : displayUrl(address)}
          placeholder="Rechercher ou saisir une URL"
          spellCheck={false}
          onFocus={(e) => {
            setEditing(true)
            setAddress(active?.url ?? '')
            requestAnimationFrame(() => e.target.select())
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && addressRef.current?.blur()}
        />
      </form>

      <browser-action-list className="extensions" partition={BROWSING_PARTITION} alignment="bottom right" />

      <button className="new-tab" onClick={() => window.browsy.newTab()}>
        <span className="plus">+</span> Nouvel onglet
      </button>

      <ul className="tabs">
        {state.tabs.map((tab) => (
          <TabRow key={tab.id} tab={tab} active={tab.id === state.activeTabId} />
        ))}
      </ul>
    </aside>
  )
}

function TabRow({ tab, active }: { tab: TabState; active: boolean }) {
  return (
    <li
      className={active ? 'tab active' : 'tab'}
      onMouseDown={(e) => e.button === 0 && window.browsy.selectTab(tab.id)}
      onAuxClick={(e) => e.button === 1 && window.browsy.closeTab(tab.id)}
      title={tab.url}
    >
      {tab.favicon ? <img className="favicon" src={tab.favicon} alt="" /> : <span className="favicon placeholder" />}
      <span className="title">{tab.loading && !tab.title ? 'Chargement…' : tab.title}</span>
      <button
        className="close"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => window.browsy.closeTab(tab.id)}
        title="Fermer l'onglet"
      >
        ×
      </button>
    </li>
  )
}
