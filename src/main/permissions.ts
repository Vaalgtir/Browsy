import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, systemPreferences, type Session } from 'electron'

/**
 * Electron accorde par défaut toutes les permissions aux sites. On fait comme Chrome :
 * on demande pour les permissions sensibles, et on mémorise la réponse par origine.
 */

type Decision = 'allow' | 'deny'

export interface StoredPermission {
  key: string
  label: string
  decision: Decision
}

/** Permissions accordées sans demander (comme Chrome). */
const ALWAYS_ALLOWED = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock', 'window-management'])

const LABELS: Record<string, string> = {
  notifications: 'afficher des notifications',
  geolocation: 'connaître votre position',
  media: 'utiliser votre caméra et votre micro',
  'clipboard-read': 'lire le presse-papiers',
  midi: 'accéder à vos appareils MIDI',
  midiSysex: 'contrôler vos appareils MIDI',
  openExternal: 'ouvrir une application externe',
  'idle-detection': 'savoir quand vous êtes inactif',
  'storage-access': 'utiliser ses cookies sur ce site',
  'top-level-storage-access': 'utiliser ses cookies sur ce site',
}

const decisionsFile = () => join(app.getPath('userData'), 'permissions.json')
let decisions: Record<string, Decision> | null = null

function load(): Record<string, Decision> {
  if (!decisions) {
    try {
      decisions = existsSync(decisionsFile()) ? JSON.parse(readFileSync(decisionsFile(), 'utf8')) : {}
    } catch {
      decisions = {}
    }
  }
  return decisions!
}

function remember(key: string, decision: Decision | null): void {
  if (decision) load()[key] = decision
  else delete load()[key]
  writeFileSync(decisionsFile(), JSON.stringify(decisions, null, 2))
}

/** Libellé lisible d'une clé « origine|permission[:médias] ». */
function labelOf(key: string): string {
  const [, rest = ''] = key.split('|')
  const [permission, media] = rest.split(':')
  if (permission === 'media') {
    const types = media?.split('+') ?? []
    if (types.includes('video') && types.includes('audio')) return 'Caméra et micro'
    if (types.includes('video')) return 'Caméra'
    if (types.includes('audio')) return 'Micro'
  }
  const names: Record<string, string> = {
    notifications: 'Notifications',
    geolocation: 'Position',
    'clipboard-read': 'Presse-papiers',
    midi: 'Appareils MIDI',
    midiSysex: 'Appareils MIDI',
    openExternal: 'Applications externes',
    'idle-detection': "Détection d'inactivité",
    'storage-access': 'Cookies intersites',
    'top-level-storage-access': 'Cookies intersites',
  }
  return names[permission] ?? permission
}

/** Décisions mémorisées pour une origine (menu « Contrôles du site »). */
export function permissionsFor(origin: string): StoredPermission[] {
  return Object.entries(load())
    .filter(([key]) => key.startsWith(`${origin}|`))
    .map(([key, decision]) => ({ key, label: labelOf(key), decision }))
}

/** Modifie (ou oublie, avec null) une décision mémorisée. */
export function setPermission(key: string, decision: Decision | null): void {
  remember(key, decision)
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}

function mediaLabel(mediaTypes: string[] | undefined): string {
  const video = mediaTypes?.includes('video')
  const audio = mediaTypes?.includes('audio')
  if (video && audio) return 'utiliser votre caméra et votre micro'
  if (video) return 'utiliser votre caméra'
  if (audio) return 'utiliser votre micro'
  return LABELS.media
}

async function ask(origin: string, label: string): Promise<{ decision: Decision; rememberIt: boolean }> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const host = origin.replace(/^https?:\/\//, '')
  const options = {
    type: 'question' as const,
    message: `${host} souhaite ${label}`,
    buttons: ['Autoriser', 'Bloquer'],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: 'Mémoriser pour ce site',
    checkboxChecked: true,
  }
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
  return { decision: result.response === 0 ? 'allow' : 'deny', rememberIt: result.checkboxChecked }
}

async function ensureSystemAccess(mediaTypes: string[] | undefined): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  for (const type of mediaTypes ?? []) {
    const device = type === 'video' ? 'camera' : type === 'audio' ? 'microphone' : null
    if (device && !(await systemPreferences.askForMediaAccess(device))) return false
  }
  return true
}

export function installPermissionHandler(ses: Session): void {
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return callback(true)
    const url = details.requestingUrl || wc.getURL()
    // Les extensions ont déjà déclaré leurs permissions dans leur manifeste.
    if (url.startsWith('chrome-extension://')) return callback(true)

    const origin = originOf(url)
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes as string[]) : undefined
    const key = `${origin}|${permission}${mediaTypes?.length ? `:${[...mediaTypes].sort().join('+')}` : ''}`
    const label = permission === 'media' ? mediaLabel(mediaTypes) : (LABELS[permission] ?? `utiliser « ${permission} »`)

    let decision = load()[key]
    if (!decision) {
      const answer = await ask(origin, label)
      decision = answer.decision
      if (answer.rememberIt) remember(key, decision)
    }
    if (decision === 'allow' && permission === 'media') return callback(await ensureSystemAccess(mediaTypes))
    callback(decision === 'allow')
  })

  // Vérifications synchrones (Notification.permission, navigator.permissions.query…).
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (ALWAYS_ALLOWED.has(permission)) return true
    if (requestingOrigin.startsWith('chrome-extension://')) return true
    const prefix = `${originOf(requestingOrigin)}|${permission}`
    return Object.entries(load()).some(([key, decision]) => key.startsWith(prefix) && decision === 'allow')
  })

  // Partage d'écran (Google Meet…) : sélecteur système de macOS.
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}), { useSystemPicker: true })
}
