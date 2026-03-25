import {
  BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY,
  CONTENT_TRIGGER_BOOKMARK_CAPTURE,
  CONTENT_TRIGGER_MANUAL_CAPTURE,
  DEFAULT_SYNC_API_BASE_URL,
  SYNC_API_BASE_URL_STORAGE_KEY,
  SYNC_CAPTURE_MESSAGE_TYPE,
  type SyncCaptureMessage,
  type SyncCaptureResponse
} from "~types/capture"

const buildCaptureEndpoint = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/captures`

const readSyncApiBaseUrl = () =>
  new Promise<string>((resolve) => {
    chrome.storage.local.get([SYNC_API_BASE_URL_STORAGE_KEY], (result) => {
      const configuredUrl = (result[SYNC_API_BASE_URL_STORAGE_KEY] as string | undefined)?.trim()
      resolve(configuredUrl || DEFAULT_SYNC_API_BASE_URL)
    })
  })

const readBookmarkCaptureEnabled = () =>
  new Promise<boolean>((resolve) => {
    chrome.storage.local.get([BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY], (result) => {
      const value = result[BOOKMARK_CAPTURE_ENABLED_STORAGE_KEY]
      resolve(value !== false)
    })
  })

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    !message ||
    typeof message !== "object" ||
    !("type" in message) ||
    (message as { type?: string }).type !== SYNC_CAPTURE_MESSAGE_TYPE
  ) {
    return
  }

  const syncMessage = message as SyncCaptureMessage

  void (async () => {
    try {
      const syncApiBaseUrl = await readSyncApiBaseUrl()
      const response = await fetch(buildCaptureEndpoint(syncApiBaseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(syncMessage.payload)
      })

      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`
        try {
          const body = await response.json() as { issues?: Array<{ path: string[]; message: string }> }
          if (Array.isArray(body?.issues) && body.issues.length > 0) {
            errorMsg += `: ${body.issues.map((i) => i.message).join("; ")}`
          }
        } catch {
          // ignore
        }
        console.error("Sync API error:", errorMsg)
        sendResponse({
          ok: false,
          error: errorMsg
        } satisfies SyncCaptureResponse)
        return
      }

      sendResponse({ ok: true } satisfies SyncCaptureResponse)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch local API"
      console.error("Sync API fetch failed:", message)
      sendResponse({
        ok: false,
        error: message
      } satisfies SyncCaptureResponse)
    }
  })()

  return true
})

const urlsLikelySame = (a: string, b: string) => {
  if (a === b) {
    return true
  }

  try {
    const ua = new URL(a)
    const ub = new URL(b)
    const pa = ua.pathname.replace(/\/$/, "") || "/"
    const pb = ub.pathname.replace(/\/$/, "") || "/"
    return ua.origin === ub.origin && pa === pb && ua.search === ub.search
  } catch {
    return false
  }
}

const sendCaptureTriggerToTab = (
  tabId: number,
  type: typeof CONTENT_TRIGGER_MANUAL_CAPTURE | typeof CONTENT_TRIGGER_BOOKMARK_CAPTURE
) => {
  chrome.tabs.sendMessage(tabId, { type }, () => {
    void chrome.runtime.lastError
  })
}

const triggerManualCaptureInActiveTab = () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId === undefined) {
      return
    }

    sendCaptureTriggerToTab(tabId, CONTENT_TRIGGER_MANUAL_CAPTURE)
  })
}

if (chrome.commands) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "capture-page") {
      triggerManualCaptureInActiveTab()
    }
  })
}

chrome.bookmarks.onCreated.addListener((_id, node) => {
  const url = node.url
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    return
  }

  void readBookmarkCaptureEnabled().then((enabled) => {
    if (!enabled) {
      return
    }

    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id === undefined || !tab.url) {
          continue
        }

        if (urlsLikelySame(tab.url, url)) {
          sendCaptureTriggerToTab(tab.id, CONTENT_TRIGGER_BOOKMARK_CAPTURE)
          return
        }
      }
    })
  })
})
