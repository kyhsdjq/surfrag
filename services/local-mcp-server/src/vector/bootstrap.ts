import path from "node:path"
import { mkdirSync } from "node:fs"

import { bootstrapLanceDB, type LanceDBClient } from "./lancedb.js"
import { getEmbeddingProvider, type EmbeddingProvider } from "../embedding/index.js"

const DEFAULT_VECTOR_DB_PATH = "./data/lancedb"

/** VECTOR_DB_ENABLED defaults to false when unset (LightRAG is primary). Explicit true/1/yes/on enables. */
export function isVectorDbEnabled(): boolean {
  const v = process.env.VECTOR_DB_ENABLED?.toLowerCase().trim()
  if (v === undefined || v === "") return false
  return ["true", "1", "yes", "on"].includes(v)
}

export type VectorBootstrapResult = {
  lanceClient: LanceDBClient
  embedProvider: EmbeddingProvider
}

/** Whether vector indexing can be bootstrapped (requires VECTOR_DB_ENABLED and EMBED_API). */
export function canBootstrapVectorIndexing(): boolean {
  if (!isVectorDbEnabled()) return false
  const apiKey = process.env.EMBED_API?.trim()
  return !!apiKey
}

export type BootstrapOptions = {
  /** Base path for resolving relative VECTOR_DB_PATH. Use when cwd may be wrong (e.g. MCP run by Cursor). */
  basePath?: string
}

/**
 * Bootstrap LanceDB and embedding provider when env is configured.
 * Returns null if VECTOR_DB_ENABLED is false, EMBED_API is missing, or bootstrap fails.
 */
export async function bootstrapVectorIfEnabled(
  options?: BootstrapOptions
): Promise<VectorBootstrapResult | null> {
  if (!canBootstrapVectorIndexing()) {
    return null
  }

  try {
    const vectorPath =
      process.env.VECTOR_DB_PATH?.trim() || DEFAULT_VECTOR_DB_PATH
    const base = options?.basePath ?? process.cwd()
    const resolvedPath = path.resolve(base, vectorPath)
    mkdirSync(resolvedPath, { recursive: true })

    const embedProvider = getEmbeddingProvider()
    const lanceClient = await bootstrapLanceDB({
      path: resolvedPath,
      tableName: "capture_vectors",
      dimension: embedProvider.dimension
    })

    return { lanceClient, embedProvider }
  } catch (err) {
    console.error(
      "[surfrag-mcp] Vector bootstrap failed:",
      err instanceof Error ? err.message : err
    )
    return null
  }
}
