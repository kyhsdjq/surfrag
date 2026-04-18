import "dotenv/config";
import path from "node:path";
import { mkdirSync } from "node:fs";

import Fastify from "fastify";
import { ZodError } from "zod";

import {
  bootstrapSqlite,
  getCaptureIdentityState,
  toContradictionReviewRow,
  upsertCapture,
  upsertContradictionReview
} from "./db/sqlite.js";
import {
  deriveSignalPatterns,
  evaluateCaptureForContradictions,
  type ContradictionClassification,
  type FinalAction,
  type PolicySignals,
  type PreliminaryAction
} from "./contradiction/review.js";
import {
  getMaxDebateRounds,
  runContradictionDebate
} from "./contradiction/debate.js";
import { computeContentHash } from "./ingest/hash.js";
import { canonicalizeCaptureUrl } from "./ingest/url.js";
import { toCaptureRecord, type CaptureIngestInput } from "./schema/capture.js";
import {
  syncCaptureToLightRAG,
  type LightRAGSyncMode
} from "./lightrag/sync.js";
import { removeLightRAGDocumentsByFileSources } from "./lightrag/documents.js";
import { getEmbeddingProvider } from "./embedding/index.js";
import { getChunkingStrategy } from "./chunking/index.js";
import { canBootstrapVectorIndexing, isVectorDbEnabled } from "./vector/bootstrap.js";
import { bootstrapLanceDB, type LanceDBClient } from "./vector/lancedb.js";

const DEFAULT_VECTOR_DB_PATH = "./data/lancedb";
const DEFAULT_LIGHTRAG_URL = "http://localhost:9621";

