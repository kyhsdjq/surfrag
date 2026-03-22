# Phase 3.2: Build and Run Local LightRAG (Installation from Source)

Build LightRAG from the submodule at `services/lightrag/` and run the local API server. Environment setup (uv, Python, bun, etc.) is documented in [env3-2.md](./env3-2.md).

---

## Goal

- Install Python dependencies for LightRAG (with API extras) from source.
- Build the LightRAG WebUI frontend artifacts.
- Configure environment (.env) for LLM and embedding.
- Run the LightRAG API server locally.

---

## Prerequisites

- [ ] Phase 3.1 complete: `services/lightrag/` exists and contains LightRAG source.
- [ ] Environment ready: uv, Python 3.10+, bun (see [env3-2.md](./env3-2.md)).

---

## Plan

### 1. Install Python dependencies (uv sync)

From the repo root:

```bash
cd services/lightrag
uv sync --extra api
```

This will:

- Create/use `.venv/` under `services/lightrag/`
- Install the project in editable mode with the `api` extras
- Populate the virtual environment with all required packages

**Alternative (pip):**

```bash
cd services/lightrag
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # Linux/macOS
pip install -e ".[api]"
```

### 2. Build LightRAG WebUI

The LightRAG server serves a Web UI that must be built first:

```bash
cd services/lightrag/lightrag_webui
bun install --frozen-lockfile
bun run build
cd ../..
```

Outputs go into `lightrag/api/static` (or similar). The server expects these artifacts to exist.

### 3. Configure environment

Copy the example env file and edit it for your LLM and embedding configuration:

```bash
cd services/lightrag
cp env.example .env
# Edit .env with your settings (LLM provider, embedding API, etc.)
```

Required sections in `.env` (see `env.example` for details):

- **LLM:** OpenAI/GLM/Ollama/etc.
- **Embedding:** OpenAI/Voyage/etc.
- **Storage path:** Where LightRAG stores graph + vectors (default: `./data/lightrag` or similar)

Optional: Use the setup wizard if available:

```bash
make env-base   # Interactive LLM/embedding setup
```

### 4. Launch the LightRAG server

With the venv active (or `uv run`):

```bash
cd services/lightrag
uv run lightrag-server
# Or, if venv is activated: lightrag-server
```

Default port is usually 8020. Check console output or `.env` for the actual port.

### 5. Verify

- [ ] Server starts without errors.
- [ ] `GET http://localhost:8020/health` (or your configured port) returns OK.
- [ ] Web UI at `http://localhost:<port>/` loads (if enabled).
- [ ] LightRAG can receive inserts and queries (test via Web UI or API).

---

## Project Layout (Reference)

```
surfrag/
├── services/
│   └── lightrag/           # LightRAG submodule (Phase 3.1)
│       ├── .venv/          # Python virtual env (created by uv sync)
│       ├── uv.lock         # Locked dependency versions
│       ├── pyproject.toml  # Project + deps
│       ├── env.example    # Template for .env
│       ├── .env           # Your config (create from env.example)
│       ├── lightrag/      # Package source
│       │   └── api/       # Server + static assets
│       └── lightrag_webui/
│           ├── node_modules/  # bun install
│           └── dist/         # bun run build output
```

---

## Startup Order (Phase 3 Integration)

When integrating with the SurfRAG MCP server (Phase 3.3+):

1. Start the LightRAG server first (`lightrag-server`).
2. Then start the MCP server (configured with `LIGHTRAG_URL`).

---

## Troubleshooting

| Issue | Possible fix |
|-------|--------------|
| `uv sync` fails | Ensure Python 3.10+ and uv are installed; run from `services/lightrag/`. |
| `bun install` fails | Ensure bun is installed; try `bun install` without `--frozen-lockfile` if lockfile issues. |
| Server fails with import errors | Re-run `uv sync --extra api` and ensure venv is activated. |
| Web UI 404 | Ensure `bun run build` completed and assets are in the expected static path. |
| LLM/embedding errors | Check `.env` for valid API keys and correct provider settings. |

---

## Outputs

- [ ] `services/lightrag/.venv/` — Python virtual environment with lightrag-hku[api]
- [ ] `services/lightrag/lightrag_webui/node_modules/` — Frontend dependencies
- [ ] `services/lightrag/.env` — Configured environment (LLM, embedding)
- [ ] LightRAG server running and reachable on configured port
