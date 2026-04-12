import type { CaptureRecord } from "../schema/capture.js";
import { type LightRAGLogger } from "./documents.js";
import {
  buildLightRAGHeaders,
  buildLightRAGTextRequestPayload
} from "./payload.js";

export type LightRAGSyncMode = "insert";

export type SyncCaptureToLightRAGOptions = {
  mode?: LightRAGSyncMode;
  fileSource?: string;
  lookupFileSources?: string[];
};

function getLookupFileSources(
  fileSource: string,
  lookupFileSources: string[] | undefined
): string[] {
  return [...new Set([fileSource, ...(lookupFileSources ?? [])])]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function insertDocumentText(
  capture: CaptureRecord,
  fileSource: string,
  baseUrl: string,
  apiKey?: string | null
): Promise<Response> {
  return fetch(`${baseUrl}/documents/text`, {
    method: "POST",
    headers: buildLightRAGHeaders(apiKey),
    body: JSON.stringify(buildLightRAGTextRequestPayload(capture, fileSource))
  });
}

/**
 * Sync a capture to LightRAG's insert API (Phase 3.3).
 * Fire-and-forget: logs errors but does not throw.
 */
export async function syncCaptureToLightRAG(
  capture: CaptureRecord,
  lightragUrl: string,
  apiKey?: string | null,
  log?: LightRAGLogger,
  options: SyncCaptureToLightRAGOptions = {}
): Promise<void> {
  const baseUrl = lightragUrl.replace(/\/$/, "");
  const fileSource = options.fileSource?.trim() || capture.url;
  const mode = options.mode ?? "insert";
  const lookupFileSources = getLookupFileSources(fileSource, options.lookupFileSources);

  try {
    const res = await insertDocumentText(
      capture,
      fileSource,
      baseUrl,
      apiKey
    );

    if (!res.ok) {
      const errBody = await res.text();
      (log ?? console).error(
        {
          status: res.status,
          statusText: res.statusText,
          body: errBody.slice(0, 500),
          captureId: capture.id,
          url: capture.url,
          fileSource,
          mode
        },
        "LightRAG document sync failed"
      );
      return;
    }

    log?.info?.(
      { captureId: capture.id, fileSource, mode, lookupFileSources },
      "LightRAG capture sync queued"
    );
  } catch (err) {
    (log ?? console).error(
      { err, captureId: capture.id, url: capture.url, fileSource, mode },
      "LightRAG document sync request failed"
    );
  }
}
