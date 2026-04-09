# Phase 5.3: Add Contradiction Detection

## Objective
Add a contradiction-detection gate in the MCP server so a newly accepted capture is not blindly inserted into LightRAG. Before LightRAG sync runs, the system should compare the new document's claims against the current LightRAG graph, gather the minimum evidence needed for review, and classify the result as `consistent`, `contradictory`, or `uncertain`. Phase 5.3 should also define a more concrete retention policy based on the size and structure of the contradiction set, so the system can decide whether to allow insertion, hold for review, reject, or allow insertion while promoting the new claim as preferred.

---

## Why This Phase Is Needed

Phase 5.1 and Phase 5.2 make changed-document ingestion easier to route and test, but they do not yet stop contradictory updates from entering the graph:

1. `services/local-mcp-server/src/index.ts` currently persists a changed capture and immediately queues LightRAG sync when the content hash changes.
2. `services/local-mcp-server/src/lightrag/sync.ts` now supports both `insert` and `overwrite-add`, but it still assumes every accepted changed capture is ready for graph insertion.
3. `services/local-mcp-server/src/lightrag/query.ts` can already query the existing LightRAG graph with references, but the ingestion path does not yet use that evidence to make a contradiction decision.
4. Phase 5 explicitly requires a classification layer before graph insertion so changed facts do not automatically overwrite or merge with existing knowledge.
5. Phase 5.4 needs a structured evidence packet from Phase 5.3; otherwise the debate step would have to rediscover the same claims and references from scratch.

So Phase 5.3 is really four tasks:

- extract or summarize the new document's candidate factual claims
- retrieve relevant prior graph evidence from LightRAG
- classify the result as `consistent`, `contradictory`, or `uncertain`
- route only safe documents into LightRAG insertion, while holding the rest for later review

---

## Scope

### In Scope

- Adding a contradiction-detection gate in the MCP server before LightRAG insertion
- Reusing current LightRAG query capabilities to gather graph-backed evidence
- Defining the minimum evidence packet needed for later debate and manual review
- Classifying document updates as `consistent`, `contradictory`, or `uncertain`
- Preventing `contradictory` and `uncertain` documents from being inserted directly into LightRAG
- Logging and test visibility for contradiction-detection outcomes

### Out of Scope

- Multi-round debate behavior and judge logic from Phase 5.4
- Final operator UX for manual review queues
- Changing LightRAG graph schema or storage structure
- Full historical audit ledger design beyond the minimum review packet needed for later phases

---

## Requirements

### Functional Requirements

1. Contradiction detection must run after the capture is accepted by the MCP server and before `syncCaptureToLightRAG()` inserts the document into LightRAG.
2. The detector must compare the new document against the current LightRAG graph rather than only against the previously stored raw capture row.
3. The detector must produce exactly one of these classifications for each candidate ingestion: `consistent`, `contradictory`, or `uncertain`.
4. The detector must gather enough supporting evidence for the classification to be inspectable by developers and reusable by Phase 5.4.
5. If the classification is `consistent`, the normal LightRAG sync path may continue.
6. If the classification is `contradictory` or `uncertain`, the document must not be inserted into LightRAG automatically.
7. If contradiction detection itself fails unexpectedly, the safe default should be to avoid blind insertion and treat the result as `uncertain` or another explicit hold state.
8. The main capture persistence path should remain non-destructive: the capture can still be stored in SQLite even when LightRAG insertion is blocked pending review.
9. The response, logs, or stored review state should make it clear whether the document was inserted, blocked as contradictory, or held as uncertain.
10. The classification output should be shaped so Phase 5.4 can consume it without redoing basic evidence retrieval.
11. Phase 5.3 must not use the incoming document's same-source status as the main basis for deciding whether the document should be retained.
12. Phase 5.3 should instead evaluate how many contradictory documents exist and whether those contradictory documents come from one source or from multiple independent sources.
13. Cross-document contradiction handling must support both rejection and multi-view retention, depending on the graph's current evidence state.

