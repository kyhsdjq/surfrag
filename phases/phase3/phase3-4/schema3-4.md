# Phase 3.4: Schema for `lightrag_query` MCP Tool

Input/output schema for the `lightrag_query` MCP tool and the underlying LightRAG API.

---

## 1. MCP Tool Input

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Natural language question. Min 3 characters (LightRAG requirement). |
| `mode` | string | No | `mix` | Query mode: `naive` \| `local` \| `global` \| `hybrid` \| `mix`. |
| `limit` | number | No | 10 | Max text chunks to retrieve (maps to `chunk_top_k`). |

### Query Modes

| Mode | Description |
|------|-------------|
| `naive` | Vector-only retrieval. |
| `local` | Entity-focused (local graph context). |
| `global` | Community/summary (global graph context). |
| `hybrid` | Local + global combined. |
| `mix` | Recommended with reranker; balances local and global. |

---

## 2. LightRAG API Request

**Endpoint:** `POST {LIGHTRAG_URL}/query`

**Headers:** `Content-Type: application/json`, optional `X-API-Key` when auth enabled.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Query text (min 3 chars). |
| `mode` | string | No | `mix` | `local` \| `global` \| `hybrid` \| `naive` \| `mix` \| `bypass`. |
| `chunk_top_k` | number | No | (server default) | Max chunks from vector search. |
| `only_need_context` | boolean | No | false | If true, returns context only (no LLM answer). |
| `include_references` | boolean | No | true | Include reference list in response. |

Other LightRAG params (`top_k`, `max_entity_tokens`, etc.) use server defaults for Phase 3.4.

---

## 3. LightRAG API Response

**Success (200):**

```json
{
  "response": "The generated answer from the RAG system.",
  "references": [
    {
      "reference_id": "1",
      "file_path": "https://example.com/page"
    }
  ]
}
```

- `response`: LLM-generated answer (or empty if `only_need_context=true`).
- `references`: Source list; `file_path` is typically the capture URL (web link).

---

## 4. MCP Tool Output

Return a text content block with JSON:

```json
{
  "response": "The generated answer...",
  "references": [
    { "reference_id": "1", "file_path": "https://example.com/page" }
  ],
  "query_mode": "mix",
  "summary": "LightRAG returned 1 reference(s). Use get_capture_by_id if capture UUID is known."
}
```

When `only_need_context=true`, `response` may be empty; `references` and chunk content (if requested) are the primary output.

### Error Output

When LightRAG is disabled, unreachable, or returns an error:

```json
{
  "error": "Error: LightRAG query failed. Set LIGHTRAG_QUERY_ENABLED=true and ensure LightRAG server is running at LIGHTRAG_URL."
}
```

Or for validation errors (e.g. query too short):

```json
{
  "error": "Error: Query must be at least 3 characters."
}
```

---

## 5. Env Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LIGHTRAG_QUERY_ENABLED` | boolean | `true` | Register and enable `lightrag_query`. `false` = tool returns disabled message. |
| `LIGHTRAG_URL` | string (URL) | `http://localhost:9621` | LightRAG API base URL. |
| `LIGHTRAG_API_KEY` | string | — | Optional. X-API-Key header when LightRAG auth is enabled. |
