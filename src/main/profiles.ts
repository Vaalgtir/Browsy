import { join } from 'node:path'
import { app, session, type Session, type WebContents } from 'electron'
import { ElectronChromeExtensions, type ChromeExtensionOptions } from 'electron-chrome-extensions'
import { installChromeWebStore } from 'electron-chrome-web-store'
import { DEFAULT_PROFILE_ID, type Id } from '../shared/model'
import { installChromeIdentity } from './chromeIdentity'
import { installPermissionHandler } from './permissions'

export interface ProfileContext {
  id: Id
  session: Session
  extensions: ElectronChromeExtensions
}

/** Callbacks des API chrome.tabs / chrome.windows, branchés sur le navigateur. */
export type ExtensionHooks = Pick<ChromeExtensionOptions, 'createTab' | 'selectTab' | 'removeTab' | 'createWindow'>

export function partitionOf(profileId: Id): string {
  return `persist:profile-${profileId}`
}

/**
 * Une session Electron par profil : cookies, stockage et extensions isolés.
 * Le profil par défaut garde le dossier d'extensions historique (« Extensions/ »).
 */
export class Profiles {
  private readonly contexts = new Map<Id, Promise<ProfileContext>>()

  constructor(private readonly hooks: (profileId: Id) => ExtensionHooks) {}

  get(profileId: Id): Promise<ProfileContext> {
    let context = this.contexts.get(profileId)
    if (!context) {
      context = this.create(profileId)
      this.contexts.set(profileId, context)
    }
    return context
  }

  private async create(profileId: Id): Promise<ProfileContext> {
    const ses = session.fromPartition(partitionOf(profileId))
    installChromeIdentity(ses)
    installPermissionHandler(ses)

    const extensions = new ElectronChromeExtensions({ session: ses, ...this.hooks(profileId) })
    // Après le preload de la lib : correctifs de compatibilité (voir src/preload/compat.ts).
    const compatPreload = join(__dirname, '../preload/compat.js')
    ses.registerPreloadScript({ id: 'browsy-compat-frame', type: 'frame', filePath: compatPreload })
    ses.registerPreloadScript({ id: 'browsy-compat-sw', type: 'service-worker', filePath: compatPreload })

    if (process.env.BROWSY_DEBUG_SW === '1') {
      ses.serviceWorkers.on('console-message', (_event, details) => {
        console.log(`[sw] ${details.sourceUrl}:${details.lineNumber} ${details.message}`)
      })
    }

    await installChromeWebStore({
      session: ses,
      allowUnpackedExtensions: true,
      extensionsPath:
        profileId === DEFAULT_PROFILE_ID
          ? join(app.getPath('userData'), 'Extensions')
          : join(app.getPath('userData'), 'Profiles', profileId, 'Extensions'),
    })
    return { id: profileId, session: ses, extensions }
  }

  /** Retrouve le profil d'un webContents (onglet, popup d'extension…). */
  async profileOf(wc: WebContents): Promise<Id | undefined> {
    for (const [id, context] of this.contexts) if ((await context).session === wc.session) return id
    return undefined
  }
}
