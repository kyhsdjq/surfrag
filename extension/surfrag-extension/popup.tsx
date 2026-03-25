import { useEffect, useState } from "react"

import {
  AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY,
  BLOCKLIST_STORAGE_KEY,
  BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY,
  CONTENT_GET_DOCUMENT_CAPTURE_STATE,
  CONTENT_TRIGGER_MANUAL_CAPTURE,
  DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES,
  DEFAULT_BLOCKLIST_PATTERNS,
  DEFAULT_SYNC_API_BASE_URL,
  MAX_AUTO_CAPTURE_ACTIVE_MINUTES,
  MIN_AUTO_CAPTURE_ACTIVE_MINUTES,
  PAGE_CAPTURES_STORAGE_KEY,
  PAGE_CAPTURES_SYNC_QUEUE_KEY,
  SYNC_API_BASE_URL_STORAGE_KEY,
  type CaptureSyncQueueItem,
  type ContentCaptureTriggerResponse,
  type DocumentCaptureStateResponse,
  type PageCaptureRecord
} from "~types/capture"

const bodyPreview = (value: string, maxLength = 280) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value

const patternsToText = (patterns: string[]) => patterns.join("\n")

type TabCaptureHint = "loading" | "captured" | "not_captured" | "unavailable"

type PopupView = "main" | "settings"

