import path from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"

import { bootstrapSqlite, type SqliteBootstrapResult } from "../db/sqlite.js"
import {
  bootstrapVectorIfEnabled,
  type VectorBootstrapResult
} from "../vector/bootstrap.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PACKAGE_ROOT = path.resolve(__dirname, "../..")

let envLoaded = false
let runtimePromise: Promise<SurfRagMcpRuntime> | null = null

function parseBoolEnv(value: string | undefined): boolean {
  const v = value?.toLowerCase().trim()
  return v === "true" || v === "1" || v === "yes" || v === "on"
}

export type SurfRagMcpRuntime = {
  db: SqliteBootstrapResult["db"]
  dbPath: string
  vectorBootstrap: VectorBootstrapResult | null
  lightragQueryEnabled: boolean
  lightragUrl: string
  lightragApiKey: string | null
  searchCapturesEnabled: boolean
  vectorSearchEnabled: boolean
}

export function ensureMcpEnvLoaded() {
  if (envLoaded) {
    return
  }

  loadDotenv({ path: path.join(PACKAGE_ROOT, ".env") })
  envLoaded = true
}

export async function getSurfRagMcpRuntime(): Promise<SurfRagMcpRuntime> {
  ensureMcpEnvLoaded()

  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { db, dbPath } = bootstrapSqlite()
      const vectorBootstrap = await bootstrapVectorIfEnabled({
        basePath: PACKAGE_ROOT
      })

      const lightragQueryEnabled =
        process.env.LIGHTRAG_QUERY_ENABLED === undefined ||
        (process.env.LIGHTRAG_QUERY_ENABLED ?? "").trim() === ""
          ? true
          : parseBoolEnv(process.env.LIGHTRAG_QUERY_ENABLED)

      const searchCapturesEnabled =
        process.env.SEARCH_CAPTURES_ENABLED === undefined ||
        (process.env.SEARCH_CAPTURES_ENABLED ?? "").trim() === ""
          ? false
          : parseBoolEnv(process.env.SEARCH_CAPTURES_ENABLED)

      return {
        db,
        dbPath,
        vectorBootstrap,
        lightragQueryEnabled,
        lightragUrl: process.env.LIGHTRAG_URL?.trim() || "http://localhost:9621",
        lightragApiKey: process.env.LIGHTRAG_API_KEY?.trim() || null,
        searchCapturesEnabled,
        vectorSearchEnabled: parseBoolEnv(process.env.VECTOR_SEARCH_ENABLED)
      }
    })()
  }

  return runtimePromise
}
