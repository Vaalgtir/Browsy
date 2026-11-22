import { useEffect, useState } from 'react'
import type { Toast } from '../../shared/ipc'
import { IconCheck } from './icons'
import { browsy } from './useBrowser'

/** Notification ponctuelle (« Lien copié »), en bas de la page. */
export function ToastView() {
  const [toast, setToast] = useState<Toast | null>(null)
  const [last, setLast] = useState<Toast | null>(null)
  useEffect(
    () =>
      browsy().onToast((t) => {
        setToast(t)
        if (t) setLast(t)
      }),
    [],
  )
  if (!last) return null
  return (
    <div className="toast-stage">
      {/* Clé = identifiant : chaque nouvelle notification rejoue l'entrée. */}
      <div key={last.id} className={toast ? 'toast' : 'toast leaving'} role="status">
        <span className="toast-icon">
          <IconCheck />
        </span>
        <span className="toast-text">
          <span className="toast-message">{last.message}</span>
          {last.detail && <span className="toast-detail">{last.detail}</span>}
        </span>
      </div>
    </div>
  )
}

/** URL du lien survolé dans la page, en bas à gauche (comme Chrome et Arc). Sans animation : très fréquent. */
export function StatusView() {
  const [url, setUrl] = useState('')
  useEffect(() => browsy().onStatus(setUrl), [])
  if (!url) return null
  return (
    <div className="status-stage">
      <span className="status-bubble">{url}</span>
    </div>
  )
}
