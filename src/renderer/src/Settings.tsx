import { useEffect, useState } from 'react'
import type { BrowserAction, CommandInfo, UiState } from '../../shared/ipc'
import { DEFAULT_PROFILE_ID, newId, type LinkDestination, type LinkRule, type SearchEngineId, type Settings as SettingsData } from '../../shared/model'
import { SEARCH_ENGINES } from '../../shared/search'
import { IconClose, IconPlus } from './icons'
import { browsy, useUiState } from './useBrowser'

type Section = 'general' | 'profiles' | 'shortcuts' | 'links' | 'advanced'

const SECTIONS: [Section, string][] = [
  ['general', 'Général'],
  ['profiles', 'Profils'],
  ['shortcuts', 'Raccourcis'],
  ['links', 'Liens'],
  ['advanced', 'Avancé'],
]

const dispatch = (action: BrowserAction) => browsy().dispatch(action)
const updateSettings = (patch: Partial<SettingsData>) => dispatch({ type: 'settings.update', patch })

/** Fenêtre de réglages (⌘,). */
export function Settings() {
  const state = useUiState()
  const [section, setSection] = useState<Section>('general')
  useEffect(() => {
    document.title = 'Réglages'
  }, [])
  if (!state) return null
  return (
    <div className="settings">
      <nav className="settings-nav">
        <div className="settings-traffic" />
        {SECTIONS.map(([id, label]) => (
          <button key={id} className={section === id ? 'settings-tab active' : 'settings-tab'} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="settings-main">
        {section === 'general' && <General state={state} />}
        {section === 'profiles' && <Profiles state={state} />}
        {section === 'shortcuts' && <Shortcuts state={state} />}
        {section === 'links' && <Links state={state} />}
        {section === 'advanced' && <Advanced state={state} />}
      </main>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  )
}

// ── Général ──────────────────────────────────────────────────────────────

function General({ state }: { state: UiState }) {
  const { settings } = state.persisted
  return (
    <>
      <h1>Général</h1>
      <Row label="Moteur de recherche" hint="Utilisé par la Command bar et la barre d'adresse.">
        <select value={settings.searchEngine} onChange={(e) => updateSettings({ searchEngine: e.target.value as SearchEngineId })}>
          {Object.values(SEARCH_ENGINES).map((engine) => (
            <option key={engine.id} value={engine.id}>
              {engine.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Sidebar">
        <div className="segmented settings-segmented">
          {(['left', 'right'] as const).map((side) => (
            <button key={side} className={settings.sidebarPosition === side ? 'segment active' : 'segment'} onClick={() => updateSettings({ sidebarPosition: side })}>
              {side === 'left' ? 'À gauche' : 'À droite'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Navigateur par défaut" hint="macOS demande une confirmation. Fonctionne avec l'application installée.">
        <button className="settings-button" onClick={() => dispatch({ type: 'browser.setDefault' })}>
          Définir Browsy par défaut
        </button>
      </Row>
      <Row label="Arc" hint="Spaces, épinglés, favoris, extensions épinglées, Developer Mode et règles de liens.">
        <button className="settings-button" onClick={() => dispatch({ type: 'arc.import' })}>
          Importer depuis Arc…
        </button>
      </Row>
    </>
  )
}

// ── Profils ──────────────────────────────────────────────────────────────

function Profiles({ state }: { state: UiState }) {
  const { profiles, spaces } = state.persisted
  const [name, setName] = useState('')
  return (
    <>
      <h1>Profils</h1>
      <p className="settings-intro">Chaque profil a ses propres cookies, connexions, extensions et favoris. Un Space utilise un profil (clic droit sur le Space &gt; Profil).</p>
      <div className="settings-list">
        {profiles.map((profile) => {
          const used = spaces.filter((s) => s.profileId === profile.id)
          const deletable = profile.id !== DEFAULT_PROFILE_ID && !used.length
          return (
            <div key={profile.id} className="settings-list-row">
              <input
                className="settings-input grow"
                defaultValue={profile.name}
                onBlur={(e) => e.target.value.trim() !== profile.name && dispatch({ type: 'profile.rename', id: profile.id, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <span className="settings-meta">{used.length ? used.map((s) => s.name).join(', ') : 'Aucun Space'}</span>
              <button
                className="settings-icon-button"
                disabled={!deletable}
                title={deletable ? 'Supprimer le profil' : profile.id === DEFAULT_PROFILE_ID ? 'Profil par défaut' : 'Utilisé par un Space'}
                onClick={() => dispatch({ type: 'profile.delete', id: profile.id })}
              >
                <IconClose />
              </button>
            </div>
          )
        })}
      </div>
      <form
        className="settings-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          dispatch({ type: 'profile.create', name })
          setName('')
        }}
      >
        <input className="settings-input grow" value={name} placeholder="Nom du nouveau profil" onChange={(e) => setName(e.target.value)} />
        <button className="settings-button" type="submit">
          <IconPlus /> Créer
        </button>
      </form>
    </>
  )
}

// ── Raccourcis ───────────────────────────────────────────────────────────

const SYMBOLS: [RegExp, string][] = [
  [/CmdOrCtrl|Command|Cmd/g, '⌘'],
  [/Control|Ctrl/g, '⌃'],
  [/Alt|Option/g, '⌥'],
  [/Shift/g, '⇧'],
  [/Plus/g, '+'],
  [/Left/g, '←'],
  [/Right/g, '→'],
  [/Up/g, '↑'],
  [/Down/g, '↓'],
  [/Tab/g, '⇥'],
]

export function prettyAccelerator(accelerator?: string): string {
  if (!accelerator) return '—'
  const parts = accelerator.split('+').map((part) => SYMBOLS.reduce((text, [pattern, symbol]) => text.replace(pattern, symbol), part))
  // Ordre macOS : ⌃ ⌥ ⇧ ⌘ puis la touche.
  const order = ['⌃', '⌥', '⇧', '⌘']
  const mods = parts.filter((p) => order.includes(p)).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const keys = parts.filter((p) => !order.includes(p))
  return [...mods, ...keys].join('')
}

/** Touche pressée → accélérateur Electron (ou null si seulement des modificateurs). */
function acceleratorFromEvent(e: React.KeyboardEvent): string | null {
  const named: Record<string, string> = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Enter: 'Return', '+': 'Plus' }
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null
  const key = named[e.key] ?? (e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key.length === 1 ? e.key.toUpperCase() : e.key)
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'CmdOrCtrl'].filter(Boolean)
  if (!mods.length && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}

function Shortcuts({ state }: { state: UiState }) {
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [recording, setRecording] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    browsy().commands().then(setCommands)
  }, [])
  const overrides = state.persisted.settings.shortcuts
  const effective = (c: CommandInfo) => (overrides[c.id] !== undefined ? overrides[c.id] || undefined : c.accelerator)
  const setShortcut = (id: string, value: string | null) => {
    const next = { ...overrides }
    if (value === null) delete next[id]
    else next[id] = value
    updateSettings({ shortcuts: next })
  }
  const q = filter.trim().toLowerCase()
  const visible = commands.filter((c) => !q || c.label.toLowerCase().includes(q) || c.menu.toLowerCase().includes(q))
  const menus = [...new Set(visible.map((c) => c.menu))]
  const conflicts = (c: CommandInfo) => {
    const acc = effective(c)
    return !!acc && commands.some((o) => o.id !== c.id && effective(o) === acc)
  }
  return (
    <>
      <h1>Raccourcis</h1>
      <p className="settings-intro">Clique sur un raccourci puis tape la nouvelle combinaison. Échap annule, ⌫ supprime le raccourci.</p>
      <input className="settings-input search" placeholder="Rechercher une commande" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {menus.map((menu) => (
        <section key={menu} className="settings-group">
          <h2>{menu}</h2>
          {visible
            .filter((c) => c.menu === menu)
            .map((c) => (
              <div key={c.id} className="settings-list-row">
                <span className="grow">{c.label}</span>
                {overrides[c.id] !== undefined && (
                  <button className="settings-link" onClick={() => setShortcut(c.id, null)}>
                    Réinitialiser
                  </button>
                )}
                <button
                  className={`shortcut${recording === c.id ? ' recording' : ''}${conflicts(c) ? ' conflict' : ''}`}
                  title={conflicts(c) ? 'Raccourci utilisé par une autre commande' : undefined}
                  onClick={() => setRecording(c.id)}
                  onBlur={() => recording === c.id && setRecording(null)}
                  onKeyDown={(e) => {
                    if (recording !== c.id) return
                    e.preventDefault()
                    if (e.key === 'Escape') return setRecording(null)
                    if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                      setShortcut(c.id, '')
                      return setRecording(null)
                    }
                    const accelerator = acceleratorFromEvent(e)
                    if (!accelerator) return
                    setShortcut(c.id, accelerator)
                    setRecording(null)
                  }}
                >
                  {recording === c.id ? 'Tape le raccourci…' : prettyAccelerator(effective(c))}
                </button>
              </div>
            ))}
        </section>
      ))}
    </>
  )
}

// ── Liens (Air Traffic Control) ──────────────────────────────────────────

function destinationValue(d: LinkDestination): string {
  return d.kind === 'space' ? `space:${d.spaceId}` : d.kind
}

function parseDestination(value: string): LinkDestination {
  if (value.startsWith('space:')) return { kind: 'space', spaceId: value.slice(6) }
  return value === 'littleArc' ? { kind: 'littleArc' } : { kind: 'mostRecent' }
}

function DestinationSelect({ state, value, onChange }: { state: UiState; value: LinkDestination; onChange(d: LinkDestination): void }) {
  return (
    <select value={destinationValue(value)} onChange={(e) => onChange(parseDestination(e.target.value))}>
      <option value="littleArc">Mini-fenêtre</option>
      <option value="mostRecent">Dernier Space utilisé</option>
      {state.persisted.spaces.map((s) => (
        <option key={s.id} value={`space:${s.id}`}>
          Space « {s.name} »
        </option>
      ))}
    </select>
  )
}

function Links({ state }: { state: UiState }) {
  const { linkRules, defaultLinkDestination } = state.persisted.settings
  const setRules = (rules: LinkRule[]) => updateSettings({ linkRules: rules })
  const patchRule = (id: string, patch: Partial<LinkRule>) => setRules(linkRules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <>
      <h1>Liens</h1>
      <p className="settings-intro">Air Traffic Control : où s'ouvrent les liens venus d'autres applications (Slack, Mail…). Les règles sont testées dans l'ordre.</p>
      <div className="settings-list">
        {linkRules.map((rule) => (
          <div key={rule.id} className="settings-list-row rule">
            <span className="rule-word">Si l'URL</span>
            <select value={rule.match.kind} onChange={(e) => patchRule(rule.id, { match: { ...rule.match, kind: e.target.value as 'contains' | 'domain' } })}>
              <option value="contains">contient</option>
              <option value="domain">est sur le domaine</option>
            </select>
            <input
              className="settings-input grow"
              defaultValue={rule.match.value}
              placeholder="meet.google.com"
              onBlur={(e) => patchRule(rule.id, { match: { ...rule.match, value: e.target.value.trim() } })}
            />
            <span className="rule-word">→</span>
            <DestinationSelect state={state} value={rule.destination} onChange={(destination) => patchRule(rule.id, { destination })} />
            <button className="settings-icon-button" title="Supprimer la règle" onClick={() => setRules(linkRules.filter((r) => r.id !== rule.id))}>
              <IconClose />
            </button>
          </div>
        ))}
      </div>
      <button className="settings-button add-rule" onClick={() => setRules([...linkRules, { id: newId(), match: { kind: 'contains', value: '' }, destination: { kind: 'mostRecent' } }])}>
        <IconPlus /> Ajouter une règle
      </button>
      <Row label="Autres liens" hint="Destination par défaut quand aucune règle ne correspond.">
        <DestinationSelect state={state} value={defaultLinkDestination} onChange={(d) => updateSettings({ defaultLinkDestination: d })} />
      </Row>
    </>
  )
}

// ── Avancé ───────────────────────────────────────────────────────────────

const ARCHIVE_OPTIONS: [number, string][] = [
  [12, '12 heures'],
  [24, '24 heures'],
  [24 * 7, '7 jours'],
  [24 * 30, '30 jours'],
  [0, 'Jamais'],
]

function Advanced({ state }: { state: UiState }) {
  const { settings } = state.persisted
  const [host, setHost] = useState('')
  return (
    <>
      <h1>Avancé</h1>
      <Row label="Archiver les onglets du jour après" hint="Réglage par défaut ; chaque Space peut avoir le sien (clic droit sur le Space).">
        <select value={settings.archiveAfterHours} onChange={(e) => updateSettings({ archiveAfterHours: Number(e.target.value) })}>
          {ARCHIVE_OPTIONS.map(([hours, label]) => (
            <option key={hours} value={hours}>
              {label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Picture-in-Picture automatique" hint="Une vidéo en lecture passe en fenêtre flottante quand tu changes d'onglet.">
        <button role="switch" aria-checked={settings.autoPip} className={settings.autoPip ? 'switch on' : 'switch'} onClick={() => updateSettings({ autoPip: !settings.autoPip })}>
          <span className="switch-knob" />
        </button>
      </Row>
      <section className="settings-group">
        <h2>Developer Mode</h2>
        <p className="settings-intro">Toujours actif sur localhost et les adresses locales. Sites ajoutés :</p>
        <div className="settings-list">
          {settings.devModeHosts.map((h) => (
            <div key={h} className="settings-list-row">
              <span className="grow mono">{h}</span>
              <button className="settings-icon-button" title="Retirer" onClick={() => updateSettings({ devModeHosts: settings.devModeHosts.filter((x) => x !== h) })}>
                <IconClose />
              </button>
            </div>
          ))}
        </div>
        <form
          className="settings-add"
          onSubmit={(e) => {
            e.preventDefault()
            const value = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
            if (value && !settings.devModeHosts.includes(value)) updateSettings({ devModeHosts: [...settings.devModeHosts, value] })
            setHost('')
          }}
        >
          <input className="settings-input grow mono" value={host} placeholder="staging.exemple.fr" onChange={(e) => setHost(e.target.value)} />
          <button className="settings-button" type="submit">
            <IconPlus /> Ajouter
          </button>
        </form>
      </section>
    </>
  )
}
