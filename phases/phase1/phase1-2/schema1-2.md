# Schema 1.2: MCP Tool Schema and Descriptions

This document defines the input/output schemas and LLM-oriented descriptions for the SurfRAG local MCP search tools.

---

## Tool 1: `search_captures`

### Description

Search across captured web pages by keyword. Matches in title, URL, and body text. Returns a list of matches with id, title, url, capturedAt, and a short snippet. Call `get_capture_by_id` with the returned id when you need full page content for answering. Maximum 50 results. Optional `since` parameter filters by capture date (ISO 8601).

### Input Schema

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `keyword` | `string` | Yes | Search term. Case-insensitive. Matches title, URL, and body text. |
| `limit` | `number` | No | Maximum results to return. Defaults to 10. Range: 1–50. |
| `since` | `string` | No | Only return captures after this datetime. ISO 8601 format (e.g. `2025-03-01T00:00:00.000Z`). |

**JSON Schema (for MCP inputSchema):**

```json
{
  "type": "object",
  "properties": {
    "keyword": {
      "type": "string",
      "description": "Search term. Case-insensitive. Matches in page title, URL, and body text."
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
  "required": ["keyword"]
}
```

### Output

MCP tool result format: `{ content: [{ type: "text", text: "..." }], isError?: boolean }`

The `text` field should include:
1. A human-readable summary (e.g. "Found 5 matching captures. Use get_capture_by_id(id) for full content.")
2. JSON payload with the following structure:

```json
{
  "matches": [
    {
      "id": "string (UUID)",
      "title": "string",
      "url": "string",
      "capturedAt": "string (ISO 8601)",
      "snippet": "string (keyword context excerpt)",
      "keywordCount": "number (optional, for ranking)"
    }
  ],
  "totalMatches": "number (optional)"
}
```

---

## Tool 2: `get_capture_by_id`

### Description

Fetch the full content of a single captured page by its UUID. Use this after `search_captures` when you need the complete body text for RAG or answering. Returns null if the id does not exist.

### Input Schema

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | `string` | Yes | UUID of the capture (from `search_captures` matches). |

**JSON Schema (for MCP inputSchema):**

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "UUID of the capture (from search_captures matches)"
    }
  },
  "required": ["id"]
}
```

### Output

MCP tool result format: `{ content: [{ type: "text", text: "..." }], isError?: boolean }`

The `text` field contains JSON:

```json
{
  "capture": {
    "id": "string (UUID)",
    "title": "string",
    "url": "string",
    "referrer": "string",
    "bodyText": "string",
    "maxScrollPercentage": "number",
    "capturedAt": "string (ISO 8601)",
    "sourceSession": "string"
  }
}
```

When not found: `{ "capture": null }` with `isError: false` (not an error, just empty).

---

## Error Handling

- **User-facing errors** (invalid id, query timeout, etc.): Return `isError: true` with a descriptive message the LLM can act on (e.g. "Error: Invalid capture id format. Expected UUID.").
- **System errors** (DB connection lost): Throw; the SDK will surface as JSON-RPC error.

---

## Naming Conventions

- Tool names: `snake_case`, verb-noun format.
- Parameters: `camelCase` or `snake_case` (consistent with JSON Schema).
