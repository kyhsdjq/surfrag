import "dotenv/config";
import path from "node:path";
import { mkdirSync } from "node:fs";

import Fastify from "fastify";
import { ZodError } from "zod";

import { bootstrapSqlite, upsertCapture } from "./db/sqlite.js";
import { toCaptureRecord, type CaptureIngestInput } from "./schema/capture.js";
import { syncCaptureToLightRAG } from "./lightrag/sync.js";
import { getEmbeddingProvider } from "./embedding/index.js";
import { getChunkingStrategy } from "./chunking/index.js";
import { canBootstrapVectorIndexing } from "./vector/bootstrap.js";
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
      { err, msg: "Vector indexing disabled; keyword search only" },
      "Failed to bootstrap LanceDB"
    );
    lanceClient = null;
  }
} else {
  app.log.info(
    "Vector indexing disabled (missing API_KEY); keyword search only"
  );
}

// Simple health-check endpoint to verify the service is alive.
app.get("/health", async () => ({ ok: true }));

app.post<{ Body: CaptureIngestInput }>("/captures", async (request, reply) => {
  try {
    const captureRecord = toCaptureRecord(request.body);
    const insertResult = upsertCapture(db, captureRecord);

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

    // Phase 3.3: sync to LightRAG (fire-and-forget)
    if (lightragInsertEnabled && lightragUrl) {
      void syncCaptureToLightRAG(
        captureRecord,
        lightragUrl,
        lightragApiKey,
        request.log
      );
    }

    reply.code(201);

    return {
      ok: true,
      status: "persisted",
      id: insertResult.id,
      changes: insertResult.changes,
      capture: captureRecord
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
