# Phase 5.1: Update LightRAG Merge Behavior

## Objective
Make changed captures update existing LightRAG knowledge instead of being ignored or duplicated. When the same page is captured again with new content, matching graph nodes should be merged, conflicting overlapping facts should prefer the newly added document for now, and provenance must remain available for later contradiction review in Phase 5.2 and Phase 5.3.

---

## Why This Phase Is Needed

Phase 5 says the system should merge matching nodes and prefer the newly added nodes when content overlaps. The current stack is not there yet:

1. `services/local-mcp-server/src/index.ts` already treats a changed capture at the same canonical URL as a valid update.
2. `services/local-mcp-server/src/lightrag/sync.ts` still sends every accepted capture to `POST /documents/text`.
3. LightRAG's `POST /documents/text` rejects a repeated `file_source` as `duplicated`, so a changed page at the same URL does not naturally become a graph update.
4. LightRAG's internal entity merge path is designed to combine existing and new attributes, but it does not currently express SurfRAG's Phase 5 rule that new evidence should win on overlapping facts.

So Phase 5.1 is really two tasks:

- allow an updated document to reach the graph update path at all
- define how merged entities store both "current preferred fact" and provenance of older facts

---

## Scope

### In Scope

- Re-ingesting changed captures for an existing URL/source
- Matching newly extracted nodes against existing LightRAG nodes
- Merging matching nodes instead of creating duplicates
- Preferring the newest document when two facts overlap
- Preserving enough provenance for contradiction detection later

### Out of Scope

- Full contradiction classification (`consistent`, `contradictory`, `uncertain`)
- Multi-agent debate and judge flow
- Final policy for rejecting documents

---

## Requirements

### Functional Requirements

1. A capture with changed content at the same canonical URL must be able to update LightRAG instead of being dropped as a duplicate.
2. Matching entities should resolve to one graph node, not parallel duplicates.
3. When old and new facts overlap, the merged representation should prefer the new document as the active/default fact.
4. Older facts must remain traceable through provenance metadata so later phases can inspect conflicts instead of losing history.
5. The local MCP server should still treat LightRAG failures as non-fatal for the main capture flow.

### Data Requirements

- Keep the source URL or file path for each ingestion
- Preserve chunk/source IDs for merged entities where possible
- Record enough metadata to answer:
  - which document introduced the currently preferred fact?
  - which older document was superseded?
  - what entity or relation was merged?

---

## Implementation Approach

Phase 5.1 will use a single approach: **replace-and-reinsert through LightRAG, then patch merge preference**.

This is the most incremental fit for the current architecture:

- it fits the current `POST /captures` flow with the least disruption
- it solves the immediate blocker where changed URLs are rejected as duplicate `file_source`s
- it keeps LightRAG as the primary graph builder instead of re-implementing extraction and merge logic in the MCP server
- it still prepares the system for Phase 5.2 if we store structured merge metadata now

### How it works

1. In the MCP server, detect that a capture is an update of an existing URL.
2. Before re-inserting, locate the existing LightRAG document for that `file_source`.
3. Delete the old LightRAG document.
4. Insert the new document text again.
5. Patch LightRAG's merge behavior so when matching entities are encountered, overlapping fact text favors the newest document while retaining source history.

### Likely implementation areas

- `services/local-mcp-server/src/index.ts`
- `services/local-mcp-server/src/lightrag/sync.ts`
- a new helper such as `services/local-mcp-server/src/lightrag/documents.ts`
- `services/lightrag/lightrag/api/routers/document_routes.py`
- `services/lightrag/lightrag/operate.py`

### Trade-offs

- Smallest change to SurfRAG's current ingestion flow
- Reuses existing LightRAG extraction and graph-building pipeline
- Easier to land before Phase 5.2
- Delete/reinsert can be slower than a true in-place graph update
- Requires careful handling so document deletion does not lose useful provenance
- Depends on patching LightRAG internals or adding wrapper logic around them

---

## Design

### 1. Add an "update existing document" LightRAG sync path

When SQLite says a capture changed for an existing canonical URL:

- look up the existing LightRAG document by `file_source`
- if one exists, delete it
- insert the new text as the latest version for that same source URL
- keep this flow asynchronous and non-fatal to the main HTTP response

