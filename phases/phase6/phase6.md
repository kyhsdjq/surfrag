# Phase 6: Sync and Targeted Fixes

## Objective
Use Phase 6 to land incremental improvements around SurfRAG sync behavior and small but high-leverage fixes that unblock the next user-facing workflows without forcing a large architectural rewrite.

## Current Direction
SurfRAG already has three important building blocks:

1. a local server that already exposes HTTP APIs such as `POST /captures`
2. an MCP server path that currently runs over `stdio`
3. a need to expose the same MCP tool layer over HTTP without splitting the service

The current split works for IDE-integrated MCP clients, but it leaves SurfRAG's MCP tool layer tied to `stdio`. The next incremental improvement for this project is to expose the same MCP capability over HTTP on the existing local server.

## Phase 6 Focus
Phase 6 is intended to group work that improves synchronization behavior or removes small architectural blockers.

### Phase 6.1: Add HTTP MCP Transport to the Local MCP Server
(See [`phase6-1/phase6-1.md`](phase6-1/phase6-1.md) for the full plan.)

- Keep the existing `stdio` MCP path for Cursor and other local MCP clients.
- Add an HTTP MCP endpoint on the same local server.
- Reuse the same MCP tools and avoid introducing a second MCP-facing backend.
- Keep the work scoped to server-side MCP transport adaptation in SurfRAG.

### Future Phase 6 Tasks

- Reserve this phase for later sync-related improvements.
- Reserve this phase for small bug fixes that are too small for a standalone major phase but still need persistent planning and documentation.
- Add later `phase6-x` subphases here as new tasks are selected.
