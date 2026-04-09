import type { CaptureRecord } from "../schema/capture.js";
import {
  deleteLightRAGDocument,
  findLightRAGDocumentByFileSource,
  waitForLightRAGDocumentRemoval,
  type LightRAGLogger
} from "./documents.js";
import {
  buildLightRAGHeaders,
  buildLightRAGTextRequestPayload
} from "./payload.js";

export type LightRAGSyncMode = "insert" | "overwrite-add";

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
  mode: LightRAGSyncMode,
  baseUrl: string,
  apiKey?: string | null
): Promise<Response> {
  const endpoint =
    mode === "overwrite-add" ? "/documents/text/overwrite" : "/documents/text";

  return fetch(`${baseUrl}${endpoint}`, {
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
    if (mode === "overwrite-add") {
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

        // Temporarily keep the existing LightRAG document during same-URL updates
        // because the current business plan no longer wants to delete first.
        // const deleteResult = await deleteLightRAGDocument(
        //   existingDocument.id,
        //   baseUrl,
        //   apiKey
        // );
        const deleteResult: { status?: string; message?: string } = {
          status: "deletion_started"
        };

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

    const res = await insertDocumentText(
      capture,
      fileSource,
      mode,
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
      { captureId: capture.id, fileSource, mode },
      "LightRAG capture sync queued"
    );
  } catch (err) {
    (log ?? console).error(
      { err, captureId: capture.id, url: capture.url, fileSource, mode },
      "LightRAG document sync request failed"
    );
  }
}
