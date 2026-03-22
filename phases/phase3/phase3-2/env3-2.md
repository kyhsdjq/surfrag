# Phase 3.2: Environment Setup for Local LightRAG (from Source)

Environment and tooling required to build and run LightRAG from `services/lightrag/`.

---

## Prerequisites

- Phase 3.1 complete: LightRAG submodule at `services/lightrag/` exists (see [phase3-1.md](../phase3-1/phase3-1.md)).

---

## 1. uv (Python Package Manager)

LightRAG uses [uv](https://docs.astral.sh/uv/) for fast Python dependency management.

### Check if already installed

```bash
uv --version
```

- **If installed:** You should see a version string (e.g. `uv 0.5.x`).
- **If not installed:** The command will fail or not be found.

### Install

| OS | Command |
|----|---------|
| **Windows (PowerShell)** | `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"` |
| **Linux / macOS** | `curl -LsSf https://astral.sh/uv/install.sh | sh` |

Then restart your shell or add uv to `PATH` if needed.

### Verify

```bash
uv --version
```

---

## 2. Python 3.10+

LightRAG requires Python 3.10 or newer. **On Windows, prefer Python 3.12** — numpy 1.26.4 has no wheel for Python 3.13, so uv builds from source; with MINGW in PATH this produces a crashing MINGW build. Use Python 3.12 to get pre-built wheels.

### Check if already installed

```bash
python --version
# or
python3 --version
```

- **If 3.10–3.12:** You’re good.
- **If 3.13 on Windows:** Recreate venv with Python 3.12 (see below).
- **If older or missing:** Install Python 3.10+ via [python.org](https://www.python.org/downloads/).

### Windows: recreate venv with Python 3.12 (if numpy MINGW crash)

```powershell
cd services/lightrag
Remove-Item -Recurse -Force .venv
uv venv --python 3.12
uv sync --extra api
```

### Verify

```bash
python --version
# Prefer Python 3.12.x on Windows
```

---

## 3. bun (JavaScript Runtime for WebUI)

The LightRAG WebUI (`lightrag_webui`) is built with Vite and uses [bun](https://bun.sh/) for dependency install and build.

### Check if already installed

```bash
bun --version
```

- **If installed:** You’ll see a version string (e.g. `1.1.x`).
- **If not installed:** The command will fail or not be found.

### Install

| OS | Command |
|----|---------|
| **Windows (PowerShell)** | `powershell -c "irm bun.sh/install.ps1 | iex"` |
| **Linux / macOS** | `curl -fsSL https://bun.sh/install \| bash` |

Restart the shell after install if `bun` is not recognized.

### Verify

```bash
bun --version
```

---

## 4. Python Dependencies (via uv sync)

Python dependencies are installed in the [phase3-2](./phase3-2.md) build step via `uv sync --extra api` from `services/lightrag/`. No separate installation steps here.

### Check if virtual environment exists

```bash
# From repo root
test -d services/lightrag/.venv && echo "venv exists" || echo "venv missing"
```

On Windows PowerShell:

```powershell
Test-Path services\lightrag\.venv
```

---

## 5. bun Dependencies (lightrag_webui)

Frontend dependencies are installed when building the WebUI in phase3-2.

### Check if node_modules exists

```bash
# From repo root
test -d services/lightrag/lightrag_webui/node_modules && echo "installed" || echo "not installed"
```

---

## Summary: Quick Check Script

Run these to verify all tools before proceeding to phase3-2 build:

```bash
echo "=== uv ===" && (uv --version || echo "NOT INSTALLED")
echo "=== Python ===" && (python --version || python3 --version || echo "NOT FOUND")
echo "=== bun ===" && (bun --version || echo "NOT INSTALLED")
```

---

## Optional: pip Fallback

If you prefer not to use uv, LightRAG supports pip:

```bash
# Create venv and install (from services/lightrag/)
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # Linux/macOS
pip install -e ".[api]"
```

Phase 3.2 build steps assume `uv`; adjust commands accordingly if using pip.
