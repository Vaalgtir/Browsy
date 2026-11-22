import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { BrowserAction, UiState } from '../../shared/ipc'
import { SIDEBAR_MAX, SIDEBAR_MIN } from '../../shared/layout'
import {
  favoritesOf,
  tabTitle,
  type FolderNode,
  type Id,
  type SidebarNode,
  type Space,
  type SplitNode,
  type TabLocation,
} from '../../shared/model'
import { Backdrop } from './Backdrop'
import { ExtensionButtons } from './ExtensionButtons'
import {
  IconBack,
  IconChevron,
  IconClose,
  IconFolder,
  IconForward,
  IconLibrary,
  IconLink,
  IconMore,
  IconPlus,
  IconReload,
  IconReturn,
  IconSidebar,
  IconSliders,
  IconSpeaker,
} from './icons'
import { Library } from './Library'
import { SpaceIcon } from './SpaceIcon'
import { applyTheme } from './theme'
import { browsy, displayHost, useUiState } from './useBrowser'

const DRAG_TYPE = 'application/x-browsy-tab'
const SWIPE_THRESHOLD = 70
const SWIPE_COOLDOWN_MS = 450

/** Cible de dépôt pendant un glisser-déposer. */
interface DropTarget extends TabLocation {
  index: number
  markerId?: string
  markerSide?: 'before' | 'after' | 'inside'
}

type Dispatch = (action: BrowserAction) => Promise<void>
const dispatch: Dispatch = (action) => browsy().dispatch(action)

interface DnD {
  drop: DropTarget | null
  setDrop(target: DropTarget | null): void
  commit(e: DragEvent): void
}

interface Editing {
  space: Id | null
  folder: Id | null
  tab: Id | null
  set(patch: Partial<Pick<Editing, 'space' | 'folder' | 'tab'>>): void
}

/**
 * Sidebar façon Arc. Rendue dans la fenêtre (avec le fond et la carte de contenu)
 * ou dans la vue flottante qui apparaît au bord quand la sidebar est masquée.
 */
