# Phase 3.4: MCP Tool `lightrag_query`

Build the `lightrag_query` MCP tool that forwards natural language queries to the LightRAG API and returns graph-based RAG results. This is the primary retrieval tool (LightRAG is the default backend).

---

## Goal

Expose LightRAG's query API via an MCP tool so agents can perform graph-based RAG retrieval over captured web pages. Align with `search_captures` and `vector_search` style: structured JSON output the agent can use.

---

## Prerequisites

- [ ] Phase 3.1: LightRAG submodule at `services/lightrag/`
- [ ] Phase 3.2: LightRAG built and running (`lightrag-server` on port 9621)
- [ ] Phase 3.3: Captures syncing to LightRAG via `POST /captures`

---

## Task: Build MCP Tool `lightrag_query`

### LightRAG API

- **Endpoint:** `POST {LIGHTRAG_URL}/query`
- **Request:** `{ query: string, mode?: string, chunk_top_k?: number, only_need_context?: boolean, ... }`
- **Response:** `{ response: string, references?: Array<{ reference_id, file_path }> }`

See [schema3-4.md](./schema3-4.md) for full input/output schema.

### Tool Behavior

1. **When enabled:** Call LightRAG `POST /query` with the tool's input parameters.
2. **When disabled or unreachable:** Return an error message (similar to `vector_search` when disabled).
3. **Output:** Return structured JSON with `response` and `references` (or `matches`-style list for consistency with `vector_search`/`search_captures`).

### Env Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTRAG_QUERY_ENABLED` | `true` | Whether to register the `lightrag_query` tool. Set `false` to hide it. |
| `LIGHTRAG_URL` | `http://localhost:9621` | LightRAG API base URL. Must be reachable when tool is enabled. |
| `LIGHTRAG_API_KEY` | — | Optional. X-API-Key header when LightRAG has auth enabled. |
| `SEARCH_CAPTURES_ENABLED` | `false` | Whether to register the `search_captures` tool (keyword search). Set `true` to show it. |
| `VECTOR_SEARCH_ENABLED` | `false` | Whether to register the `vector_search` tool. Set `true` to show it. Requires VECTOR_DB_ENABLED, API_KEY. |
| `get_capture_by_id` | — | Only enabled when `search_captures` or `vector_search` is enabled. Disabled by default (both are off). |

### Error Handling

- If `LIGHTRAG_QUERY_ENABLED=false`: Do not register the tool, or register and return a "LightRAG query disabled" message.
- If `LIGHTRAG_URL` is unreachable or returns 4xx/5xx: Return `isError: true` with a descriptive message.
- If LightRAG returns validation errors (e.g. query too short): Forward the error to the agent.

---

## Implementation Outline

### 1. Add env parsing

- Read `LIGHTRAG_QUERY_ENABLED` (default `true` when unset).
- Reuse `LIGHTRAG_URL` and `LIGHTRAG_API_KEY` from Phase 3.3 (or read in MCP server context).

### 2. Create LightRAG query client

- `queryLightRAG(options: { query, mode?, limit? }, baseUrl: string, apiKey?: string): Promise<LightRAGQueryResult>`
- POST to `{baseUrl}/query` with body derived from options.
- Map MCP `limit` → LightRAG `chunk_top_k` (or `top_k` if appropriate).
- Handle fetch errors and non-2xx responses; throw or return error result.

### 3. Register MCP tool

- Tool name: `lightrag_query`
- Input schema: `query` (required), `mode` (optional, default `mix`), `limit` (optional, default 10).
- Output: JSON string with `response`, `references`, and optional summary (like `vector_search`).

### 4. Conditional registration

- If `LIGHTRAG_QUERY_ENABLED=false`: Either omit the tool or return disabled message on invoke.
- Prefer always registering; on invoke, check enabled and URL reachability, then return error if disabled.

---

## Parameter Mapping (MCP → LightRAG)

| MCP Input | LightRAG API | Notes |
|-----------|--------------|-------|
| `query` | `query` | Required, min 3 chars (LightRAG validates) |
| `mode` | `mode` | `naive` \| `local` \| `global` \| `hybrid` \| `mix`. Default `mix`. |
| `limit` | `chunk_top_k` | Max chunks to retrieve. Default 10. |

Optional future parameters: `only_need_context`, `response_type`, etc. Start minimal.

---

## Deliverables

- [ ] `lightrag_query` MCP tool registered in `services/local-mcp-server/src/mcp/server.ts`
- [ ] LightRAG query client (e.g. `src/lightrag/query.ts`) calling `POST /query`
- [ ] Env: `LIGHTRAG_QUERY_ENABLED`, reuse `LIGHTRAG_URL`, `LIGHTRAG_API_KEY`
- [ ] Schema: [schema3-4.md](./schema3-4.md)

---

## Dependencies

- Phase 3.2 (LightRAG server)
- Phase 3.3 (capture sync, env setup)
