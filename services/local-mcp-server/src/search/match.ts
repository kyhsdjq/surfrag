import type { CaptureRecord } from "../schema/capture.js"

export const MAX_SNIPPET_LENGTH = 220

/**
 * Build a snippet from body text.
 * - If keyword is provided: returns excerpt centered on keyword match (or first N chars if no match).
 * - If keyword is empty/undefined: returns first N chars (excerpt for vector search).
 */
export function buildSnippet(bodyText: string, keyword?: string): string {
  const normalized = bodyText.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return ""
  }

  const lowerKeyword = keyword?.trim().toLowerCase()
  if (!lowerKeyword) {
    return normalized.slice(0, MAX_SNIPPET_LENGTH)
  }

  const lowerText = normalized.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerKeyword)

  if (matchIndex === -1) {
    return normalized.slice(0, MAX_SNIPPET_LENGTH)
  }

  const start = Math.max(0, matchIndex - Math.floor(MAX_SNIPPET_LENGTH / 3))
  const end = Math.min(normalized.length, start + MAX_SNIPPET_LENGTH)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < normalized.length ? "..." : ""

  return `${prefix}${normalized.slice(start, end)}${suffix}`
}

/** Common match shape for search_captures and vector_search. */
export type SearchMatch = {
  id: string
  pageId: string
  title: string
  url: string
  capturedAt: string
  snippet: string
  keywordCount?: number
  distance?: number
}

export type BuildSearchMatchOptions = {
  snippet: string
  keywordCount?: number
  distance?: number
}

/**
 * Build a SearchMatch from a capture record.
 * Shared by search_captures (keyword) and vector_search (semantic).
 */
export function buildSearchMatch(
  capture: CaptureRecord,
  options: BuildSearchMatchOptions
): SearchMatch {
  const { snippet, keywordCount, distance } = options
  return {
    id: capture.id,
    pageId: capture.pageId,
    title: capture.title,
    url: capture.url,
    capturedAt: capture.capturedAt,
    snippet,
    ...(keywordCount !== undefined && { keywordCount }),
    ...(distance !== undefined && { distance })
  }
}