export function Sidebar({ floating = false }: { floating?: boolean }) {
  const state = useUiState()
  const [editing, setEditing] = useState({ space: null as Id | null, folder: null as Id | null, tab: null as Id | null })
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [direction, setDirection] = useState<'left' | 'right'>('right')
  const [enterKey, setEnterKey] = useState(0)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const previousSpace = useRef<Id | null>(null)
  const swipe = useRef({ accumulated: 0, lockedUntil: 0 })

  useEffect(
    () =>
      browsy().onEvent((event) => {
        if (event.type === 'rename-space') setEditing((e) => ({ ...e, space: event.id }))
        if (event.type === 'rename-folder') setEditing((e) => ({ ...e, folder: event.id }))
        if (event.type === 'rename-tab') setEditing((e) => ({ ...e, tab: event.id }))
        if (event.type === 'floating-show') setEnterKey((k) => k + 1)
      }),
    [],
  )

  const spaces = state?.persisted.spaces ?? []
  const activeSpaceId = state?.persisted.activeSpaceId ?? null
  const space = spaces.find((s) => s.id === activeSpaceId) ?? spaces[0]

  // Sens de l'animation de changement de Space : vers la droite si le Space suivant est à droite.
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

  // Thème du Space sur toute la page (fond, grain, apparence claire ou sombre).
  const theme = space?.theme
  useLayoutEffect(() => {
    if (!theme) return
    applyTheme(theme)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(theme)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  if (!state || !space) return null
  const { settings } = state.persisted
  const width = dragWidth ?? settings.sidebarWidth
  const showDocked = floating || state.sidebarVisible

  /** Glissement horizontal à deux doigts sur la sidebar : Space précédent / suivant. */
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const s = swipe.current
    if (Date.now() < s.lockedUntil) return
    s.accumulated += e.deltaX
    if (Math.abs(s.accumulated) < SWIPE_THRESHOLD) return
    const i = spaces.findIndex((sp) => sp.id === space.id)
    const next = spaces[i + (s.accumulated > 0 ? 1 : -1)]
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
      if (id && target) {
        dispatch({ type: 'tab.move', id, to: { section: target.section, spaceId: target.spaceId, folderId: target.folderId }, index: target.index })
      }
    },
  }
  const edit: Editing = { ...editing, set: (patch) => setEditing((e) => ({ ...e, ...patch })) }

  const sidebar = (
    <aside
      className="sidebar"
      data-position={settings.sidebarPosition}
      data-floating={floating || undefined}
      style={{ width }}
      onWheel={onWheel}
      onDragEnd={() => setDrop(null)}
    >
      <TopBar state={state} floating={floating} />
      <UrlBar state={state} />
      <Favorites state={state} space={space} dnd={dnd} edit={edit} />

      {libraryOpen ? (
        <Library state={state} onClose={() => setLibraryOpen(false)} />
      ) : (
        <div className="space-content" key={space.id} data-direction={direction}>
          <SpaceTitle space={space} edit={edit} />
          <section className="pinned" onDragOver={(e) => acceptDrag(e, { section: 'pinned', spaceId: space.id, index: -1 }, dnd)} onDrop={dnd.commit}>
            <NodeList nodes={space.pinned} state={state} space={space} dnd={dnd} edit={edit} section="pinned" />
          </section>

          <div className="today-divider">
            <span className="divider" />
            {space.today.length > 0 && (
              <button className="clear-button" onClick={() => dispatch({ type: 'today.clear', spaceId: space.id })}>
                ↓ Effacer
              </button>
            )}
          </div>

          <button className="row new-tab" onClick={() => dispatch({ type: 'ui.commandBar', mode: 'new-tab' })}>
            <span className="row-icon">
              <IconPlus />
            </span>
            <span className="title">Nouvel onglet</span>
          </button>

          <section className="today" onDragOver={(e) => acceptDrag(e, { section: 'today', spaceId: space.id, index: -1 }, dnd)} onDrop={dnd.commit}>
            <NodeList nodes={space.today} state={state} space={space} dnd={dnd} edit={edit} section="today" />
          </section>
        </div>
      )}

      <BottomBar state={state} libraryOpen={libraryOpen} onLibrary={() => setLibraryOpen((o) => !o)} />
      {!floating && <ResizeHandle position={settings.sidebarPosition} onResize={setDragWidth} />}
    </aside>
  )

  if (floating) {
    return (
      <div className="floating-panel" key={enterKey} data-position={settings.sidebarPosition}>
        {sidebar}
      </div>
    )
  }
  return (
    <>
      <Backdrop state={state} />
      {showDocked && sidebar}
    </>
  )
}

// ── Glisser-déposer ──────────────────────────────────────────────────────

