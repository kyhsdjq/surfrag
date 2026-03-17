# Phase 2.1: Embedding Infrastructure (LanceDB + GLM)

Implement the embedding layer for Phase 2: LanceDB as vector store and GLM (智谱 `embedding-2`) as the first embedding provider. Expose a **public interface** so other LLM providers (OpenAI, Ollama, etc.) can be added later without changing the pipeline.

## Scope

- **LanceDB** integration for vector storage
- **`EmbeddingProvider`** public interface (provider-agnostic)
- **GLM provider** (智谱 `embedding-2`) — first implementation
- No MCP tools or ingestion wiring yet (Phase 2.2+)

---

## Public Interface: EmbeddingProvider

Define a provider-agnostic interface that all embedding backends must implement. Other providers (OpenAI, Ollama, Cohere) will implement this interface later.

```typescript
// src/embedding/types.ts

export interface EmbeddingProvider {
  /** Embed a single text. Returns a vector of configurable dimension. */
  embed(text: string): Promise<number[]>

  /** Embed multiple texts. May batch for efficiency. */
  embedBatch(texts: string[]): Promise<number[][]>

  /** Dimension of returned vectors (e.g. 1024 for GLM embedding-2). */
  readonly dimension: number

  /** Provider identifier (e.g. "glm", "openai", "ollama"). */
  readonly name: string
}
```

### Design Notes

- `dimension` is required so LanceDB can create the table with the correct vector schema.
- `embedBatch` allows batching for ingestion; providers may implement sequential calls or use native batch APIs.
- No provider-specific types in the interface; all use `number[]`.

---

## Implementation Plan

### 1. Add Dependencies

| Package | Purpose |
|---------|---------|
| `@lancedb/lancedb` | Vector database |
| (none for GLM) | Use `fetch` for 智谱 REST API; no SDK required |

### 2. Project Structure

```
services/local-mcp-server/src/
├── embedding/
│   ├── types.ts          # EmbeddingProvider interface (public)
│   ├── glm.ts            # GLMEmbeddingProvider implementation
│   ├── factory.ts        # getEmbeddingProvider(env) → EmbeddingProvider
│   └── index.ts          # Re-exports
├── vector/
│   ├── lancedb.ts        # LanceDB connect, createTable, vectorSearch, add
│   └── index.ts          # Re-exports
└── ... (existing)
```

### 3. GLM Provider (`embedding/glm.ts`)

- **API:** `POST https://open.bigmodel.cn/api/paas/v4/embeddings`
- **Auth:** `Authorization: Bearer ${API_KEY}`
- **Model:** `embedding-2` (configurable via `EMBED_MODEL`, default `embedding-2`)
- **Dimension:** 1024 (fixed for embedding-2)
- **Input:** Single string or array of strings; 智谱 supports batch.
- **Error handling:** Throw on non-2xx; include status and message for debugging.

### 4. LanceDB Module (`vector/lancedb.ts`)

- **Connect:** `lancedb.connect(VECTOR_DB_PATH)` — path from env.
- **Table:** `captures` (or configurable name).
- **Schema:** `{ vector: number[], capture_id: string, ... }` — `capture_id` links to SQLite.
- **Operations:**
  - `createTableIfNotExists(name, schema)` — create on first run.
  - `add(records)` — append vectors with metadata.
  - `vectorSearch(vector, limit)` — similarity search, return `capture_id` + score.
- **Dimension:** Passed from `EmbeddingProvider.dimension`; table schema must match.

### 5. Provider Factory (`embedding/factory.ts`)

```typescript
export function getEmbeddingProvider(env: Env): EmbeddingProvider {
  const provider = env.EMBED_PROVIDER ?? "glm"
  switch (provider) {
    case "glm":
      return new GLMEmbeddingProvider(env)
    // case "openai": return new OpenAIEmbeddingProvider(env)  // Phase 2.2+
    // case "ollama": return new OllamaEmbeddingProvider(env)  // Phase 2.2+
    default:
      throw new Error(`Unknown EMBED_PROVIDER: ${provider}`)
  }
}
```

### 6. Config / Env

See `env2-1.md` for full env setup. Phase 2.1 uses:

- `EMBED_PROVIDER` — `glm` (default)
- `API_KEY` — required for API-based providers (GLM, OpenAI, etc.)
- `EMBED_MODEL` — `embedding-2` (default)
- `VECTOR_DB_PATH` — path to LanceDB data directory

---

## Implementation Steps (Checklist)

1. [ ] Add `@lancedb/lancedb` to `package.json`.
2. [ ] Create `src/embedding/types.ts` with `EmbeddingProvider` interface.
3. [ ] Create `src/embedding/glm.ts` — `GLMEmbeddingProvider` implementing the interface.
4. [ ] Create `src/embedding/factory.ts` — `getEmbeddingProvider(env)`.
5. [ ] Create `src/embedding/index.ts` — re-exports.
6. [ ] Create `src/vector/lancedb.ts` — connect, createTable, add, vectorSearch.
7. [ ] Create `src/vector/index.ts` — re-exports.
8. [ ] Add env vars to `.env.example` (see `env2-1.md`).
9. [ ] Add a minimal test or script to verify: GLM embed → LanceDB add → vectorSearch.

---

## Deliverables for Phase 2.1

- **`EmbeddingProvider`** interface exported for future providers.
- **`GLMEmbeddingProvider`** (智谱 `embedding-2`) working.
- **LanceDB** module with connect, add, vectorSearch.
- **Provider factory** selecting implementation from env.
- **Env documentation** in `env2-1.md`.
- No changes to HTTP ingestion or MCP tools yet.
