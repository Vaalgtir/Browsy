import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { DownloadInfo, UiState } from '../../shared/ipc'
import { favoritesOf, type FolderNode, type Id, type SidebarNode, type Space, type TabLocation } from '../../shared/model'
import {
  IconBack,
  IconChevron,
  IconClose,
  IconDownload,
  IconFolder,
  IconForward,
  IconPlus,
  IconReload,
  IconReturn,
  IconSpeaker,
} from './icons'
import { browsy, displayHost, useUiState } from './useBrowser'

const SIDEBAR_WIDTH = 260
const DRAG_TYPE = 'application/x-browsy-tab'
const SWIPE_THRESHOLD = 70
const SWIPE_COOLDOWN_MS = 450

/** Cible de dépôt pendant un glisser-déposer. */
interface DropTarget extends TabLocation {
  index: number
  /** Repère visuel : identifiant du nœud et position de la ligne d'insertion. */
  markerId?: string
  markerSide?: 'before' | 'after' | 'inside'
}

type Dispatch = ReturnType<typeof browsy>['dispatch']

export function Sidebar() {
  const state = useUiState()
  const [editingSpace, setEditingSpace] = useState<Id | null>(null)
  const [editingFolder, setEditingFolder] = useState<Id | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [direction, setDirection] = useState<'left' | 'right'>('right')
  const previousSpace = useRef<Id | null>(null)
  const swipe = useRef({ accumulated: 0, lockedUntil: 0 })

  useEffect(() => {
    browsy().dispatch({ type: 'ui.sidebarWidth', width: SIDEBAR_WIDTH })
    return browsy().onEvent((event) => {
      if (event.type === 'rename-space') setEditingSpace(event.id)
      if (event.type === 'rename-folder') setEditingFolder(event.id)
    })
  }, [])

  // Sens de l'animation de changement de Space : vers la droite si le Space suivant est à droite.
  const spaces = state?.persisted.spaces ?? []
  const activeSpaceId = state?.persisted.activeSpaceId ?? null
  useLayoutEffect(() => {
    if (!activeSpaceId) return
    const prev = previousSpace.current
    if (prev && prev !== activeSpaceId) {
      const from = spaces.findIndex((s) => s.id === prev)
      const to = spaces.findIndex((s) => s.id === activeSpaceId)
      setDirection(to > from ? 'right' : 'left')
    }
    previousSpace.current = activeSpaceId
  }, [activeSpaceId, spaces])

  // La teinte du Space colore toute la fenêtre (marges autour de la page comprises).
  const theme = spaces.find((s) => s.id === activeSpaceId)?.theme
  useLayoutEffect(() => {
    if (!theme) return
    document.documentElement.style.setProperty('--space-from', theme.from)
    document.documentElement.style.setProperty('--space-to', theme.to)
  }, [theme])

  if (!state) return null
  const { persisted } = state
  const space = persisted.spaces.find((s) => s.id === persisted.activeSpaceId) ?? persisted.spaces[0]
  const dispatch: Dispatch = (action) => browsy().dispatch(action)

  /** Glissement horizontal à deux doigts sur la sidebar : Space précédent / suivant. */
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const s = swipe.current
    if (Date.now() < s.lockedUntil) return
    s.accumulated += e.deltaX
    if (Math.abs(s.accumulated) < SWIPE_THRESHOLD) return
    const i = persisted.spaces.findIndex((sp) => sp.id === space.id)
    const next = persisted.spaces[i + (s.accumulated > 0 ? 1 : -1)]
    s.accumulated = 0
    s.lockedUntil = Date.now() + SWIPE_COOLDOWN_MS
    if (next) dispatch({ type: 'space.select', id: next.id })
  }

  const dnd: DnD = {
    drop,
    setDrop,
    commit(e) {
      e.preventDefault()
      const id = e.dataTransfer.getData(DRAG_TYPE)
      const target = drop
      setDrop(null)
      if (id && target) dispatch({ type: 'tab.move', id, to: { section: target.section, spaceId: target.spaceId, folderId: target.folderId }, index: target.index })
    },
  }

  return (
    <aside
      className="sidebar"
      style={{ width: SIDEBAR_WIDTH }}
      onWheel={onWheel}
      onDragEnd={() => setDrop(null)}
    >
      <Toolbar state={state} dispatch={dispatch} />
      <UrlPill state={state} dispatch={dispatch} />
      <browser-action-list className="extensions" partition={state.partition} alignment="bottom right" />

      <Favorites state={state} space={space} dispatch={dispatch} dnd={dnd} />

      <div className="space-content" key={space.id} data-direction={direction}>
        <SpaceHeader
          space={space}
          editing={editingSpace === space.id}
          onDone={() => setEditingSpace(null)}
          onEdit={() => setEditingSpace(space.id)}
          dispatch={dispatch}
        />

        <section
          className="pinned"
          onDragOver={(e) => acceptDrag(e, { section: 'pinned', spaceId: space.id, index: -1 }, dnd)}
          onDrop={dnd.commit}
        >
          <NodeList
            nodes={space.pinned}
            state={state}
            space={space}
            dispatch={dispatch}
            dnd={dnd}
            editingFolder={editingFolder}
            setEditingFolder={setEditingFolder}
          />
        </section>

        <TodayHeader space={space} dispatch={dispatch} />

        <button className="row new-tab" onClick={() => dispatch({ type: 'ui.commandBar', mode: 'new-tab' })}>
          <span className="row-icon">
            <IconPlus />
          </span>
          <span className="title">Nouvel onglet</span>
        </button>

        <section
          className="today"
          onDragOver={(e) => acceptDrag(e, { section: 'today', spaceId: space.id, index: -1 }, dnd)}
          onDrop={dnd.commit}
        >
          {space.today.map((id, index) => (
            <TabRow
              key={id}
              id={id}
              state={state}
              dispatch={dispatch}
              dnd={dnd}
              location={{ section: 'today', spaceId: space.id }}
              index={index}
            />
          ))}
        </section>
      </div>

      <DownloadsList downloads={state.downloads} dispatch={dispatch} />
      <SpaceBar state={state} dispatch={dispatch} />
    </aside>
  )
}

