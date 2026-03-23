# Phase 3.3: Schema for Capture→LightRAG Sync and Storage Toggles

Schemas and formats for syncing captures to LightRAG and for global storage settings.

---

## 1. Capture Ingest (unchanged)

SurfRAG's `POST /captures` accepts `CaptureIngestInput`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pageId` | string | No | Stable page identifier; optional. |
| `title` | string | Yes | Page title. |
| `url` | string (URL) | Yes | Web URL (e.g. `https://example.com/v1`). Used as `file_source` for LightRAG. |
| `referrer` | string | No | Referrer URL. |
| `bodyText` | string | Yes | Main text content. |
| `maxScrollPercentage` | number | No | 0–100, default 0. |
| `capturedAt` | string (ISO 8601) | No | Capture timestamp. |
| `sourceSession` | string | No | Session identifier. |

---

## 2. LightRAG Insert Request

**Endpoint:** `POST {LIGHTRAG_URL}/documents/text`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Document text to insert. |
| `file_source` | string | No | Source of the text (web URL for citation). Use capture's `url`. |

### Document Text Format

```
Title: {title}
URL: {url}
Captured: {capturedAt}

{bodyText}
```

- `{title}`: capture title
- `{url}`: capture URL (same as `file_source`)
- `{capturedAt}`: capture timestamp (ISO 8601)
- `{bodyText}`: capture body text

### Example

**Request to LightRAG:**
```json
{
  "text": "Title: Example Page\nURL: https://example.com/v1\nCaptured: 2025-03-23T12:00:00.000Z\n\nThis is the page body...",
  "file_source": "https://example.com/v1"
}
```

---

## 3. LightRAG Insert Response

LightRAG returns an `InsertResponse`; the MCP service does not need to parse it for the sync flow. On success, HTTP 2xx; on error, HTTP 4xx/5xx. The sync helper should only check success/failure for logging.

---

## 4. Document ID (optional, future)

If LightRAG supports `ids` or equivalent for upsert/deduplication:

- Suggested format: `capture:{pageId}` or `capture:{id}`
- Current Phase 3.3: not required; duplicates may occur on re-capture.

---

## 5. Global Storage Settings (.env)

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `LIGHTRAG_INSERT_ENABLED` | boolean | `true` | Sync captures to LightRAG (primary). `false` to disable. |
| `LIGHTRAG_URL` | string (URL) | `http://localhost:9621` | LightRAG API base URL. Start LightRAG server first. |
| `VECTOR_DB_ENABLED` | boolean | `false` | Store captures in LanceDB (vector search, second choice). `true` to enable. |

### Boolean parsing

- `true`, `1`, `yes`, `on` → enabled
- `false`, `0`, `no`, `off`, empty, unset → disabled

---

## 6. Capture Pipeline Order

```
POST /captures
  → 1. SQLite upsert (always)
  → 2. LanceDB upsert (if VECTOR_DB_ENABLED && lanceClient)
  → 3. LightRAG insert (if LIGHTRAG_INSERT_ENABLED; async, fire-and-forget)
  → Reply 201
```
