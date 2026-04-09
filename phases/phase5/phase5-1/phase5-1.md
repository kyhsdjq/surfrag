# Phase 5.1: Update LightRAG Merge Behavior

## Objective
Make changed captures update existing LightRAG knowledge instead of being ignored or duplicated. When the same page is captured again with new content, matching graph nodes should be merged, and conflicting overlapping facts should prefer the newly added document for now. Keep LightRAG's current add-document interface behavior unchanged, and add a separate overwrite-style add-document interface for update flows so only that new interface uses the newest-first merge behavior. Contradiction detection is handled before graph insertion in the MCP server, not by storing old contradictory facts inside LightRAG.

---

## Why This Phase Is Needed

Phase 5 says the system should merge matching nodes and prefer the newly added nodes when content overlaps. The current stack is not there yet:

1. `services/local-mcp-server/src/index.ts` already treats a changed capture at the same canonical URL as a valid update.
2. `services/local-mcp-server/src/lightrag/sync.ts` still sends every accepted capture to `POST /documents/text`.
3. LightRAG's current `POST /documents/text` rejects a repeated `file_source` as `duplicated`, so a changed page at the same URL does not naturally become a graph update.
4. We do not want to change the meaning of the existing add-document interface, because normal ingestion should keep its current behavior.
5. LightRAG's internal entity merge path is designed to combine existing and new attributes, but it does not currently express SurfRAG's Phase 5 rule that new evidence should win on overlapping facts.

So Phase 5.1 is really three tasks:

- add a separate overwrite-add document interface for update flows without changing existing interface behavior
- allow an updated document to reach the graph update path at all
- make LightRAG's merged text prefer the newest accepted information

---

## Scope

### In Scope

- Re-ingesting changed captures for an existing URL/source
- Adding a new LightRAG overwrite-ingest API while keeping the old add-document API unchanged
- Matching newly extracted nodes against existing LightRAG nodes
- Merging matching nodes instead of creating duplicates
- Preferring the newest document when two facts overlap
- Prompting LightRAG to keep the newest accepted information in merged descriptions

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
4. Contradiction detection for candidate updates must happen before insertion into LightRAG, in the MCP server.
5. The local MCP server should still treat LightRAG failures as non-fatal for the main capture flow.
6. The existing LightRAG add-document interface must keep its current behavior unchanged.
7. LightRAG must expose a separate overwrite-style add-document interface for changed-document update flows.

### Data Requirements

- Keep the source URL or file path for each ingestion
- Preserve chunk/source IDs for merged entities where possible
- If audit, rollback, or manual-review history is needed, record it in the MCP server rather than by extending LightRAG's stored entity or relation structure
- Any optional MCP-side audit trail should be able to answer:
  - which document introduced the currently preferred fact?
  - which earlier document was replaced or rejected?
  - what entity or relation was involved?

---

## Implementation Approach

Phase 5.1 will use a single approach: **keep the current add-document API unchanged, add an overwrite-add API in LightRAG, then patch prompt-driven merge preference for that overwrite path**.

This is the most incremental fit for the current architecture:

- it fits the current `POST /captures` flow with the least disruption
- it solves the immediate blocker where changed URLs are rejected as duplicate `file_source`s
- it avoids breaking existing LightRAG clients that already rely on the current add-document behavior
- it keeps LightRAG as the primary graph builder instead of re-implementing extraction and merge logic in the MCP server
- it avoids changing LightRAG storage structure in this phase

### How it works

1. In the MCP server, detect that a capture is an update of an existing URL.
2. Route update-style ingestions to a new LightRAG overwrite-add document API instead of the existing add-document API.
3. Inside LightRAG, let the new overwrite-add API reuse the current add-document pipeline as much as possible, with only the minimum changes needed for overwrite semantics.
4. Before re-inserting, locate the existing LightRAG document for that `file_source`.
5. Delete the old LightRAG document, then insert the new document text again through the overwrite path.
6. Patch LightRAG's merge prompt and merge-input ordering so when matching entities are encountered, overlapping fact text favors the newest document and older contradictory statements are omitted from the merged description.

### Likely implementation areas

- `services/local-mcp-server/src/index.ts`
- `services/local-mcp-server/src/lightrag/sync.ts`
- a new helper such as `services/local-mcp-server/src/lightrag/documents.ts`
- LightRAG document API routing for a new overwrite-add endpoint
- `services/lightrag/lightrag/operate.py`
- `services/lightrag/lightrag/prompt.py`

### Trade-offs

- Smallest change to SurfRAG's current ingestion flow
- Reuses existing LightRAG extraction and graph-building pipeline
- Easier to land before Phase 5.2
- Delete/reinsert can be slower than a true in-place graph update
- Prompt-only merge preference can be less deterministic than a structured merge model
- Audit history and manual-review records, if needed, should live in the MCP server rather than in LightRAG storage

---

## Design

### 1. Add an overwrite-add document API without changing the old API

Keep the existing LightRAG add-document interface unchanged for normal ingestion. Add a separate overwrite-add document interface for changed-document update flows.

When SQLite says a capture changed for an existing canonical URL:

