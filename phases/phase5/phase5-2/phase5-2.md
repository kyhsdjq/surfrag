# Phase 5.2: Build Reset and End-to-End Test Support

## Objective
Make Phase 5 development easier to verify and repeat by adding a reliable reset flow, a lightweight MCP-side end-to-end test script, and a lightweight LightRAG API test script for newly added endpoints. The reset flow should make `pnpm clean` clear local persistence and reset the LightRAG server to an empty document state. The MCP-side script should call the same server entrance path used by the extension capture flow so developers can mimic a user capturing a web page without needing to drive the extension UI. In addition, there should be a LightRAG-side script entry that simulates the same kind of request the MCP server would send to a newly added LightRAG interface. Contradiction-quality evaluation can remain manual for this phase when it is too hard to verify automatically.

---

## Why This Phase Is Needed

Phase 5 work is becoming harder to validate with ad hoc manual steps alone:

1. `services/local-mcp-server/package.json` already has a `clean` script, but it currently only drops local tables and does not reset LightRAG state.
2. Phase 5.1 and later phases depend on repeated before/after comparisons, so stale SQLite, LanceDB, or LightRAG document state can make tests noisy and misleading.
3. The real user entry path is the MCP server capture flow at `POST /captures`, but there is no dedicated lightweight script focused on that end-to-end path.
4. Contradiction detection and debate quality can be subjective and model-dependent, so a fully automatic assertion strategy is not realistic for every case right now.

So Phase 5.2 is really three tasks:

- make environment reset cheap and repeatable
- add a developer-friendly end-to-end capture test path that exercises the same MCP entrance flow as the extension
- add a LightRAG API test path that simulates MCP-to-LightRAG requests for newly added interfaces

---

## Scope

### In Scope

- Extending `pnpm clean` for Phase 5 test workflows
- Clearing SQLite and any other MCP-side persisted ingestion state needed for repeatable tests
- Resetting LightRAG document state so each test run can start from a known empty graph/document baseline
- Adding an MCP-side lightweight end-to-end test script that submits capture payloads through the same entrance flow as the extension
- Adding a LightRAG-side test interface or script that calls newly added LightRAG APIs using MCP-like request shapes
- Making it easy for developers to replay realistic web-capture scenarios without manual extension interaction
- Defining which parts of the result are verified automatically versus reviewed manually

### Out of Scope

- Full automatic scoring of contradiction quality
- Automatic pass/fail judgments for every LLM-generated reasoning result
- Browser automation of the Chrome extension UI
- Replacing unit tests or lower-level integration tests in other phases

---

## Requirements

### Functional Requirements

1. Running `pnpm clean` for the MCP server test workflow must clear local persisted state required for repeatable end-to-end runs.
2. The clean flow must also reset LightRAG document state so prior test documents do not affect the next run.
3. The reset flow should be safe to run repeatedly.
4. The MCP-side end-to-end test script must submit data through the same MCP server entrance path used by extension captures, currently `POST /captures`.
5. The script must support both new-capture and changed-capture scenarios.
6. The script should make it easy to provide realistic capture inputs such as title, URL, capture time, and body text.
7. There must also be a LightRAG-oriented test entry that simulates the request payloads the MCP server would send to newly added LightRAG interfaces.
8. The LightRAG-oriented test entry may stop at request execution plus response capture, leaving deeper result evaluation to developer review.
9. Automatic checks should focus on deterministic outcomes such as HTTP responses, persistence status, and sync-path behavior.
10. Contradiction-quality or debate-quality judgments may be left to manual developer review when they are too subjective or nondeterministic for reliable automation.

### Data Requirements

- The reset flow should account for SQLite capture state and any local vector/index state used by the MCP server
- The reset flow should also account for LightRAG documents associated with earlier runs
- Test fixtures should be able to represent:
  - a brand-new captured page
  - an unchanged repeat capture
  - a changed capture for the same canonical URL
  - a capture whose content is intentionally designed for later contradiction testing
- LightRAG API test fixtures should be able to represent the request body the MCP server would send to the new LightRAG endpoint

---

## Implementation Approach

Phase 5.2 will use a single approach: **extend the existing MCP server clean flow, then add both a lightweight MCP end-to-end capture script and a lightweight LightRAG API script for newly added interfaces**.

This is the best fit for the current architecture:

- it reuses the real ingestion boundary instead of inventing a test-only flow
- it keeps extension behavior represented without requiring browser automation
- it also gives developers a smaller direct path to verify newly added LightRAG APIs without needing the full MCP flow every time
- it improves developer iteration speed for Phase 5.1, 5.3, and 5.4
- it separates deterministic transport/persistence checks from subjective LLM-output evaluation

### How it works

