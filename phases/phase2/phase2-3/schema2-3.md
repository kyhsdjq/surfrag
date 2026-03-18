# Schema 2.3: MCP Tool `vector_search`

This document defines the input/output schema and LLM-oriented description for the SurfRAG `vector_search` MCP tool (semantic search).

**Related schemas:** `schema1-2.md` (search_captures, get_capture_by_id), `schema2-2.md` (LanceDB capture_vectors).

---

## Tool: `vector_search`

### Description

Search across captured web pages by semantic similarity. Finds pages that are conceptually related to the query (e.g., "machine learning tutorials" matches pages about neural networks, deep learning). Use this when the user asks by meaning rather than exact keywords. Returns matches with id, title, url, capturedAt, and a short snippet. Call `get_capture_by_id` with the returned id when you need full page content. Maximum 50 results. Optional `since` parameter filters by capture date (ISO 8601). Requires vector indexing to be enabled (API_KEY and VECTOR_DB_PATH configured).

### Input Schema

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `query` | `string` | Yes | Natural language query. Embedded and matched by semantic similarity. |
| `limit` | `number` | No | Maximum results to return. Defaults to 10. Range: 1–50. |
| `since` | `string` | No | Only return captures after this datetime. ISO 8601 format (e.g. `2025-03-01T00:00:00.000Z`). |

**JSON Schema (for MCP inputSchema):**

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Natural language query. Matched by semantic similarity (e.g. 'machine learning tutorials', 'pages about neural networks')."
    },
    "limit": {
      "type": "number",
      "default": 10,
      "minimum": 1,
      "maximum": 50,
      "description": "Maximum number of results to return"
    },
    "since": {
      "type": "string",
      "description": "Optional. Only captures after this datetime. ISO 8601 format (e.g. 2025-03-01T00:00:00.000Z)"
    }
  },
  "required": ["query"]
}
```

### Output

MCP tool result format: `{ content: [{ type: "text", text: "..." }], isError?: boolean }`

The `text` field should include:
1. A human-readable summary (e.g. "Found 5 semantically similar captures. Use get_capture_by_id(id) for full content.")
2. JSON payload with the following structure:

```json
{
  "matches": [
    {
      "id": "string (UUID)",
      "pageId": "string (stable page-session id)",
      "title": "string",
      "url": "string",
      "capturedAt": "string (ISO 8601)",
      "snippet": "string (excerpt from body text)",
      "distance": "number (optional, lower = more similar)"
    }
  ],
  "totalMatches": "number (optional)"
}
```

### Field Mapping (LanceDB → Output)

| LanceDB / SQLite | Output |
|------------------|--------|
| `capture_id` | `id` |
| `captures.page_id` | `pageId` |
| `captures.title` | `title` |
| `captures.url` | `url` |
| `captures.captured_at` | `capturedAt` |
| Excerpt of `captures.body_text` (first ~220 chars) | `snippet` |
| `_distance` from vector search | `distance` (optional) |

### When Vector Search Is Disabled

If `API_KEY` or `VECTOR_DB_PATH` is not configured, the tool returns:

```json
{
  "content": [{ "type": "text", "text": "Error: Vector search is disabled. Set API_KEY and VECTOR_DB_PATH to enable semantic search." }],
  "isError": true
}
```

---

## Comparison: `vector_search` vs `search_captures`

| Aspect | `vector_search` | `search_captures` |
|--------|-----------------|-------------------|
| **Matching** | Semantic similarity (embedding) | Keyword match (SQL LIKE) |
| **Use when** | User asks by meaning ("tutorials on ML") | User has specific terms ("React hooks") |
| **Input** | `query` (natural language) | `keyword` (search term) |
| **Snippet** | Excerpt (first N chars) | Keyword-context excerpt |
| **Extra field** | `distance` (similarity) | `keywordCount` |
| **Backend** | LanceDB + SQLite | SQLite only |

---

## Error Handling

- **Vector indexing disabled:** Return `isError: true` with message explaining API_KEY and VECTOR_DB_PATH.
- **Invalid `since` format:** Return `isError: true` with "Expected ISO 8601 datetime."
- **Empty or invalid query:** Return `isError: true` with descriptive message.
- **Embedding API failure:** Return `isError: true` with error details.
- **LanceDB/SQLite failure:** Return `isError: true` or throw (SDK surfaces as JSON-RPC error).

---

## Naming Conventions

- Tool name: `vector_search` (snake_case, verb-noun).
- Parameters: `query`, `limit`, `since` (consistent with schema1-2).