- call the new overwrite-add LightRAG API instead of the old add-document API
- inside that API, look up the existing LightRAG document by `file_source`
- if one exists, delete it
- insert the new text as the latest version for that same source URL
- keep this flow asynchronous and non-fatal to the main HTTP response

This can live behind a helper such as:

```ts
syncCaptureToLightRAG(capture, { mode: "overwrite-add" })
```

### 2. Patch merge preference in LightRAG with a prompt-first patch

Update the merge path so SurfRAG can express:

- merge matching entities instead of duplicating them
- keep the existing LightRAG storage shape unchanged
- when old and new descriptions overlap or conflict, the new document becomes the preferred/current version in the merged text
- older contradictory statements are dropped from the merged LightRAG description

Use a **prompt-first patch**: update the summarization/merge prompt so the LLM is told that the newest descriptions have highest priority and that older contradictory statements should be discarded from the merged result.

This is the selected design for Phase 5.1 because contradiction detection happens earlier in the MCP server and we want to avoid changing LightRAG structure.

### 2.1 Required ordering in `operate.py`

The prompt can only enforce newest-first conflict resolution if the description list passed into summarization is also ordered newest-first.

So `services/lightrag/lightrag/operate.py` should follow this rule before calling `PROMPTS["summarize_entity_descriptions"]`:

- descriptions from the newest document version must come first
- descriptions from older document versions must come later
- if existing merged descriptions are still included, they must be placed after the newly accepted document's descriptions
- the effective ordering contract for the prompt input must be `newest -> oldest`
- when the overwrite-add path is used and there is more than one description fragment to merge, the merge must still go through the LLM even if the fragment count and token count would normally stay below the standard non-LLM shortcut thresholds

This ordering requirement applies to both entity and relationship merge summarization paths.

### 2.2 Selected Plan For The Remaining Work

For the remaining Phase 5.1 work, use a **prompt-only merge patch as Plan A**. Avoid changing LightRAG data structures, graph schemas, or stored entity/relation field layouts. The goal is to make the LLM prefer the newest document's statements and discard older contradictory statements when it produces the merged description.

#### Why Plan A is the right fit

- It respects the constraint to avoid modifying LightRAG structure.
- `services/lightrag/lightrag/operate.py` already rebuilds entity and relationship descriptions through the summarization path.
- The lowest-risk patch is to keep the old add-document interface intact, reuse its implementation in a new overwrite-add interface, and only change how the overwrite path generates the final merged description.
- This matches the intended architecture: contradiction detection happens in the MCP server before graph insertion, so LightRAG does not need to keep superseded contradictory facts for that purpose.

#### Plan A: prompt-only implementation

1. **Add a new overwrite-add interface**
   - Keep the existing LightRAG add-document API behavior unchanged.
   - Add a new overwrite-add API for changed-document updates only.
   - Reuse the existing add-document implementation as much as possible, with minimal modifications for overwrite semantics.
   - Route only the update flow to this new API.

2. **Preserve newest-first ordering into summarization**
   - In `services/lightrag/lightrag/operate.py`, make sure the newest description from the newly reinserted document is passed first to the merge-summary path.
   - Ensure the full prompt input ordering contract is `newest -> oldest`.
   - Keep existing storage fields such as `description`, `source_id`, and `file_path`.
   - Do not add new graph/entity/relation metadata fields.

3. **Patch the merge prompt to prefer new evidence**
   - In `services/lightrag/lightrag/prompt.py`, update `PROMPTS["summarize_entity_descriptions"]`.
   - Tell the LLM:
     - the description list is ordered by version time from newest to oldest
     - the first descriptions are the newest and highest priority
     - when two statements overlap and conflict, keep the newest statement
     - discard older contradictory statements from the final merged description
     - only retain older information if it is non-contradictory and still useful
   - This makes the merged text itself carry the "newest wins" behavior without schema changes.
   - For the overwrite-add path specifically, the implementation should route summarization through the dedicated newest-first merge prompt whenever more than one fragment is present, instead of falling back to raw string concatenation.

4. **Limit code changes to targeted reuse**
   - Prefer changes in:
     - the LightRAG document API layer for the new overwrite-add route
     - `services/lightrag/lightrag/prompt.py`
     - small ordering adjustments in `services/lightrag/lightrag/operate.py`
   - Avoid changing:
     - `services/lightrag/lightrag/utils_graph.py` merge structure
     - graph node/edge field schema
     - vector payload schema

5. **Validate with contradiction-style update cases**
   - Entity example: old capture says CEO is `A`, new capture says CEO is `B`.
   - Relation example: old capture says headquarters is `City X`, new capture says `City Y`.
   - Expected result:
     - one merged node / relation remains
     - the merged description reflects the new document's fact
     - the old contradictory statement is omitted from the merged description

If audit logging, rollback support, or manual review is needed, that history can also be recorded in the MCP server instead of in LightRAG. That is the preferred place for such records in the current architecture.

#### Files to patch next

- LightRAG document API entrypoint for the new overwrite-add route
- `services/lightrag/lightrag/prompt.py`
- `services/lightrag/lightrag/operate.py`

#### Acceptance criteria for the remaining work