function IndexPopup() {
  const [view, setView] = useState<PopupView>("main")
  const [latestCapture, setLatestCapture] = useState<PageCaptureRecord | null>(null)
  const [queueLength, setQueueLength] = useState(0)
  const [lastSyncError, setLastSyncError] = useState("")
  const [syncApiBaseUrl, setSyncApiBaseUrl] = useState(DEFAULT_SYNC_API_BASE_URL)
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle")
  const [blocklistText, setBlocklistText] = useState(() => patternsToText(DEFAULT_BLOCKLIST_PATTERNS))
  const [blocklistSaveState, setBlocklistSaveState] = useState<"idle" | "saved" | "error">("idle")
  const [captureFeedback, setCaptureFeedback] = useState("")
  const [bookmarkCaptureEnabled, setBookmarkCaptureEnabled] = useState(true)
  const [tabCaptureHint, setTabCaptureHint] = useState<TabCaptureHint>("loading")
  const [autoCaptureMinutes, setAutoCaptureMinutes] = useState(DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES)
  const [autoMinutesSaveState, setAutoMinutesSaveState] = useState<"idle" | "saved" | "error">("idle")

  const loadTabCaptureHint = () => {
    setTabCaptureHint("loading")
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId === undefined) {
        setTabCaptureHint("unavailable")
        return
      }

      chrome.tabs.sendMessage(
        tabId,
        { type: CONTENT_GET_DOCUMENT_CAPTURE_STATE },
        (response: DocumentCaptureStateResponse | undefined) => {
          if (chrome.runtime.lastError) {
            console.error("loadTabCaptureHint error:", chrome.runtime.lastError)
            setTabCaptureHint("unavailable")
            return
          }

          if (!response || response.ok !== true) {
            console.warn("loadTabCaptureHint invalid response:", response)
            setTabCaptureHint("unavailable")
            return
          }

          setTabCaptureHint(response.captured ? "captured" : "not_captured")
        }
      )
    })
  }

  useEffect(() => {
    const loadCaptureStatus = () => {
      chrome.storage.local.get(
        [
          PAGE_CAPTURES_STORAGE_KEY,
          PAGE_CAPTURES_SYNC_QUEUE_KEY,
          SYNC_API_BASE_URL_STORAGE_KEY,
          BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY,
          AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY
        ],
        (result) => {
          const captures =
            (result[PAGE_CAPTURES_STORAGE_KEY] as PageCaptureRecord[] | undefined) || []
          const queue =
            (result[PAGE_CAPTURES_SYNC_QUEUE_KEY] as CaptureSyncQueueItem[] | undefined) || []
          const recentErrorItem = queue.find((item) => item.lastError.trim().length > 0)
          const configuredBaseUrl =
            (result[SYNC_API_BASE_URL_STORAGE_KEY] as string | undefined) ||
            DEFAULT_SYNC_API_BASE_URL

          const rawMinutes = result[AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY]
          const minutes =
            typeof rawMinutes === "number" &&
            Number.isFinite(rawMinutes) &&
            rawMinutes >= MIN_AUTO_CAPTURE_ACTIVE_MINUTES &&
            rawMinutes <= MAX_AUTO_CAPTURE_ACTIVE_MINUTES
              ? Math.round(rawMinutes)
              : DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES

          setLatestCapture(captures[0] || null)
          setQueueLength(queue.length)
          setLastSyncError(recentErrorItem?.lastError || "")
          setSyncApiBaseUrl(configuredBaseUrl)
          setBookmarkCaptureEnabled(result[BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY] !== false)
          setAutoCaptureMinutes(minutes)
        }
      )
    }

    const loadBlocklistFromStorage = () => {
      chrome.storage.local.get([BLOCKLIST_STORAGE_KEY], (result) => {
        const storedList = result[BLOCKLIST_STORAGE_KEY] as string[] | undefined
        const patterns =
          Array.isArray(storedList) && storedList.length > 0
            ? storedList.map((s) => String(s).trim()).filter(Boolean)
            : [...DEFAULT_BLOCKLIST_PATTERNS]

        setBlocklistText(patternsToText(patterns))
      })
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
        changes[SYNC_API_BASE_URL_STORAGE_KEY] ||
        changes[BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY] ||
        changes[AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY]
      ) {
        loadCaptureStatus()
      }

      if (changes[BLOCKLIST_STORAGE_KEY]) {
        loadBlocklistFromStorage()
      }

      if (changes[PAGE_CAPTURES_STORAGE_KEY]) {
        loadTabCaptureHint()
      }
    }

    loadCaptureStatus()
    loadBlocklistFromStorage()
    loadTabCaptureHint()
    chrome.storage.onChanged.addListener(onStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(onStorageChange)
    }
  }, [])

  const onSaveBlocklist = () => {
    const patterns = blocklistText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    if (patterns.length === 0) {
      setBlocklistSaveState("error")
      return
    }

    chrome.storage.local.set({ [BLOCKLIST_STORAGE_KEY]: patterns }, () => {
      if (chrome.runtime.lastError) {
        setBlocklistSaveState("error")
        return
      }

      setBlocklistSaveState("saved")
      window.setTimeout(() => setBlocklistSaveState("idle"), 1500)
    })
  }

  const onSaveAutoCaptureMinutes = () => {
    const n = Number(autoCaptureMinutes)

    if (
      !Number.isFinite(n) ||
      n < MIN_AUTO_CAPTURE_ACTIVE_MINUTES ||
      n > MAX_AUTO_CAPTURE_ACTIVE_MINUTES
    ) {
      setAutoMinutesSaveState("error")
      return
    }

    const rounded = Math.round(n)
    chrome.storage.local.set({ [AUTO_CAPTURE_ACTIVE_MINUTES_STORAGE_KEY]: rounded }, () => {
      if (chrome.runtime.lastError) {
        setAutoMinutesSaveState("error")
        return
      }

      setAutoCaptureMinutes(rounded)
      setAutoMinutesSaveState("saved")
      window.setTimeout(() => setAutoMinutesSaveState("idle"), 1500)
    })
  }

  const onCapturePage = () => {
    setCaptureFeedback("")

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId === undefined) {
        setCaptureFeedback("No active tab.")
        return
      }

      chrome.tabs.sendMessage(
        tabId,
        { type: CONTENT_TRIGGER_MANUAL_CAPTURE },
        (response: ContentCaptureTriggerResponse | undefined) => {
          if (chrome.runtime.lastError) {
            console.error("onCapturePage error:", chrome.runtime.lastError)
            setCaptureFeedback(
              chrome.runtime.lastError.message ||
                "Could not capture (restricted or unloaded page)."
            )
            return
          }

          if (!response?.ok) {
            setCaptureFeedback(response?.error || "Capture failed.")
            return
          }

          setCaptureFeedback("Captured.")
          loadTabCaptureHint()
          window.setTimeout(() => setCaptureFeedback(""), 2500)
        }
      )
    })
  }

  const onSaveSyncApiBaseUrl = () => {
    const normalized = syncApiBaseUrl.trim()

    if (!normalized) {
      setSaveState("error")
      return
    }

    try {
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

  const cardStyle = {
    marginBottom: 12,
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 10
  } as const

  const mainView = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 8
        }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>SurfRAG</h2>
        <button type="button" onClick={() => setView("settings")}>
          Settings
        </button>
      </div>

      <div style={cardStyle}>
        <p style={{ margin: "0 0 6px", fontSize: 11, color: "#94a3b8" }}>
          Shortcut: Ctrl+Shift+Y (Cmd+Shift+Y on Mac)
        </p>
        <button type="button" onClick={onCapturePage} style={{ width: "100%" }}>
          Capture this tab now
        </button>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#475569" }}>
          <strong>This tab:</strong>{" "}
          {tabCaptureHint === "loading"
            ? "…"
            : tabCaptureHint === "captured"
              ? "Already captured for this visit (reload to capture again)."
              : tabCaptureHint === "not_captured"
                ? "Not captured yet for this visit."
                : "Unavailable (restricted or no content script)."}
        </p>
        {captureFeedback ? (
          <p
            style={{
              margin: "8px 0 0",
              color: captureFeedback === "Captured." ? "#166534" : "#b91c1c",
              fontSize: 13
            }}>
            {captureFeedback}
          </p>
        ) : null}
      </div>

      <div style={cardStyle}>
        <p style={{ margin: "0 0 6px", fontSize: 12, color: "#64748b" }}>Latest capture</p>
        {latestCapture ? (
          <>
            <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13 }}>
              {latestCapture.title}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "#475569", lineHeight: 1.4 }}>
              {bodyPreview(latestCapture.bodyText)}
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>No local captures yet.</p>
        )}
      </div>
    </>
  )

  const settingsView = (
    <>
      <button type="button" onClick={() => setView("main")} style={{ marginBottom: 8 }}>
        ← Back
      </button>
      <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 17 }}>Settings</h2>

      <div style={cardStyle}>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong>Auto-capture after active focus</strong>
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748b" }}>
          Cumulative minutes with the tab visible and focused before auto-capture runs (default{" "}
          {DEFAULT_AUTO_CAPTURE_ACTIVE_MINUTES}). Range {MIN_AUTO_CAPTURE_ACTIVE_MINUTES}–
          {MAX_AUTO_CAPTURE_ACTIVE_MINUTES}.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <label htmlFor="auto-minutes" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
            Minutes
          </label>
          <input
            id="auto-minutes"
            type="number"
            min={MIN_AUTO_CAPTURE_ACTIVE_MINUTES}
            max={MAX_AUTO_CAPTURE_ACTIVE_MINUTES}
            value={autoCaptureMinutes}
            onChange={(event) => {
              setAutoCaptureMinutes(Number(event.target.value))
              setAutoMinutesSaveState("idle")
            }}
            style={{ width: 72, boxSizing: "border-box" }}
          />
          <button type="button" onClick={onSaveAutoCaptureMinutes}>
            Save
          </button>
        </div>
        <p
          style={{
            margin: 0,
            color: autoMinutesSaveState === "error" ? "#b91c1c" : "#166534",
            fontSize: 13
          }}>
          {autoMinutesSaveState === "error"
            ? `Enter ${MIN_AUTO_CAPTURE_ACTIVE_MINUTES}–${MAX_AUTO_CAPTURE_ACTIVE_MINUTES}.`
            : autoMinutesSaveState === "saved"
              ? "Saved. Open tabs pick up the new threshold from storage."
              : ""}
        </p>
      </div>

      <div style={cardStyle}>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong>Bookmark capture</strong>
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748b" }}>
          Manual or bookmark capture is only sent once per page visit unless you reload.
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 13,
            cursor: "pointer"
          }}>
          <input
            type="checkbox"
            checked={bookmarkCaptureEnabled}
            onChange={(event) => {
              const checked = event.target.checked
              setBookmarkCaptureEnabled(checked)
              chrome.storage.local.set({ [BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY]: checked })
            }}
            style={{ marginTop: 2 }}
          />
          <span>Capture when bookmarking this tab&apos;s URL</span>
        </label>
      </div>

      <div style={cardStyle}>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong>URL blocklist</strong>
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#64748b" }}>
          One substring per line (matched against the full URL, case-insensitive). No capture or
          time tracking on matching pages.
        </p>
        <textarea
          value={blocklistText}
          onChange={(event) => {
            setBlocklistText(event.target.value)
            setBlocklistSaveState("idle")
          }}
          rows={5}
          style={{
            width: "100%",
            boxSizing: "border-box",
            marginBottom: 8,
            fontFamily: "monospace",
            fontSize: 12
          }}
        />
        <button type="button" onClick={onSaveBlocklist} style={{ width: "100%" }}>
          Save blocklist
        </button>
        <p
          style={{
            margin: "8px 0 0",
            color: blocklistSaveState === "error" ? "#b91c1c" : "#166534",
            fontSize: 13
          }}>
          {blocklistSaveState === "error"
            ? "Add at least one non-empty line, or edit before saving."
            : blocklistSaveState === "saved"
              ? "Blocklist saved."
              : ""}
        </p>
      </div>

      <div style={cardStyle}>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong>Local API base URL</strong>
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
        <button type="button" onClick={onSaveSyncApiBaseUrl} style={{ width: "100%" }}>
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

      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <p style={{ margin: 0 }}>
          <strong>Sync queue:</strong> {queueLength}
        </p>
        <p style={{ margin: "6px 0 0" }}>
          <strong>Last sync error:</strong> {lastSyncError || "(none)"}
        </p>
        {queueLength > 0 && (
          <button
            type="button"
            onClick={() => {
              chrome.storage.local.remove(PAGE_CAPTURES_SYNC_QUEUE_KEY, () => {
                if (chrome.runtime.lastError) {
                  console.error("Failed to clear queue:", chrome.runtime.lastError)
                }
              })
            }}
            style={{ marginTop: 8, width: "100%" }}>
            Clear sync queue
          </button>
        )}
      </div>
    </>
  )

  return (
    <div
      style={{
        padding: 16,
        width: 360,
        fontFamily: "Arial, sans-serif"
      }}>
      {view === "main" ? mainView : settingsView}
    </div>
  )
}

export default IndexPopup
