/** A single chunk of text ready for embedding. */
export type TextChunk = {
  text: string
  /** 0-based position within the page (for ordering, snippet display). */
  index: number
}

/** Chunking strategy: splits body text into embeddable chunks. */
export interface ChunkingStrategy {
  /** Split body text into chunks. Never returns empty array. */
  chunk(bodyText: string): TextChunk[]

  /** Strategy name (e.g. "whole-page", "fixed-512"). */
  readonly name: string
}