### Data Requirements

- The detector should retain the candidate document identity, including capture ID, canonical URL, original URL, and LightRAG `file_source`
- The detector should record the candidate claims or claim summaries that were evaluated
- The detector should record the LightRAG queries used to gather evidence
- The detector should record the referenced LightRAG sources returned by `queryLightRAG()`
- The detector should preserve a compact explanation of why the result was `consistent`, `contradictory`, or `uncertain`
- The minimum review packet should be sufficient to answer:
  - what new claim appears to conflict?
  - what existing graph evidence was retrieved?
  - which sources support the new side?
  - which sources support the old side?
  - why was the case allowed, blocked, or escalated?

---

## Implementation Approach

Phase 5.3 will use a single approach: **add an MCP-side contradiction gate that extracts candidate claims from the new document, retrieves relevant LightRAG evidence, and classifies the result before calling the LightRAG insert path**.

This is the best fit for the current architecture:

- it matches Phase 5.1's decision that contradiction handling belongs in the MCP server before graph insertion
- it reuses `services/local-mcp-server/src/lightrag/query.ts` instead of extending LightRAG storage or graph schema
- it keeps LightRAG focused on retrieval and graph insertion, while the MCP server owns ingestion policy
- it gives Phase 5.4 a reusable review packet rather than forcing debate agents to rediscover the same evidence
- it fits the current `POST /captures` flow with targeted changes rather than a full ingestion redesign

### How it works

1. `POST /captures` persists the accepted capture as it does today.
2. Before the current fire-and-forget LightRAG sync is queued, the MCP server runs a contradiction-detection step.
3. The detector converts the capture into a stable document text or claim input, likely reusing the same text-building conventions used for LightRAG payloads.
4. The detector extracts or summarizes the most important factual assertions from the new document.
5. For those candidate claims, the detector calls `queryLightRAG()` with focused prompts to retrieve existing graph evidence and references.
6. The detector passes the new claims plus retrieved evidence into a classifier that chooses `consistent`, `contradictory`, or `uncertain`.
7. If the result is `consistent`, the normal `insert` or `overwrite-add` LightRAG sync continues.
8. If the result is `contradictory` or `uncertain`, the sync is withheld and the structured review packet is stored or emitted for later manual review and Phase 5.4 debate.

### Likely implementation areas

- `services/local-mcp-server/src/index.ts`
- `services/local-mcp-server/src/lightrag/query.ts`
- `services/local-mcp-server/src/lightrag/payload.ts`
- `services/local-mcp-server/src/lightrag/sync.ts`
- a new contradiction module such as `services/local-mcp-server/src/contradiction/`
- `services/local-mcp-server/src/scripts/fixtures/phase5.ts`
- Phase 5.2 developer scripts if they need to expose or print contradiction-review output

### Trade-offs

- MCP-side gating is the cleanest fit for Phase 5, but it introduces another decision step before async sync
- Prompt-based claim extraction and classification are flexible, but not perfectly deterministic
- Reusing LightRAG query keeps the design incremental, but retrieved evidence quality depends on how well the query prompts are shaped
- A fail-closed default is safer for knowledge quality, but it may temporarily hold some documents that are actually acceptable
- Storing a review packet now helps later phases, but it introduces a small amount of temporary review-state design before the full Phase 5.4 system exists

---

## Design

### 0. Use the contradiction set as the main decision basis

Before defining insertion behavior, Phase 5.3 should explicitly avoid one common confusion: whether the new document itself comes from the same source should not be the main criterion for keeping or rejecting it. The more important question is what kind of contradiction set already exists around the claim in the graph.

For this phase, the retention policy should focus on:

- how many existing contradictory documents are retrieved
- whether those contradictory documents come from one source or from multiple independent sources
- whether the graph already contains multiple coexisting viewpoints
- whether the new document provides decisive evidence strong enough to become the preferred conclusion

