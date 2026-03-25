import { Readability } from "@mozilla/readability"

import {
  AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY,
  BLOCKLIST_STORAGE_KEY,
  CONTENT_GET_DOCUMENT_CAPTURE_STATE,
  CONTENT_TRIGGER_BOOKMARK_CAPTURE,
  CONTENT_TRIGGER_MANUAL_CAPTURE,
  DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES,
  DEFAULT_BLOCKLIST_PATTERNS,
  MAX_AUTO_CAPTURE_ACTIVE_MINUTES,
  MAX_CAPTURE_HISTORY,
  MAX_SYNC_QUEUE_SIZE,
  MIN_AUTO_CAPTURE_ACTIVE_MINUTES,
  PAGE_CAPTURES_SYNC_QUEUE_KEY,
  PAGE_CAPTURES_STORAGE_KEY,
  SYNC_CAPTURE_MESSAGE_TYPE,
  type CaptureSyncPayload,
  type CaptureSyncQueueItem,
  type ContentCaptureTriggerResponse,
  type DocumentCaptureStateResponse,
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
const ACTIVE_TICK_MS = 1_000

let activeThresholdMs = DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES * 60_000

const pageId = `${window.location.href}::${performance.timeOrigin}`
let maxScrollPercentage = 0
let lastSavedScrollPercentage = -1
let didSaveAtLeastOnce = false
let isSyncInProgress = false

let cachedPatterns: string[] = [...DEFAULT_BLOCKLIST_PATTERNS]
let captureEnabled = false
let activeMs = 0
let saveIntervalId: number | null = null
/** True after the first successful local write for this document (`pageId`). Resets on navigation. */
let documentCommittedCapture = false

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

const loadAutoCaptureThresholdMs = () =>
  new Promise<number>((resolve) => {
    chrome.storage.local.get([AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY], (result) => {
      const raw = result[AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY]
      const minutes =
        typeof raw === "number" && Number.isFinite(raw)
          ? clamp(
              Math.round(raw),
              MIN_AUTO_CAPTURE_ACTIVE_MINUTES,
              MAX_AUTO_CAPTURE_ACTIVE_MINUTES
            )
          : DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES
      resolve(minutes * 60_000)
    })
  })

const loadBlocklist = () =>
  new Promise<string[]>((resolve) => {
    chrome.storage.local.get([BLOCKLIST_STORAGE_KEY], (result) => {
      const raw = result[BLOCKLIST_STORAGE_KEY] as string[] | undefined
      if (Array.isArray(raw) && raw.length > 0) {
        resolve(raw.map((s) => String(s).trim()).filter(Boolean))
      } else {
        resolve([...DEFAULT_BLOCKLIST_PATTERNS])
      }
    })
  })

const urlMatchesBlocklist = (url: string, patterns: string[]) => {
  const u = url.toLowerCase()
  for (const p of patterns) {
    const t = String(p).trim().toLowerCase()
    if (t && u.includes(t)) {
      return true
    }
  }
  return false
}

const isCurrentUrlBlocked = () => urlMatchesBlocklist(window.location.href, cachedPatterns)

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
    // Add a timeout so we don't get stuck forever if the background script hangs
    const timeoutId = setTimeout(() => {
      reject(new Error("Timeout waiting for background script response"))
    }, 15000)

    chrome.runtime.sendMessage(
      {
        type: SYNC_CAPTURE_MESSAGE_TYPE,
        payload: toSyncPayload(record)
      },
      (result: SyncCaptureResponse | undefined) => {
        clearTimeout(timeoutId)
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

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]
      if (item.nextRetryAt > now) {
        nextQueue.push(item)
        continue
      }

      try {
        await sendCaptureToLocalApi(item.capture)
        // If successful, we don't push it to nextQueue
      } catch (error) {
        const attempts = item.attempts + 1
        const message = error instanceof Error ? error.message : "Unknown sync error"

        nextQueue.push({
          capture: item.capture,
          attempts,
          nextRetryAt: Date.now() + backoffDelayMs(attempts),
          lastError: message
        })

        // Keep the rest of the queue intact for future flushes
        for (let j = i + 1; j < queue.length; j++) {
          nextQueue.push(queue[j])
        }
        break
      }
    }

    await writeSyncQueue(nextQueue.slice(0, MAX_SYNC_QUEUE_SIZE))
  } finally {
    isSyncInProgress = false
  }
}

const stopPeriodicSave = () => {
  if (saveIntervalId !== null) {
    clearInterval(saveIntervalId)
    saveIntervalId = null
  }
}

