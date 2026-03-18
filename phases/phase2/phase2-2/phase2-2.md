# Phase 2.2: Save Vectors to LanceDB After HTTP Ingestion

Integrate the vector pipeline into the `POST /captures` flow: after persisting a capture to SQLite, generate embeddings and upsert vectors into LanceDB. This enables semantic search over newly captured pages.

**Schema:** See `schema2-2.md` for the LanceDB table definition. References: `schema1-1.md` (extension → service payload, SQLite captures), `schema1-2.md` (MCP tools).

---

## Goals

- **Trigger:** After HTTP receives `POST /captures` and successfully persists to SQLite, run the embedding pipeline and save vectors to LanceDB.
- **Schema:** LanceDB table `capture_vectors` with `vector` and `capture_id` — see `schema2-2.md`.
- **Same-pageId handling:** When the same `pageId` is sent again (e.g., user revisits and scrolls more), SQLite updates the row via `ON CONFLICT(page_id) DO UPDATE`; `id` stays the same. LanceDB must reflect the updated content — see [Handling Same pageId Updates](#handling-same-pageid-updates).

---

## Data Flow

```
POST /captures (request body)
    → validate payload (Zod, captureIngestSchema — schema1-1)
    → toCaptureRecord (generate id, normalize)
    → upsertCapture(db, capture)  [SQLite]
    → insertResult = { id, changes }
    → [NEW] embed bodyText (EmbeddingProvider)
    → [NEW] upsertVectors(lanceClient, captureId, vectors)
    → reply 201 { ok, id, changes, ... }
```

- **Async consideration:** Embedding is async and may be slow (API call). Options:
  - **A. Fire-and-forget:** Return 201 immediately; run embedding in background. Simpler; client may search before vectors exist.
  - **B. Await before reply:** Wait for embedding + vector write, then return 201. Simpler semantics; slower response.
  - **C. Queue + worker:** Enqueue job; worker processes; HTTP returns 201. Best for scale; more complex.

**Recommendation for Phase 2.2:** Start with **B (await before reply)** for simplicity and correctness. Switch to A or C later if latency is an issue.

---

## Handling Same pageId Updates

When the extension sends the same `pageId` again (e.g., user scrolls more, body text changes), SQLite updates the row via `ON CONFLICT(page_id) DO UPDATE`. The `id` (UUID) stays the same. LanceDB must reflect the updated content.

### Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **1. Delete-then-add** | Before adding new vectors, delete all rows where `capture_id = id`. Then add new vectors. | Simple, works with current LanceDB API, no extra columns. | Two operations (delete + add); brief moment of "no vectors" for that capture. |
| **2. Update in place** | Use LanceDB `table.update(where, values)` to replace the vector. | Single operation; no row churn. | Need to verify Node.js API supports vector updates; may require one row per capture (no chunking). |
| **3. Versioned append** | Add new vectors with `updated_at` or `version`; at search time, dedupe by `capture_id` (keep latest). | No delete; append-only. | Wastes space; duplicates; search logic more complex. |
| **4. Soft delete + add** | Mark old rows as deleted; add new. Filter at search. | Keeps history. | More schema; more logic; usually overkill. |

### Recommendation: **Option 1 — Delete-then-add**

- **Simplicity:** Matches current LanceDB Node API (`table.delete` + `table.add`).
- **Correctness:** Ensures the index always reflects the latest content for that capture.
- **Performance:** For typical usage (hundreds to low thousands of captures), delete + add is fast.
- **Chunking-ready:** If we later add chunking (multiple vectors per capture), delete-then-add scales naturally.

**Implementation:** In `upsertVectors`, always `deleteByCaptureId(captureId)` first, then `add(records)`.

---

## Implementation Tasks

### 1. Extend LanceDB Client

The current `lancedb.ts` only has `add(records)`. Add:

- **`deleteByCaptureId(captureId: string): Promise<void>`** — delete all rows where `capture_id = captureId`. Use proper escaping to avoid injection.
- **`upsertVectors(captureId: string, vectors: number[][]): Promise<void>`** — `deleteByCaptureId(captureId)` → `add(records)` where each record is `{ vector, capture_id: captureId }`.

Use table name `capture_vectors` (configurable; see `schema2-2.md`).

### 2. Wire Ingestion Pipeline in `index.ts`

1. Bootstrap LanceDB at startup (alongside SQLite). Use `VECTOR_DB_PATH`, `EMBED_PROVIDER`, `API_KEY`, embedding provider dimension.
2. In `POST /captures` handler, after `upsertCapture`:
   - Use `insertResult.id` (the persisted capture UUID — stable across pageId updates).
   - Get embedding provider; call `embed(captureRecord.bodyText)` (whole-page: one vector).
   - Call `upsertVectors(lanceClient, insertResult.id, [embedding])`.
3. If embedding or vector write fails, log and return 500 (or 207 with message). Document behavior.

### 3. Chunking Strategy

Per Phase 2, start with **whole page** (one embedding per capture). If `bodyText` exceeds model context (e.g., 8K tokens), truncate or split in a later phase. For now, embed the full `bodyText` as-is.

### 4. Error Handling

| Scenario | Behavior |
|----------|----------|
| SQLite upsert fails | Return 500 (existing behavior). |
| Embedding API fails | Log error; return 500. |
| LanceDB write fails | Log error; return 500. |
| Missing `API_KEY` | Fail at startup or on first embed; document in env. |

### 5. Config and Startup

- Ensure `bootstrapLanceDB` runs before accepting requests.
- If `VECTOR_DB_PATH` or embedding env is missing, either fail fast or run in "keyword-only" mode (no vector indexing). Document in config.

---

## Deliverables

- [ ] `schema2-2.md` — LanceDB table schema (see that file).
- [ ] `lancedb.ts` — Add `deleteByCaptureId`, `upsertVectors`; use table `capture_vectors`.
- [ ] `index.ts` — Wire embedding + vector upsert after `upsertCapture`.
- [ ] Startup — Bootstrap LanceDB; handle missing config.
- [ ] Error handling — Document and implement for embedding/LanceDB failures.

---

## Dependencies

- Phase 2.1 (env, LanceDB, GLM embedding provider).
- Phase 1.1 / 1.2 (capture schema, SQLite, `POST /captures`).