/** Accepte le survol d'un onglet glissé et mémorise la cible de dépôt. */
function acceptDrag(e: DragEvent, target: DropTarget, dnd: DnD): void {
  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  const c = dnd.drop
  if (
    !c ||
    c.section !== target.section ||
    c.index !== target.index ||
    c.folderId !== target.folderId ||
    c.markerId !== target.markerId ||
    c.markerSide !== target.markerSide
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
  return dnd.drop?.markerId === markerId ? ` drop-${dnd.drop.markerSide}` : ''
}

function startDrag(e: DragEvent, id: Id): void {
  e.dataTransfer.setData(DRAG_TYPE, id)
  e.dataTransfer.effectAllowed = 'move'
}

// ── Barre du haut et barre d'URL ─────────────────────────────────────────

function TopBar({ state, floating }: { state: UiState; floating: boolean }) {
  const id = state.activeTabId
  const live = id ? state.live[id] : undefined
  return (
    <div className="topbar">
      <div className="traffic-lights" />
      <button
        className="icon-button"
        onClick={() => dispatch({ type: 'ui.toggleSidebar' })}
        aria-label={floating ? 'Garder la sidebar' : 'Masquer la sidebar'}
        title="Afficher/masquer la sidebar (⌘S)"
      >
        <IconSidebar />
      </button>
      <span className="topbar-spacer" />
      <button className="icon-button" disabled={!live?.canGoBack} onClick={() => id && dispatch({ type: 'tab.back', id })} aria-label="Précédent">
        <IconBack />
      </button>
      <button className="icon-button" disabled={!live?.canGoForward} onClick={() => id && dispatch({ type: 'tab.forward', id })} aria-label="Suivant">
        <IconForward />
      </button>
      <button className="icon-button" disabled={!id} onClick={() => id && dispatch({ type: 'tab.reload', id })} aria-label="Recharger">
        <IconReload />
      </button>
    </div>
  )
}

function UrlBar({ state }: { state: UiState }) {
  const id = state.activeTabId
  const tab = id ? state.persisted.tabs[id] : undefined
  const loading = id ? state.live[id]?.loading : false
  const controlsRef = useRef<HTMLButtonElement>(null)
  const openControls = () => {
    const r = controlsRef.current?.getBoundingClientRect()
    if (r) dispatch({ type: 'ui.siteControls', anchor: { x: r.left, y: r.top, width: r.width, height: r.height } })
  }
  return (
    <div className="url-bar" data-loading={loading || undefined}>
      <button className="url-text" onClick={() => dispatch({ type: 'ui.commandBar', mode: tab ? 'edit-url' : 'new-tab' })}>
        {tab ? displayHost(tab.url) : 'Rechercher ou saisir une URL'}
      </button>
      {tab && (
        <div className="url-actions">
          <ExtensionButtons state={state} />
          <button className="url-action" onClick={() => dispatch({ type: 'tab.copyUrl' })} aria-label="Copier le lien" title="Copier le lien (⌘⇧C)">
            <IconLink />
          </button>
          <button ref={controlsRef} className="url-action" onClick={openControls} aria-label="Contrôles du site" title="Contrôles du site">
            <IconSliders />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Favorites ────────────────────────────────────────────────────────────

function Favorites({ state, space, dnd, edit }: { state: UiState; space: Space; dnd: DnD; edit: Editing }) {
  const favorites = favoritesOf(state.persisted, space.profileId)
  const dragging = dnd.drop?.section === 'favorites'
  const columns = state.persisted.settings.sidebarWidth >= 330 ? 4 : 3
  const endTarget: DropTarget = { section: 'favorites', spaceId: space.id, index: -1, markerId: 'favorites-end', markerSide: 'after' }
  if (!favorites.length) {
    // Zone de dépôt discrète, qui ne se révèle que pendant un glisser.
    return (
      <section className={dragging ? 'favorites-empty dropping' : 'favorites-empty'} onDragOver={(e) => acceptDrag(e, endTarget, dnd)} onDrop={dnd.commit}>
        {dragging && 'Déposer ici pour ajouter aux favoris'}
      </section>
    )
  }
  return (
    <section className="favorites" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }} onDragOver={(e) => acceptDrag(e, endTarget, dnd)} onDrop={dnd.commit}>
      {favorites.map((id, index) => {
        const tab = state.persisted.tabs[id]
        if (!tab) return null
        const live = state.live[id]
        const markerId = `fav-${id}`
        const active = state.activeTabId === id
        return (
          <div key={id} className="favorite-cell">
            <button
              className={`favorite${active ? ' active' : ''}${markerClass(dnd, markerId)}`}
              title={tabTitle(tab)}
              draggable
              onDragStart={(e) => startDrag(e, id)}
              onDragOver={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const before = e.clientX < rect.left + rect.width / 2
                acceptDrag(e, { section: 'favorites', spaceId: space.id, index: before ? index : index + 1, markerId, markerSide: before ? 'before' : 'after' }, dnd)
              }}
              onMouseDown={(e) => e.button === 0 && dispatch({ type: 'tab.select', id })}
              onAuxClick={(e) => e.button === 1 && dispatch({ type: 'tab.close', id })}
              onContextMenu={() => dispatch({ type: 'tab.contextMenu', id })}
            >
              <Favicon src={tab.favicon} url={tab.url} size={20} />
              {live?.audible && <span className="favorite-dot audio" />}
            </button>
            {edit.tab === id && (
              <InlineEdit
                className="favorite-rename"
                initial={tabTitle(tab)}
                onCommit={(title) => {
                  dispatch({ type: 'tab.rename', id, title })
                  edit.set({ tab: null })
                }}
                onCancel={() => edit.set({ tab: null })}
              />
            )}
          </div>
        )
      })}
    </section>
  )
}

// ── Titre du Space ───────────────────────────────────────────────────────

const EMOJI_PREFIX = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u

function SpaceTitle({ space, edit }: { space: Space; edit: Editing }) {
  if (edit.space === space.id) {
    const label = `${space.icon && !space.icon.startsWith('icon:') ? `${space.icon} ` : ''}${space.name}`
    return (
      <InlineEdit
        className="space-title editing"
        initial={label}
        onCommit={(value) => {
          const match = value.match(EMOJI_PREFIX)
          const icon = match?.[1] ?? (space.icon.startsWith('icon:') ? space.icon : '')
          dispatch({ type: 'space.update', id: space.id, icon, name: value.replace(EMOJI_PREFIX, '') || space.name })
          edit.set({ space: null })
        }}
        onCancel={() => edit.set({ space: null })}
      />
    )
  }
  return (
    <div className="space-title" onDoubleClick={() => edit.set({ space: space.id })} onContextMenu={() => dispatch({ type: 'space.contextMenu', id: space.id })}>
      <SpaceIcon icon={space.icon} name={space.name} size={14} />
      <span className="space-name">{space.name}</span>
      <button className="space-more" aria-label="Options du Space" onClick={() => dispatch({ type: 'space.contextMenu', id: space.id })}>
        <IconMore />
      </button>
    </div>
  )
}

// ── Onglets épinglés, dossiers, Split Views ──────────────────────────────

interface ListProps {
  state: UiState
  space: Space
  dnd: DnD
  edit: Editing
}

function NodeList({ nodes, folderId, section, ...props }: ListProps & { nodes: SidebarNode[]; folderId?: Id; section: 'pinned' | 'today' }) {
  const location: TabLocation = { section, spaceId: props.space.id, folderId }
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'tab') return <TabRow key={node.id} id={node.id} location={location} index={index} {...props} />
        if (node.type === 'split') return <SplitRow key={node.id} split={node} location={location} index={index} {...props} />
        return <FolderRow key={node.id} folder={node} parentFolderId={folderId} index={index} {...props} />
      })}
    </>
  )
}

