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
    → [NEW] chunks = chunker.chunk(capture.bodyText)
    → [NEW] vectors = embedBatch(chunks.map(c => c.text))
    → [NEW] records = vectors.map((v, i) => ({ vector: v, capture_id: insertResult.id, chunk_index: chunks[i].index }))
    → [NEW] upsertVectors(lanceClient, insertResult.id, records)
    → reply 201 { ok, id, changes, ... }
```

- **Async consideration:** Embedding is async and may be slow (API call). Options:
  - **A. Fire-and-forget:** Return 201 immediately; run embedding in background. Simpler; client may search before vectors exist.
  - **B. Await before reply:** Wait for embedding + vector write, then return 201. Simpler semantics; slower response.
  - **C. Queue + worker:** Enqueue job; worker processes; HTTP returns 201. Best for scale; more complex.

**Chosen for Phase 2.2:** **B (await before reply)** — wait for embedding + vector write, then return 201. Simpler semantics and correctness; switch to A or C later if latency is an issue.

---

## Handling Same pageId Updates

When the extension sends the same `pageId` again (e.g., user scrolls more, body text changes), SQLite updates the row via `ON CONFLICT(page_id) DO UPDATE`. The `id` (UUID) stays the same. LanceDB must reflect the updated content.

### Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **1. Delete-then-add** | Before adding new vectors, delete all rows where `capture_id = id`. Then add new vectors. | Simple, works with current LanceDB API, no extra columns. | Two operations (delete + add); brief moment of "no vectors" for that capture. |
| **2. Update in place** | Use LanceDB `table.update({ where, values })` to replace the vector. | Single operation; no row churn. | See [LanceDB Update Support](#lancedb-update-support) below. |
| **3. Versioned append** | Add new vectors with `updated_at` or `version`; at search time, dedupe by `capture_id` (keep latest). | No delete; append-only. | Wastes space; duplicates; search logic more complex. |
| **4. Soft delete + add** | Mark old rows as deleted; add new. Filter at search. | Keeps history. | More schema; more logic; usually overkill. |

### LanceDB Update Support

**LanceDB does support updating vectors directly.** The Node.js API provides:

```javascript
await table.update({
  where: "capture_id = 'uuid-here'",
  values: { vector: [0.1, 0.2, ...] }
})
```

- Indexes are updated automatically; updated data is searchable immediately.
- **Caveats:**
  - **New captures:** `update` only modifies existing rows; it does not insert. For first-time captures, we must use `add`.
  - **Chunking:** `values` applies the same value to all matching rows. With multiple vectors per capture, we cannot update each row to a different vector in one call.
  - **Logic:** We would need "if rows exist → update, else → add", adding branching and a prior query.

### Recommendation: **Option 1 — Delete-then-add**

- **Simplicity:** Single code path for both new and updated captures; no existence check.
- **Correctness:** Ensures the index always reflects the latest content.
- **Chunking-ready:** Scales naturally when we add multiple vectors per capture.
- **Performance:** For typical usage, delete + add is fast; update would save one op but adds complexity.

**Implementation:** In `upsertVectors`, always `deleteByCaptureId(captureId)` first, then `add(records)`.

---

## How `capture_id` and `chunk_index` Are Generated

### `capture_id`

`capture_id` is the **persisted UUID** from SQLite `captures.id`, returned by `upsertCapture` as `insertResult.id`.

| Scenario | Source |
|----------|--------|
| **New capture** | `toCaptureRecord` generates `id` via `randomUUID()`. That id is inserted into SQLite. `upsertCapture` returns it as `insertResult.id`. |
| **Update (same pageId)** | `ON CONFLICT(page_id) DO UPDATE` does not change `id`. `upsertCapture` runs `SELECT id FROM captures WHERE page_id = ?` and returns the **existing** row’s id. So the same UUID is reused across updates. |

**Important:** Always use `insertResult.id`, not `captureRecord.id`. On updates, `captureRecord.id` is a new UUID from `toCaptureRecord`, but the persisted id is the original one.

### `chunk_index`

`chunk_index` is **assigned by the chunker** in each `TextChunk` as `chunks[i].index`.

| Chunker | How `index` is set |
|---------|--------------------|
| **whole-page** | Always `0` (one chunk per capture). |
| **fixed-size / recursive / sentence** | `0`, `1`, `2`, … in the order chunks are produced. |

The pipeline uses `chunks[i].index` when building records: `chunk_index: chunks[i].index`.

---

## Chunking Design

Design a pluggable chunking layer so we can swap strategies (whole-page, fixed-size, recursive, etc.) without changing the pipeline. Implement **whole-page** first.

### Interface

```typescript
/** A single chunk of text ready for embedding. */
export type TextChunk = {
  text: string
  index: number   // 0-based position within the page (for ordering, snippet display)
}

