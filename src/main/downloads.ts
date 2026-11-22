import { existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, shell, type DownloadItem, type Session } from 'electron'
import type { DownloadInfo } from '../shared/ipc'

const MAX_KEPT = 30

/** Nom de fichier libre dans le dossier : « fichier (1).pdf », « fichier (2).pdf »… */
function uniquePath(dir: string, filename: string): string {
  const ext = extname(filename)
  const stem = basename(filename, ext)
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

/** Téléchargements : enregistrés directement dans ~/Téléchargements, suivis dans la sidebar. */
export class Downloads {
  private readonly items: DownloadInfo[] = []
  private readonly sessions = new WeakSet<Session>()

  constructor(private readonly onChange: () => void) {}

  list(): DownloadInfo[] {
    return this.items
  }

  watch(ses: Session): void {
    if (this.sessions.has(ses)) return
    this.sessions.add(ses)
    ses.on('will-download', (_event, item) => this.track(item))
  }

  private track(item: DownloadItem): void {
    const path = uniquePath(app.getPath('downloads'), item.getFilename())
    item.setSavePath(path)
    const info: DownloadInfo = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      filename: basename(path),
      path,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
    }
    this.items.unshift(info)
    this.items.length = Math.min(this.items.length, MAX_KEPT)
    this.onChange()

    item.on('updated', (_e, state) => {
      info.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      info.receivedBytes = item.getReceivedBytes()
      info.totalBytes = item.getTotalBytes()
      this.onChange()
    })
    item.once('done', (_e, state) => {
      info.state = state
      info.receivedBytes = item.getReceivedBytes()
      if (state === 'completed') app.dock?.downloadFinished(path)
      this.onChange()
    })
  }

  open(id: string): void {
    const item = this.items.find((d) => d.id === id)
    if (item?.state === 'completed') void shell.openPath(item.path)
  }

  reveal(id: string): void {
    const item = this.items.find((d) => d.id === id)
    if (item) shell.showItemInFolder(item.path)
  }

  clearFinished(): void {
    const kept = this.items.filter((d) => d.state === 'progressing')
    this.items.splice(0, this.items.length, ...kept)
    this.onChange()
  }
}
