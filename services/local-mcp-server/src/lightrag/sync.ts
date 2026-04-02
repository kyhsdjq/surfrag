import type { CaptureRecord } from "../schema/capture.js";
import {
  deleteLightRAGDocument,
  findLightRAGDocumentByFileSource,
  waitForLightRAGDocumentRemoval,
  type LightRAGLogger
} from "./documents.js";

export type LightRAGSyncMode = "insert" | "insert-or-replace";

export type SyncCaptureToLightRAGOptions = {
  mode?: LightRAGSyncMode;
  fileSource?: string;
  lookupFileSources?: string[];
};

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

function buildHeaders(apiKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (apiKey?.trim()) {
    headers["X-API-Key"] = apiKey.trim();
  }

  return headers;
}

function getLookupFileSources(
  fileSource: string,
  lookupFileSources: string[] | undefined
): string[] {
  return [...new Set([fileSource, ...(lookupFileSources ?? [])])]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

async function insertDocumentText(
  text: string,
  fileSource: string,
  baseUrl: string,
  apiKey?: string | null
): Promise<Response> {
  return fetch(`${baseUrl}/documents/text`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      text,
      file_source: fileSource
    })
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
  const text = buildDocumentText(capture);
  const fileSource = options.fileSource?.trim() || capture.url;
  const mode = options.mode ?? "insert";
  const lookupFileSources = getLookupFileSources(fileSource, options.lookupFileSources);

  try {
    if (mode === "insert-or-replace") {
      for (const lookupSource of lookupFileSources) {
        const existingDocument = await findLightRAGDocumentByFileSource(
          lookupSource,
          baseUrl,
          apiKey
        );

        if (!existingDocument) {
          continue;
        }

        log?.info?.(
          {
            captureId: capture.id,
            fileSource: lookupSource,
            docId: existingDocument.id,
            status: existingDocument.status
          },
          "LightRAG document found for capture update"
        );

        const deleteResult = await deleteLightRAGDocument(
          existingDocument.id,
          baseUrl,
          apiKey
        );

        if (deleteResult.status !== "deletion_started") {
          log?.warn?.(
            {
              captureId: capture.id,
              fileSource: lookupSource,
              docId: existingDocument.id,
              deleteStatus: deleteResult.status,
              message: deleteResult.message
            },
            "LightRAG document deletion could not be started"
          );
          return;
        }

        const removed = await waitForLightRAGDocumentRemoval(
          lookupSource,
          baseUrl,
          apiKey,
          log
        );

        if (!removed) {
          log?.error(
            {
              captureId: capture.id,
              fileSource: lookupSource,
              docId: existingDocument.id
            },
            "Timed out waiting for LightRAG document deletion"
          );
          return;
        }

        log?.info?.(
          {
            captureId: capture.id,
            previousFileSource: lookupSource,
            nextFileSource: fileSource,
            docId: existingDocument.id
          },
          "LightRAG document deleted before reinsert"
        );

        break;
      }
    }

    const res = await insertDocumentText(text, fileSource, baseUrl, apiKey);

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
        "LightRAG insert failed"
      );
      return;
    }

    log?.info?.(
      { captureId: capture.id, fileSource, mode },
      "LightRAG capture sync queued"
    );
  } catch (err) {
    (log ?? console).error(
      { err, captureId: capture.id, url: capture.url, fileSource, mode },
      "LightRAG insert request failed"
    );
  }
}
