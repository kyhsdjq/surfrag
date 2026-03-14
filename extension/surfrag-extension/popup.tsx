import { useEffect, useState } from "react"

import {
  DEFAULT_SYNC_API_BASE_URL,
  PAGE_CAPTURES_STORAGE_KEY,
  PAGE_CAPTURES_SYNC_QUEUE_KEY,
  SYNC_API_BASE_URL_STORAGE_KEY,
  type CaptureSyncQueueItem,
  type PageCaptureRecord
} from "~types/capture"

const bodyPreview = (value: string, maxLength = 280) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value

function IndexPopup() {
  const [latestCapture, setLatestCapture] = useState<PageCaptureRecord | null>(null)
  const [queueLength, setQueueLength] = useState(0)
  const [lastSyncError, setLastSyncError] = useState("")
  const [syncApiBaseUrl, setSyncApiBaseUrl] = useState(DEFAULT_SYNC_API_BASE_URL)
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle")

  useEffect(() => {
    const loadPopupState = () => {
      chrome.storage.local.get(
        [PAGE_CAPTURES_STORAGE_KEY, PAGE_CAPTURES_SYNC_QUEUE_KEY, SYNC_API_BASE_URL_STORAGE_KEY],
        (result) => {
          const captures =
            (result[PAGE_CAPTURES_STORAGE_KEY] as PageCaptureRecord[] | undefined) || []
          const queue =
            (result[PAGE_CAPTURES_SYNC_QUEUE_KEY] as CaptureSyncQueueItem[] | undefined) || []
          const recentErrorItem = queue.find((item) => item.lastError.trim().length > 0)
          const configuredBaseUrl =
            (result[SYNC_API_BASE_URL_STORAGE_KEY] as string | undefined) ||
            DEFAULT_SYNC_API_BASE_URL

          setLatestCapture(captures[0] || null)
          setQueueLength(queue.length)
          setLastSyncError(recentErrorItem?.lastError || "")
          setSyncApiBaseUrl(configuredBaseUrl)
        }
      )
    }

    const onStorageChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
      changes,
      areaName
    ) => {
      if (areaName !== "local") {
        return
      }

      if (
        changes[PAGE_CAPTURES_STORAGE_KEY] ||
        changes[PAGE_CAPTURES_SYNC_QUEUE_KEY] ||
        changes[SYNC_API_BASE_URL_STORAGE_KEY]
      ) {
        loadPopupState()
      }
    }

    loadPopupState()
    chrome.storage.onChanged.addListener(onStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(onStorageChange)
    }
  }, [])

  const onSaveSyncApiBaseUrl = () => {
    const normalized = syncApiBaseUrl.trim()

    if (!normalized) {
      setSaveState("error")
      return
    }

    try {
      // Basic validation so accidental malformed URLs are rejected early.
      // More strict constraints can be added later if needed.
      new URL(normalized)
    } catch {
      setSaveState("error")
      return
    }

    chrome.storage.local.set({ [SYNC_API_BASE_URL_STORAGE_KEY]: normalized }, () => {
      if (chrome.runtime.lastError) {
        setSaveState("error")
        return
      }

      setSaveState("saved")
      window.setTimeout(() => setSaveState("idle"), 1500)
    })
  }

  return (
    <div
      style={{
        padding: 16,
        width: 360,
        fontFamily: "Arial, sans-serif"
      }}>
      <h2 style={{ marginTop: 0 }}>SurfRAG Capture Status</h2>
      <div
        style={{
          marginBottom: 12,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: 10
        }}>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong>Local API Base URL</strong>
        </p>
        <input
          value={syncApiBaseUrl}
          onChange={(event) => {
            setSyncApiBaseUrl(event.target.value)
            setSaveState("idle")
          }}
          placeholder={DEFAULT_SYNC_API_BASE_URL}
          style={{
            width: "100%",
            boxSizing: "border-box",
            marginBottom: 8
          }}
        />
        <button onClick={onSaveSyncApiBaseUrl} style={{ width: "100%" }}>
          Save API URL
        </button>
        <p style={{ margin: "8px 0 0", color: saveState === "error" ? "#b91c1c" : "#166534" }}>
          {saveState === "error"
            ? "Invalid URL. Example: http://localhost:3030"
            : saveState === "saved"
              ? "Saved."
              : "Default: http://localhost:3030"}
        </p>
      </div>
      <div
        style={{
          marginBottom: 12,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: 10
        }}>
        <p style={{ margin: 0 }}>
          <strong>Sync Queue:</strong> {queueLength}
        </p>
        <p style={{ margin: "6px 0 0" }}>
          <strong>Last Sync Error:</strong> {lastSyncError || "(none)"}
        </p>
        {queueLength > 0 && (
          <button
            onClick={() => {
              chrome.storage.local.remove(PAGE_CAPTURES_SYNC_QUEUE_KEY, () => {
                if (chrome.runtime.lastError) {
                  console.error("Failed to clear queue:", chrome.runtime.lastError)
                }
              })
            }}
            style={{ marginTop: 8, width: "100%" }}>
            Clear Sync Queue
          </button>
        )}
      </div>

      {!latestCapture ? (
        <p style={{ marginBottom: 0 }}>
          No captured pages yet. Open any webpage and scroll to generate a capture.
        </p>
      ) : (
        <div>
          <p style={{ marginTop: 0, marginBottom: 8 }}>
            <strong>Title:</strong> {latestCapture.title}
          </p>
          <p style={{ margin: "8px 0" }}>
            <strong>URL:</strong> {latestCapture.url}
          </p>
          <p style={{ margin: "8px 0" }}>
            <strong>Referrer:</strong> {latestCapture.referrer || "(none)"}
          </p>
          <p style={{ margin: "8px 0" }}>
            <strong>Max Scroll:</strong> {latestCapture.maxScrollPercentage.toFixed(2)}%
          </p>
          <p style={{ margin: "8px 0" }}>
            <strong>Updated:</strong> {new Date(latestCapture.updatedAt).toLocaleString()}
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Body Preview:</strong> {bodyPreview(latestCapture.bodyText)}
          </p>
        </div>
      )}
    </div>
  )
}

export default IndexPopup
