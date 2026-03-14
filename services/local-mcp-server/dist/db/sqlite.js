import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
const DEFAULT_DB_PATH = "./data/surfrag.db";
export const resolveDbPath = (dbPath = process.env.DB_PATH) => {
    const safePath = dbPath?.trim() || DEFAULT_DB_PATH;
    return path.resolve(process.cwd(), safePath);
};
export const bootstrapSqlite = (dbPath = process.env.DB_PATH) => {
    const resolvedDbPath = resolveDbPath(dbPath);
    mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    const db = new Database(resolvedDbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("synchronous = NORMAL");
    db.exec(`
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      referrer TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL,
      max_scroll_percentage REAL NOT NULL,
      captured_at TEXT NOT NULL,
      source_session TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_captures_url ON captures(url);
    CREATE INDEX IF NOT EXISTS idx_captures_captured_at ON captures(captured_at);
    CREATE INDEX IF NOT EXISTS idx_captures_page_id ON captures(page_id);
  `);
    return { db, dbPath: resolvedDbPath };
};
export const upsertCapture = (db, capture) => {
    const statement = db.prepare(`
    INSERT INTO captures (
      id,
      page_id,
      title,
      url,
      referrer,
      body_text,
      max_scroll_percentage,
      captured_at,
      source_session,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @page_id,
      @title,
      @url,
      @referrer,
      @body_text,
      @max_scroll_percentage,
      @captured_at,
      @source_session,
      @created_at,
      @updated_at
    )
    ON CONFLICT(page_id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      referrer = excluded.referrer,
      body_text = excluded.body_text,
      max_scroll_percentage = excluded.max_scroll_percentage,
      captured_at = excluded.captured_at,
      source_session = excluded.source_session,
      updated_at = excluded.updated_at
  `);
    statement.run({
        id: capture.id,
        page_id: capture.pageId,
        title: capture.title,
        url: capture.url,
        referrer: capture.referrer,
        body_text: capture.bodyText,
        max_scroll_percentage: capture.maxScrollPercentage,
        captured_at: capture.capturedAt,
        source_session: capture.sourceSession,
        created_at: capture.createdAt,
        updated_at: capture.updatedAt
    });
    const row = db.prepare("SELECT id FROM captures WHERE page_id = ?").get(capture.pageId);
    return {
        id: row.id,
        changes: 1
    };
};
//# sourceMappingURL=sqlite.js.map