# Phase 3.3: Sync Captures to LightRAG and Global Storage Toggles

When SurfRAG's MCP service receives an HTTP capture, sync it to the LightRAG service. Add global settings to control whether data is stored in the classic vector database (LanceDB) and/or LightRAG.

**Default settings:** LightRAG is the primary/default retrieval backend. Vector search (LanceDB) is the second choice and disabled by default.

---

## Goals

1. **Sync to LightRAG:** On `POST /captures`, forward the capture to LightRAG's insert API with the web URL as the source (enabled by default).
2. **Global storage toggles:** Add `.env` flags to enable/disable storage into (a) LightRAG (default on) and (b) LanceDB (default off) independently.

---

## Prerequisites

- [ ] Phase 3.1: LightRAG submodule at `services/lightrag/`
- [ ] Phase 3.2: LightRAG built and running (`lightrag-server` on port 9621)
- [ ] Phase 2: Vector ingestion pipeline (LanceDB) in place

---

## Task 1: Sync Captures to LightRAG

### Trigger

When the MCP service receives `POST /captures`, after persisting to SQLite (and optionally to LanceDB when enabled), call LightRAG's insert endpoint when LightRAG sync is enabled.

### LightRAG API

- **Endpoint:** `POST {LIGHTRAG_URL}/documents/text`
- **Body:** `{ text: string, file_source?: string }`
- **file_source:** Use the capture's `url` as the web link (e.g. `https://example.com/page`, `https://example.com/v1`). LightRAG uses this for citation.

### Document Format

Build the document text per Phase 3:

```
Title: {title}
URL: {url}
Captured: {capturedAt}

{bodyText}
```

### Execution Mode

- **Preferred:** Fire-and-forget (async). Do not block the HTTP response on LightRAG insert.
- **Alternative:** Await LightRAG insert if `LIGHTRAG_INSERT_SYNC=true` (optional env; default async).

### Idempotency

- LightRAG may not support upsert by URL. Use a stable document ID (e.g. `capture:{pageId}` or `capture:{id}`) if the API supports it; otherwise accept possible duplicates and rely on query-time behavior.
- Document ID handling: see [schema3-3.md](./schema3-3.md).

### Error Handling

- If `LIGHTRAG_URL` is unreachable or insert fails: log the error; do not fail the main capture flow.
- Capture must still persist to SQLite (and LanceDB when enabled). LightRAG failure is non-fatal.

---

## Task 2: Global Storage Toggles

### Env Variables (in `services/local-mcp-server/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTRAG_INSERT_ENABLED` | `true` | Whether to sync new captures to LightRAG (primary/default). Set `false` to disable. |
| `LIGHTRAG_URL` | `http://localhost:9621` | LightRAG API server base URL. Start LightRAG server first. |
| `VECTOR_DB_ENABLED` | `false` | Whether to store captures in LanceDB (vector search, second choice). Set `true` to enable. |

### Behavior

- **LIGHTRAG_INSERT_ENABLED=true (default):** After SQLite (and optional LanceDB), call LightRAG insert with document text and `file_source=url`.
- **LIGHTRAG_INSERT_ENABLED=false:** Skip LightRAG sync entirely.
- **VECTOR_DB_ENABLED=false (default):** Skip LanceDB indexing. `vector_search` MCP tool returns disabled message.
- **VECTOR_DB_ENABLED=true:** Index captures in LanceDB; `vector_search` available when `API_KEY` is set.

### Bootstrap

- Vector indexing (LanceDB) bootstrapped only when `VECTOR_DB_ENABLED=true` and `API_KEY` (or equivalent) is set.
- LightRAG sync: no bootstrap; HTTP client invoked per capture when `LIGHTRAG_INSERT_ENABLED=true`.

---

## Implementation Outline

### 1. Add env parsing

- Read `VECTOR_DB_ENABLED`, `LIGHTRAG_INSERT_ENABLED`, `LIGHTRAG_URL` from `.env`.
- `canBootstrapVectorIndexing()` should also check `VECTOR_DB_ENABLED`.

### 2. Create LightRAG sync helper

- `syncCaptureToLightRAG(capture: CaptureRecord, lightragUrl: string): Promise<void>`
- Build document string (Title, URL, Captured, bodyText).
- POST to `{lightragUrl}/documents/text` with `{ text: documentString, file_source: capture.url }`.
- Handle fetch errors, log, do not throw.

### 3. Wire into `POST /captures`

- After SQLite upsert and optional LanceDB upsert:
  - If `LIGHTRAG_INSERT_ENABLED` and `LIGHTRAG_URL` set: fire `syncCaptureToLightRAG` (async, non-blocking).
- Do not await LightRAG by default; reply immediately.

### 4. Update `.env.example`

- Add `VECTOR_DB_ENABLED`, `LIGHTRAG_INSERT_ENABLED`, `LIGHTRAG_URL` with defaults and comments.

---

## File Source Format

The `file_source` passed to LightRAG must be a web link. For SurfRAG captures:

- **Source:** `capture.url` (already a URL from the extension, e.g. `https://example.com/article`, `https://example.com/v1`)
- **Use as-is:** No transformation needed; the capture URL is the canonical web source.

---

## Deliverables

- [ ] LightRAG sync: call `/documents/text` with document + `file_source=url` when enabled
- [ ] Env toggles: `VECTOR_DB_ENABLED`, `LIGHTRAG_INSERT_ENABLED`, `LIGHTRAG_URL` in `.env`
- [ ] `canBootstrapVectorIndexing()` respects `VECTOR_DB_ENABLED`
- [ ] Schema: [schema3-3.md](./schema3-3.md) for request/response and document format

---

## Dependencies

- Phase 2 (LanceDB, capture schema)
- Phase 3.1, 3.2 (LightRAG service running)

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| LightRAG down | Non-blocking sync; log and continue. Capture still persisted. |
| Duplicate content in LightRAG | Accept for now; future: doc ID or delete support if LightRAG adds it. |
| Env typo | Validate `LIGHTRAG_URL` format; document in README. |
