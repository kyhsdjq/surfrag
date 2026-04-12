import { mkdirSync } from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"

import type {
  ContradictionResult,
  ContradictionReviewPacket
} from "../contradiction/review.js"
import type { CaptureRecord } from "../schema/capture.js"
import { buildSearchMatch, buildSnippet, type SearchMatch } from "../search/match.js"

const DEFAULT_DB_PATH = "./data/surfrag.db"

export type SqliteBootstrapResult = {
  db: Database.Database
  dbPath: string
}

export type CaptureIdentityState = {
  id: string
  contentHash: string | null
  url: string
}

export type UpsertCaptureInput = {
  capture: CaptureRecord
  canonicalUrl: string
  contentHash: string
}

export type ContradictionReviewRow = {
  captureId: string
  url: string
  rawDocument: string
  candidateClaims: string[]
  queryText: string
  references: Array<{ reference_id: string; file_path: string }>
  result: ContradictionResult
  enteredDebate: boolean
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
      canonical_url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      referrer TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL,
      content_hash TEXT,
      max_scroll_percentage REAL NOT NULL,
      captured_at TEXT NOT NULL,
      source_session TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS contradiction_reviews (
      url TEXT PRIMARY KEY,
      capture_id TEXT NOT NULL,
      raw_document TEXT NOT NULL,
      candidate_claims_json TEXT NOT NULL DEFAULT '[]',
      query_text TEXT NOT NULL DEFAULT '',
      references_json TEXT NOT NULL DEFAULT '[]',
      result_json TEXT NOT NULL,
      entered_debate INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)

  const hasPageIdColumn = db
    .prepare("SELECT 1 AS ok FROM pragma_table_info('captures') WHERE name = 'page_id' LIMIT 1;")
    .get() as { ok: number } | undefined

  if (!hasPageIdColumn) {
    db.exec("ALTER TABLE captures ADD COLUMN page_id TEXT NOT NULL DEFAULT '';")
  }

  const hasCanonicalUrlColumn = db
    .prepare("SELECT 1 AS ok FROM pragma_table_info('captures') WHERE name = 'canonical_url' LIMIT 1;")
    .get() as { ok: number } | undefined

  if (!hasCanonicalUrlColumn) {
    db.exec("ALTER TABLE captures ADD COLUMN canonical_url TEXT NOT NULL DEFAULT '';")
  }

  const hasContentHashColumn = db
    .prepare("SELECT 1 AS ok FROM pragma_table_info('captures') WHERE name = 'content_hash' LIMIT 1;")
    .get() as { ok: number } | undefined

  if (!hasContentHashColumn) {
    db.exec("ALTER TABLE captures ADD COLUMN content_hash TEXT;")
  }

  db.exec("UPDATE captures SET page_id = id WHERE page_id = '';")
  db.exec("UPDATE captures SET canonical_url = url WHERE canonical_url = '';")
  db.exec("DROP INDEX IF EXISTS idx_captures_page_id_unique;")
  db.exec("CREATE INDEX IF NOT EXISTS idx_captures_canonical_url ON captures(canonical_url);")
  db.exec("CREATE INDEX IF NOT EXISTS idx_captures_url ON captures(url);")
  db.exec("CREATE INDEX IF NOT EXISTS idx_captures_captured_at ON captures(captured_at);")
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_contradiction_reviews_capture_id ON contradiction_reviews(capture_id);"
  )

  return { db, dbPath: resolvedDbPath }
}

export const getCaptureIdentityState = (
  db: Database.Database,
  canonicalUrl: string
): CaptureIdentityState | null => {
  const row = db
    .prepare(
      `
      SELECT id, content_hash, url
      FROM captures
      WHERE canonical_url = @canonical_url
      ORDER BY updated_at DESC
      LIMIT 1;
    `
    )
    .get({ canonical_url: canonicalUrl }) as
    | { id: string; content_hash: string | null; url: string }
    | undefined

  if (!row) {
    return null
  }

  return {
    id: row.id,
    contentHash: row.content_hash,
    url: row.url
  }
}

