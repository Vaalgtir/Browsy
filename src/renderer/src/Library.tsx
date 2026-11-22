import { useEffect, useState } from 'react'
import type { HistoryItem, UiState } from '../../shared/ipc'
import { IconClose, IconDownload, IconSearch } from './icons'
import { Favicon } from './Sidebar'
import { browsy, displayHost } from './useBrowser'

type Tab = 'downloads' | 'archive' | 'history'

const TABS: [Tab, string][] = [
  ['downloads', 'Téléchargements'],
  ['archive', 'Archive'],
  ['history', 'Historique'],
]

function formatTime(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

/** Library (bouton en bas à gauche, comme Arc) : téléchargements, onglets archivés, historique. */
export function Library({ state, onClose }: { state: UiState; onClose(): void }) {
  const [tab, setTab] = useState<Tab>('downloads')
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const dispatch = browsy().dispatch

  useEffect(() => {
    if (tab !== 'history') return
    let cancelled = false
    browsy()
      .searchHistory(query)
      .then((items) => !cancelled && setHistory(items))
    return () => {
      cancelled = true
    }
  }, [tab, query])

  const q = query.trim().toLowerCase()
  const archive = state.persisted.archive
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !q || entry.title.toLowerCase().includes(q) || entry.url.toLowerCase().includes(q))
    .slice(0, 200)

  return (
    <div className="library">
      <div className="library-header">
        <span className="library-title">Library</span>
        <button className="icon-button small" onClick={onClose} aria-label="Fermer la Library">
          <IconClose />
        </button>
      </div>
      <div className="segmented">
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? 'segment active' : 'segment'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab !== 'downloads' && (
        <label className="library-search">
          <IconSearch />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher" spellCheck={false} />
        </label>
      )}

      <div className="library-list">
        {tab === 'downloads' &&
          (state.downloads.length ? (
            <>
              {state.downloads.map((d) => {
                const progress = d.totalBytes ? d.receivedBytes / d.totalBytes : 0
                return (
                  <div
                    key={d.id}
                    className={`row download ${d.state}`}
                    title={d.path}
                    onClick={() => dispatch({ type: d.state === 'completed' ? 'download.open' : 'download.reveal', id: d.id })}
                    onContextMenu={() => dispatch({ type: 'download.reveal', id: d.id })}
                  >
                    <span className="row-icon">
                      <IconDownload />
                    </span>
                    <span className="title">{d.filename}</span>
                    <span className="meta">{d.state === 'progressing' ? `${Math.round(progress * 100)} %` : formatSize(d.receivedBytes)}</span>
                    {d.state === 'progressing' && <span className="progress" style={{ '--progress': progress } as React.CSSProperties} />}
                  </div>
                )
              })}
              <button className="library-footer-button" onClick={() => dispatch({ type: 'download.clear' })}>
                Effacer les téléchargements terminés
              </button>
            </>
          ) : (
            <p className="library-empty">Aucun téléchargement pour l'instant.</p>
          ))}

        {tab === 'archive' &&
          (archive.length ? (
            archive.map(({ entry, index }) => (
              <div key={`${entry.url}-${entry.archivedAt}`} className="row" title={entry.url} onClick={() => dispatch({ type: 'archive.restore', index })}>
                <span className="row-icon">
                  <Favicon src={entry.favicon} url={entry.url} />
                </span>
                <span className="title">{entry.title || displayHost(entry.url)}</span>
                <span className="meta">{formatTime(entry.archivedAt)}</span>
              </div>
            ))
          ) : (
            <p className="library-empty">Les onglets du jour inutilisés arrivent ici après le délai d'archivage.</p>
          ))}

        {tab === 'history' &&
          (history.length ? (
            history.map((item) => (
              <div key={item.url} className="row" title={item.url} onClick={() => dispatch({ type: 'history.open', url: item.url })}>
                <span className="row-icon">
                  <Favicon url={item.url} />
                </span>
                <span className="title">{item.title || displayHost(item.url)}</span>
                <span className="meta">{formatTime(item.lastVisitAt)}</span>
              </div>
            ))
          ) : (
            <p className="library-empty">{query ? 'Aucun résultat.' : 'Historique vide.'}</p>
          ))}
      </div>
    </div>
  )
}
