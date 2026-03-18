import { wholePageChunker } from "./whole-page.js"
import type { ChunkingStrategy } from "./types.js"

export type ChunkingEnv = {
  CHUNK_STRATEGY?: string
}

/**
 * Returns the chunking strategy based on env config.
 * Phase 2.2: whole-page only; fixed-size, recursive, etc. can be added later.
 */
export function getChunkingStrategy(
  env: ChunkingEnv = process.env
): ChunkingStrategy {
  const strategy = (env.CHUNK_STRATEGY ?? "whole-page").toLowerCase()

  switch (strategy) {
    case "whole-page":
      return wholePageChunker
    default:
      throw new Error(
        `Unknown CHUNK_STRATEGY: ${strategy}. Supported: whole-page`
      )
  }
}
