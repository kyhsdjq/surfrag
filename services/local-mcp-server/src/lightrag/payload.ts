import type { CaptureRecord } from "../schema/capture.js"

export type LightRAGDocumentSource = Pick<
  CaptureRecord,
  "title" | "url" | "capturedAt" | "bodyText"
>

export type LightRAGTextRequestPayload = {
  text: string
  file_source: string
}

export function buildLightRAGHeaders(
  apiKey?: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  }

  if (apiKey?.trim()) {
    headers["X-API-Key"] = apiKey.trim()
  }

  return headers
}

/**
 * Match the text format that MCP sync sends to LightRAG.
 */
export function buildLightRAGDocumentText(
  capture: LightRAGDocumentSource
): string {
  return [
    `Title: ${capture.title}`,
    `URL: ${capture.url}`,
    `Captured: ${capture.capturedAt}`,
    "",
    capture.bodyText
  ].join("\n")
}

export function buildLightRAGTextRequestPayload(
  capture: LightRAGDocumentSource,
  fileSource: string
): LightRAGTextRequestPayload {
  return {
    text: buildLightRAGDocumentText(capture),
    file_source: fileSource
  }
}
