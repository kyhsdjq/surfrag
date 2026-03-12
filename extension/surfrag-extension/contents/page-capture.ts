import { Readability } from "@mozilla/readability"

import {
  MAX_CAPTURE_HISTORY,
  PAGE_CAPTURES_STORAGE_KEY,
  type PageCaptureRecord
} from "~types/capture"

export const config = {
  matches: ["<all_urls>"],
  run_at: "document_idle"
}

const READABLE_TEXT_MAX_LENGTH = 100_000
const SAVE_INTERVAL_MS = 15_000
const SCROLL_SAVE_DELTA_PERCENT = 5

const pageId = `${window.location.href}::${performance.timeOrigin}`
let maxScrollPercentage = 0
let lastSavedScrollPercentage = -1
let didSaveAtLeastOnce = false

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

setInterval(() => {
  void upsertCapture()
}, SAVE_INTERVAL_MS)

void upsertCapture()