Duplicate recapture handling is intentionally out of scope for this section, because it has already been handled in earlier phases.

#### 0.1 Contradiction-set signals

This layer answers: what does the graph's contradiction pattern look like around the candidate claim?

- `no-conflict`: no meaningful contradictory evidence is retrieved
- `one-doc-conflict`: exactly one contradictory document is retrieved
- `multi-doc-single-source-conflict`: multiple contradictory documents are retrieved, but they come from the same source lineage
- `multi-doc-multi-source-conflict`: multiple contradictory documents are retrieved, and they come from multiple independent sources
- `multi-view-existing`: the graph already preserves more than one plausible view on the same issue
- `decisive-new-evidence`: the new document contributes stronger, newer, or more authoritative evidence than the currently preferred side
- `insufficient-evidence`: evidence is too sparse, mixed, or ambiguous for automatic trust

#### 0.2 Final retention actions

After the contradiction set is evaluated, the system should choose one of these concrete actions:

- `allow-add`
- `allow-add-prefer-new`
- `hold`
- `reject`

This means Phase 5.3 is not only a contradiction classifier. It is also the policy layer that maps contradiction-set structure into a final retention action.

The exact LightRAG transport call, such as `insert` versus `overwrite-add`, should remain a downstream delivery concern from Phase 5.1 rather than the main contradiction-policy concern of Phase 5.3.

### 0.3 Core insertion principles

To keep the system behavior understandable, Phase 5.3 should adopt these principles:

- the incoming document's own source identity should not decide whether the knowledge is retained
- contradiction strength should be judged mainly by contradictory-document count plus contradictory-source count
- multiple contradictory documents from the same source are weaker than multiple contradictory documents from independent sources
- cross-document contradiction is a policy problem before it is an API-selection problem
- the system should distinguish "should this source be stored?" from "should this claim become the currently preferred fact?"
- a document can be worth storing even if its claim should not become the graph's preferred conclusion

### 0.4 Recommended case taxonomy

The insertion strategy should treat the following cases as distinct:

1. **No contradictory evidence**
   - no meaningful contradictory documents are retrieved
   - action: `allow-add`

2. **Single contradictory document**
   - exactly one contradictory document is retrieved
   - action: `hold`

3. **Multiple contradictory documents from one source**
   - several contradictory documents are retrieved
   - they mostly come from one source lineage
   - action: `hold`

4. **Multiple contradictory documents from multiple sources**
   - several contradictory documents are retrieved
   - they come from multiple independent sources
   - old-side support is materially stronger
   - action: `reject` or conservative `hold`

5. **Graph already contains multiple views**
   - the graph already represents disagreement on the question
   - the new document adds another plausible viewpoint without decisive evidence
   - action: `allow-add`

6. **Decisive new evidence**
   - the graph currently contains disagreement or outdated support
   - the new document adds stronger, newer, or more authoritative evidence
   - action: `allow-add-prefer-new`

7. **Insufficient evidence**
   - retrieval quality is poor, evidence is mixed, or the claim is too ambiguous
   - action: `hold`

### 0.5 Decision table

| Contradictory documents | Contradictory sources | Graph state | Recommended action | Why |
|------|------|------|------|------|
| 0 | 0 | no meaningful conflict | `allow-add` | nothing currently contradicts the new claim |
| 1 | 1 | old-side support is weak | `hold` | one contradictory document is not enough to auto-reject or auto-accept |
| many | 1 | contradictions mostly come from one source lineage | `hold` | repeated claims from one source are not the same as independent consensus |
| many | many | old-side support is strong and independent | `reject` or `hold` | independent multi-source contradiction is much stronger than single-source repetition |
| many | many | graph already stores multiple plausible views | `allow-add` | preserve multi-view knowledge instead of forcing a single truth too early |
| many | many | new doc provides decisive stronger evidence | `allow-add-prefer-new` | the new claim should be retained and become the preferred conclusion |
| any | any | evidence retrieval is weak or ambiguous | `hold` | avoid blind insertion when reasoning confidence is low |