This can live behind a helper such as:

```ts
syncCaptureToLightRAG(capture, { mode: "insert-or-replace" })
```

### 2. Patch merge preference in LightRAG

Update the merge path so SurfRAG can express:

- merge matching entities instead of duplicating them
- keep combined provenance (`source_id`, `file_path`, chunk refs)
- when old and new descriptions overlap or conflict, the new document becomes the preferred/current version

There are two practical sub-approaches here:

1. **Prompt-first patch:** update the summarization/merge prompt so the LLM is told to keep the newer source as the default fact while still mentioning prior evidence in a provenance field.
2. **Structured-field patch:** keep separate fields such as `current_description`, `historical_descriptions`, and `preferred_source_id`, then derive the final display/summary from those fields.

For long-term reliability, the structured-field patch is better, but the prompt-first patch is faster.

### 3. Add provenance storage on the SurfRAG side

Do not rely only on merged LightRAG descriptions for history. Add a small local ledger in SQLite for merge events, for example:

- `canonical_url`
- `capture_id`
- `lightrag_track_id`
- `entity_name`
- `merge_action`
- `preferred_source`
- `superseded_source`
- `timestamp`

This does not need full contradiction logic yet. It only needs to preserve enough history so Phase 5.2 can inspect what changed.

---

## Development Steps

1. Document the current duplicate-update mismatch between SurfRAG and LightRAG.
2. Add LightRAG helper methods for:
   - finding an existing document by `file_source` or doc metadata
   - deleting an old document
   - reinserting updated text
3. Update the MCP server sync path so changed captures use replace-and-reinsert semantics.
4. Patch LightRAG merge behavior to prefer new facts on overlap.
5. Add provenance persistence for merge events in SQLite or a similar local store.
6. Add logs and status reporting so update, replace, delete, and merge decisions are visible.
7. Validate with repeated captures of the same URL where the page content changes meaningfully.

---

## Deliverables

- [ ] Changed same-URL captures can update LightRAG instead of being rejected as duplicates
- [ ] Matching entities are merged instead of duplicated
- [ ] Merge logic prefers new facts when content overlaps
- [ ] Provenance for old vs new evidence is retained
- [ ] MCP server logs clearly show whether the operation was insert, replace, merge, or failed

---

## Testing Plan

### Core Cases

1. Insert a brand-new URL and verify normal LightRAG ingestion still works.
2. Re-submit identical content and verify SurfRAG still skips unnecessary heavy ingestion.
3. Submit changed content for the same URL and verify the LightRAG sync path performs replace/reinsert instead of duplicate rejection.
4. Verify that the resulting graph contains one merged entity rather than duplicate entities when names match.
5. Verify the preferred description/fact comes from the newer document.
6. Verify provenance records still show the older source.

### Good Example Scenarios

- A page title stays the same but the article body changes
- A company node exists and the new page updates the CEO or headquarters
- A page corrects a previously extracted misspelling or alias

---

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
|------|----------------|------------|
| Delete-then-reinsert loses graph context | A failed reinsert could temporarily remove knowledge | Use async status tracking and only treat LightRAG as eventually consistent; keep SQLite as system-of-record for captures |
| LightRAG merge stays too summary-based | LLM summaries may blur true contradiction history | Add structured provenance fields or an external merge ledger early |
| Same-name matching is too naive | Different real-world entities may be collapsed incorrectly | Keep Phase 5.1 matching conservative and let Phase 5.2 handle uncertain cases |
| Submodule patch drift | Future LightRAG updates may overwrite custom behavior | Keep SurfRAG-specific changes isolated and documented in this phase |

---

## Open Questions

1. Should provenance live primarily inside LightRAG node fields, or should SurfRAG own it in SQLite?
2. Is delete-and-reinsert acceptable for changed captures, or do we want true in-place document updates in the LightRAG submodule?
3. Should "prefer new facts" apply to all overlapping fields, or only to selected fields such as description/value assertions?

---

## Decision

For Phase 5.1, implement **replace-and-reinsert plus merge provenance tracking**. This is the selected approach for this phase.
