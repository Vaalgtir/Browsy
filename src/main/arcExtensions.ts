import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Session } from 'electron'

const ARC_USER_DATA = join(homedir(), 'Library/Application Support/Arc/User Data')

/**
 * Phase 0 : charge en lecture seule les extensions déjà installées dans Arc,
 * pour tester leur compatibilité sans passer par le Web Store.
 */
export async function loadArcExtensions(session: Session): Promise<void> {
  if (!existsSync(ARC_USER_DATA)) return
  const seen = new Set<string>()
  const profiles = readdirSync(ARC_USER_DATA).filter((name) => existsSync(join(ARC_USER_DATA, name, 'Extensions')))
  for (const profile of profiles) {
    const root = join(ARC_USER_DATA, profile, 'Extensions')
    for (const id of readdirSync(root)) {
      if (seen.has(id) || id.startsWith('.')) continue
      const versions = readdirSync(join(root, id)).filter((v) => existsSync(join(root, id, v, 'manifest.json')))
      const latest = versions.sort().at(-1)
      if (!latest) continue
      seen.add(id)
      try {
        const ext = await session.extensions.loadExtension(join(root, id, latest), { allowFileAccess: true })
        console.log(`[arc] chargée : ${ext.name} (${id})`)
      } catch (error) {
        console.warn(`[arc] échec : ${id}`, error)
      }
    }
  }
}
