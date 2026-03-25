export const PAGE_CAPTURES_STORAGE_KEY = "surfrag:page-captures"
export const PAGE_CAPTURES_SYNC_QUEUE_KEY = "surfrag:page-captures-sync-queue"
export const SYNC_API_BASE_URL_STORAGE_KEY = "surfrag:sync-api-base-url"
export const BLOCKLIST_STORAGE_KEY = "surfrag:url-blocklist-patterns"
export const BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY = "surfrag:bookmark-capture-enabled"
/** Cumulative active focus time before auto-capture starts (minutes). */
export const AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY = "surfrag:auto-capture-active-minutes"
export const DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES = 5
export const MIN_AUTO_CAPTURE_ACTIVE_MINUTES = 1
export const MAX_AUTO_CAPTURE_ACTIVE_MINUTES = 120
export const DEFAULT_SYNC_API_BASE_URL = "http://localhost:3030"

/** Substring patterns matched case-insensitively against the full page URL. */
export const DEFAULT_BLOCKLIST_PATTERNS: string[] = [
  "google.com/search",
  "mail.google.com",
  "localhost"
]

export const CONTENT_TRIGGER_MANUAL_CAPTURE = "surfrag:manual-capture"
export const CONTENT_TRIGGER_BOOKMARK_CAPTURE = "surfrag:bookmark-capture"
export const CONTENT_GET_DOCUMENT_CAPTURE_STATE = "surfrag:get-document-capture-state"

export type ContentCaptureTriggerMessage =
  | { type: typeof CONTENT_TRIGGER_MANUAL_CAPTURE }
  | { type: typeof CONTENT_TRIGGER_BOOKMARK_CAPTURE }

export type ContentCaptureTriggerResponse =
  | { ok: true }
  | { ok: false; error: string }

export type DocumentCaptureStateMessage = { type: typeof CONTENT_GET_DOCUMENT_CAPTURE_STATE }

export type DocumentCaptureStateResponse =
  | { ok: true; captured: boolean }
  | { ok: false; error: string }
export const MAX_CAPTURE_HISTORY = 100
export const MAX_SYNC_QUEUE_SIZE = 500
export const SYNC_CAPTURE_MESSAGE_TYPE = "surfrag:sync-capture"

export type PageCaptureRecord = {
  id: string
  title: string
  url: string
  referrer: string
  bodyText: string
  maxScrollPercentage: number
  createdAt: string
  updatedAt: string
}

export type CaptureSyncQueueItem = {
  capture: PageCaptureRecord
  attempts: number
  nextRetryAt: number
  lastError: string
}

export type CaptureSyncPayload = {
  pageId: string
  title: string
  url: string
  referrer: string
  bodyText: string
  maxScrollPercentage: number
  capturedAt: string
  sourceSession: string
}

export type SyncCaptureMessage = {
  type: typeof SYNC_CAPTURE_MESSAGE_TYPE
  payload: CaptureSyncPayload
}

export type SyncCaptureResponse =
  | { ok: true }
  | {
      ok: false
      error: string
    }