1. Expand the current `pnpm clean` workflow in `services/local-mcp-server/package.json`.
2. Clear MCP-side persisted data needed for clean re-runs.
3. Add a LightRAG reset step that calls LightRAG's existing delete-all-documents API before a new test session.
4. Add a lightweight end-to-end test script that builds a realistic capture payload and sends it to `POST /captures`.
5. Let the server execute its normal logic, including dedupe/update checks, persistence, vector handling, and LightRAG sync behavior.
6. Add a lightweight LightRAG API test script that sends MCP-like request payloads directly to newly added LightRAG interfaces.
7. Assert deterministic outputs automatically where possible.
8. For contradiction-oriented scenarios, leave final evaluation of reasoning quality to the developer when automatic checks are not reliable enough.

### Likely implementation areas

- `services/local-mcp-server/package.json`
- `services/local-mcp-server/src/scripts/drop-tables.ts`
- a new MCP-side reset helper for LightRAG document cleanup
- `services/local-mcp-server/src/index.ts`
- `services/local-mcp-server/src/lightrag/documents.ts`
- a new lightweight end-to-end developer script under `services/local-mcp-server/src/scripts/`
- `services/lightrag/lightrag/api/routers/document_routes.py`
- a new lightweight LightRAG API developer script that mimics MCP request payloads

### Trade-offs

- Reusing the real HTTP entrance flow gives higher confidence than testing internal helpers only
- A direct LightRAG API test path shortens feedback loops for new LightRAG interfaces
- Avoiding extension UI automation keeps the phase much smaller and more stable
- Manual review is still required for some contradiction outcomes
- Resetting all LightRAG documents is simple and deterministic, but it is a coarse-grained cleanup strategy

---

## Design

### 1. Extend `pnpm clean` into a full reset flow

The current clean script is a good starting point, but for Phase 5 it should become a broader reset tool.

The reset flow should:

- drop or clear MCP-side database state used by capture ingestion
- clear any local vector/index state that would affect end-to-end test repeatability
- delete all existing LightRAG documents so graph ingestion starts from a known baseline
- report reset progress clearly so developers know whether local cleanup and LightRAG cleanup both succeeded

If needed, the implementation can keep the existing local clean logic and add a second cleanup step for LightRAG, rather than replacing the current script entirely.

### 2. Add a LightRAG reset helper that calls the delete-all-documents API

Phase 5.2 needs a simple way to reset the remote LightRAG server state from the MCP-side workflow.

This helper should:

- call the existing LightRAG API that deletes all documents directly
- wait until deletion is complete enough for the next test run to start cleanly
- return a clear success/failure summary to the caller

This should be designed as test-support infrastructure, not as part of the normal end-user capture flow.

### 3. Add a lightweight MCP end-to-end capture script

The script should behave like a lightweight extension substitute.

It should:

- construct realistic `CaptureIngestInput` payloads
- submit them to `POST /captures`
- capture the HTTP response and any useful logs/status fields
- support scenario replay such as:
  - brand-new capture
  - unchanged recapture
  - changed recapture for the same canonical URL
  - contradiction-oriented example content for later developer inspection

This can be implemented as:

```ts
runCaptureE2EScenario({
  fixture: "changed-company-facts",
  baseUrl: "http://localhost:3030"
})
```

The exact API shape is flexible; the important part is that it enters through the same MCP capture boundary as the extension.

### 4. Add a lightweight LightRAG API test script for newly added endpoints

Besides the MCP end-to-end flow, Phase 5.2 should also provide a more direct lightweight script to validate new LightRAG interfaces.

This test path should:

- simulate the request body and headers that the MCP server would send to the new LightRAG API
- call the new LightRAG endpoint directly, without going through the full `/captures` flow
- capture the HTTP response and any returned status payload
- make it easier to quickly smoke-test newly added interfaces such as overwrite-style document ingestion
- leave semantic correctness and final output quality to manual developer review

This can be implemented as:

```ts
runLightRAGApiScenario({
  endpoint: "/documents/text/overwrite",
  payload: {
    text: fixtureText,
    file_source: "https://example.com/company"
  },
  baseUrl: "http://localhost:9621"
})
```

The exact interface can vary, but it should remain aligned with the real request shape emitted by the MCP server.

### 5. Split automatic checks from manual evaluation

Phase 5.2 should explicitly define what is and is not automatically checked.

Automatic checks should cover:

- request success or expected failure
- dedupe/update status from the MCP server response
- whether the capture was persisted
- whether the expected LightRAG sync path was selected
- whether the reset flow actually cleared prior state
- whether the new LightRAG API accepts the simulated MCP-style request and returns the expected response shape or status code

Manual developer review can cover:

- whether contradiction detection quality is reasonable
- whether debate output is persuasive or credible
- whether a final contradiction decision matches human expectations in ambiguous cases
- whether the new LightRAG interface behavior is semantically correct beyond basic request/response success

