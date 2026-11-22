import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'

export interface HistoryEntry {
  url: string
  title: string
  visitCount: number
  lastVisitAt: number
}

/** Historique de navigation en SQLite (node:sqlite), avec recherche plein texte FTS5. */
export class History {
  private readonly db: DatabaseSync

  constructor(file = join(app.getPath('userData'), 'history.sqlite')) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS pages (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        visit_count INTEGER NOT NULL DEFAULT 0,
        last_visit_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(url, title, content='pages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
        INSERT INTO pages_fts(rowid, url, title) VALUES (new.rowid, new.url, new.title);
      END;
      CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
        INSERT INTO pages_fts(pages_fts, rowid, url, title) VALUES ('delete', old.rowid, old.url, old.title);
        INSERT INTO pages_fts(rowid, url, title) VALUES (new.rowid, new.url, new.title);
      END;
    `)
  }

  recordVisit(url: string, title: string, now = Date.now()): void {
    if (!/^https?:/.test(url)) return
    this.db
      .prepare(
        `INSERT INTO pages (url, title, visit_count, last_visit_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1, last_visit_at = excluded.last_visit_at,
           title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END`,
      )
      .run(url, title, now)
  }

  updateTitle(url: string, title: string): void {
    if (title) this.db.prepare('UPDATE pages SET title = ? WHERE url = ? AND title <> ?').run(title, url, title)
  }

  /** Recherche par préfixes de mots, classée par fréquence et récence. */
  search(query: string, limit = 8): HistoryEntry[] {
    const terms = query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .map((t) => `"${t}"*`)
    if (!terms.length) return []
    const rows = this.db
      .prepare(
        `SELECT p.url, p.title, p.visit_count AS visitCount, p.last_visit_at AS lastVisitAt
         FROM pages_fts f JOIN pages p ON p.rowid = f.rowid
         WHERE pages_fts MATCH ?
         ORDER BY (p.visit_count * 1.0) / (1 + (? - p.last_visit_at) / 86400000.0) DESC
         LIMIT ?`,
      )
      .all(terms.join(' '), Date.now(), limit)
    return rows as unknown as HistoryEntry[]
  }

  close(): void {
    this.db.close()
  }
}