function FolderRow({ folder, parentFolderId, index, ...props }: ListProps & { folder: FolderNode; parentFolderId?: Id; index: number }) {
  const { space, dnd, edit } = props
  const markerId = `folder-${folder.id}`
  return (
    <div className="folder">
      <div
        className={`row folder-row${markerClass(dnd, markerId)}`}
        onClick={() => dispatch({ type: 'folder.toggle', spaceId: space.id, id: folder.id })}
        onContextMenu={() => dispatch({ type: 'folder.contextMenu', spaceId: space.id, id: folder.id })}
        onDoubleClick={() => edit.set({ folder: folder.id })}
        onDragOver={(e) => {
          // Moitié haute : avant le dossier ; moitié basse : dedans.
          if (sideOf(e) === 'before') acceptDrag(e, { section: 'pinned', spaceId: space.id, folderId: parentFolderId, index, markerId, markerSide: 'before' }, dnd)
          else acceptDrag(e, { section: 'pinned', spaceId: space.id, folderId: folder.id, index: 0, markerId, markerSide: 'inside' }, dnd)
        }}
        onDrop={dnd.commit}
      >
        <span className="row-icon">
          <IconFolder />
        </span>
        {edit.folder === folder.id ? (
          <InlineEdit
            className="title editing"
            initial={folder.title}
            onCommit={(title) => {
              dispatch({ type: 'folder.rename', spaceId: space.id, id: folder.id, title })
              edit.set({ folder: null })
            }}
            onCancel={() => edit.set({ folder: null })}
          />
        ) : (
          <span className="title">{folder.title}</span>
        )}
        <IconChevron open={folder.open} />
      </div>
      {folder.open && (
        <div className="folder-children">
          <NodeList nodes={folder.children} folderId={folder.id} section="pinned" {...props} />
        </div>
      )}
    </div>
  )
}

