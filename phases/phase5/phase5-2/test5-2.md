# Phase 5.2 Test Guide

## Objective

This document turns Phase 5.2 into the **shared test harness guide for all current Phase 5 work**.

It now organizes test coverage by the phase behavior being validated:

- `5.2.x` for reset and replay infrastructure
- `5.1.x` for insertion-path and transport behavior
- `5.3.x` for contradiction detection behavior
- `5.4.x` for preliminary retention-policy behavior

The goal is not only to list existing scripts, but to show which Phase 5 behaviors are already covered, which checks are automatic versus manual, and which additional scenarios should be added next.

---

## Test Commands

Run these commands inside `services/local-mcp-server`:

```bash
pnpm clean
pnpm test:phase5:capture --help
pnpm test:phase5:lightrag --help
pnpm test:phase5:policy
```

Available commands:

- `pnpm clean`
  - clears local SQLite state
  - clears local LanceDB `capture_vectors`
  - calls `DELETE /documents` on the LightRAG server
  - waits until LightRAG document state is empty
- `pnpm test:phase5:capture [scenario-id]`
  - sends fixture payloads to `POST /captures`
  - validates deterministic MCP-side behavior
  - pauses between multi-step requests until the developer types `c`
- `pnpm test:phase5:lightrag [scenario-id]`
  - sends MCP-shaped payloads directly to LightRAG
  - validates deterministic LightRAG API behavior
- `pnpm test:phase5:policy`
  - runs deterministic unit tests for Phase 5.4 preliminary-action derivation
  - validates the MCP-side policy mapping separately from live LightRAG behavior

Current capture scenario ids:

- `5.1.1`
- `5.1.2`
- `5.1.3`
- `5.3.1`
- `5.4.1`
- `5.4.2`
- `5.4.3`
- `5.4.4`
- `5.4.5`
- `5.4.6`
- `5.4.7`

Current direct LightRAG scenario ids:

- `5.1.4`
- `5.1.5`

---

## Environment Assumptions

Before running the tests:

1. Start the local MCP server.
2. The capture script resolves its base URL in this order:
   `MCP_BASE_URL` -> `http://localhost:${PORT}` -> `http://localhost:3030`.
3. Start the LightRAG server on `http://localhost:9621`, or set `LIGHTRAG_URL` / `LIGHTRAG_TEST_BASE_URL`.
4. Set `LIGHTRAG_API_KEY` if your LightRAG server requires it.
5. Run `pnpm clean` before a scenario when you want a fully repeatable baseline.

---

## Automatic Checks

### `pnpm test:phase5:capture`

The current script automatically checks:

- HTTP status code
- response `ok === true`
- response `status` is `persisted` or `unchanged`
- response `unchanged` boolean
- response contains a capture `id`
- optional `contradictionReview.classification`
- `lightRagSync.attempted`
- `lightRagSync.mode` when sync should happen
- `lightRagSync.fileSource` when sync should happen

The current script now also supports automatic assertions for:

- `contradictionReview.preliminaryAction`
- `contradictionReview.blocked`
- `contradictionReview.debateTodo`

### `pnpm test:phase5:lightrag`

This script automatically checks:

- direct LightRAG endpoint returns HTTP 2xx
- response `status === "success"`
- response contains `track_id`

### `pnpm test:phase5:policy`

This script automatically checks:

- Phase 5.4 no-conflict -> `allow-add`
- Phase 5.4 one-doc-conflict -> `hold`
- Phase 5.4 multi-doc-single-source-conflict -> `hold`
- Phase 5.4 multi-doc-multi-source-conflict -> `reject`
- Phase 5.4 multi-view-existing -> `allow-add`
- Phase 5.4 decisive-new-evidence -> `allow-add-prefer-new`
- Phase 5.4 insufficient-evidence -> `hold`
- MCP-side recomputation of `preliminary_action` when the model returns an inconsistent action