const startPeriodicSave = () => {
  if (saveIntervalId !== null || isCurrentUrlBlocked()) {
    return
  }

  saveIntervalId = window.setInterval(() => {
    void upsertCapture()
  }, SAVE_INTERVAL_MS)
}

const enableCapturePipeline = () => {
  if (isCurrentUrlBlocked()) {
    return
  }

  captureEnabled = true
  startPeriodicSave()
}

const upsertCapture = async (options?: { force?: boolean }) => {
  if (isCurrentUrlBlocked()) {
    return
  }

  maxScrollPercentage = Math.max(maxScrollPercentage, getCurrentScrollPercentage())

  if (!options?.force && didSaveAtLeastOnce) {
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
  documentCommittedCapture = true
  await flushSyncQueue()
  lastSavedScrollPercentage = maxScrollPercentage
  didSaveAtLeastOnce = true
}

const onScroll = () => {
  maxScrollPercentage = Math.max(maxScrollPercentage, getCurrentScrollPercentage())
}

const shouldCountActiveEngagement = () =>
  document.visibilityState === "visible" && document.hasFocus()

const tickActiveEngagement = () => {
  if (isCurrentUrlBlocked() || captureEnabled) {
    return
  }

  if (shouldCountActiveEngagement()) {
    activeMs += ACTIVE_TICK_MS
    if (activeMs >= activeThresholdMs) {
      enableCapturePipeline()
      void upsertCapture({ force: true })
    }
  }
}

const onBlocklistMaybeChanged = () => {
  if (isCurrentUrlBlocked()) {
    stopPeriodicSave()
  } else if (captureEnabled) {
    startPeriodicSave()
  }
}

const runForcedCapture = async (): Promise<ContentCaptureTriggerResponse> => {
  if (documentCommittedCapture) {
    return {
      ok: false,
      error: "Already captured in this tab. Reload the page to capture again."
    }
  }

  if (isCurrentUrlBlocked()) {
    return { ok: false, error: "This URL matches your blocklist." }
  }

  enableCapturePipeline()
  try {
    await upsertCapture({ force: true })
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Capture failed"
    return { ok: false, error: message }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return
  }

  const type = (message as { type: string }).type

  if (type === CONTENT_GET_DOCUMENT_CAPTURE_STATE) {
    sendResponse({
      ok: true,
      captured: documentCommittedCapture
    } satisfies DocumentCaptureStateResponse)
    return
  }

  if (type === CONTENT_TRIGGER_MANUAL_CAPTURE || type === CONTENT_TRIGGER_BOOKMARK_CAPTURE) {
    void runForcedCapture().then(sendResponse)
    return true
  }

  return
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return
  }

  if (changes[BLOCKLIST_STORAGE_KEY]) {
    const next = changes[BLOCKLIST_STORAGE_KEY].newValue as string[] | undefined
    cachedPatterns =
      Array.isArray(next) && next.length > 0
        ? next.map((s) => String(s).trim()).filter(Boolean)
        : [...DEFAULT_BLOCKLIST_PATTERNS]

    onBlocklistMaybeChanged()
  }

  if (changes[AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY]) {
    const newVal = changes[AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY].newValue
    const minutes =
      typeof newVal === "number" && Number.isFinite(newVal)
        ? clamp(
            Math.round(newVal),
            MIN_AUTO_CAPTURE_ACTIVE_MINUTES,
            MAX_AUTO_CAPTURE_ACTIVE_MINUTES
          )
        : DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES
    activeThresholdMs = minutes * 60_000

    if (!captureEnabled && !isCurrentUrlBlocked() && activeMs >= activeThresholdMs) {
      enableCapturePipeline()
      void upsertCapture({ force: true })
    }
  }
})

window.addEventListener("scroll", onScroll, { passive: true })
window.addEventListener("beforeunload", () => {
  if (captureEnabled && !isCurrentUrlBlocked()) {
    void upsertCapture()
  }
})
window.addEventListener("pagehide", () => {
  if (captureEnabled && !isCurrentUrlBlocked()) {
    void upsertCapture()
  }
})
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && captureEnabled && !isCurrentUrlBlocked()) {
    void upsertCapture()
  }
})
window.addEventListener("online", () => {
  void flushSyncQueue()
})

window.setInterval(() => {
  tickActiveEngagement()
}, ACTIVE_TICK_MS)

window.setInterval(() => {
  void flushSyncQueue()
}, SYNC_INTERVAL_MS)

void (async () => {
  cachedPatterns = await loadBlocklist()
  activeThresholdMs = await loadAutoCaptureThresholdMs()
  onBlocklistMaybeChanged()
})()
