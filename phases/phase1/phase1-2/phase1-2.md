# Phase 1.2: Local Ingestion + MCP Search Service (SQLite)

Build one local backend service that:
- receives extracted webpage data from the extension,
- stores it in SQLite,
- exposes MCP/RPC tools for keyword search.

This replaces the temporary JSON-file approach and keeps the architecture simple for MVP.

## Selected Tech Stack

### 1) Runtime and Language
- **Node.js + TypeScript**
- Reason: easy integration with extension tooling and strong ecosystem for local APIs + MCP.

### 2) Local API Layer (for extension ingestion)
- **Fastify** (or Express; prefer Fastify for speed and schema-first validation)
- Reason: lightweight local HTTP endpoint for `POST /captures`.

### 3) Database
- **SQLite** (`better-sqlite3`)
- Reason: zero-setup local DB, single file, fast enough for MVP, good query support.

### 4) RPC / MCP Layer
- **Model Context Protocol server** in the same Node process
- Reason: avoid running multiple services; one process handles both ingestion and search tools.

### 5) Validation and Config
- **Zod** for request/tool input validation
- **dotenv** for local config (`PORT`, `DB_PATH`)

## Implementation Steps

1. **Create service workspace**
   - Add a new folder (example: `services/local-mcp-server`).
   - Initialize TypeScript project and scripts (`dev`, `build`, `start`).

2. **Define shared capture schema**
   - Create a single capture type/schema for:
     - `title`, `url`, `referrer`, `bodyText`, `maxScrollPercentage`, `capturedAt`, `sourceSession`.
   - Reuse this schema in HTTP ingestion and MCP search tools.

3. **Initialize SQLite and migrations**
   - Add DB bootstrap on server startup.
   - Create table `captures` with indexes on:
     - `url`
     - `captured_at`
     - optional FTS index (later step) for `body_text`.
   - Configure SQLite pragmas for local reliability/performance (for example WAL mode).

4. **Implement ingestion API for extension**
   - Add `POST /captures` endpoint.
   - Validate payload, normalize text, upsert/insert records.
   - Return record id + status.
   - Add `GET /health` endpoint for extension connectivity checks.

5. **Wire extension sync**
   - Update extension content script to send captured records to local API.
   - Keep `chrome.storage.local` as fallback queue when server is unavailable.
   - Add retry with exponential backoff.

6. **Implement MCP search tools**
   - Add tool: `search_captures(keyword, limit, since?)`.
   - Add tool: `get_capture_by_id(id)`.
   - Query SQLite and return concise snippets + metadata (title/url/time).

7. **Add basic ranking and snippet extraction**
   - Start with `LIKE`/keyword matching.
   - Return top matches sorted by recency + keyword count.
   - Optionally migrate to SQLite FTS5 for faster full-text search.

8. **Local developer setup**
   - Add `.env.example` with `PORT` and `DB_PATH`.
   - Add run instructions in README:
     - start local server,
     - load extension,
     - verify capture ingestion,
     - verify MCP search tool calls.

9. **Testing and verification**
   - Add minimal integration tests:
     - ingest capture -> persisted in SQLite
     - search returns expected capture
   - Manual E2E:
     - browse page -> extension captures -> server stores -> MCP can retrieve.

## Deliverables for Phase 1.2

- One local Node service running both ingestion API and MCP search tools.
- SQLite-backed capture persistence with schema and indexes.
- Extension successfully syncing captured data to local service.
- Working MCP keyword search over stored captures.
