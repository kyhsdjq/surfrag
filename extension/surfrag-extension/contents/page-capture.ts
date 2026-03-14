import { Readability } from "@mozilla/readability"

import {
  MAX_CAPTURE_HISTORY,
  MAX_SYNC_QUEUE_SIZE,
  PAGE_CAPTURES_SYNC_QUEUE_KEY,
  PAGE_CAPTURES_STORAGE_KEY,
  SYNC_CAPTURE_MESSAGE_TYPE,
  type CaptureSyncPayload,
  type CaptureSyncQueueItem,
  type PageCaptureRecord,
  type SyncCaptureResponse
} from "~types/capture"

export const config = {
  matches: ["<all_urls>"],
  run_at: "document_idle"
}

const READABLE_TEXT_MAX_LENGTH = 100_000
const SAVE_INTERVAL_MS = 15_000
const SCROLL_SAVE_DELTA_PERCENT = 5
const SYNC_INTERVAL_MS = 10_000
const SYNC_BASE_DELAY_MS = 1_000
const SYNC_MAX_DELAY_MS = 5 * 60_000
const SYNC_SOURCE_SESSION = "extension-content-script"

const pageId = `${window.location.href}::${performance.timeOrigin}`
let maxScrollPercentage = 0
let lastSavedScrollPercentage = -1
let didSaveAtLeastOnce = false
let isSyncInProgress = false

const safeNumber = (value: number) => (Number.isFinite(value) ? value : 0)

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const getCurrentScrollPercentage = () => {
  const root = document.documentElement
  const scrollableHeight = root.scrollHeight - window.innerHeight

  if (scrollableHeight <= 0) {
    return 100
  }

  const percentage = (window.scrollY / scrollableHeight) * 100
  return clamp(safeNumber(percentage), 0, 100)
}

const getMainBodyText = () => {
  try {
    const clone = document.cloneNode(true) as Document
    const article = new Readability(clone).parse()
    const source = article?.textContent?.trim() || document.body?.innerText?.trim() || ""
    return source.slice(0, READABLE_TEXT_MAX_LENGTH)
  } catch {
    return (document.body?.innerText || "").trim().slice(0, READABLE_TEXT_MAX_LENGTH)
  }
}

const readStorage = () =>
  new Promise<PageCaptureRecord[]>((resolve) => {
    chrome.storage.local.get([PAGE_CAPTURES_STORAGE_KEY], (result) => {
      resolve((result[PAGE_CAPTURES_STORAGE_KEY] as PageCaptureRecord[] | undefined) || [])
    })
  })

const writeStorage = (captures: PageCaptureRecord[]) =>
  new Promise<void>((resolve) => {
    chrome.storage.local.set({ [PAGE_CAPTURES_STORAGE_KEY]: captures }, () => resolve())
  })

const readSyncQueue = () =>
  new Promise<CaptureSyncQueueItem[]>((resolve) => {
    chrome.storage.local.get([PAGE_CAPTURES_SYNC_QUEUE_KEY], (result) => {
      resolve(
        (result[PAGE_CAPTURES_SYNC_QUEUE_KEY] as CaptureSyncQueueItem[] | undefined) || []
      )
    })
  })

const writeSyncQueue = (queue: CaptureSyncQueueItem[]) =>
  new Promise<void>((resolve) => {
    chrome.storage.local.set({ [PAGE_CAPTURES_SYNC_QUEUE_KEY]: queue }, () => resolve())
  })

const backoffDelayMs = (attempts: number) => {
  const rawDelay = SYNC_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1)
  return Math.min(rawDelay, SYNC_MAX_DELAY_MS)
}

const toSyncPayload = (record: PageCaptureRecord): CaptureSyncPayload => ({
  pageId: record.id,
  title: record.title,
  url: record.url,
  referrer: record.referrer,
  bodyText: record.bodyText,
  maxScrollPercentage: record.maxScrollPercentage,
  capturedAt: record.updatedAt,
  sourceSession: SYNC_SOURCE_SESSION
})

