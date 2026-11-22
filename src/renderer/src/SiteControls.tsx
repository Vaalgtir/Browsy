import type { SiteInfo } from '../../shared/ipc'
import { IconCode, IconGear, IconLink, IconLock, IconTrash, IconWarning } from './icons'
import { browsy } from './useBrowser'

/** Menu « Contrôles du site » ouvert depuis la barre d'URL (comme Arc). */
export function SiteControls({ site }: { site: SiteInfo }) {
  const dispatch = browsy().dispatch
  const zoom = Math.round(site.zoom * 100)
  return (
    <div className="popover site-controls" role="dialog" aria-label="Contrôles du site" onKeyDown={(e) => e.key === 'Escape' && dispatch({ type: 'overlay.close' })}>
      <header className="site-header">
        <span className="site-host">{site.host || site.url}</span>
        {/^https?:/.test(site.url) && (
          <span className={site.secure ? 'site-security secure' : 'site-security'}>
            {site.secure ? <IconLock /> : <IconWarning />}
            {site.secure ? 'Connexion sécurisée' : 'Connexion non sécurisée'}
          </span>
        )}
      </header>

      <div className="site-actions">
        <button className="site-action" onClick={() => dispatch({ type: 'tab.copyUrl', id: site.tabId })}>
          <IconLink />
          Copier le lien
        </button>
        <button className="site-action" onClick={() => dispatch({ type: 'tab.copyUrl', id: site.tabId, markdown: true })}>
          <span className="md">M↓</span>
          Markdown
        </button>
      </div>

      <section className="site-section">
        <div className="site-row">
          <span className="site-label">Zoom</span>
          <div className="stepper">
            <button onClick={() => dispatch({ type: 'site.zoom', tabId: site.tabId, delta: -1 })} aria-label="Zoom arrière">
              −
            </button>
            <button className="stepper-value" onClick={() => dispatch({ type: 'site.zoom', tabId: site.tabId, delta: 0 })} title="Taille réelle">
              {zoom} %
            </button>
            <button onClick={() => dispatch({ type: 'site.zoom', tabId: site.tabId, delta: 1 })} aria-label="Zoom avant">
              +
            </button>
          </div>
        </div>
        {site.host && (
          <label className="site-row toggle-row">
            <span className="site-label">
              <IconCode />
              Developer Mode
            </span>
            <Switch checked={site.devMode} onChange={() => dispatch({ type: 'devMode.toggle', host: site.host })} />
          </label>
        )}
      </section>

      {site.permissions.length > 0 && (
        <section className="site-section">
          <h3>Autorisations</h3>
          {site.permissions.map((p) => (
            <div key={p.key} className="site-row">
              <span className="site-label">{p.label}</span>
              <div className="segmented small">
                <button
                  className={p.decision === 'allow' ? 'segment active' : 'segment'}
                  onClick={() => dispatch({ type: 'site.permission', origin: site.origin, key: p.key, decision: 'allow' })}
                >
                  Autoriser
                </button>
                <button
                  className={p.decision === 'deny' ? 'segment active' : 'segment'}
                  onClick={() => dispatch({ type: 'site.permission', origin: site.origin, key: p.key, decision: 'deny' })}
                >
                  Bloquer
                </button>
              </div>
              <button className="icon-button small" title="Redemander" onClick={() => dispatch({ type: 'site.permission', origin: site.origin, key: p.key, decision: null })}>
                ×
              </button>
            </div>
          ))}
        </section>
      )}

      <footer className="site-footer">
        {site.origin && (
          <button className="footer-button danger" onClick={() => dispatch({ type: 'site.clearData', tabId: site.tabId })}>
            <IconTrash />
            Effacer les cookies et données du site
          </button>
        )}
        <button className="footer-button" onClick={() => dispatch({ type: 'ui.openSettings' })}>
          <IconGear />
          Réglages de Browsy
        </button>
      </footer>
    </div>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange(): void }) {
  return (
    <button role="switch" aria-checked={checked} className={checked ? 'switch on' : 'switch'} onClick={onChange}>
      <span className="switch-knob" />
    </button>
  )
}
