# Phase 6.1: Add HTTP MCP Transport to the Local MCP Server

## Objective
Extend the existing local MCP server so it can serve the same MCP tools over HTTP in addition to `stdio`. This phase is only about server-side MCP transport adaptation inside SurfRAG.

---

## Why This Phase Is Needed

The current architecture already has most of the required pieces for multi-transport MCP support:

1. the local service already runs as an HTTP server
2. the MCP tools already exist inside `services/local-mcp-server`
3. the current MCP entrypoint is already working over `stdio`

But the current MCP entrypoint only exposes `stdio`, which keeps the MCP layer tied to one transport even though the rest of the service already supports HTTP.

So the simplest architectural improvement is:

- keep the current MCP tool definitions
- keep the current local server process
- add an HTTP MCP transport to that same process
- let the local server continue to own SurfRAG tool execution through both transports

This keeps the system incremental and avoids adding another MCP-facing backend just to bridge one transport into another.

---

## Scope

### In Scope

- Adding an HTTP MCP transport to the existing local MCP server
- Reusing the same MCP tool registrations for both `stdio` and HTTP
- Keeping current REST endpoints such as `/health` and `/captures`
- Adding the required documentation and configuration notes for the new HTTP MCP path

### Out of Scope

- Replacing the existing `stdio` MCP path
- Building a second backend or dedicated MCP gateway service
- Redesigning existing MCP tools unless HTTP transport exposes a concrete issue
- Any downstream client or product work that consumes the HTTP MCP endpoint

---

## Requirements

### Functional Requirements

1. The local MCP server must continue to support the current `stdio` transport for existing MCP clients.
2. The same MCP toolset must be reachable through a new HTTP MCP endpoint.
3. The HTTP transport should be implemented using the MCP SDK's current recommended HTTP transport rather than introducing a custom pseudo-MCP format.
4. Existing HTTP routes such as `/health` and `/captures` must remain available.
5. Tool behavior should stay consistent across transports.
6. The change should avoid creating a second long-running local service.

### Operational Requirements

- The HTTP MCP endpoint should fit into the current Fastify-based server rather than forcing a separate process.
- HTTP access requirements such as CORS should be handled in a way that does not break the current server.
- The implementation should remain incremental enough that the existing docs for running the local server need only targeted updates.

---

## Implementation Approach

Phase 6.1 should use one approach only: **add an MCP-over-HTTP endpoint to the existing Fastify server while preserving the current `stdio` entrypoint**.

This is the smallest useful architecture because:

- it reuses the current local service that already exists
- it avoids a second bridge server whose only job would be protocol translation
- it keeps the MCP tool logic in one place

### High-Level Design

1. Extract MCP server construction and tool registration into shared code.
2. Keep one `stdio` entrypoint for current local MCP clients.
3. Add a new HTTP transport entrypoint mounted on the existing Fastify app.
4. Route both transports to the same underlying MCP tool registration logic.

---

## Design Details

### 1. Share MCP Tool Registration

Today, the MCP tool definitions live inside the current `stdio` server entrypoint. Phase 6.1 should factor that setup into shared code so both transports can use the same tool registration path.

This shared layer should own:

- environment loading
- database bootstrap
- optional vector bootstrap
- MCP tool definitions
- transport-agnostic server construction

This avoids drift where the HTTP path and `stdio` path expose slightly different behavior.

### 2. Add an HTTP MCP Endpoint on the Existing Server

The current local service already uses Fastify and already exposes normal HTTP routes. Phase 6.1 should extend that same process with a dedicated MCP HTTP endpoint such as:

- `POST /mcp`
- `GET /mcp`

The selected transport should follow the MCP SDK's recommended HTTP transport for network clients rather than introducing a custom RPC wrapper.

The endpoint should:

- live inside the existing local service
- share the same environment and storage configuration as the current MCP setup

### 3. Preserve Existing `stdio` Usage

The current `stdio` path still matters for IDE tools such as Cursor. Phase 6.1 should not replace that flow. Instead, it should preserve the existing `stdio` entrypoint and make HTTP an additional transport.

The operating model should become:

- IDE-integrated MCP clients -> `stdio`
- HTTP-capable MCP clients -> HTTP MCP

### 4. Add the Minimum HTTP-Compatibility Work

The HTTP MCP path should include only the minimum extra work needed to make HTTP access practical:

- CORS or other HTTP access configuration when needed by the selected client environment
- endpoint shape and headers compatible with the MCP SDK's HTTP transport
- small documentation updates describing how an HTTP MCP client should connect

Avoid turning this phase into a full auth, multi-user, or client-specific redesign unless a concrete blocker appears.

---

## Likely Implementation Areas

- `services/local-mcp-server/src/mcp/server.ts`
- a new shared MCP factory/helper under `services/local-mcp-server/src/mcp/`
- `services/local-mcp-server/src/index.ts`
- local server docs in `README.md`

---

## Trade-offs

### Advantages

- Smallest change that keeps reuse of the current MCP tool layer
- No need for an extra bridge backend
- Keeps current IDE usage intact
- Makes the MCP layer transport-flexible inside the existing service

### Costs and Risks

- The MCP server code needs a small refactor so transport setup is not hard-coded to `stdio`
- HTTP access may introduce CORS or related configuration concerns that do not exist for `stdio`
- HTTP transport adds another supported access path, so transport parity must be maintained
- Some MCP SDK HTTP behavior may require session or transport lifecycle handling that is more complex than `stdio`

---

## Implementation Plan (Draft)

### Step 1: Refactor MCP Construction into Shared Code

- Move MCP server creation and tool registration out of the current `stdio`-only entrypoint.
- Build a shared helper that returns a configured MCP server instance with the current SurfRAG tools.
- Keep environment loading and bootstrapping behavior correct when the server runs from different working directories.

### Step 2: Keep the Existing `stdio` Entry Point Working

- Update the current `stdio` entrypoint to use the shared MCP construction path.
- Verify that current MCP clients can still use the server exactly as before.

### Step 3: Add an HTTP MCP Transport to the Fastify App

- Mount an MCP HTTP transport on the current Fastify server.
- Reuse the same MCP tool instance or server-construction path used by the `stdio` setup.
- Keep `/health` and `/captures` behavior unchanged.

### Step 4: Add HTTP Access Support

- Configure the HTTP MCP route for standard HTTP MCP clients.
- Add the minimum required CORS or related HTTP handling if needed by the selected client environment.
- Document expected local URL usage for HTTP clients.

### Step 5: Update Project Documentation

- Document that SurfRAG MCP is now available over both `stdio` and HTTP.
- Keep `stdio` configuration instructions for Cursor.
- Add a short HTTP MCP section for generic HTTP-capable MCP clients.

---

## Acceptance Criteria

1. The current `stdio` MCP setup still works for existing local MCP clients.
2. The local server exposes a working MCP-over-HTTP endpoint.
3. The HTTP endpoint uses the same SurfRAG MCP tools as the `stdio` path.
4. Existing HTTP routes such as `/health` and `/captures` still work.
5. The implementation does not require a separate MCP bridge server.
6. Project documentation explains the new transport layout clearly enough for future HTTP-client integration.

---

## Notes

Phase 6.1 ends at the server-side transport boundary. Any client-specific integration work that consumes the HTTP MCP endpoint should be tracked outside this project plan.
