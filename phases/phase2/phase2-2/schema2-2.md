# Schema 2.2: LanceDB Vector Table

This document defines the schema for vector embeddings stored in LanceDB, used for semantic search over captured web pages.

**Related schemas:** `schema1-1.md` (extension payload, SQLite `captures`), `schema1-2.md` (MCP tools).

---

## 1. Relationship to SQLite

| SQLite (`captures` — schema1-1) | LanceDB (`capture_vectors`) |
|---------------------------------|-----------------------------|
| `id` (UUID, primary key) | `capture_id` (foreign reference) |
| `body_text` | Source text for embedding |
| — | `vector` (embedding) |

- **One-to-many (future):** One capture may have multiple vectors if chunking is added. For Phase 2.2 (whole-page), one vector per capture.
- **Join:** Vector search returns `capture_id`; join with SQLite to fetch `title`, `url`, `body_text`, etc. (see `get_capture_by_id` in schema1-2).

---

## 2. Table: `capture_vectors`

| Column | Type | Description |
|--------|------|-------------|
| `vector` | `number[]` (fixed-length) | Embedding vector. Dimension from config (e.g., 1024 for GLM `embedding-2`, 1536 for OpenAI `text-embedding-3-small`). |
| `capture_id` | `string` | UUID of the capture in SQLite. Links to `captures.id`. |

### Constraints

- **vector:** Non-null, length = `EMBED_DIMENSION` (from embedding provider).
- **capture_id:** Non-null. Not unique (allows multiple chunks per capture in future).

### Index

LanceDB creates a vector index on the `vector` column for similarity search. No explicit primary key; `capture_id` is metadata for filtering and join.

---

## 3. TypeScript Definition

```typescript
export type VectorRecord = {
  vector: number[]
  capture_id: string
}

export type VectorSearchResult = {
  capture_id: string
  _distance?: number  // LanceDB returns distance (lower = more similar)
}
```

---

## 4. Bootstrap / Creation

When the table does not exist, create it with a placeholder row (to establish schema), then delete the placeholder:

```typescript
const placeholderVector = new Array<number>(dimension).fill(0)
table = await db.createTable(
  "capture_vectors",
  [{ vector: placeholderVector, capture_id: "__placeholder__" }],
  { mode: "create", existOk: false }
)
await table.delete("capture_id = '__placeholder__'")
```

---

## 5. Upsert Semantics (Same pageId)

When a capture is updated (same `page_id`, new `body_text`), SQLite keeps the same `id` (see `upsertCapture` in schema1-1 / sqlite.ts). For LanceDB:

1. **Delete** all rows where `capture_id = id`.
2. **Add** new vector(s) for that `capture_id`.

This ensures the vector index always reflects the latest content. See `phase2-2.md` for options and rationale (recommendation: **delete-then-add**).

---

## 6. Field Mapping (Ingestion)

| Source | LanceDB |
|--------|---------|
| `insertResult.id` (from `upsertCapture` — SQLite) | `capture_id` |
| `embed(capture.bodyText)` (EmbeddingProvider) | `vector` |

**Source chain:** Extension `CaptureSyncPayload` (schema1-1) → `toCaptureRecord` → `upsertCapture` → `insertResult.id` + `captureRecord.bodyText`.

---

## 7. Dimension Configuration

| Provider | Model | Typical Dimension |
|----------|-------|-------------------|
| GLM | `embedding-2` | 1024 |
| OpenAI | `text-embedding-3-small` | 1536 |
| OpenAI | `text-embedding-3-large` | 3072 |
| Ollama | `nomic-embed-text` | 768 |

The dimension must match between embedding calls and the LanceDB table. If the provider or model changes, the table may need to be recreated (or a new table with a different name).
