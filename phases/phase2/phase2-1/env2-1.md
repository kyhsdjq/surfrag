# Phase 2.1: Environment Setup (LanceDB + GLM)

How to build the environment for the embedding layer: LanceDB, GLM (智谱) API, and related config.

---

## Prerequisites

| Requirement | Version / Notes |
|-------------|-----------------|
| Node.js | v20 LTS (or v18+) |
| pnpm | 10.x (or npm 9+) |
| OS | Windows, macOS, or Linux (x86_64 / aarch64) |

---

## 1. Install Dependencies

From `services/local-mcp-server`:

```powershell
cd services/local-mcp-server
pnpm add @lancedb/lancedb
```

`@lancedb/lancedb` includes native bindings; it will download the correct binary for your platform. No separate LanceDB server or Python runtime required.

---

## 2. Environment Variables

Create or update `services/local-mcp-server/.env`:

```env
# --- Phase 1 (existing) ---
PORT=3030
DB_PATH=./data/surfrag.db

# --- Phase 2.1: Embedding ---
# Provider: glm | openai | ollama (glm first)
EMBED_PROVIDER=glm

# GLM / 智谱 (when EMBED_PROVIDER=glm)
API_KEY=your-api-key-here
EMBED_MODEL=embedding-2

# LanceDB storage path (directory; will be created if missing)
VECTOR_DB_PATH=./data/lancedb
```

### Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMBED_PROVIDER` | No | `glm` | Embedding provider: `glm`, `openai`, `ollama` (Phase 2.2+). |
| `API_KEY` | Yes (API-based providers) | — | API key for the embedding provider (GLM, OpenAI, etc.). |
| `EMBED_MODEL` | No | `embedding-2` | Model name for GLM; `embedding-2` outputs 1024-dim vectors. |
| `VECTOR_DB_PATH` | No | `./data/lancedb` | Directory for LanceDB data. Created on first connect. |

---

## 3. Get Zhipu (智谱) API Key

1. Go to [智谱 AI 开放平台](https://open.bigmodel.cn/).
2. Sign up / log in.
3. Create an API key in the console.
4. Copy the key and set `API_KEY` in `.env`.

**API base URL:** `https://open.bigmodel.cn/api/paas/v4/embeddings` (used internally; no env var needed unless you use a proxy).

---

## 4. LanceDB Data Directory

- **Path:** `VECTOR_DB_PATH` (default `./data/lancedb`).
- **Behavior:** LanceDB creates the directory on first `connect()` if it does not exist.
- **Content:** LanceDB stores tables as Lance format files in this directory.
- **Backup:** Copy the entire directory to backup; no separate dump step.

---

## 5. Update .env.example

Add Phase 2.1 vars to `services/local-mcp-server/.env.example`:

```env
PORT=3030
DB_PATH=./data/surfrag.db

# Phase 2.1: Embedding
EMBED_PROVIDER=glm
API_KEY=
EMBED_MODEL=embedding-2
VECTOR_DB_PATH=./data/lancedb
```

---

## 6. Verify Setup

After `pnpm install` and `.env` configuration:

1. **Build:**
   ```powershell
   pnpm build
   ```

2. **Run a quick test** (once Phase 2.1 code exists):
   - Call `GLMEmbeddingProvider.embed("test")` → expect `number[]` of length 1024.
   - Call `lancedb.connect(VECTOR_DB_PATH)` → expect no error; directory created if missing.
   - Add a vector and run `vectorSearch` → expect results.

---

## 7. Platform Notes

### Windows

- LanceDB supports Windows x86_64 and aarch64.
- If `@lancedb/lancedb` fails to load native bindings, ensure Visual C++ Redistributable is installed (often already present).

### Network

- GLM embedding calls require outbound HTTPS to `open.bigmodel.cn`.
- If behind a proxy, configure `fetch` or use `NODE_OPTIONS` / proxy env vars as needed.
