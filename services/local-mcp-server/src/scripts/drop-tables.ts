/**
 * Drop LanceDB table capture_vectors and SQLite table captures.
 * Run: pnpm clean
 */
import "dotenv/config"
import { mkdirSync } from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import * as lancedb from "@lancedb/lancedb"

import { resolveDbPath } from "../db/sqlite.js"

const VECTOR_DB_PATH = path.resolve(
  process.cwd(),
  process.env.VECTOR_DB_PATH?.trim() || "./data/lancedb"
)

async function main() {
  // Drop SQLite table captures
  const sqlitePath = resolveDbPath(process.env.DB_PATH)
  mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath)
  db.exec("DROP TABLE IF EXISTS captures")
  console.log("SQLite: dropped captures")
  db.close()

  // Drop LanceDB table capture_vectors
  const ldb = await lancedb.connect(VECTOR_DB_PATH)
  const ldbNames = await ldb.tableNames()
  if (ldbNames.includes("capture_vectors")) {
    await ldb.dropTable("capture_vectors")
    console.log("LanceDB: dropped capture_vectors")
  } else {
    console.log("LanceDB: capture_vectors not found, skip")
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
