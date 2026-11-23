import { useEffect, useRef, useState } from 'react'
import type { UiState } from '../../shared/ipc'
import { IconPuzzle } from './icons'
import { browsy } from './useBrowser'

/** API injectée par electron-chrome-extensions (preload de la sidebar). */
interface ActionState {
  id: string
  title?: string
  iconModified?: number
  tabs: Record<number, { text?: string; color?: string; title?: string; iconModified?: number }>
}
interface BrowserActionApi {
  getState(partition: string): Promise<{ activeTabId?: number; actions: ActionState[] }>
  activate(partition: string, details: Record<string, unknown>): Promise<void>
  addEventListener(name: 'update', listener: (state: { activeTabId?: number; actions: ActionState[] }) => void): void
  removeEventListener(name: 'update', listener: (state: { activeTabId?: number; actions: ActionState[] }) => void): void
  addObserver(partition: string): void
  removeObserver(partition: string): void
}

const api = () => (window as unknown as { browserAction?: BrowserActionApi }).browserAction

/** Extensions épinglées visibles dans la barre d'URL : le domaine doit rester lisible. */
const maxVisible = (sidebarWidth: number) => (sidebarWidth >= 300 ? 3 : 2)

/**
 * Extensions dans la barre d'URL (comme Arc) : les épinglées en petites icônes,
 * les autres dans le menu du bouton puzzle.
 */
export function ExtensionButtons({ state }: { state: UiState }) {
  const [actions, setActions] = useState<ActionState[]>([])
  const [tabId, setTabId] = useState(-1)
  const partition = state.partition
  const puzzleRef = useRef<HTMLButtonElement>(null)

  const activate = (extensionId: string, anchor: DOMRect) =>
    api()?.activate(partition, {
      eventType: 'click',
      extensionId,
      tabId,
      alignment: 'bottom left',
      anchorRect: { x: anchor.left, y: anchor.top, width: anchor.width, height: anchor.height },
    })

  // Choix d'une extension dans le menu du bouton puzzle : son popup s'ouvre sous le bouton.
  useEffect(
    () =>
      browsy().onEvent((event) => {
        const rect = puzzleRef.current?.getBoundingClientRect()
        if (event.type === 'activate-extension' && rect) void activate(event.id, rect)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [partition, tabId],
  )

  useEffect(() => {
    const browserAction = api()
    if (!browserAction) return
    const update = (s: { activeTabId?: number; actions: ActionState[] }) => {
      setActions(s.actions)
      setTabId(s.activeTabId ?? -1)
    }
    browserAction.addEventListener('update', update)
    browserAction.addObserver(partition)
    browserAction.getState(partition).then(update).catch(() => {})
    return () => {
      browserAction.removeEventListener('update', update)
      browserAction.removeObserver(partition)
    }
  }, [partition])

  const profileId = state.persisted.spaces.find((s) => s.id === state.spaceId)?.profileId ?? ''
  const pinned = state.persisted.settings.pinnedExtensions[profileId]
  const visible = (pinned ? actions.filter((a) => pinned.includes(a.id)) : actions).slice(0, maxVisible(state.persisted.settings.sidebarWidth))
  if (!actions.length) return null

  return (
    <>
      {visible.map((action) => {
        const info = { ...action, ...(action.tabs?.[tabId] ?? {}) }
        const params = new URLSearchParams({ tabId: String(tabId), partition })
        if (info.iconModified) params.append('t', String(info.iconModified))
        return (
          <button
            key={action.id}
            className="url-action extension"
            title={info.title ?? ''}
            aria-label={info.title ?? 'Extension'}
            onClick={(e) => void activate(action.id, e.currentTarget.getBoundingClientRect())}
          >
            <img src={`crx://extension-icon/${action.id}/32/2?${params}`} width={16} height={16} alt="" draggable={false} />
            {info.text && (
              <span className="extension-badge" style={{ background: info.color ?? '#d93025' }}>
                {info.text}
              </span>
            )}
          </button>
        )
      })}
      <button
        ref={puzzleRef}
        className="url-action"
        aria-label="Extensions"
        title="Extensions"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          void browsy().dispatch({ type: 'ui.extensionsMenu', anchor: { x: r.left, y: r.top, width: r.width, height: r.height } })
        }}
      >
        <IconPuzzle />
      </button>
    </>
  )
}
