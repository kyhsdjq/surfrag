import type { ChunkingStrategy } from "./types.js"

/**
 * Whole-page chunker: one chunk per capture.
 * Phase 2.2 default; chunk_index is always 0.
 */
export const wholePageChunker: ChunkingStrategy = {
  name: "whole-page",

  chunk(bodyText: string) {
    const text = bodyText.trim()
    if (!text) {
      return [{ text: "(empty)", index: 0 }]
    }
    return [{ text, index: 0 }]
  }
}