// ── Glisser-déposer ──────────────────────────────────────────────────────

interface DnD {
  drop: DropTarget | null
  setDrop(target: DropTarget | null): void
  commit(e: DragEvent): void
}

/** Accepte le survol d'un onglet glissé et mémorise la cible de dépôt. */
function acceptDrag(e: DragEvent, target: DropTarget, dnd: DnD): void {
  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  const current = dnd.drop
  if (
    !current ||
    current.section !== target.section ||
    current.index !== target.index ||
    current.folderId !== target.folderId ||
    current.markerId !== target.markerId ||
    current.markerSide !== target.markerSide
  ) {
    dnd.setDrop(target)
  }
}

/** Avant ou après la ligne survolée, selon la moitié du curseur. */
function sideOf(e: DragEvent): 'before' | 'after' {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function markerClass(dnd: DnD, markerId: string): string {
  if (dnd.drop?.markerId !== markerId) return ''
  return ` drop-${dnd.drop.markerSide}`
}

// ── Barre du haut ────────────────────────────────────────────────────────

function Toolbar({ state, dispatch }: { state: UiState; dispatch: Dispatch }) {
  const id = state.activeTabId
  const live = id ? state.live[id] : undefined
  return (
    <div className="toolbar">
      <div className="traffic-lights" />
      <button className="icon-button" disabled={!live?.canGoBack} onClick={() => id && dispatch({ type: 'tab.back', id })} aria-label="Précédent">
        <IconBack />
      </button>
      <button
        className="icon-button"
        disabled={!live?.canGoForward}
        onClick={() => id && dispatch({ type: 'tab.forward', id })}
        aria-label="Suivant"
      >
        <IconForward />
      </button>
      <button className="icon-button" disabled={!id} onClick={() => id && dispatch({ type: 'tab.reload', id })} aria-label="Recharger">
        <IconReload />
      </button>
    </div>
  )
}

function UrlPill({ state, dispatch }: { state: UiState; dispatch: Dispatch }) {
  const tab = state.activeTabId ? state.persisted.tabs[state.activeTabId] : undefined
  const loading = state.activeTabId ? state.live[state.activeTabId]?.loading : false
  return (
    <button className="url-pill" data-loading={loading || undefined} onClick={() => dispatch({ type: 'ui.commandBar', mode: 'edit-url' })}>
      <span className="url-text">{tab ? displayHost(tab.url) : 'Rechercher ou saisir une URL'}</span>
    </button>
  )
}

// ── Favorites ────────────────────────────────────────────────────────────

function Favorites({ state, space, dispatch, dnd }: { state: UiState; space: Space; dispatch: Dispatch; dnd: DnD }) {
  const favorites = favoritesOf(state.persisted, space.profileId)
  const dragging = dnd.drop?.section === 'favorites'
  return (
    <section
      className={favorites.length || dragging ? 'favorites' : 'favorites empty'}
      onDragOver={(e) => acceptDrag(e, { section: 'favorites', spaceId: space.id, index: -1, markerId: 'favorites-end', markerSide: 'after' }, dnd)}
      onDrop={dnd.commit}
    >
      {favorites.map((id, index) => {
        const tab = state.persisted.tabs[id]
        if (!tab) return null
        const live = state.live[id]
        const markerId = `fav-${id}`
        return (
          <button
            key={id}
            className={`favorite${state.activeTabId === id ? ' active' : ''}${live ? '' : ' unloaded'}${markerClass(dnd, markerId)}`}
            title={tab.title || tab.url}
            draggable
            onDragStart={(e) => startDrag(e, id)}
            onDragOver={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const before = e.clientX < rect.left + rect.width / 2
              acceptDrag(e, { section: 'favorites', spaceId: space.id, index: before ? index : index + 1, markerId, markerSide: before ? 'before' : 'after' }, dnd)
            }}
            onMouseDown={(e) => e.button === 0 && dispatch({ type: 'tab.select', id })}
            onContextMenu={() => dispatch({ type: 'tab.contextMenu', id })}
          >
            <Favicon src={tab.favicon} url={tab.url} size={20} />
            {live?.audible && <span className="audio-dot" />}
          </button>
        )
      })}
      {!favorites.length && <span className="favorites-hint">Glisser un onglet ici pour l'ajouter aux favoris</span>}
    </section>
  )
}

// ── En-tête du Space ─────────────────────────────────────────────────────

const EMOJI_PREFIX = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u

function SpaceHeader({
  space,
  editing,
  onEdit,
  onDone,
  dispatch,
}: {
  space: Space
  editing: boolean
  onEdit(): void
  onDone(): void
  dispatch: Dispatch
}) {
  const label = `${space.icon ? `${space.icon} ` : ''}${space.name}`
  if (editing) {
    return (
      <InlineEdit
        className="space-name editing"
        initial={label}
        onCommit={(value) => {
          const match = value.match(EMOJI_PREFIX)
          dispatch({ type: 'space.update', id: space.id, icon: match?.[1] ?? '', name: value.replace(EMOJI_PREFIX, '') || space.name })
          onDone()
        }}
        onCancel={onDone}
      />
    )
  }
  return (
    <div className="space-name" onDoubleClick={onEdit} onContextMenu={() => dispatch({ type: 'space.contextMenu', id: space.id })}>
      {space.icon && <span className="space-emoji">{space.icon}</span>}
      <span>{space.name}</span>
    </div>
  )
}

function TodayHeader({ space, dispatch }: { space: Space; dispatch: Dispatch }) {
  return (
    <div className="today-header">
      <span className="divider" />
      {space.today.length > 0 && (
        <button className="clear-button" onClick={() => dispatch({ type: 'today.clear', spaceId: space.id })}>
          Effacer
        </button>
      )}
    </div>
  )
}

// ── Onglets épinglés et dossiers ─────────────────────────────────────────

function NodeList({
  nodes,
  folderId,
  state,
  space,
  dispatch,
  dnd,
  editingFolder,
  setEditingFolder,
}: {
  nodes: SidebarNode[]
  folderId?: Id
  state: UiState
  space: Space
  dispatch: Dispatch
  dnd: DnD
  editingFolder: Id | null
  setEditingFolder(id: Id | null): void
}) {
  return (
    <>
      {nodes.map((node, index) =>
        node.type === 'tab' ? (
          <TabRow
            key={node.id}
            id={node.id}
            state={state}
            dispatch={dispatch}
            dnd={dnd}
            location={{ section: 'pinned', spaceId: space.id, folderId }}
            index={index}
          />
        ) : (
          <FolderRow
            key={node.id}
            folder={node}
            parentFolderId={folderId}
            index={index}
            state={state}
            space={space}
            dispatch={dispatch}
            dnd={dnd}
            editingFolder={editingFolder}
            setEditingFolder={setEditingFolder}
          />
        ),
      )}
    </>
  )
}

function FolderRow({
  folder,
  parentFolderId,
  index,
  state,
  space,
  dispatch,
  dnd,
  editingFolder,
  setEditingFolder,
}: {
  folder: FolderNode
  parentFolderId?: Id
  index: number
  state: UiState
  space: Space
  dispatch: Dispatch
  dnd: DnD
  editingFolder: Id | null
  setEditingFolder(id: Id | null): void
}) {
  const markerId = `folder-${folder.id}`
  return (
    <div className="folder">
      <div
        className={`row folder-row${markerClass(dnd, markerId)}`}
        onClick={() => dispatch({ type: 'folder.toggle', spaceId: space.id, id: folder.id })}
        onContextMenu={() => dispatch({ type: 'folder.contextMenu', spaceId: space.id, id: folder.id })}
        onDoubleClick={() => setEditingFolder(folder.id)}
        onDragOver={(e) => {
          // Moitié haute : avant le dossier ; moitié basse : dedans.
          const side = sideOf(e)
          if (side === 'before') acceptDrag(e, { section: 'pinned', spaceId: space.id, folderId: parentFolderId, index, markerId, markerSide: 'before' }, dnd)
          else acceptDrag(e, { section: 'pinned', spaceId: space.id, folderId: folder.id, index: 0, markerId, markerSide: 'inside' }, dnd)
        }}
        onDrop={dnd.commit}
      >
        <span className="row-icon">
          <IconFolder />
        </span>
        {editingFolder === folder.id ? (
          <InlineEdit
            className="title editing"
            initial={folder.title}
            onCommit={(title) => {
              dispatch({ type: 'folder.rename', spaceId: space.id, id: folder.id, title })
              setEditingFolder(null)
            }}
            onCancel={() => setEditingFolder(null)}
          />
        ) : (
          <span className="title">{folder.title}</span>
        )}
        <IconChevron open={folder.open} />
      </div>
      {folder.open && (
        <div className="folder-children">
          <NodeList
            nodes={folder.children}
            folderId={folder.id}
            state={state}
            space={space}
            dispatch={dispatch}
            dnd={dnd}
            editingFolder={editingFolder}
            setEditingFolder={setEditingFolder}
          />
        </div>
      )}
    </div>
  )
}

// ── Ligne d'onglet ───────────────────────────────────────────────────────

function startDrag(e: DragEvent, id: Id): void {
  e.dataTransfer.setData(DRAG_TYPE, id)
  e.dataTransfer.effectAllowed = 'move'
}

function TabRow({
  id,
  state,
  dispatch,
  dnd,
  location,
  index,
}: {
  id: Id
  state: UiState
  dispatch: Dispatch
  dnd: DnD
  location: TabLocation
  index: number
}) {
  const tab = state.persisted.tabs[id]
  if (!tab) return null
  const live = state.live[id]
  const active = state.activeTabId === id
  const markerId = `tab-${id}`
  const awayFromPinned = !!tab.pinnedUrl && displayHost(tab.pinnedUrl) !== displayHost(tab.url)
  const classes = ['row', 'tab', active && 'active', !live && location.section !== 'today' && 'unloaded', live?.loading && 'loading']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes + markerClass(dnd, markerId)}
      title={tab.url}
      draggable
      onDragStart={(e) => startDrag(e, id)}
      onDragOver={(e) => {
        const side = sideOf(e)
        acceptDrag(e, { ...location, index: side === 'before' ? index : index + 1, markerId, markerSide: side }, dnd)
      }}
      onDrop={dnd.commit}
      onMouseDown={(e) => e.button === 0 && dispatch({ type: 'tab.select', id })}
      onAuxClick={(e) => e.button === 1 && dispatch({ type: 'tab.close', id })}
      onContextMenu={() => dispatch({ type: 'tab.contextMenu', id })}
    >
      <span className="row-icon">
        <Favicon src={tab.favicon} url={tab.url} />
      </span>
      <span className="title">{tab.title || displayHost(tab.url) || 'Nouvel onglet'}</span>
      {(live?.audible || live?.muted) && (
        <RowButton label={live.muted ? 'Réactiver le son' : 'Couper le son'} onClick={() => dispatch({ type: 'tab.toggleMute', id })} visible>
          <IconSpeaker muted={live.muted} />
        </RowButton>
      )}
      {awayFromPinned && (
        <RowButton label="Revenir à l'URL d'origine" onClick={() => dispatch({ type: 'tab.resetToPinned', id })}>
          <IconReturn />
        </RowButton>
      )}
      {(location.section === 'today' || live) && (
        <RowButton label={location.section === 'today' ? "Fermer l'onglet" : 'Décharger'} onClick={() => dispatch({ type: 'tab.close', id })}>
          <IconClose />
        </RowButton>
      )}
    </div>
  )
}

