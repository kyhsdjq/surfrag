import { mkdirSync } from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"

import type { CaptureRecord } from "../schema/capture.js"

const DEFAULT_DB_PATH = "./data/surfrag.db"
const MAX_SNIPPET_LENGTH = 220

export type SqliteBootstrapResult = {
  db: Database.Database
  dbPath: string
}

type CaptureRow = {
  id: string
  page_id: string
  title: string
  url: string
  referrer: string
  body_text: string
  max_scroll_percentage: number
  captured_at: string
  source_session: string
  created_at: string
  updated_at: string
}

export type SearchCaptureMatch = {
  id: string
  title: string
  url: string
  capturedAt: string
  snippet: string
  keywordCount: number
}

const normalizeRecord = (row: CaptureRow): CaptureRecord => ({
  id: row.id,
  pageId: row.page_id,
  title: row.title,
  url: row.url,
  referrer: row.referrer,
  bodyText: row.body_text,
  maxScrollPercentage: row.max_scroll_percentage,
  capturedAt: row.captured_at,
  sourceSession: row.source_session,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const escapeForLike = (value: string) => value.replace(/[\\%_]/g, "\\$&")

const countKeyword = (text: string, keyword: string) => {
  const target = keyword.trim().toLowerCase()
  if (!target) {
    return 0
  }

  const source = text.toLowerCase()
  let index = 0
  let count = 0

  while (index < source.length) {
    const next = source.indexOf(target, index)
    if (next === -1) {
      break
    }
    count += 1
    index = next + target.length
  }

  return count
}

const buildSnippet = (text: string, keyword: string) => {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return ""
  }

  const lowerText = normalized.toLowerCase()
  const lowerKeyword = keyword.trim().toLowerCase()
  const matchIndex = lowerKeyword ? lowerText.indexOf(lowerKeyword) : -1

  if (matchIndex === -1) {
    return normalized.slice(0, MAX_SNIPPET_LENGTH)
  }

  const start = Math.max(0, matchIndex - Math.floor(MAX_SNIPPET_LENGTH / 3))
  const end = Math.min(normalized.length, start + MAX_SNIPPET_LENGTH)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < normalized.length ? "..." : ""

  return `${prefix}${normalized.slice(start, end)}${suffix}`
}

export const resolveDbPath = (dbPath = process.env.DB_PATH) => {
  const safePath = dbPath?.trim() || DEFAULT_DB_PATH
  return path.resolve(process.cwd(), safePath)
}

export const bootstrapSqlite = (dbPath = process.env.DB_PATH): SqliteBootstrapResult => {
  const resolvedDbPath = resolveDbPath(dbPath)
  mkdirSync(path.dirname(resolvedDbPath), { recursive: true })

  const db = new Database(resolvedDbPath)

  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  db.pragma("synchronous = NORMAL")

  db.exec(`
    CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_captures_page_id_unique ON captures(page_id);
    CREATE INDEX IF NOT EXISTS idx_captures_url ON captures(url);
    CREATE INDEX IF NOT EXISTS idx_captures_captured_at ON captures(captured_at);
  `)

  const hasPageIdColumn = db
    .prepare("SELECT 1 AS ok FROM pragma_table_info('captures') WHERE name = 'page_id' LIMIT 1;")
    .get() as { ok: number } | undefined

  if (!hasPageIdColumn) {
    db.exec("ALTER TABLE captures ADD COLUMN page_id TEXT NOT NULL DEFAULT '';")
  }

  db.exec("UPDATE captures SET page_id = id WHERE page_id = '';")

  return { db, dbPath: resolvedDbPath }
}

export const upsertCapture = (db: Database.Database, capture: CaptureRecord) => {
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
      updated_at = excluded.updated_at;
  `)

  const result = statement.run({
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
  })

  const persisted = db
    .prepare("SELECT id FROM captures WHERE page_id = @page_id LIMIT 1;")
    .get({ page_id: capture.pageId }) as { id: string } | undefined

  return {
    id: persisted?.id ?? capture.id,
    changes: result.changes
  }
}

export const searchCaptures = (
  db: Database.Database,
  keyword: string,
  limit: number,
  since?: string
) => {
  const escaped = escapeForLike(keyword.trim().toLowerCase())
  const likeTerm = `%${escaped}%`

  const rows = db
    .prepare(
      `
      SELECT
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
      FROM captures
      WHERE (
        LOWER(title) LIKE @likeTerm ESCAPE '\\'
        OR LOWER(url) LIKE @likeTerm ESCAPE '\\'
        OR LOWER(body_text) LIKE @likeTerm ESCAPE '\\'
      )
      AND (@since IS NULL OR captured_at >= @since)
      ORDER BY captured_at DESC
      LIMIT @limit;
    `
    )
    .all({
      likeTerm,
      since: since ?? null,
      limit
    }) as CaptureRow[]

  const total = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM captures
      WHERE (
        LOWER(title) LIKE @likeTerm ESCAPE '\\'
        OR LOWER(url) LIKE @likeTerm ESCAPE '\\'
        OR LOWER(body_text) LIKE @likeTerm ESCAPE '\\'
      )
      AND (@since IS NULL OR captured_at >= @since);
    `
    )
    .get({
      likeTerm,
      since: since ?? null
    }) as { count: number }

  const matches: SearchCaptureMatch[] = rows.map((row) => {
    const haystack = `${row.title} ${row.url} ${row.body_text}`
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      capturedAt: row.captured_at,
      snippet: buildSnippet(row.body_text, keyword),
      keywordCount: countKeyword(haystack, keyword)
    }
  })

  return {
    matches,
    totalMatches: total.count
  }
}

export const getCaptureById = (db: Database.Database, id: string) => {
  const row = db
    .prepare(
      `
      SELECT
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
      FROM captures
      WHERE id = @id
      LIMIT 1;
    `
    )
    .get({ id }) as CaptureRow | undefined

  return row ? normalizeRecord(row) : null
}
