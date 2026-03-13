import "dotenv/config";
import Fastify from "fastify";
import { ZodError } from "zod";
import { bootstrapSqlite, insertCapture } from "./db/sqlite.js";
import { toCaptureRecord } from "./schema/capture.js";
// Create a Fastify app with built-in logging enabled.
const app = Fastify({ logger: true });
const { db, dbPath } = bootstrapSqlite();
app.log.info({ dbPath }, "SQLite bootstrap complete");
// Simple health-check endpoint to verify the service is alive.
app.get("/health", async () => ({ ok: true }));
app.post("/captures", async (request, reply) => {
    try {
        const captureRecord = toCaptureRecord(request.body);
        const insertResult = insertCapture(db, captureRecord);
        reply.code(201);
        return {
            ok: true,
            status: "persisted",
            id: insertResult.id,
            changes: insertResult.changes,
            capture: captureRecord
        };
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map