function RowButton({ label, onClick, visible, children }: { label: string; onClick(): void; visible?: boolean; children: ReactNode }) {
  return (
    <button
      className={visible ? 'row-button visible' : 'row-button'}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

/** Favicon du site, ou son initiale tant qu'il n'a jamais été chargé. */
function Favicon({ src, url, size = 16 }: { src?: string; url?: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    const letter = url ? displayHost(url).charAt(0).toUpperCase() : ''
    return (
      <span className="favicon placeholder" style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}>
        {letter}
      </span>
    )
  }
  return <img className="favicon" src={src} width={size} height={size} alt="" draggable={false} onError={() => setFailed(true)} />
}

// ── Téléchargements ──────────────────────────────────────────────────────

function DownloadsList({ downloads, dispatch }: { downloads: DownloadInfo[]; dispatch: Dispatch }) {
  const recent = downloads.slice(0, 3)
  if (!recent.length) return null
  return (
    <section className="downloads">
      <div className="downloads-header">
        <span>Téléchargements</span>
        {downloads.some((d) => d.state !== 'progressing') && (
          <button className="clear-button" onClick={() => dispatch({ type: 'download.clear' })}>
            Effacer
          </button>
        )}
      </div>
      {recent.map((d) => {
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
            {d.state === 'progressing' && (
              <span className="progress" style={{ '--progress': progress } as React.CSSProperties} />
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── Barre des Spaces ─────────────────────────────────────────────────────

function SpaceBar({ state, dispatch }: { state: UiState; dispatch: Dispatch }) {
  const { spaces, activeSpaceId } = state.persisted
  return (
    <nav className="space-bar">
      {spaces.map((space) => (
        <button
          key={space.id}
          className={space.id === activeSpaceId ? 'space-dot active' : 'space-dot'}
          title={space.name}
          aria-label={space.name}
          style={{ '--dot': space.theme.from } as React.CSSProperties}
          onClick={() => dispatch({ type: 'space.select', id: space.id })}
          onContextMenu={() => dispatch({ type: 'space.contextMenu', id: space.id })}
        >
          {space.icon ? <span className="space-emoji">{space.icon}</span> : <span className="dot" />}
        </button>
      ))}
      <button className="icon-button" onClick={() => dispatch({ type: 'space.new' })} aria-label="Nouveau Space" title="Nouveau Space">
        <IconPlus />
      </button>
    </nav>
  )
}

// ── Édition en place ─────────────────────────────────────────────────────

function InlineEdit({
  initial,
  className,
  onCommit,
  onCancel,
}: {
  initial: string
  className: string
  onCommit(value: string): void
  onCancel(): void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const value = ref.current?.value.trim() ?? ''
    if (commit && value) onCommit(value)
    else onCancel()
  }
  return (
    <input
      ref={ref}
      className={className}
      defaultValue={initial}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
    />
  )
}
