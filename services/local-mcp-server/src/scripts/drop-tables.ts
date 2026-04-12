/**
 * Reset local MCP persistence and clear LightRAG documents.
 * Run: pnpm clean
 */
import "dotenv/config"
import { mkdirSync } from "node:fs"
import path from "node:path"

import Database from "better-sqlite3"
import * as lancedb from "@lancedb/lancedb"

import { resolveDbPath } from "../db/sqlite.js"
import {
  clearAllLightRAGDocuments,
  waitForLightRAGDocumentsCleared
} from "../lightrag/documents.js"

const DEFAULT_LIGHTRAG_URL = "http://localhost:9621"
const VECTOR_DB_PATH = path.resolve(
  process.cwd(),
  process.env.VECTOR_DB_PATH?.trim() || "./data/lancedb"
)

async function resetSqlite() {
  const sqlitePath = resolveDbPath(process.env.DB_PATH)
  mkdirSync(path.dirname(sqlitePath), { recursive: true })

  const db = new Database(sqlitePath)
  db.exec("DROP TABLE IF EXISTS captures")
  db.exec("DROP TABLE IF EXISTS contradiction_reviews")
  db.close()

  console.log(`SQLite: dropped captures and contradiction_reviews at ${sqlitePath}`)
}

async function resetLanceDb() {
  const ldb = await lancedb.connect(VECTOR_DB_PATH)
  const ldbNames = await ldb.tableNames()

  if (ldbNames.includes("capture_vectors")) {
    await ldb.dropTable("capture_vectors")
    console.log(`LanceDB: dropped capture_vectors at ${VECTOR_DB_PATH}`)
    return
  }

  console.log(`LanceDB: capture_vectors not found at ${VECTOR_DB_PATH}, skip`)
}

async function resetLightRAG() {
  const lightragUrl =
    process.env.LIGHTRAG_URL?.trim().replace(/\/$/, "") || DEFAULT_LIGHTRAG_URL
  const apiKey = process.env.LIGHTRAG_API_KEY?.trim() || null

  console.log(`LightRAG: clearing documents via ${lightragUrl}/documents`)

  const result = await clearAllLightRAGDocuments(lightragUrl, apiKey)
  console.log(
    `LightRAG: delete request finished with status=${result.status ?? "unknown"}`
  )

  if (result.message?.trim()) {
    console.log(`LightRAG: ${result.message}`)
  }

  if (result.status === "busy" || result.status === "fail") {
    throw new Error(
      `LightRAG reset did not start cleanly (status=${result.status ?? "unknown"})`
    )
  }

  const cleared = await waitForLightRAGDocumentsCleared(lightragUrl, apiKey, console)
  if (!cleared) {
    throw new Error("Timed out waiting for LightRAG documents to clear")
  }

  console.log("LightRAG: document state reset complete")
}

async function main() {
  await resetSqlite()
  await resetLanceDb()
  await resetLightRAG()
  console.log("Reset complete: local MCP state and LightRAG documents cleared")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
