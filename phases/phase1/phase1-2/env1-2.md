# Build Env for Phases 1.2

## Goal
Prepare a local development environment for a single service that handles:
- extension ingestion (`POST /captures`),
- SQLite storage,
- MCP/RPC keyword search tools.

## 1) Required Software
- Install **Node.js 20 LTS** (recommended for compatibility and stability).
- Install **pnpm** (`npm i -g pnpm`) and confirm version.
- Install **Git** (if not already available).
- Use a modern Chromium browser for extension testing.

## 2) Verify Local Tooling
Run and confirm these commands work:
- `node -v`
- `pnpm -v`
- `git --version`

## 3) Repository and Branch Setup
- Pull latest repository updates.
- Create a working branch for Phase 1.2 changes.
- Confirm workspace path and extension folder are correct.

## 4) Server Project Preparation
- Create server folder (example: `services/local-mcp-server`).
- Initialize package (`package.json`) and TypeScript config.
- Add scripts:
  - `dev` (watch mode),
  - `build`,
  - `start`.

## 5) Dependencies to Install
- Runtime:
  - `fastify` (or `express`),
  - `better-sqlite3`,
  - `zod`,
  - `dotenv`.
- Dev:
  - `typescript`,
  - `tsx` (or `ts-node`),
  - `@types/node`.
- (If needed) MCP SDK package based on final implementation choice.

## 6) Local Config and Secrets
- Add `.env.example` with:
  - `PORT=3030` (example),
  - `DB_PATH=./data/surfrag.db`.
- Add `.env` locally from template.
- Ensure `.env` is gitignored if not already.

## 7) Data Directory and Git Hygiene
- Create a local `data/` directory for SQLite files.
- Add ignore patterns:
  - `*.db`
  - `*.db-shm`
  - `*.db-wal`
  - `data/` (if keeping DB fully local)

## 8) Extension-Side Preparation
- Decide local API base URL (example `http://localhost:3030`).
- Confirm extension has required permissions:
  - `storage`
  - host permissions for target pages.
- Keep `chrome.storage.local` as fallback queue while server is offline.

## 9) Basic Health Checks Before Coding Features
- Start local server and verify `GET /health`.
- Confirm SQLite DB file is created on startup.
- Test one sample `POST /captures` payload manually (curl/Postman).
- Confirm inserted row exists in SQLite.

## 10) Definition of Ready for Phase 1.2
Phase 1.2 can start when:
- all required tools are installed,
- local server boots without errors,
- DB initializes automatically,
- extension can reach local endpoint,
- one test capture can be stored and retrieved.