function TabRow({ id, location, index, state, dnd, edit }: ListProps & { id: Id; location: TabLocation; index: number }) {
  const tab = state.persisted.tabs[id]
  if (!tab) return null
  const live = state.live[id]
  const active = state.activeTabId === id
  const markerId = `tab-${id}`
  const pinned = location.section === 'pinned'
  // Onglet épinglé parti de son URL d'origine : « Nom / page actuelle », comme Arc.
  const away = pinned && !!tab.pinnedUrl && tab.url !== tab.pinnedUrl
  const rootTitle = tab.customTitle || displayHost(tab.pinnedUrl ?? tab.url)
  const classes = ['row', 'tab', active && 'active', !live && pinned && 'unloaded', live?.loading && 'loading'].filter(Boolean).join(' ')

  return (
    <div
      className={classes + markerClass(dnd, markerId)}
      title={tab.url}
      draggable={edit.tab !== id}
      onDragStart={(e) => startDrag(e, id)}
      onDragOver={(e) => {
        const side = sideOf(e)
        acceptDrag(e, { ...location, index: side === 'before' ? index : index + 1, markerId, markerSide: side }, dnd)
      }}
      onDrop={dnd.commit}
      onMouseDown={(e) => e.button === 0 && edit.tab !== id && dispatch({ type: 'tab.select', id })}
      onAuxClick={(e) => e.button === 1 && dispatch({ type: 'tab.close', id })}
      onDoubleClick={() => pinned && edit.set({ tab: id })}
      onContextMenu={() => dispatch({ type: 'tab.contextMenu', id })}
    >
      <span className="row-icon">
        <Favicon src={tab.favicon} url={tab.url} />
      </span>
      {edit.tab === id ? (
        <InlineEdit
          className="title editing"
          initial={tabTitle(tab)}
          onCommit={(title) => {
            dispatch({ type: 'tab.rename', id, title })
            edit.set({ tab: null })
          }}
          onCancel={() => edit.set({ tab: null })}
        />
      ) : away ? (
        <span className="title">
          <span className="pinned-root">{rootTitle}</span>
          <span className="slash">/</span>
          {tab.title || displayHost(tab.url)}
        </span>
      ) : (
        <span className="title">{tabTitle(tab) || displayHost(tab.url) || 'Nouvel onglet'}</span>
      )}
      {(live?.audible || live?.muted) && (
        <RowButton label={live.muted ? 'Réactiver le son' : 'Couper le son'} onClick={() => dispatch({ type: 'tab.toggleMute', id })} visible>
          <IconSpeaker muted={live.muted} />
        </RowButton>
      )}
      {away && (
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

/** Split View : une ligne, un segment par onglet (cliquable). */
function SplitRow({ split, location, index, state, dnd }: ListProps & { split: SplitNode; location: TabLocation; index: number }) {
  const markerId = `split-${split.id}`
  const active = split.tabs.includes(state.activeTabId ?? '')
  return (
    <div
      className={`row split${active ? ' active' : ''}${markerClass(dnd, markerId)}`}
      onDragOver={(e) => {
        const side = sideOf(e)
        acceptDrag(e, { ...location, index: side === 'before' ? index : index + 1, markerId, markerSide: side }, dnd)
      }}
      onDrop={dnd.commit}
    >
      {split.tabs.map((tabId) => {
        const tab = state.persisted.tabs[tabId]
        if (!tab) return null
        return (
          <button
            key={tabId}
            className={active && state.activeTabId === tabId ? 'split-part focused' : 'split-part'}
            title={tab.url}
            draggable
            onDragStart={(e) => startDrag(e, tabId)}
            onMouseDown={(e) => e.button === 0 && dispatch({ type: 'tab.select', id: tabId })}
            onContextMenu={(e) => {
              e.stopPropagation()
              dispatch({ type: 'tab.contextMenu', id: tabId })
            }}
          >
            <Favicon src={tab.favicon} url={tab.url} />
            <span className="split-title">{tabTitle(tab)}</span>
          </button>
        )
      })}
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
export function Favicon({ src, url, size = 16 }: { src?: string; url?: string; size?: number }) {
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

// ── Barre du bas ─────────────────────────────────────────────────────────

function BottomBar({ state, libraryOpen, onLibrary }: { state: UiState; libraryOpen: boolean; onLibrary(): void }) {
  const { spaces, activeSpaceId } = state.persisted
  const downloading = state.downloads.some((d) => d.state === 'progressing')
  return (
    <nav className="bottom-bar">
      <button className={`icon-button${libraryOpen ? ' pressed' : ''}`} onClick={onLibrary} aria-label="Library" title="Library : téléchargements, archive, historique">
        <IconLibrary />
        {downloading && <span className="activity-dot" />}
      </button>
      <div className="space-switcher">
        {spaces.map((space) => (
          <button
            key={space.id}
            className={space.id === activeSpaceId ? 'space-button active' : 'space-button'}
            title={space.name}
            aria-label={space.name}
            onClick={() => dispatch({ type: 'space.select', id: space.id })}
            onContextMenu={() => dispatch({ type: 'space.contextMenu', id: space.id })}
          >
            <SpaceIcon icon={space.icon} name={space.name} size={15} />
          </button>
        ))}
      </div>
      <button className="icon-button" onClick={() => dispatch({ type: 'space.newMenu' })} aria-label="Nouveau" title="Nouveau Space, dossier ou onglet">
        <IconPlus />
      </button>
    </nav>
  )
}

// ── Redimensionnement ────────────────────────────────────────────────────

/** Poignée sur le bord intérieur de la sidebar : suit la souris 1:1. */
function ResizeHandle({ position, onResize }: { position: 'left' | 'right'; onResize(width: number | null): void }) {
  const frame = useRef(0)
  const widthAt = (clientX: number) =>
    Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(position === 'left' ? clientX : window.innerWidth - clientX)))
  return (
    <div
      className="resize-handle"
      data-position={position}
      title="Glisser pour redimensionner, double-clic pour la largeur par défaut"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        e.preventDefault()
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        const width = widthAt(e.clientX)
        onResize(width)
        cancelAnimationFrame(frame.current)
        frame.current = requestAnimationFrame(() => dispatch({ type: 'ui.sidebarWidth', width }))
      }}
      onPointerUp={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        e.currentTarget.releasePointerCapture(e.pointerId)
        cancelAnimationFrame(frame.current)
        void dispatch({ type: 'ui.sidebarWidth', width: widthAt(e.clientX), commit: true }).then(() => onResize(null))
      }}
      onDoubleClick={() => dispatch({ type: 'ui.sidebarWidth', width: 260, commit: true })}
    />
  )
}

// ── Édition en place ─────────────────────────────────────────────────────

export function InlineEdit({
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
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        if (e.key === 'Escape') finish(false)
      }}
    />
  )
}
