import { useEffect, useState } from "react"

import { PAGE_CAPTURES_STORAGE_KEY, type PageCaptureRecord } from "~types/capture"

const bodyPreview = (value: string, maxLength = 280) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value

function IndexPopup() {
  const [latestCapture, setLatestCapture] = useState<PageCaptureRecord | null>(null)

  useEffect(() => {
    chrome.storage.local.get([PAGE_CAPTURES_STORAGE_KEY], (result) => {
      const captures = (result[PAGE_CAPTURES_STORAGE_KEY] as PageCaptureRecord[] | undefined) || []
      setLatestCapture(captures[0] || null)
    })
  }, [])

  return (
    <div
      style={{
        padding: 16,
        width: 360,
        fontFamily: "Arial, sans-serif"
      }}>
      <h2 style={{ marginTop: 0 }}>SurfRAG Capture Status</h2>
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
