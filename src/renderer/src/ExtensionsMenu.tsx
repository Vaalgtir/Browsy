import type { ExtensionInfo } from '../../shared/ipc'
import { IconPin, IconPlus } from './icons'
import { browsy } from './useBrowser'

/** Petit menu des extensions (bouton puzzle de la barre d'URL) : ouvrir, épingler, en ajouter. */
export function ExtensionsMenu({ extensions, partition }: { extensions: ExtensionInfo[]; partition: string }) {
  const dispatch = browsy().dispatch
  return (
    <div className="popover extensions-menu" role="menu" aria-label="Extensions" onKeyDown={(e) => e.key === 'Escape' && dispatch({ type: 'overlay.close' })}>
      <header className="menu-header">Extensions</header>
      <div className="menu-list">
        {extensions.length === 0 && <p className="menu-empty">Aucune extension installée.</p>}
        {extensions.map((ext) => (
          <div key={ext.id} className="menu-row" role="menuitem" onClick={() => dispatch({ type: 'extension.activate', id: ext.id })}>
            <img
              className="extension-icon"
              src={`crx://extension-icon/${ext.id}/32/2?partition=${encodeURIComponent(partition)}`}
              width={16}
              height={16}
              alt=""
              draggable={false}
            />
            <span className="menu-label">{ext.name}</span>
            <button
              className={ext.pinned ? 'pin-button pinned' : 'pin-button'}
              onClick={(e) => {
                e.stopPropagation()
                dispatch({ type: 'extension.pin', id: ext.id, pinned: !ext.pinned })
              }}
              title={ext.pinned ? 'Retirer de la barre d’URL' : 'Épingler dans la barre d’URL'}
              aria-pressed={ext.pinned}
            >
              <IconPin filled={ext.pinned} />
            </button>
          </div>
        ))}
      </div>
      <footer className="menu-footer">
        <button className="footer-button" onClick={() => dispatch({ type: 'tab.new', url: 'https://chromewebstore.google.com/' })}>
          <IconPlus />
          Ajouter depuis le Chrome Web Store
        </button>
      </footer>
    </div>
  )
}
