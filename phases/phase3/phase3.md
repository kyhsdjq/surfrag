# Phase 3: Merge LightRAG into MCP

Integrate [LightRAG](https://github.com/HKUDS/LightRAG) (graph-based RAG) into the SurfRAG MCP server. LightRAG adds entity/relationship extraction and knowledge-graph retrieval on top of vector search, enabling context-aware answers from captured web pages.

---

## Goals

- **RAG retrieval:** Use LightRAG's dual-level retrieval (graph + vector) for richer context than keyword or vector search alone.
- **Unified MCP:** Expose LightRAG via new MCP tools (e.g. `lightrag_query`) so the agent can choose RAG-style retrieval when appropriate.
- **Incremental sync:** Feed captured page content into LightRAG as it arrives via `POST /captures`.
- **Local-first:** LightRAG runs locally (Python); no extra cloud dependency beyond the existing embedding API.

---

## LightRAG Overview

| Aspect | Details |
|--------|---------|
| **Repo** | [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) |
| **Language** | Python 3.10+ |
| **Install** | `pip install lightrag-hku` or `pip install "lightrag-hku[api]"` |
| **Core** | Entity/relationship extraction → knowledge graph + vector index |
| **Query modes** | `naive` (vector only), `local` (entity-focused), `global` (community/summary), `hybrid` (local + global), `mix` (recommended with reranker) |

### LightRAG API Server

LightRAG provides a FastAPI server with REST endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/insert` | POST | Insert text into RAG (extracts entities, builds graph, indexes) |
| `/query` | POST | Query with mode (`naive`, `local`, `global`, `hybrid`, `mix`) |
| `/insert_file` | POST | Upload and insert file content |
| `/health` | GET | Health check |

---

## Architecture Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. LightRAG as sidecar** | Run LightRAG API server as a separate process; MCP calls it via HTTP. | Clear separation; LightRAG runs independently. | Two processes to manage; need to start LightRAG before MCP. |
| **B. Node spawns LightRAG** | Node MCP server spawns LightRAG subprocess on startup; communicates via HTTP (localhost). | Single entry point; can auto-start LightRAG. | Process lifecycle; Python must be installed. |
| **C. Shared storage, no API** | Use LightRAG's storage format; call LightRAG Python via `child_process.exec` per request. | No long-running Python server. | Slow (cold start per query); complex. |

**Recommendation:** **Option A (sidecar)** for Phase 3. Run `lightrag-server` (or equivalent) as a separate process. The MCP server calls `http://localhost:LIGHTRAG_PORT` for insert and query. Document startup order (LightRAG first, then MCP). Option B can be explored later (e.g. `pnpm start:all` that starts both).

---

## Data Flow

```
POST /captures (existing)
    → SQLite (metadata)
    → LanceDB (vectors)
    → [NEW] LightRAG /insert (bodyText + metadata as document)

MCP lightrag_query({ query, mode?, limit? })
    → HTTP POST to LightRAG /query
    → Return retrieved context + answer (or context only, depending on tool design)
```

### Document Format for LightRAG Insert

LightRAG expects text. For each capture, build a document string:

```
Title: {title}
URL: {url}
Captured: {capturedAt}

{bodyText}
```

This gives LightRAG enough context for entity extraction and retrieval.

---

## Implementation Outline

### 1. LightRAG Service Setup

- **Directory:** `services/lightrag/` (or run from a dedicated env).
- **Config:** Python venv, `pip install "lightrag-hku[api]"`, configure LLM and embedding (OpenAI/GLM compatible).
- **Storage:** LightRAG uses its own storage (graph DB + vector). Configure path (e.g. `./data/lightrag`) separate from LanceDB.
- **Start:** `lightrag-server` or `uvicorn` on configurable port (e.g. 8020).

### 2. Sync Captures to LightRAG

- **Trigger:** After `upsertCapture` and vector indexing (Phase 2.2), also call LightRAG `/insert` with the document string.
- **Options:**
  - **Sync:** Await LightRAG insert before replying (adds latency).
  - **Async:** Fire-and-forget; queue or background task (preferred).
- **Idempotency:** LightRAG may not support upsert by URL. Consider `insert` with a stable doc ID (e.g. `capture:{id}`) or accept duplicates and dedupe at query time.

### 3. MCP Tool: `lightrag_query`

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `query` | string | Yes | Natural language question. |
| `mode` | string | No | `naive` \| `local` \| `global` \| `hybrid` \| `mix`. Default: `mix`. |
| `limit` | number | No | Max context chunks. Default: 10. |

**Output:** Retrieved context (and optionally LLM-generated answer if LightRAG returns one). Align with `vector_search` / `search_captures` style: return structured JSON the agent can use.

### 4. Config and Env

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTRAG_URL` | `http://localhost:8020` | LightRAG API server base URL. |
| `LIGHTRAG_INSERT_ENABLED` | `true` | Whether to sync new captures to LightRAG. |
| `LIGHTRAG_QUERY_ENABLED` | `true` | Whether to register `lightrag_query` tool. |

If `LIGHTRAG_URL` is unreachable, `lightrag_query` returns an error (similar to vector search when disabled).

---

## Deliverables

- [ ] **LightRAG service** — Python env, config, startup script (or Docker).
- [ ] **Sync pipeline** — Call LightRAG `/insert` when captures arrive (sync or async).
- [ ] **MCP tool** — `lightrag_query(query, mode?, limit?)` calling LightRAG `/query`.
- [ ] **Schema** — `schema3-1.md` for `lightrag_query` input/output.
- [ ] **Docs** — README update: how to run LightRAG, env vars, startup order.

---

## Dependencies

- Phase 1 (extension, captures, SQLite).
- Phase 2 (vector ingestion, LanceDB, embedding).
- Python 3.10+ with LightRAG installed.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Python runtime required | Document clearly; consider Docker for one-command setup. |
| LightRAG insert latency | Use async/fire-and-forget; don't block HTTP response. |
| Duplicate content on update | LightRAG may re-insert; monitor storage; future: support update/delete if LightRAG adds it. |
| Two vector stores | LanceDB (SurfRAG) and LightRAG's internal store are separate; acceptable for Phase 3. |
