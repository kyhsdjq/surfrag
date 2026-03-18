# Phase 2.3: MCP Tool `vector_search`

Implement the MCP tool `vector_search` for semantic search over captured web pages. This complements `search_captures` (keyword) and enables RAG-style retrieval by conceptual similarity.

**Schema:** See `schema2-3.md` for the MCP input/output schema and descriptions.

---

## Goals

- **MCP tool:** Add `vector_search(query, limit, since?)` to the local MCP server.
- **Data flow:** Embed query → LanceDB similarity search → join with SQLite for metadata (title, url, snippet).
- **Consistency:** Output format aligns with `search_captures` so the LLM can use either tool interchangeably (id, title, url, capturedAt, snippet).

---

## Data Flow

```
MCP tool call: vector_search({ query, limit?, since? })
    → embed(query)  [EmbeddingProvider]
    → lanceClient.vectorSearch(queryVector, limit)
    → LanceDB returns [{ capture_id, chunk_index, _distance }]
    → Dedupe by capture_id (keep best match per capture)
    → For each capture_id: getCaptureById(db, capture_id)
    → Filter by since (captured_at >= since) if provided
    → Build snippet (excerpt from bodyText; no keyword highlight)
    → Return { matches: [...], totalMatches }
```

### Deduplication

LanceDB may return multiple rows for the same `capture_id` when chunking produces multiple vectors per capture. For Phase 2.2 (whole-page), there is one vector per capture, so no deduplication is needed. For future chunking: keep the row with the lowest `_distance` per `capture_id`.

### Snippet for Vector Search

Unlike keyword search, there is no keyword to highlight. Use a simple excerpt: first `MAX_SNIPPET_LENGTH` (220) chars of `bodyText`, normalized (whitespace collapsed). Same convention as `search_captures` when keyword is not found.

---

## Implementation Tasks

### 1. Bootstrap LanceDB and Embedding in MCP Server

The MCP server (`mcp/server.ts`) currently only bootstraps SQLite. Add:

- **Conditional bootstrap:** If `API_KEY` (or `ZHIPU_API_KEY`) and `VECTOR_DB_PATH` are set, bootstrap LanceDB and get embedding provider. Otherwise, `vector_search` is unavailable.
- **Shared config:** Use same env vars as `index.ts` (Phase 2.1/2.2): `VECTOR_DB_PATH`, `EMBED_PROVIDER`, `API_KEY`, etc.

### 2. Register `vector_search` Tool

- **When vector indexing is disabled:** Do not register the tool, or register it and return a clear error (e.g. "Vector search is disabled. Set API_KEY and VECTOR_DB_PATH to enable.").
- **Input:** `query` (required), `limit` (optional, default 10, max 50), `since` (optional, ISO 8601).
- **Handler logic:**
  1. Validate `since` if provided.
  2. Call `embedProvider.embed(query)`.
  3. Call `lanceClient.vectorSearch(queryVector, limit)`.
  4. Dedupe by `capture_id` (keep lowest `_distance`).
  5. For each `capture_id`, call `getCaptureById(db, id)`.
  6. Filter out nulls and apply `since` filter (captured_at >= since).
  7. Build matches with id, title, url, capturedAt, snippet, distance (optional).
  8. Return JSON in schema2-3 format.

### 3. Error Handling

| Scenario | Behavior |
|----------|----------|
| Vector indexing disabled | Return `isError: true` with message explaining how to enable. |
| Embedding API fails | Return `isError: true` with descriptive message. |
| LanceDB not connected | Same as disabled. |
| Invalid `since` format | Return `isError: true` with format hint. |
| Empty query | Return `isError: true` or treat as invalid. |

### 4. Tool Description

Write a clear, LLM-oriented description (see schema2-3.md) so the agent knows when to use `vector_search` vs `search_captures`:

- **vector_search:** Semantic similarity; use when the user asks by meaning (e.g. "pages about machine learning", "tutorials on neural networks").
- **search_captures:** Keyword match; use when the user has specific terms to find.

---

## Deliverables

- [ ] `schema2-3.md` — MCP tool schema for `vector_search` (input/output, descriptions).
- [ ] `mcp/server.ts` — Bootstrap LanceDB + embedding when env is set; register `vector_search` tool.
- [ ] Deduplication logic — Keep best match per capture_id when multiple chunks exist.
- [ ] Error handling — Disabled state, invalid input, embedding/DB failures.
- [ ] Snippet helper — Export or reuse excerpt logic for vector results (no keyword).

---

## Dependencies

- Phase 2.1 (env, LanceDB, GLM embedding provider).
- Phase 2.2 (vector ingestion, `capture_vectors` table, `upsertVectors`).
- Phase 1.2 (MCP server structure, `search_captures`, `get_capture_by_id`).