This keeps the automated part reliable while still making contradiction work much easier to test.

---

## Development Steps

1. Document the current limits of `pnpm clean` and identify all state that must be reset for repeatable Phase 5 testing.
2. Extend the MCP-side clean flow to clear local persisted ingestion state.
3. Add a LightRAG cleanup helper that calls the delete-all-documents API and waits for reset completion.
4. Wire the LightRAG cleanup step into the developer reset workflow.
5. Add a lightweight end-to-end capture script that posts realistic payloads to `POST /captures`.
6. Add a lightweight LightRAG API test script that sends MCP-like payloads directly to newly added LightRAG endpoints.
7. Create a small set of reusable fixtures for new, unchanged, changed, contradiction-oriented, and direct-LightRAG scenarios.
8. Add automatic assertions for deterministic outcomes only.
9. Document which contradiction-related and LightRAG semantic checks are intentionally manual in this phase.

---

## Deliverables

- [ ] `pnpm clean` clears the local MCP-side persistence needed for repeatable tests
- [ ] `pnpm clean` also resets LightRAG by deleting all existing documents
- [ ] A lightweight MCP-side end-to-end capture script exists
- [ ] A lightweight LightRAG API test script exists for newly added interfaces
- [ ] Developers can replay realistic extension-style capture scenarios without using the extension UI
- [ ] Developers can directly simulate MCP-to-LightRAG requests against new LightRAG APIs
- [ ] New, unchanged, and changed capture flows are easy to run repeatedly
- [ ] Automatic assertions cover deterministic transport and persistence behavior
- [ ] Contradiction-quality evaluation and deeper LightRAG semantic verification are clearly documented as manual where needed

---

## Testing Plan

### Core Cases

1. Run the reset flow and verify local persisted state is cleared.
2. Run the reset flow and verify LightRAG no longer contains prior test documents.
3. Submit a brand-new capture and verify `POST /captures` returns a successful persisted result.
4. Submit the same content again and verify the MCP server returns the unchanged path.
5. Submit changed content for the same canonical URL and verify the changed/update path is taken.
6. Call the new LightRAG interface directly with an MCP-like request payload and verify the endpoint accepts the request and returns the expected response status/shape.
7. Run the same scenario twice with a reset in between and verify the outcomes are repeatable.
8. Submit a contradiction-oriented scenario and verify the transport/persistence path works, while leaving the contradiction judgment itself to manual review if needed.

### Good Example Scenarios

- A normal first-time captured article
- The same article captured again with unchanged body text
- The same article captured again after the body content changes
- A company facts page where one later capture intentionally changes CEO or headquarters claims
- A direct call to the new LightRAG overwrite-style endpoint using the same payload shape the MCP server would send

---

## Risks and Mitigations

| Risk | Why it matters | Mitigation |
|------|----------------|------------|
| `pnpm clean` becomes too destructive for normal developer workflows | Some developers may want local cleanup without wiping LightRAG every time | Keep the reset behavior clearly documented and consider separate scoped scripts if needed |
| LightRAG reset is slow or eventually consistent | Tests may begin before the delete-all operation fully completes | Wait for reset completion and report reset status clearly |
| End-to-end scripts become flaky because they depend on live services | Unstable scripts reduce trust in the workflow | Keep automated assertions focused on deterministic outcomes and use manual review for subjective outputs |
| Test script drifts from real extension behavior | The script may stop reflecting the actual user path | Keep the script anchored to `POST /captures` and the shared payload schema |
| Direct LightRAG API tests drift from MCP request behavior | The direct test path may stop representing what the MCP server really sends | Reuse shared request builders or fixtures so the LightRAG test payload stays MCP-aligned |

---

## Open Questions

1. Should the Phase 5 reset flow always wipe LightRAG, or should there also be a lighter local-only clean mode?
2. Should the lightweight scripts live only under the MCP service scripts area, or should the direct LightRAG script live inside the LightRAG service area?
3. How much shared fixture or request-builder code should the two lightweight scripts reuse?
4. How much of the LightRAG result should we snapshot for developer inspection during contradiction-oriented scenarios?

---

## Decision

For Phase 5.2, implement **a full reset flow plus two lightweight developer-facing scripts: an MCP-side end-to-end capture script and a direct LightRAG API script for newly added interfaces**. Extend `pnpm clean` so it clears local persistence and resets LightRAG through its existing delete-all-documents API, then add one lightweight script that submits realistic payloads to `POST /captures` just like the extension does, and another that directly simulates MCP-to-LightRAG requests against new LightRAG endpoints. Keep automated checks focused on deterministic ingestion behavior and basic API response behavior, and leave contradiction-quality evaluation plus deeper semantic validation to manual developer review when automatic verification is not reliable enough.
