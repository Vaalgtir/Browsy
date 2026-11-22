import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { createInitialState, normalizeState, type PersistedState } from '../shared/model'

const SAVE_DELAY_MS = 400

/** Sauvegarde de l'état de la sidebar en JSON (écriture atomique, différée). */
export class StateStore {
  private readonly file = join(app.getPath('userData'), 'browsy-state.json')
  private timer: NodeJS.Timeout | null = null

  load(): PersistedState {
    if (!existsSync(this.file)) return createInitialState()
    try {
      return normalizeState(JSON.parse(readFileSync(this.file, 'utf8')) as PersistedState)
    } catch (error) {
      console.error('[store] état illisible, on repart de zéro', error)
      renameSync(this.file, `${this.file}.corrompu-${Date.now()}`)
      return createInitialState()
    }
  }

  scheduleSave(state: PersistedState): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(state), SAVE_DELAY_MS)
  }

  saveNow(state: PersistedState): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(state))
    renameSync(tmp, this.file)
  }
}
