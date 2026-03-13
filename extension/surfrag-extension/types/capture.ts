export const PAGE_CAPTURES_STORAGE_KEY = "surfrag:page-captures"
export const PAGE_CAPTURES_SYNC_QUEUE_KEY = "surfrag:page-captures-sync-queue"
export const SYNC_API_BASE_URL_STORAGE_KEY = "surfrag:sync-api-base-url"
export const DEFAULT_SYNC_API_BASE_URL = "http://localhost:3030"
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