### Detailed Notes For `pnpm test:phase5:policy`

This command is the **deterministic Phase 5.4 policy test entrypoint**.

It currently runs:

- `services/local-mcp-server/src/contradiction/review.test.ts`

It is intended to validate the MCP-side Phase 5.4 logic without depending on:

- a running local MCP server
- a running LightRAG server
- live retrieval quality
- LLM output variability

In other words, this command is for testing the **policy layer itself**, not the full end-to-end ingestion flow.

#### Command

Run inside `services/local-mcp-server`:

```bash
pnpm test:phase5:policy
```

#### What it verifies

The test file checks two kinds of behavior:

1. **Direct policy mapping**
   - whether `derivePreliminaryAction()` maps a given `policy_signals` object to the expected action
   - this is the core Phase 5.4 matrix logic

2. **Parser correction behavior**
   - whether `parseContradictionResult()` accepts a model-shaped JSON payload
   - whether MCP recomputes `preliminary_action` from `policy_signals`
   - whether MCP overrides the model-provided action when the model output is inconsistent with the policy rules

#### Why this test exists

`pnpm test:phase5:capture` and `pnpm test:phase5:lightrag` are useful for replaying real flows, but they are not ideal for validating every Phase 5.4 branch:

- live LightRAG retrieval is environment-dependent
- source-lineage grouping is still partly model-judged
- some Phase 5.4 branches are hard to trigger reliably with a small set of replay fixtures

So `pnpm test:phase5:policy` gives a stable way to prove that:

- the policy rules themselves are correct
- the MCP-side recomputation path is correct
- future refactors do not silently change the Phase 5.4 action matrix

#### What it does not verify

This command does **not** prove that live LightRAG will actually return the desired `policy_signals`.

It does not test:

- claim extraction quality
- retrieval quality
- source-lineage judgment quality
- whether real prompts cause the model to emit the expected fields
- end-to-end routing through `POST /captures`

Those behaviors still need:

- `pnpm test:phase5:capture`
- `pnpm test:phase5:lightrag`
- manual developer review

#### When to use it

Use `pnpm test:phase5:policy` when:

- you changed `services/local-mcp-server/src/contradiction/review.ts`
- you changed Phase 5.4 policy rules or thresholds
- you changed how MCP recomputes `preliminary_action`
- you want a fast local confidence check before running live replay scenarios

Use the replay scripts when:

- you changed request or response wiring
- you changed prompt wording
- you changed LightRAG transport behavior
- you need to inspect actual contradiction-review outputs

### Manual Checks

These remain intentionally manual in Phase 5.2:

- contradiction quality
- source-lineage grouping quality
- whether `policy_signals` reflect human judgment
- whether `preliminary_action` matches human expectations
- whether semantic overwrite behavior is correct
- whether future debate results align with human expectations

---

## Coverage Matrix

| Test ID | Covered behavior | Current scenario or command | Status |
|------|------------------|-----------------------------|--------|
| `5.2.1` | reset local and LightRAG state | `pnpm clean` | implemented |
| `5.1.1` | first-time insert path | `5.1.1` | implemented |
| `5.1.2` | unchanged short-circuit path | `5.1.2` | implemented |
| `5.1.3` | changed recapture path | `5.1.3` | implemented |
| `5.1.4` | direct LightRAG insert smoke test | `5.1.4` | implemented |
| `5.1.5` | direct LightRAG updated insert smoke test | `5.1.5` | implemented |
| `5.3.1` | contradiction-oriented changed facts replay | `5.3.1` | implemented, mostly manual |
| `5.4.1` | no-conflict -> `allow-add` | `pnpm test:phase5:policy`, `5.1.1`, `5.4.1` | implemented |
| `5.4.2` | one-doc-conflict -> `hold` | `pnpm test:phase5:policy`, `5.4.2` | implemented |
| `5.4.3` | multi-doc-single-source-conflict -> `hold` | `pnpm test:phase5:policy`, `5.4.3` | implemented |
| `5.4.4` | multi-doc-multi-source-conflict -> `reject` or conservative `hold` | `pnpm test:phase5:policy`, `5.4.4` | implemented |
| `5.4.5` | multi-view-existing -> `allow-add` | `pnpm test:phase5:policy`, `5.4.5` | implemented |
| `5.4.6` | decisive-new-evidence -> `allow-add-prefer-new` | `pnpm test:phase5:policy`, `5.4.6` | implemented |
| `5.4.7` | insufficient-evidence -> `hold` | `pnpm test:phase5:policy`, `5.4.7` | implemented |