### 1. Insert a contradiction gate before LightRAG sync

The current Phase 5.1 path in `services/local-mcp-server/src/index.ts` chooses `insert` versus `overwrite-add` and then queues `syncCaptureToLightRAG()`.

Phase 5.3 should add a gate between those two steps, and that gate should be responsible for producing a retention action rather than only producing a contradiction label:

- accept and persist the capture as usual
- run contradiction detection before queueing LightRAG insertion
- evaluate the contradiction set around the candidate claim
- count contradictory documents and contradictory sources
- determine whether the graph already supports multi-view coexistence
- map the result into one of `allow-add`, `allow-add-prefer-new`, `hold`, or `reject`
- call `syncCaptureToLightRAG()` only when the final action allows insertion
- keep held or rejected cases outside LightRAG for later review

This keeps contradiction policy in the MCP server while preserving the current separation between capture persistence and LightRAG sync.

### 2. Define a minimum contradiction review packet

Phase 5.3 should not try to solve the full Phase 5.4 workflow yet, but it should define the minimum structured output that later phases can reuse.

That packet should contain:

- document identity: capture ID, canonical URL, original URL, file source
- document summary or extracted claims from the new document
- retrieval queries used against LightRAG
- evidence references returned from LightRAG
- a classification: `consistent`, `contradictory`, or `uncertain`
- a short rationale describing the key conflict or the reason the result remained uncertain

This can be shaped behind a new type such as:

```ts
type ContradictionReview = {
  captureId: number
  fileSource: string
  classification: "consistent" | "contradictory" | "uncertain"
  claims: string[]
  evidence: Array<{
    query: string
    response: string
    references: Array<{ referenceId: string; filePath: string }>
  }>
  rationale: string
}
```

The exact schema can vary, but the output should be structured enough that Phase 5.4 can consume it directly.

### 3. Extract focused candidate claims from the new document

The detector should avoid treating the entire raw document body as one opaque blob. It should first derive a small set of candidate factual claims worth comparing against the graph.

This extraction can start simple:

- reuse the normalized capture text shape built for LightRAG ingestion
- ask an LLM to list the most important factual assertions in the new document
- keep the number of extracted claims bounded so evidence retrieval remains cheap and explainable
- prefer entity-value style claims first, such as role, location, date, status, quantity, or policy changes

The purpose of this step is not to make the final contradiction judgment by itself. Its job is to produce better retrieval prompts for graph evidence lookup.

### 4. Retrieve existing graph evidence with `queryLightRAG()`

`services/local-mcp-server/src/lightrag/query.ts` already provides a direct path to LightRAG's `/query` endpoint with references. Phase 5.3 should reuse that capability instead of inventing a new graph-read API.

For each candidate claim or claim cluster:

- build a focused query aimed at the existing graph state
- ask LightRAG for the current fact or surrounding context
- collect the returned answer plus any source references
- retain the references as part of the contradiction packet

The goal is not perfect retrieval for every claim in this phase. The goal is to gather enough graph-backed context that the classifier can tell whether the new document appears aligned, contradictory, or too ambiguous to trust automatically.

### 5. Add a classifier that chooses `consistent`, `contradictory`, or `uncertain`

After claim extraction and evidence retrieval, Phase 5.3 should run a dedicated classifier step.

The classifier should follow these rules:

- choose `consistent` when the retrieved graph evidence agrees with the new document or when no meaningful conflict is found
- choose `contradictory` when the new document and retrieved graph evidence assert materially incompatible facts
- choose `uncertain` when the evidence is sparse, mixed, low-confidence, or ambiguous enough that automatic acceptance would be risky

This classifier should produce both a label and a concise rationale. The rationale is important because it becomes the bridge into later debate and manual review.

### 6. Route outcomes explicitly

