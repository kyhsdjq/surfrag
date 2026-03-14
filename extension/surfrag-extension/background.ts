import {
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
        sendResponse({
          ok: false,
          error: errorMsg
        } satisfies SyncCaptureResponse)
        return
      }

      sendResponse({ ok: true } satisfies SyncCaptureResponse)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch local API"

      sendResponse({
        ok: false,
        error: message
      } satisfies SyncCaptureResponse)
    }
  })()

  return true
})