This matrix should become the canonical checklist for all Phase 5 test scenarios.

---

## Shared Virtual Web Pages

The currently implemented scenarios use the following virtual pages.

For Phase 5.4 replay coverage, URLs under `https://phase5.mock/` are **deterministic mock contradiction-policy pages**:

- they still enter through the real MCP capture endpoint at `POST /captures`
- they still persist normal capture payloads
- but the contradiction review result is mocked inside the MCP server so every `5.4.x` branch is repeatable

### Virtual Page A1: `Phase 5 Launch Notes` v1

```json
{
  "pageId": "phase5-article-v1",
  "title": "Phase 5 Launch Notes",
  "url": "https://docs.surfrag.dev/blog/phase5-launch",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "SurfRAG Phase 5 introduces contradiction-aware ingestion. The first public preview explains how developers can replay ingestion and compare changed captures.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-09T09:00:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page A2: `Phase 5 Launch Notes` v2

```json
{
  "pageId": "phase5-article-v2",
  "title": "Phase 5 Launch Notes",
  "url": "https://docs.surfrag.dev/blog/phase5-launch",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "SurfRAG Phase 5 introduces contradiction-aware ingestion. The updated article now states the rollout includes a reset flow, an MCP capture harness, and a direct LightRAG API smoke test.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-09T09:15:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page B1: `Example Company Facts` v1

```json
{
  "pageId": "company-facts-v1",
  "title": "Example Company Facts",
  "url": "https://example.com/company/facts",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Example Company says its CEO is Avery Chen and its headquarters is Singapore. The company focuses on retrieval tooling for enterprise teams.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-09T10:00:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page B2: `Example Company Facts` v2

```json
{
  "pageId": "company-facts-v2",
  "title": "Example Company Facts",
  "url": "https://example.com/company/facts-update",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Example Company now says its CEO is Jordan Patel and its headquarters is Tokyo. The company focuses on retrieval tooling for enterprise teams.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-09T10:20:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page C1: `5.4.1` no-conflict mock page

```json
{
  "pageId": "phase5-4-no-conflict",
  "title": "Nebula Labs Atlas Launch",
  "url": "https://phase5.mock/5.4.1/no-conflict",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Nebula Labs launched the Atlas search appliance in 2026 and described it as a new product for enterprise knowledge search.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-10T08:00:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page C2: `5.4.2` one-doc-conflict mock page

```json
{
  "pageId": "phase5-4-one-doc-conflict",
  "title": "Orchid AI Leadership Update",
  "url": "https://phase5.mock/5.4.2/one-doc-conflict",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Orchid AI says Mina Park is now the company's CEO after a recent executive transition.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-10T08:10:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page C3: `5.4.3` multi-doc-single-source-conflict mock page

```json
{
  "pageId": "phase5-4-single-source-conflict",
  "title": "Quartz Systems Relocation Notice",
  "url": "https://phase5.mock/5.4.3/multi-doc-single-source-conflict",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Quartz Systems says it moved its headquarters to Toronto and has started relocating leadership teams there.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-10T08:20:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page C4: `5.4.4` multi-doc-multi-source-conflict mock page

```json
{
  "pageId": "phase5-4-multi-source-reject",
  "title": "Aster Bank Office Move Rumor",
  "url": "https://phase5.mock/5.4.4/multi-doc-multi-source-conflict",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Aster Bank's headquarters is now in Dubai according to this newly captured page.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-10T08:30:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page C5: `5.4.5` multi-view-existing mock page

```json
{
  "pageId": "phase5-4-multi-view-existing",
  "title": "Aurora Policy Interpretation",
  "url": "https://phase5.mock/5.4.5/multi-view-existing",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "This page argues that the Aurora policy should be classified as privacy-first rather than growth-first.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-10T08:40:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page C6: `5.4.6` decisive-new-evidence mock page

```json
{
  "pageId": "phase5-4-decisive-new-evidence",
  "title": "Northstar Robotics Official CEO Announcement",
  "url": "https://phase5.mock/5.4.6/decisive-new-evidence",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Northstar Robotics officially announced that Eva Lin became CEO on 2026-04-10.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-10T08:50:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

### Virtual Page C7: `5.4.7` insufficient-evidence mock page

```json
{
  "pageId": "phase5-4-insufficient-evidence",
  "title": "Helios Cloud Regional Expansion Speculation",
  "url": "https://phase5.mock/5.4.7/insufficient-evidence",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Helios Cloud may move its primary region to Madrid next year, according to an ambiguous industry note.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-10T09:00:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

---

## `5.2.x` Reset And Harness Scenarios

### `5.2.1` Reset flow

#### Purpose

Verify that Phase 5.2 infrastructure can clear local persistence and return LightRAG to an empty baseline.

#### Command

```bash
pnpm clean
```

#### Expected Result

- local SQLite state is cleared
- local LanceDB vector state is cleared
- LightRAG documents are deleted
- repeated runs remain safe and repeatable

#### Manual Review

- confirm the next capture scenario starts from a truly empty LightRAG baseline if a previous run inserted documents

---

## `5.1.x` Insertion And Transport Scenarios

### `5.1.1` First-time insert path

#### Scenario id

- `5.1.1`

#### Command

```bash
pnpm clean
pnpm test:phase5:capture 5.1.1
```

#### Purpose

Verify that a first-time page capture is persisted and synced through the normal `insert` path.

#### Expected Result

- HTTP response is `201`
- response `status` is `persisted`
- response `unchanged` is `false`
- response contains a capture `id`
- `lightRagSync.attempted === true`
- `lightRagSync.mode === "insert"`
- `lightRagSync.fileSource` is populated

### `5.1.2` Unchanged short-circuit path

#### Scenario id

- `5.1.2`

#### Command

```bash
pnpm clean
pnpm test:phase5:capture 5.1.2
```

#### Purpose

Verify that sending the same page content twice causes the second request to take the unchanged path.

#### Expected Result

First request:

- HTTP response is `201`
- response `status` is `persisted`
- `lightRagSync.mode === "insert"`

Second request:

- HTTP response is `200`
- response `status` is `unchanged`
- response `unchanged` is `true`
- `lightRagSync.attempted === false`

### `5.1.3` Changed recapture path

#### Scenario id

- `5.1.3`

#### Command

```bash
pnpm clean
pnpm test:phase5:capture 5.1.3
```

#### Purpose

Verify that a second capture with the same canonical URL but changed body content takes the changed-update path, removes the prior LightRAG document first, and then uses the current LightRAG `insert` path.

#### Expected Result

First request:

- HTTP response is `201`
- response `status` is `persisted`
- `lightRagSync.mode === "insert"`

Second request:

- HTTP response is `201`
- response `status` is `persisted`
- response `unchanged` is `false`
- `lightRagSync.attempted === true`
- `lightRagSync.mode === "insert"`

### `5.1.4` Direct LightRAG insert smoke test

#### Scenario id

- `5.1.4`

#### Command

```bash
pnpm clean
pnpm test:phase5:lightrag 5.1.4
```

#### Purpose

Smoke-test the normal LightRAG text insert endpoint using the same MCP-shaped document payload.

#### Expected Result

- HTTP response is 2xx
- response `status` is `success`
- response contains `track_id`

### `5.1.5` Direct LightRAG updated insert smoke test

#### Scenario id

- `5.1.5`

#### Command

```bash
pnpm clean
pnpm test:phase5:lightrag 5.1.5
```

#### Purpose

Smoke-test the current LightRAG text insert endpoint using an updated document payload.

#### Expected Result

- HTTP response is 2xx
- response `status` is `success`
- response contains `track_id`

#### Manual Review

- whether updated insert ingestion behaves sensibly downstream
- whether entity and relationship merging still looks correct

---

## `5.3.x` Contradiction Detection Scenarios

### `5.3.1` Contradiction-oriented replay

#### Scenario id

- `5.3.1`

#### Command

```bash
pnpm clean
pnpm test:phase5:capture 5.3.1
```

#### Purpose

Replay a page whose facts intentionally change so Phase 5.3 contradiction detection and review-row creation have realistic inputs.

#### Expected Deterministic Result

First request:

- HTTP response is `201`
- response `status` is `persisted`
- `lightRagSync.mode === "insert"`

Second request:

- HTTP response is `201`
- response `status` is `persisted`
- response `unchanged` is `false`
- contradiction review response exists
- the server either blocks or routes according to contradiction review output

#### Manual Review

- whether the extracted claims look correct
- whether the retrieved references are relevant
- whether the document-level contradiction result matches human expectations
- whether the stored review row contains the expected packet shape

### `5.3.2` Recommended next contradiction tests

The following Phase 5.3-specific scenarios should be added next as dedicated fixtures:

- a clear `consistent` case with graph-backed support
- a clear `contradictory` case with strong conflicting graph-backed support
- a clear `uncertain` case with mixed or weak evidence
- a malformed JSON case that must fail closed

---

## `5.4.x` Preliminary Retention-Policy Scenarios

Phase 5.4 now exists before debate, so Phase 5.2 test support should explicitly validate the new retention-policy outputs.

For now:

- `allow-add` and `reject` are actionable outcomes
- `hold` remains a TODO branch waiting for debate implementation
- `allow-add-prefer-new` should be validated at the policy layer even though transport still falls back to the current `insert` path until overwrite support is fully wired

### `5.4.1` No-conflict -> `allow-add`

#### Current coverage

- covered by `pnpm test:phase5:policy`
- covered by `pnpm test:phase5:capture 5.4.1`
- also cross-checked by the live capture replay `5.1.1`

#### What to check

- `contradictionReview.classification` is effectively consistent with no conflict
- `policy_signals.contradictoryDocumentCount` should be `0`
- `preliminary_action` should be `allow-add`
- the capture should not be blocked
- LightRAG sync should continue

#### Current status

- implemented in deterministic policy tests
- implemented in deterministic capture replay through the mock Phase 5.4 page
- also asserted in the no-conflict live capture scenarios `5.1.1`, `5.1.2` first step, and `5.1.3`

### `5.4.2` One-doc-conflict -> `hold`

#### Automatic coverage

- covered by `pnpm test:phase5:policy`
- covered by `pnpm test:phase5:capture 5.4.2`

#### What to check

- `contradictoryDocumentCount === 1`
- `contradictorySourceCount === 1`
- `preliminary_action === "hold"`
- `blocked === true`
- `debateTodo === true`

#### Notes

- this is the main TODO branch for not-yet-implemented debate

### `5.4.3` Multi-doc-single-source-conflict -> `hold`

#### Automatic coverage

- covered by `pnpm test:phase5:policy`
- covered by `pnpm test:phase5:capture 5.4.3`

#### What to check

- `contradictoryDocumentCount >= 2`
- `contradictorySourceCount === 1`
- `preliminary_action === "hold"`
- the result is blocked pending future debate

### `5.4.4` Multi-doc-multi-source-conflict -> `reject` or conservative `hold`

#### Automatic coverage

- covered by `pnpm test:phase5:policy`
- covered by `pnpm test:phase5:capture 5.4.4`

#### What to check

- `contradictoryDocumentCount >= 2`
- `contradictorySourceCount >= 2`
- `oldSideSupportStrength === "strong"` when returned
- `preliminary_action` is `reject`, or conservative `hold` if thresholds are not yet strict enough

### `5.4.5` Multi-view-existing -> `allow-add`

#### Automatic coverage

- covered by `pnpm test:phase5:policy`
- covered by `pnpm test:phase5:capture 5.4.5`

#### What to check

- `hasMultiViewExisting === true`
- `hasDecisiveNewEvidence === false`
- `preliminary_action === "allow-add"`
- the capture is stored rather than blocked

### `5.4.6` Decisive-new-evidence -> `allow-add-prefer-new`

#### Automatic coverage

- covered by `pnpm test:phase5:policy`
- covered by `pnpm test:phase5:capture 5.4.6`

#### What to check

- `hasDecisiveNewEvidence === true`
- `preliminary_action === "allow-add-prefer-new"`
- the capture is not blocked
- current implementation logs that overwrite transport is not implemented yet and still uses `insert`

### `5.4.7` Insufficient-evidence -> `hold`

#### Automatic coverage

- covered by `pnpm test:phase5:policy`
- covered by `pnpm test:phase5:capture 5.4.7`

#### What to check

- `hasInsufficientEvidence === true`
- `preliminary_action === "hold"`
- `blocked === true`
- `debateTodo === true`

---

## Suggested Execution Order

For a normal developer validation pass of the currently implemented scenarios, run:

```bash
pnpm clean
pnpm test:phase5:capture 5.1.1
pnpm clean
pnpm test:phase5:capture 5.1.2
pnpm clean
pnpm test:phase5:capture 5.1.3
pnpm clean
pnpm test:phase5:capture 5.3.1
pnpm clean
pnpm test:phase5:capture 5.4.1
pnpm clean
pnpm test:phase5:capture 5.4.2
pnpm clean
pnpm test:phase5:capture 5.4.3
pnpm clean
pnpm test:phase5:capture 5.4.4
pnpm clean
pnpm test:phase5:capture 5.4.5
pnpm clean
pnpm test:phase5:capture 5.4.6
pnpm clean
pnpm test:phase5:capture 5.4.7
pnpm clean
pnpm test:phase5:lightrag 5.1.4
pnpm clean
pnpm test:phase5:lightrag 5.1.5
pnpm test:phase5:policy
```

---

## How To Test Your Own Virtual Web Page

If you want to test your own invented page, there are currently two practical options.

### Option 1: Send your own request directly to `POST /captures`

Example PowerShell request:

```powershell
$body = @{
  pageId = "my-fake-page-v1"
  title = "My Fake Company Update"
  url = "https://fake.example.com/company/update"
  referrer = "https://fake.example.com"
  bodyText = "Fake Company says its CEO is Alice Wong and its headquarters is Berlin."
  maxScrollPercentage = 100
  capturedAt = "2026-04-09T12:00:00.000Z"
  sourceSession = "manual-test"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:3030/captures" `
  -ContentType "application/json" `
  -Body $body
```

To test changed recapture or contradiction-policy behavior, send the same logical subject again with different `bodyText`, and inspect the returned `contradictionReview`.

### Option 2: Add a new scenario fixture

Add a new fixture and scenario in:

- `services/local-mcp-server/src/scripts/fixtures/phase5.ts`

Then run:

```bash
pnpm test:phase5:capture <your-scenario-id>
```

If your custom scenario has multiple steps, the script will pause between non-final requests and wait for `c` + Enter.

This is the better option when you want to reuse the existing automatic assertions and eventually map the new fixture back to one of the numbered `5.x.y` scenarios in this guide.