/** Chunking strategy: splits body text into embeddable chunks. */
export interface ChunkingStrategy {
  /** Split body text into chunks. Never returns empty array. */
  chunk(bodyText: string): TextChunk[]

  /** Strategy name (e.g. "whole-page", "fixed-512"). */
  readonly name: string
}
```

### Pipeline Integration

```
bodyText → chunker.chunk(bodyText) → TextChunk[]
       → texts = chunks.map(c => c.text)
       → embedBatch(texts) → number[][]
       → records = vectors.map((v, i) => ({ vector: v, capture_id, chunk_index: chunks[i].index }))
       → upsertVectors(captureId, records)
```

- **embedBatch:** Use provider's `embedBatch` for efficiency when multiple chunks.
- **chunk_index:** Stored in LanceDB for search-time use (e.g., "which chunk matched", snippet extraction). See `schema2-2.md`.

### Implementations

| Strategy | Description | Config | Phase 2.2 |
|----------|-------------|--------|-----------|
| **whole-page** | Single chunk = full bodyText. Optionally truncate if exceeds model limit. | `maxChars?` (e.g. 32K) | ✅ Implement first |
| **fixed-size** | Split by token/char count with overlap. | `chunkSize`, `overlap` | Future |
| **recursive** | Split by separators (paragraph → sentence → char). | `separators`, `chunkSize` | Future |
| **sentence** | Split on sentence boundaries. | `maxSentences` | Future |

### Whole-Page Chunker (Phase 2.2)

```typescript
export const wholePageChunker: ChunkingStrategy = {
  name: "whole-page",
  chunk(bodyText: string): TextChunk[] {
    const text = bodyText.trim()
    if (!text) return [{ text: "(empty)", index: 0 }]
    // Optional: truncate to maxChars if bodyText exceeds model context
    return [{ text, index: 0 }]
  }
}
```

- One chunk per capture; `chunk_index` is always 0.
- If `bodyText` exceeds model context (e.g., 8K tokens ≈ 32K chars), add truncation in a later iteration.

### Strategy Selection

- **Config:** `CHUNK_STRATEGY=whole-page` (default). Future: `fixed-512`, `recursive`, etc.
- **Factory:** `getChunkingStrategy(env)` → selected implementation.
- **Startup:** Resolve strategy once; use for all captures until restart.

### Adding New Chunkers Later

1. Implement `ChunkingStrategy` with `chunk(bodyText): TextChunk[]`.
2. Register in factory (e.g. `strategies[env.CHUNK_STRATEGY]`).
3. No pipeline changes; `upsertVectors` already accepts multiple records per capture.

---

## Implementation Tasks

### 1. Extend LanceDB Client

The current `lancedb.ts` only has `add(records)`. Add:

- **`deleteByCaptureId(captureId: string): Promise<void>`** — delete all rows where `capture_id = captureId`. Use proper escaping to avoid injection.
- **`upsertVectors(captureId: string, records: VectorRecord[]): Promise<void>`** — `deleteByCaptureId(captureId)` → `add(records)`. Each record is `{ vector, capture_id, chunk_index }` (see `schema2-2.md`).

Use table name `capture_vectors` (configurable; see `schema2-2.md`).

### 2. Wire Ingestion Pipeline in `index.ts`

1. Bootstrap LanceDB at startup (alongside SQLite). Use `VECTOR_DB_PATH`, `EMBED_PROVIDER`, `API_KEY`, embedding provider dimension.
2. In `POST /captures` handler, after `upsertCapture`:
   - Use `insertResult.id` (the persisted capture UUID — stable across pageId updates).
   - Get chunker; call `chunker.chunk(captureRecord.bodyText)` → `TextChunk[]`.
   - Get embedding provider; call `embedBatch(chunks.map(c => c.text))` → `number[][]`.
   - Build `VectorRecord[]` with `vector`, `capture_id`, `chunk_index`; call `upsertVectors(lanceClient, insertResult.id, records)`.
3. If embedding or vector write fails, log and return 500 (or 207 with message). Document behavior.

### 3. Chunking Strategy

See [Chunking Design](#chunking-design) below. Implement **whole-page** first; the design supports future chunkers (fixed-size, recursive, etc.).

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

- [ ] `schema2-2.md` — LanceDB table schema with `chunk_index` (see that file).
- [ ] `chunking/` — `ChunkingStrategy` interface, `wholePageChunker`, `getChunkingStrategy(env)`.
- [ ] `lancedb.ts` — Add `deleteByCaptureId`, `upsertVectors`; use table `capture_vectors`.
- [ ] `index.ts` — Wire chunker → embedBatch → vector upsert after `upsertCapture`.
- [ ] Startup — Bootstrap LanceDB; handle missing config.
- [ ] Error handling — Document and implement for embedding/LanceDB failures.

---

## Dependencies

- Phase 2.1 (env, LanceDB, GLM embedding provider).
- Phase 1.1 / 1.2 (capture schema, SQLite, `POST /captures`).