- Rebuilt entities and relationships use merged descriptions that prefer the newest document's facts.
- Older contradictory statements are removed from the final merged description.
- `operate.py` passes merge descriptions to the summarization prompt in `newest -> oldest` order.
- The overwrite-add path forces an LLM merge whenever an entity or relation has more than one description fragment, even if the normal summary thresholds would otherwise skip the LLM.
- The existing add-document API behavior remains unchanged.
- A new overwrite-add document API is available for changed-document update flows.
- LightRAG storage structure remains unchanged.
- The implementation stays compatible with the overwrite delete-and-reinsert flow.

---

## Development Steps

1. Document the current duplicate-update mismatch between SurfRAG and LightRAG.
2. Add LightRAG helper methods for:
   - finding an existing document by `file_source` or doc metadata
   - deleting an old document
   - reinserting updated text
3. Add a new LightRAG overwrite-add document API that reuses the current add-document implementation with minimal changes, while leaving the old API behavior unchanged.
4. Update the MCP server sync path so changed captures use the new overwrite-add API.
5. Patch LightRAG merge behavior to prefer new facts on overlap through prompt changes.
6. Update `services/lightrag/lightrag/operate.py` so merge summarization inputs are ordered `newest -> oldest`, and ensure overwrite-add forces LLM merge when more than one fragment is present.
7. Optionally add MCP-side audit persistence for review, rollback, or operator visibility.
8. Add logs and status reporting so update, replace, delete, overwrite-add, and merge decisions are visible.
9. Validate with repeated captures of the same URL where the page content changes meaningfully.

---

## Deliverables

- [ ] Changed same-URL captures can update LightRAG instead of being rejected as duplicates
- [ ] The original LightRAG add-document API keeps its current behavior unchanged
- [ ] A new overwrite-add document API exists for changed-document updates
- [ ] Matching entities are merged instead of duplicated
- [ ] Merge logic prefers new facts when content overlaps
- [ ] Merge prompt inputs in `operate.py` are ordered `newest -> oldest`
- [ ] Overwrite-add merge uses LLM whenever more than one description fragment exists
- [ ] LightRAG storage structure remains unchanged
- [ ] Optional audit or manual-review history, if needed, is recorded on the MCP side rather than in LightRAG
- [ ] MCP server logs clearly show whether the operation was insert, overwrite-add, replace, merge, or failed

---

## Testing Plan

### Core Cases

1. Insert a brand-new URL and verify normal LightRAG ingestion still works.
2. Re-submit identical content through the original add-document API and verify its current behavior is unchanged.
3. Re-submit identical content and verify SurfRAG still skips unnecessary heavy ingestion.
4. Submit changed content for the same URL and verify the LightRAG sync path uses the new overwrite-add path instead of duplicate rejection.
5. Verify that the resulting graph contains one merged entity rather than duplicate entities when names match.
6. Verify the prompt input order reaching summarization is `newest -> oldest`.
7. Verify the overwrite-add path still calls the newest-first LLM merge when there are only two short fragments.
8. Verify the preferred description/fact comes from the newer document.
9. If MCP-side audit logging is enabled, verify the server records the accepted source and the rejected or replaced source outside LightRAG.

### Good Example Scenarios

- A page title stays the same but the article body changes
- A company node exists and the new page updates the CEO or headquarters
- A page corrects a previously extracted misspelling or alias

---

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
|------|----------------|------------|
| Delete-then-reinsert loses graph context | A failed reinsert could temporarily remove knowledge | Use async status tracking and treat LightRAG as eventually consistent while keeping capture state in SurfRAG |
| New overwrite-add route diverges from old add route | Two similar APIs can drift over time | Implement the new route by reusing the old add-document pipeline and keep the delta minimal and documented |
| LightRAG merge stays too summary-based | Prompt-only merging can be nondeterministic in edge cases | Keep the prompt explicit about newest-first priority and move contradiction decisions earlier into the MCP server |
| Same-name matching is too naive | Different real-world entities may be collapsed incorrectly | Keep Phase 5.1 matching conservative and let Phase 5.2 handle uncertain cases |
| Submodule patch drift | Future LightRAG updates may overwrite custom behavior | Keep SurfRAG-specific changes isolated and documented in this phase |

---

## Open Questions

1. Do we want any audit or manual-review ledger at all for Phase 5.1, or should we defer that entirely?
2. Is delete-and-reinsert acceptable inside the new overwrite-add API, or do we want true in-place document updates in the LightRAG submodule?
3. Should "prefer new facts" apply to all overlapping fields, or only to selected fields such as description/value assertions?

---

## Decision

For Phase 5.1, implement **a new overwrite-add document API plus prompt-driven newest-first merge behavior**. Keep the original add-document API behavior unchanged. In `services/lightrag/lightrag/operate.py`, ensure merge summarization inputs are ordered `newest -> oldest` so the prompt can reliably prefer the newest accepted information, and force the overwrite-add path to use LLM merge whenever more than one description fragment exists. Contradiction detection belongs in the MCP server before insertion, and any optional audit or manual-review history should also live on the MCP side rather than inside LightRAG.
