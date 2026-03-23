import type { CaptureRecord } from "../schema/capture.js";

/**
 * Build the document text for LightRAG insert per Phase 3 format.
 */
function buildDocumentText(capture: CaptureRecord): string {
  const header = [
    `Title: ${capture.title}`,
    `URL: ${capture.url}`,
    `Captured: ${capture.capturedAt}`,
    "",
    capture.bodyText
  ].join("\n");
  return header;
}

/**
 * Sync a capture to LightRAG's insert API (Phase 3.3).
 * Fire-and-forget: logs errors but does not throw.
 */
export async function syncCaptureToLightRAG(
  capture: CaptureRecord,
  lightragUrl: string,
  apiKey?: string | null,
  log?: { error: (obj: unknown, msg?: string) => void }
): Promise<void> {
  const baseUrl = lightragUrl.replace(/\/$/, "");
  const url = `${baseUrl}/documents/text`;

  const text = buildDocumentText(capture);
  const body = { text, file_source: capture.url };

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (apiKey?.trim()) {
    headers["X-API-Key"] = apiKey.trim();
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errBody = await res.text();
      (log ?? console).error(
        {
          status: res.status,
          statusText: res.statusText,
          body: errBody.slice(0, 500),
          captureId: capture.id,
          url: capture.url
        },
        "LightRAG insert failed"
      );
    }
  } catch (err) {
    (log ?? console).error(
      { err, captureId: capture.id, url: capture.url },
      "LightRAG insert request failed"
    );
  }
}