export const upsertCapture = (db: Database.Database, input: UpsertCaptureInput) => {
  const { capture, canonicalUrl, contentHash } = input
  const findExisting = db.prepare(
    "SELECT id FROM captures WHERE canonical_url = @canonical_url ORDER BY updated_at DESC LIMIT 1;"
  )
  const updateExisting = db.prepare(`
    UPDATE captures
    SET
      page_id = @page_id,
      canonical_url = @canonical_url,
      title = @title,
      url = @url,
      referrer = @referrer,
      body_text = @body_text,
      content_hash = @content_hash,
      max_scroll_percentage = @max_scroll_percentage,
      captured_at = @captured_at,
      source_session = @source_session,
      updated_at = @updated_at
    WHERE id = @id;
  `)
  const insertNew = db.prepare(`
    INSERT INTO captures (
      id,
      page_id,
      canonical_url,
      title,
      url,
      referrer,
      body_text,
      content_hash,
      max_scroll_percentage,
      captured_at,
      source_session,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @page_id,
      @canonical_url,
      @title,
      @url,
      @referrer,
      @body_text,
      @content_hash,
      @max_scroll_percentage,
      @captured_at,
      @source_session,
      @created_at,
      @updated_at
    );
  `)

  const operation = db.transaction(() => {
    const existing = findExisting.get({ canonical_url: canonicalUrl }) as
      | { id: string }
      | undefined

    if (existing) {
      const result = updateExisting.run({
        id: existing.id,
        page_id: capture.pageId,
        canonical_url: canonicalUrl,
        title: capture.title,
        url: capture.url,
        referrer: capture.referrer,
        body_text: capture.bodyText,
        content_hash: contentHash,
        max_scroll_percentage: capture.maxScrollPercentage,
        captured_at: capture.capturedAt,
        source_session: capture.sourceSession,
        updated_at: capture.updatedAt
      })

      return {
        id: existing.id,
        changes: result.changes
      }
    }

    const result = insertNew.run({
      id: capture.id,
      page_id: capture.pageId,
      canonical_url: canonicalUrl,
      title: capture.title,
      url: capture.url,
      referrer: capture.referrer,
      body_text: capture.bodyText,
      content_hash: contentHash,
      max_scroll_percentage: capture.maxScrollPercentage,
      captured_at: capture.capturedAt,
      source_session: capture.sourceSession,
      created_at: capture.createdAt,
      updated_at: capture.updatedAt
    })

    return {
      id: capture.id,
      changes: result.changes
    }
  })

  return operation()
}

export const upsertContradictionReview = (
  db: Database.Database,
  input: ContradictionReviewRow
) => {
  const nowIso = new Date().toISOString()

  db.prepare(
    `
      INSERT INTO contradiction_reviews (
        url,
        capture_id,
        raw_document,
        candidate_claims_json,
        query_text,
        references_json,
        result_json,
        entered_debate,
        created_at,
        updated_at
      ) VALUES (
        @url,
        @capture_id,
        @raw_document,
        @candidate_claims_json,
        @query_text,
        @references_json,
        @result_json,
        @entered_debate,
        @created_at,
        @updated_at
      )
      ON CONFLICT(url) DO UPDATE SET
        capture_id = excluded.capture_id,
        raw_document = excluded.raw_document,
        candidate_claims_json = excluded.candidate_claims_json,
        query_text = excluded.query_text,
        references_json = excluded.references_json,
        result_json = excluded.result_json,
        entered_debate = excluded.entered_debate,
        updated_at = excluded.updated_at;
    `
  ).run({
    url: input.url,
    capture_id: input.captureId,
    raw_document: input.rawDocument,
    candidate_claims_json: JSON.stringify(input.candidateClaims),
    query_text: input.queryText,
    references_json: JSON.stringify(input.references),
    result_json: JSON.stringify(input.result),
    entered_debate: input.enteredDebate ? 1 : 0,
    created_at: nowIso,
    updated_at: nowIso
  })
}

export function toContradictionReviewRow(
  review: ContradictionReviewPacket
): ContradictionReviewRow {
  return {
    captureId: review.captureId,
    url: review.reviewUrl,
    rawDocument: review.rawDocument,
    candidateClaims: review.candidateClaims,
    queryText: review.query,
    references: review.queryReferences,
    result: review.result,
    enteredDebate: review.enteredDebate
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

  const matches: SearchMatch[] = rows.map((row) => {
    const capture = normalizeRecord(row)
    const haystack = `${row.title} ${row.url} ${row.body_text}`
    return buildSearchMatch(capture, {
      snippet: buildSnippet(row.body_text, keyword),
      keywordCount: countKeyword(haystack, keyword)
    })
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