const sendCaptureToLocalApi = async (record: PageCaptureRecord) => {
  const response = await new Promise<SyncCaptureResponse>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: SYNC_CAPTURE_MESSAGE_TYPE,
        payload: toSyncPayload(record)
      },
      (result: SyncCaptureResponse | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        if (!result) {
          reject(new Error("No response from extension background"))
          return
        }

        resolve(result)
      }
    )
  })

  if (!response.ok) {
    throw new Error(response.error || "Unknown sync error")
  }
}

const enqueueCaptureForSync = async (record: PageCaptureRecord) => {
  const queue = await readSyncQueue()
  const existingIndex = queue.findIndex((item) => item.capture.id === record.id)
  const baseItem: CaptureSyncQueueItem = {
    capture: record,
    attempts: 0,
    nextRetryAt: Date.now(),
    lastError: ""
  }

  if (existingIndex >= 0) {
    const previous = queue[existingIndex]
    queue[existingIndex] = {
      capture: record,
      attempts: previous.attempts,
      nextRetryAt: Math.min(previous.nextRetryAt, Date.now()),
      lastError: previous.lastError
    }
  } else {
    queue.unshift(baseItem)
  }

  await writeSyncQueue(queue.slice(0, MAX_SYNC_QUEUE_SIZE))
}

const flushSyncQueue = async () => {
  if (isSyncInProgress) {
    return
  }

  isSyncInProgress = true

  try {
    const queue = await readSyncQueue()
    if (queue.length === 0) {
      return
    }

    const now = Date.now()
    const nextQueue: CaptureSyncQueueItem[] = []

    for (const item of queue) {
      if (item.nextRetryAt > now) {
        nextQueue.push(item)
        continue
      }

      try {
        await sendCaptureToLocalApi(item.capture)
      } catch (error) {
        const attempts = item.attempts + 1
        const message = error instanceof Error ? error.message : "Unknown sync error"

        nextQueue.push({
          capture: item.capture,
          attempts,
          nextRetryAt: Date.now() + backoffDelayMs(attempts),
          lastError: message
        })

        // Endpoint is usually shared; stop this flush cycle after first sync failure.
        break
      }
    }

    await writeSyncQueue(nextQueue.slice(0, MAX_SYNC_QUEUE_SIZE))
  } finally {
    isSyncInProgress = false
  }
}

const upsertCapture = async () => {
  maxScrollPercentage = Math.max(maxScrollPercentage, getCurrentScrollPercentage())

  if (didSaveAtLeastOnce) {
    const delta = Math.abs(maxScrollPercentage - lastSavedScrollPercentage)
    if (delta < SCROLL_SAVE_DELTA_PERCENT) {
      return
    }
  }

  const now = new Date().toISOString()
  const record: PageCaptureRecord = {
    id: pageId,
    title: document.title || "Untitled page",
    url: window.location.href,
    referrer: document.referrer || "",
    bodyText: getMainBodyText(),
    maxScrollPercentage: Math.round(maxScrollPercentage * 100) / 100,
    createdAt: now,
    updatedAt: now
  }

  const captures = await readStorage()
  const existingIndex = captures.findIndex((capture) => capture.id === pageId)

  if (existingIndex >= 0) {
    record.createdAt = captures[existingIndex].createdAt
    captures[existingIndex] = record
  } else {
    captures.unshift(record)
  }

  await writeStorage(captures.slice(0, MAX_CAPTURE_HISTORY))
  await enqueueCaptureForSync(record)
  await flushSyncQueue()
  lastSavedScrollPercentage = maxScrollPercentage
  didSaveAtLeastOnce = true
}

const onScroll = () => {
  maxScrollPercentage = Math.max(maxScrollPercentage, getCurrentScrollPercentage())
}

window.addEventListener("scroll", onScroll, { passive: true })
window.addEventListener("beforeunload", () => {
  void upsertCapture()
})
window.addEventListener("pagehide", () => {
  void upsertCapture()
})
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void upsertCapture()
  }
})
window.addEventListener("online", () => {
  void flushSyncQueue()
})

setInterval(() => {
  void upsertCapture()
}, SAVE_INTERVAL_MS)
setInterval(() => {
  void flushSyncQueue()
}, SYNC_INTERVAL_MS)

void upsertCapture()