Phase 5.3 needs a clear routing policy. The contradiction label alone is not enough; the final routing must also consider how many contradictory documents exist and whether they come from one source or from many independent sources.

Recommended routing logic:

- no contradictory evidence -> `allow-add`
- one contradictory document -> `hold`
- multiple contradictory documents from one source -> `hold`
- multiple contradictory documents from multiple independent sources -> `reject` or `hold`, depending on system conservatism
- graph already multi-view and new article adds another plausible position -> `allow-add`
- graph already multi-view and new article adds decisive stronger evidence -> `allow-add-prefer-new`
- detector failure or weak evidence -> `hold`

This routing behavior should be reflected clearly in logs and any returned status fields so Phase 5.2 test harnesses can expose what happened.

### 7. Keep observability and testing first-class

Phase 5.2 already added reset and replay tooling. Phase 5.3 should make those tools more useful by exposing contradiction-detection results during replay.

Useful outputs include:

- chosen classification
- key conflicting claim summary
- query prompts used
- LightRAG references returned
- whether LightRAG insertion was allowed or blocked

This will make manual evaluation much easier while keeping automated assertions focused on deterministic routing behavior.

---

## Development Steps

1. Document where the contradiction gate belongs in the current `POST /captures` flow.
2. Add a new contradiction module that defines contradiction-set signals, retention actions, review packet types, and the top-level detector function.
3. Reuse the existing LightRAG document text shape or claim-preparation helpers so the detector and insertion path stay aligned.
4. Add a claim-extraction step that turns a new document into a bounded set of candidate factual assertions.
5. Reuse `queryLightRAG()` to retrieve current graph evidence and source references for those claims.
6. Add a classifier that converts claims plus evidence into `consistent`, `contradictory`, or `uncertain`.
7. Add a policy-mapping step that converts contradiction-set structure into `allow-add`, `allow-add-prefer-new`, `hold`, or `reject`.
8. Update `services/local-mcp-server/src/index.ts` so only the insertion-allowed actions proceed to `syncCaptureToLightRAG()`.
9. Record or emit the contradiction review packet for held or rejected cases so developers and later phases can inspect them.
10. Extend Phase 5 fixtures and replay scripts to cover single-conflict, single-source-multi-doc conflict, multi-source conflict, multi-view, decisive-evidence, and ambiguous examples.

---

## Deliverables

- [ ] A contradiction-detection step exists before LightRAG insertion
- [ ] Contradiction-set size and contradictory-source count are evaluated explicitly
- [ ] The detector compares new document claims against the current LightRAG graph
- [ ] The detector outputs `consistent`, `contradictory`, or `uncertain`
- [ ] The policy layer maps cases into `allow-add`, `allow-add-prefer-new`, `hold`, or `reject`
- [ ] Only insertion-allowed actions reach LightRAG automatically
- [ ] `contradictory` and `uncertain` cases are either held or rejected according to graph evidence strength
- [ ] A structured contradiction review packet exists for held cases
- [ ] The review packet includes claims, LightRAG evidence, references, and rationale
- [ ] Logs or status fields clearly show whether insertion was allowed, blocked, or held
- [ ] Phase 5 replay tooling can exercise contradiction-detection scenarios

---

## Testing Plan

### Core Cases

1. Submit a brand-new document whose claims do not conflict with current LightRAG knowledge and verify the detector returns `consistent` and allows insertion.
2. Submit a changed capture whose new facts clearly contradict existing graph-backed facts and verify the detector returns `contradictory` and blocks insertion.
3. Submit a document where LightRAG retrieval returns mixed or weak evidence and verify the detector returns `uncertain` and blocks insertion.
4. Submit a case with exactly one contradictory document and verify the policy returns `hold`.
5. Submit a case with multiple contradictory documents from one source and verify the policy still returns `hold`.
6. Submit a case with multiple contradictory documents from multiple independent sources and verify the policy returns `reject` or conservative `hold`.
7. Submit a new document into a graph that already contains multiple plausible views and verify the policy still allows insertion.
8. Submit a case where the new document provides decisive stronger evidence and verify the policy returns `allow-add-prefer-new`.
9. Verify that a detector failure does not silently fall through to automatic LightRAG insertion.
10. Verify that held or rejected cases include a review packet with claims, evidence, references, and rationale.
11. Verify that replay tooling and logs make the classification path visible to the developer.
12. Verify that repeated runs after `pnpm clean` remain reproducible enough for developer inspection.

