# Build Env for Phase 1.2 (PowerShell Script Guide)

> Documentation-only setup script. Do not run all at once blindly.  
> Run step by step in PowerShell and verify each section.

## 0) Assumptions
- Repo path: `D:\Workspace\SurfRAG\surfrag`
- Target service folder: `services\local-mcp-server`
- Node.js 20 LTS is installed

## 1) Verify local tooling

```powershell
node -v
pnpm -v
git --version
```

## 2) Go to repo and create branch

```powershell
Set-Location "D:\Workspace\SurfRAG\surfrag"
git fetch origin
git checkout -b "phase1-2/local-mcp-sqlite"
git status
```

## 3) Create service folder and initialize package

```powershell
New-Item -ItemType Directory -Force -Path "services\local-mcp-server" | Out-Null
Set-Location "services\local-mcp-server"
pnpm init
```

## 4) Install dependencies

Runtime dependencies:

```powershell
pnpm add fastify better-sqlite3 zod dotenv
```

If you meet "Could not locate the bindings file." later, then use:

```
cd node_modules/better-sqlite3
pnpm dlx node-gyp rebuild
```

Dev dependencies:

```powershell
pnpm add -D typescript tsx @types/node
```

Optional MCP SDK dependency (pick the package your implementation uses):

```powershell
# example placeholder; adjust to your chosen MCP SDK package
pnpm add @modelcontextprotocol/sdk
```

## 5) Create baseline folders

```powershell
New-Item -ItemType Directory -Force -Path "src" | Out-Null
New-Item -ItemType Directory -Force -Path "src\db" | Out-Null
New-Item -ItemType Directory -Force -Path "src\api" | Out-Null
New-Item -ItemType Directory -Force -Path "src\mcp" | Out-Null
New-Item -ItemType Directory -Force -Path "data" | Out-Null
```

## 6) Create TypeScript config

```powershell
pnpm exec tsc --init
```

## 7) Add scripts in package.json (manual edit)

Edit `services/local-mcp-server/package.json` and set scripts to:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
  }
}
```

## 8) Create environment files

```powershell
@"
PORT=3030
DB_PATH=./data/surfrag.db
"@ | Set-Content -Path ".env.example"

Copy-Item ".env.example" ".env" -Force
```

## 9) Ensure DB artifacts are ignored by git

From repo root:

```powershell
Set-Location "D:\Workspace\SurfRAG\surfrag"
Add-Content ".gitignore" "`n# SQLite local artifacts"
Add-Content ".gitignore" "*.db"
Add-Content ".gitignore" "*.db-shm"
Add-Content ".gitignore" "*.db-wal"
Add-Content ".gitignore" "services/local-mcp-server/data/"
```

## 10) Create quick health-check commands

After server implementation exists, use:

```powershell
# run server (in services/local-mcp-server)
pnpm dev
```

In another terminal:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3030/health"
```

## 11) Test ingestion endpoint manually

Use after `POST /captures` is implemented:

```powershell
$payload = @{
  title = "Example Page"
  url = "https://example.com"
  referrer = ""
  bodyText = "Example content from page."
  maxScrollPercentage = 72.5
  capturedAt = (Get-Date).ToString("o")
  sourceSession = "manual-test-session"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3030/captures" `
  -ContentType "application/json" `
  -Body $payload
```

## 12) Definition of ready checklist
- `node`, `pnpm`, `git` versions are available.
- Local service folder is initialized with dependencies.
- `.env` and `.env.example` exist.
- SQLite ignore rules are in `.gitignore`.
- Server starts and `/health` responds.
- One sample capture can be posted successfully.