/** Parse boolean env: true, 1, yes, on => true; false, 0, no, off => false */
function parseBoolEnv(value: string | undefined): boolean {
  const v = value?.toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

/** LIGHTRAG_INSERT_ENABLED defaults to true when unset (LightRAG is primary). */
const lightragInsertEnabled =
  (process.env.LIGHTRAG_INSERT_ENABLED?.trim() ?? "") === ""
    ? true
    : parseBoolEnv(process.env.LIGHTRAG_INSERT_ENABLED);
const lightragUrl = process.env.LIGHTRAG_URL?.trim() || DEFAULT_LIGHTRAG_URL;
const lightragApiKey = process.env.LIGHTRAG_API_KEY?.trim() || null;
const maxDebateRounds = getMaxDebateRounds();

type LightRAGSyncSummary = {
  attempted: boolean;
  reason?: "unchanged" | "disabled" | "blocked_by_contradiction_review";
  mode?: LightRAGSyncMode;
  fileSource?: string;
  lookupFileSources?: string[];
};

type ContradictionReviewSummary = {
  classification: ContradictionClassification;
  policySignals: PolicySignals;
  signalPatterns: string[];
  preliminaryAction: PreliminaryAction;
  preliminaryActionReason: string;
  finalAction?: FinalAction;
  finalActionReason?: string;
  lowConfidence: boolean;
  blocked: boolean;
  debateTodo: boolean;
  shouldEnterDebate: boolean;
  debateStatus: "not-needed" | "todo" | "entered" | "completed";
  summaryReason: string;
  disputedClaims: string[];
  reviewUrl: string;
  enteredDebate: boolean;
};

const app = Fastify({ logger: true });
const { db, dbPath } = bootstrapSqlite();

app.log.info({ dbPath }, "SQLite bootstrap complete");

let lanceClient: LanceDBClient | null = null;

if (canBootstrapVectorIndexing()) {
  try {
    const vectorPath =
      process.env.VECTOR_DB_PATH?.trim() || DEFAULT_VECTOR_DB_PATH;
    const resolvedPath = path.resolve(process.cwd(), vectorPath);
    mkdirSync(resolvedPath, { recursive: true });

    const embedProvider = getEmbeddingProvider();
    lanceClient = await bootstrapLanceDB({
      path: resolvedPath,
      tableName: "capture_vectors",
      dimension: embedProvider.dimension
    });

    app.log.info(
      { path: resolvedPath, dimension: embedProvider.dimension },
      "LanceDB bootstrap complete"
    );
  } catch (err) {
    app.log.warn(
      { err },
      "LanceDB bootstrap failed (keyword search and LightRAG remain available)"
    );
    lanceClient = null;
  }
} else {
  const reason = !isVectorDbEnabled()
    ? "VECTOR_DB_ENABLED=false (LightRAG is primary)"
    : "missing EMBED_API";
  app.log.info(
    { reason },
    "Vector indexing disabled"
  );
}

if (lightragInsertEnabled && lightragUrl) {
  app.log.info({ lightragUrl, maxDebateRounds }, "LightRAG sync enabled");
}

// Simple health-check endpoint to verify the service is alive.
app.get("/health", async () => ({ ok: true }));

app.post<{ Body: CaptureIngestInput }>("/captures", async (request, reply) => {
  try {
    const captureRecord = toCaptureRecord(request.body);
    const canonicalUrl = canonicalizeCaptureUrl(captureRecord.url);
    const contentHash = computeContentHash(captureRecord.bodyText);
    const previousCapture = getCaptureIdentityState(db, canonicalUrl);
    let lightragSyncMode: LightRAGSyncMode = "insert";
    const lightragFileSource = canonicalUrl;
    const lightragLookupFileSources = [
      canonicalUrl,
      previousCapture?.url,
      captureRecord.url
    ].filter((value): value is string => Boolean(value?.trim()));
    let lightragSyncSummary: LightRAGSyncSummary =
      lightragInsertEnabled && lightragUrl
        ? {
            attempted: true,
            mode: lightragSyncMode,
            fileSource: lightragFileSource,
            lookupFileSources: lightragLookupFileSources
          }
        : {
            attempted: false,
            reason: "disabled"
          };
    let contradictionReviewSummary: ContradictionReviewSummary | null = null;

    if (previousCapture?.contentHash === contentHash) {
      request.log.info(
        {
          decision: "unchanged-skip",
          canonicalUrl,
          captureId: previousCapture.id
        },
        "Capture unchanged; skipping heavy ingestion"
      );

      return {
        ok: true,
        status: "unchanged",
        unchanged: true,
        id: previousCapture.id,
        canonicalUrl,
        lightRagSync: {
          attempted: false,
          reason: "unchanged"
        } satisfies LightRAGSyncSummary
      };
    }

    const insertResult = upsertCapture(db, {
      capture: captureRecord,
      canonicalUrl,
      contentHash
    });
    request.log.info(
      {
        decision: previousCapture ? "changed" : "new",
        canonicalUrl,
        captureId: insertResult.id
      },
      "Capture accepted for ingestion"
    );

    // Phase 2.2: embed and upsert vectors (await before reply)
    if (lanceClient) {
      try {
        const chunker = getChunkingStrategy();
        const embedProvider = getEmbeddingProvider();

        const chunks = chunker.chunk(captureRecord.bodyText);
        const texts = chunks.map((c) => c.text);
        const vectors = await embedProvider.embedBatch(texts);

        const records = vectors.map((v, i) => ({
          vector: v,
          capture_id: insertResult.id,
          chunk_index: chunks[i]!.index
        }));

        await lanceClient.upsertVectors(insertResult.id, records);
      } catch (vectorErr) {
        request.log.error(
          { err: vectorErr, captureId: insertResult.id },
          "Failed to index vectors"
        );
        reply.code(500);
        return {
          ok: false,
          status: "vector_index_failed",
          id: insertResult.id,
          message: "Capture persisted but vector indexing failed"
        };
      }
    }

    // For same-URL updates, remove the old LightRAG document before contradiction review
    // so the new version is not guaranteed to contradict its own prior snapshot.
    if (previousCapture && lightragInsertEnabled && lightragUrl) {
      request.log.info(
        {
          captureId: insertResult.id,
          canonicalUrl,
          lookupFileSources: lightragLookupFileSources
        },
        "Removing prior LightRAG documents before contradiction review"
      );

      const removed = await removeLightRAGDocumentsByFileSources(
        lightragLookupFileSources,
        lightragUrl,
        lightragApiKey,
        request.log
      );

      if (!removed) {
        reply.code(500);
        return {
          ok: false,
          status: "lightrag_prepare_failed",
          id: insertResult.id,
          message: "Capture persisted but prior LightRAG document removal failed"
        };
      }
    }

    // Phase 5.3: contradiction gate before LightRAG sync.
    if (lightragInsertEnabled && lightragUrl) {
      let contradictionReview = await evaluateCaptureForContradictions({
        capture: captureRecord,
        reviewUrl: canonicalUrl,
        fileSource: lightragFileSource,
        baseUrl: lightragUrl,
        apiKey: lightragApiKey
      });

      upsertContradictionReview(db, toContradictionReviewRow(contradictionReview));

      if (contradictionReview.result.preliminary_action === "hold") {
        request.log.info(
          {
            captureId: insertResult.id,
            canonicalUrl,
            maxDebateRounds,
            disputedClaims: contradictionReview.disputedClaims.map((claim) => claim.claim_text)
          },
          "Entering Phase 5.4 claim-level debate"
        );

        contradictionReview = await runContradictionDebate({
          review: contradictionReview,
          baseUrl: lightragUrl,
          apiKey: lightragApiKey,
          maxRounds: maxDebateRounds
        });

        upsertContradictionReview(db, toContradictionReviewRow(contradictionReview));
      }

      contradictionReviewSummary = {
        classification: contradictionReview.result.classification,
        policySignals: contradictionReview.result.policy_signals,
        signalPatterns: deriveSignalPatterns(contradictionReview.result.policy_signals),
        preliminaryAction: contradictionReview.result.preliminary_action,
        preliminaryActionReason: contradictionReview.result.preliminary_action_reason,
        lowConfidence: contradictionReview.result.low_confidence ?? false,
        blocked: contradictionReview.blocked,
        debateTodo: contradictionReview.debateTodo,
        shouldEnterDebate: contradictionReview.debateTodo || contradictionReview.enteredDebate,
        debateStatus:
          contradictionReview.enteredDebate
            ? "completed"
            : contradictionReview.result.preliminary_action === "hold"
              ? "todo"
              : "not-needed",
        summaryReason: contradictionReview.result.summary_reason,
        disputedClaims: contradictionReview.disputedClaims.map((claim) => claim.claim_text),
        reviewUrl: contradictionReview.reviewUrl,
        enteredDebate: contradictionReview.enteredDebate,
        ...(contradictionReview.result.final_action
          ? { finalAction: contradictionReview.result.final_action }
          : {}),
        ...(contradictionReview.result.final_action_reason
          ? { finalActionReason: contradictionReview.result.final_action_reason }
          : {})
      };

      if (contradictionReview.blocked) {
        lightragSyncSummary = {
          attempted: false,
          reason: "blocked_by_contradiction_review",
          mode: lightragSyncMode,
          fileSource: lightragFileSource,
          lookupFileSources: lightragLookupFileSources
        };

        request.log.warn(
          {
            captureId: insertResult.id,
            canonicalUrl,
            classification: contradictionReview.result.classification,
            preliminaryAction: contradictionReview.result.preliminary_action,
            finalAction: contradictionReview.result.final_action,
            lowConfidence: contradictionReview.result.low_confidence,
            debateTodo: contradictionReview.debateTodo,
            disputedClaims: contradictionReview.disputedClaims.map((claim) => claim.claim_text)
          },
          "Capture blocked by contradiction review before LightRAG sync"
        );
      } else {
        const effectiveAction =
          contradictionReview.result.final_action ??
          contradictionReview.result.preliminary_action
        lightragSyncMode =
          effectiveAction === "allow-add-prefer-new" ? "overwrite-add" : "insert";
        lightragSyncSummary = {
          attempted: true,
          mode: lightragSyncMode,
          fileSource: lightragFileSource,
          lookupFileSources: lightragLookupFileSources
        };

        request.log.info(
          {
            captureId: insertResult.id,
            canonicalUrl,
            mode: lightragSyncMode,
            fileSource: lightragFileSource,
            classification: contradictionReview.result.classification,
            preliminaryAction: contradictionReview.result.preliminary_action,
            finalAction: contradictionReview.result.final_action,
            lowConfidence: contradictionReview.result.low_confidence
          },
          "Queueing LightRAG capture sync"
        );

        void syncCaptureToLightRAG(
          captureRecord,
          lightragUrl,
          lightragApiKey,
          request.log,
          {
            mode: lightragSyncMode,
            fileSource: lightragFileSource,
            lookupFileSources: lightragLookupFileSources
          }
        );
      }
    }

    reply.code(201);

    return {
      ok: true,
      status: "persisted",
      unchanged: false,
      id: insertResult.id,
      changes: insertResult.changes,
      capture: captureRecord,
      lightRagSync: lightragSyncSummary,
      contradictionReview: contradictionReviewSummary
    };
  } catch (error) {
    if (error instanceof ZodError) {
      reply.code(400);

      return {
        ok: false,
        status: "invalid_payload",
        issues: error.issues
      };
    }

    request.log.error({ err: error }, "Failed to persist capture");
    reply.code(500);

    return {
      ok: false,
      status: "persist_failed"
    };
  }
});

// Read port from env and fallback to 3000 for local development.
const port = Number(process.env.PORT ?? 3000);

// Start the server and fail fast if startup fails.
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
