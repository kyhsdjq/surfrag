import { mkdirSync } from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"

import type { CaptureRecord } from "../schema/capture.js"

const DEFAULT_DB_PATH = "./data/surfrag.db"

export type SqliteBootstrapResult = {
  db: Database.Database
  dbPath: string
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
  `)

  return { db, dbPath: resolvedDbPath }
}

export const insertCapture = (db: Database.Database, capture: CaptureRecord) => {
  const statement = db.prepare(`
    INSERT INTO captures (
      id,
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
      @title,
      @url,
      @referrer,
      @body_text,
      @max_scroll_percentage,
      @captured_at,
      @source_session,
      @created_at,
      @updated_at
    );
  `)

  const result = statement.run({
    id: capture.id,
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

  return {
    id: capture.id,
    changes: result.changes
  }
}