### Good Example Scenarios

- A company page update that changes `CEO: Alice` to `CEO: Bob`
- A policy page whose wording is expanded but remains semantically consistent with the current graph
- A document that mentions a loosely related topic where retrieval surfaces partial but inconclusive evidence
- Two pages about the same subject with conflicting dates, titles, or headquarters locations
- A graph where three contradictory documents all trace back to one original source
- A graph that already contains two competing viewpoints, followed by a third article that simply joins one side
- A graph with competing viewpoints, followed by a new article that includes a decisive official source or newer authoritative evidence

### Automatic Versus Manual Checks

Automatic checks should cover:

- whether contradiction detection ran
- which classification was returned
- whether LightRAG insertion was allowed or blocked
- whether the review packet contains the expected structural fields

Manual developer review can cover:

- whether the extracted claims were the right ones
- whether the retrieved LightRAG evidence was actually relevant
- whether the final contradiction judgment matches human expectations in ambiguous cases

---

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
|------|----------------|------------|
| Retrieval misses the relevant prior fact | A contradictory document may be incorrectly marked `consistent` | Keep retrieval prompts focused, prefer multiple claim-level lookups, and fail toward `uncertain` when evidence is weak |
| Repeated contradictory documents from one source are mistaken for consensus | The system may over-penalize a new document based on non-independent evidence | Track contradictory source count separately from raw contradictory-document count |
| Claim extraction is too broad or too noisy | The classifier may waste effort on irrelevant text | Bound the number of claims and prioritize high-signal factual assertions |
| Fail-closed behavior holds too many documents | Developers may see more manual-review cases than expected | Keep the rationale visible and tune thresholds after Phase 5.2 replay feedback |
| Review packet schema drifts before Phase 5.4 | Later debate code may need reshaping | Keep the packet minimal and centered on claims, evidence, references, and rationale only |
| Contradiction logic leaks into LightRAG schema | The design becomes harder to maintain and conflicts with Phase 5.1 direction | Keep contradiction detection entirely MCP-side and reuse LightRAG only for retrieval plus insertion |

---

## Open Questions

1. Should Phase 5.3 store held review packets only in logs/files for now, or add a lightweight SQLite-backed review table immediately?
2. How many candidate claims should be extracted per document before retrieval becomes too expensive or noisy?
3. Should the detector evaluate every new document, or only changed captures and other update-like cases in the first iteration?
4. What level of confidence or evidence sparsity should force `uncertain` instead of `consistent`?
5. How should the system define source independence when several contradictory documents appear to be syndicated, mirrored, or copied from one original source?
6. In decisive-evidence cases, do we want an explicit "preferred fact" layer before Phase 5.4, or is allow-plus-review enough for now?
7. Should `reject` be enabled in Phase 5.3 immediately, or should the first version collapse hard rejection into conservative `hold`?

---

## Decision

For Phase 5.3, implement **an MCP-side contradiction gate that evaluates the contradiction set around each candidate claim, especially contradictory-document count and contradictory-source count, then maps the result into `allow-add`, `allow-add-prefer-new`, `hold`, or `reject` before graph insertion**. Keep contradiction policy outside LightRAG storage, reuse `queryLightRAG()` for evidence gathering, and do not treat the incoming document's same-source status as the main basis for retention. The output of this phase should be a reusable contradiction review packet that Phase 5.4 can consume for debate and final judgment.
