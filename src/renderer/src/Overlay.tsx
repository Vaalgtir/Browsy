import { useEffect, useRef, useState } from 'react'
import type { OverlayState, Suggestion } from '../../shared/ipc'
import { IconArrowDown, IconArrowUp, IconClock, IconClose, IconGlobe, IconSearch, IconTabs } from './icons'
import { ExtensionsMenu } from './ExtensionsMenu'
import { PeekFrame } from './PeekFrame'
import { ThemeEditor } from './ThemeEditor'
import { SiteControls } from './SiteControls'
import { browsy, displayHost, useOverlayState } from './useBrowser'

/** Vue posée au-dessus de la page : Command bar, recherche dans la page, contrôles du site. */
export function Overlay() {
  const overlay = useOverlayState()
  if (overlay.kind === 'command-bar') return <CommandBar key={`${overlay.mode}-${overlay.tabId}-${overlay.initial}`} overlay={overlay} />
  if (overlay.kind === 'find') return <FindBar key={overlay.tabId} overlay={overlay} />
  if (overlay.kind === 'site-controls') return <SiteControls site={overlay.site} />
  if (overlay.kind === 'extensions') return <ExtensionsMenu extensions={overlay.extensions} partition={overlay.partition} />
  if (overlay.kind === 'theme-editor') return <ThemeEditor spaceId={overlay.spaceId} />
  if (overlay.kind === 'peek') return <PeekFrame peek={overlay} />
  return null
}

const close = () => browsy().dispatch({ type: 'overlay.close' })

// ── Command bar ──────────────────────────────────────────────────────────

/**
 * Pas d'animation d'ouverture : la Command bar s'ouvre des centaines de fois par jour,
 * elle doit apparaître instantanément (comme Raycast).
 */
function CommandBar({ overlay }: { overlay: Extract<OverlayState, { kind: 'command-bar' }> }) {
  const [input, setInput] = useState(overlay.initial)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  // En mode « modifier l'URL », on n'affiche pas de suggestions tant que l'URL n'a pas été modifiée.
  const touched = useRef(overlay.mode === 'new-tab')

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    if (!touched.current) return
    const current = ++request.current
    browsy()
      .suggest(input)
      .then((results) => {
        // Ignore les réponses arrivées dans le désordre.
        if (current !== request.current) return
        setSuggestions(results)
        setSelected(0)
      })
  }, [input])

  const submit = (suggestion?: Suggestion) => {
    if (!input.trim() && !suggestion) return close()
    browsy().dispatch({ type: 'commandBar.submit', input, suggestion })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return close()
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // ⌥Entrée : utiliser le texte tel quel, sans la suggestion sélectionnée.
      submit(e.altKey ? undefined : suggestions[selected])
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="command-bar" role="dialog" aria-label="Command bar">
        <div className="command-input">
          <IconSearch />
          <input
            ref={inputRef}
            value={input}
            placeholder="Rechercher ou saisir une URL"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              touched.current = true
              setInput(e.target.value)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {suggestions.length > 0 && (
          <ul className="suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={`${s.kind}-${s.tabId ?? s.url ?? s.title}-${i}`}
                role="option"
                aria-selected={i === selected}
                className={i === selected ? 'suggestion selected' : 'suggestion'}
                onMouseMove={() => i !== selected && setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  submit(s)
                }}
              >
                <SuggestionIcon suggestion={s} />
                <span className="suggestion-title">{s.title}</span>
                {s.subtitle && <span className="suggestion-subtitle">{s.kind === 'history' ? displayHost(s.subtitle) : s.subtitle}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SuggestionIcon({ suggestion }: { suggestion: Suggestion }) {
  if (suggestion.favicon) return <img className="favicon" src={suggestion.favicon} width={16} height={16} alt="" />
  const icons = { tab: <IconTabs />, history: <IconClock />, search: <IconSearch />, url: <IconGlobe />, command: <IconSearch /> }
  return <span className="suggestion-icon">{icons[suggestion.kind]}</span>
}

// ── Recherche dans la page ───────────────────────────────────────────────

function FindBar({ overlay }: { overlay: Extract<OverlayState, { kind: 'find' }> }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const find = (value: string, forward = true, findNext = false) =>
    browsy().dispatch({ type: 'find.query', text: value, forward, findNext })

  return (
    <div className="find-bar">
      <input
        ref={inputRef}
        value={text}
        placeholder="Rechercher dans la page"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          void find(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') void find(text, !e.shiftKey, true)
        }}
      />
      <span className="find-count">{text ? `${overlay.activeMatch}/${overlay.matches}` : ''}</span>
      <button className="icon-button small" aria-label="Résultat précédent" disabled={!overlay.matches} onClick={() => find(text, false, true)}>
        <IconArrowUp />
      </button>
      <button className="icon-button small" aria-label="Résultat suivant" disabled={!overlay.matches} onClick={() => find(text, true, true)}>
        <IconArrowDown />
      </button>
      <button className="icon-button small" aria-label="Fermer" onClick={close}>
        <IconClose />
      </button>
    </div>
  )
}
