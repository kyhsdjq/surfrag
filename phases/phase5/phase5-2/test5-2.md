# Phase 5.2 Test Guide

## Objective

This document records the concrete Phase 5.2 developer test scenarios that are currently implemented in the local MCP server test scripts.

It covers:

- how to reset the environment before a run
- which test commands exist
- what virtual web pages are sent in each scenario
- the exact steps each scenario executes
- the expected deterministic results
- which parts still require manual review

---

## Test Commands

Run these commands inside `services/local-mcp-server`:

```bash
pnpm clean
pnpm test:phase5:capture --help
pnpm test:phase5:lightrag --help
```

Available test commands:

- `pnpm clean`
  - clears local SQLite state
  - clears local LanceDB `capture_vectors`
  - calls `DELETE /documents` on the LightRAG server
  - waits until LightRAG document state is empty
- `pnpm test:phase5:capture [scenario-id]`
  - sends fixture payloads to `POST /captures`
  - validates deterministic MCP-side behavior
  - for multi-step scenarios, pauses after each non-final request until the developer types `c` and presses Enter
- `pnpm test:phase5:lightrag [scenario-id]`
  - sends MCP-shaped payloads directly to LightRAG
  - validates deterministic LightRAG API behavior

Current capture scenarios:

- `new-article`
- `unchanged-recapture`
- `changed-recapture`
- `contradiction-company-facts`

Current direct LightRAG scenarios:

- `insert-article`
- `insert-company-facts-update`

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

This script automatically checks:

- HTTP status code
- response `ok === true`
- response `status` is `persisted` or `unchanged`
- response `unchanged` boolean
- response contains a capture `id`
- `lightRagSync.attempted`
- `lightRagSync.mode` when sync should happen
- `lightRagSync.fileSource` when sync should happen

For multi-step capture scenarios, the script does not automatically wait on a timer anymore. After each non-final request finishes, it prompts the developer to type `c` and press Enter before the next request is sent.

### `pnpm test:phase5:lightrag`

This script automatically checks:

- direct LightRAG endpoint returns HTTP 2xx
- response `status === "success"`
- response contains `track_id`

### Manual Checks

These are intentionally not automatically judged in Phase 5.2:

- contradiction quality
- whether semantic overwrite behavior is correct
- whether LightRAG extracted the most reasonable facts
- whether later contradiction/debate results align with human expectations

---

## Shared Virtual Web Pages

The implemented scenarios use the following virtual web pages.

### Virtual Page A: `Phase 5 Launch Notes` v1

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

### Virtual Page A: `Phase 5 Launch Notes` v2

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

### Virtual Page B: `Example Company Facts` v1

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

### Virtual Page B: `Example Company Facts` v2

```json
{
  "pageId": "company-facts-v2",
  "title": "Example Company Facts",
  "url": "https://example.com/company/facts",
  "referrer": "https://search.example.test/phase5",
  "bodyText": "Example Company now says its CEO is Jordan Patel and its headquarters is Tokyo. The company focuses on retrieval tooling for enterprise teams.",
  "maxScrollPercentage": 100,
  "capturedAt": "2026-04-09T10:20:00.000Z",
  "sourceSession": "phase5-dev-script"
}
```

---

## Capture Scenario 1: `new-article`

### Purpose

Verify that a first-time page capture is persisted and synced to LightRAG through the normal `insert` path.

### Command

```bash
pnpm clean
pnpm test:phase5:capture new-article
```

### Steps

1. Reset local SQLite, LanceDB, and LightRAG document state with `pnpm clean`.
2. Send Virtual Page A v1 to `POST /captures`.

### Request Sent

The script sends Virtual Page A v1 exactly as shown above.

### Expected Result

- HTTP response is `201`
- response `status` is `persisted`
- response `unchanged` is `false`
- response contains a capture `id`
- `lightRagSync.attempted === true`
- `lightRagSync.mode === "insert"`
- `lightRagSync.fileSource` is populated

---

## Capture Scenario 2: `unchanged-recapture`

### Purpose

Verify that sending the same page content twice causes the second request to take the unchanged short-circuit path.

### Command

```bash
pnpm clean
pnpm test:phase5:capture unchanged-recapture
```

### Steps

1. Reset all state with `pnpm clean`.
2. Send Virtual Page A v1 to `POST /captures`.
3. After the first request completes, type `c` and press Enter to continue.
4. Send Virtual Page A v1 again without changing URL or body text.

### Requests Sent

Step 1 request payload:

- Virtual Page A v1

Step 2 request payload:

- Virtual Page A v1 again

### Expected Result

For the first request:

- HTTP response is `201`
- response `status` is `persisted`
- `lightRagSync.mode === "insert"`

For the second request:

- HTTP response is `200`
- response `status` is `unchanged`
- response `unchanged` is `true`
- `lightRagSync.attempted === false`
- the server skips heavy ingestion and LightRAG sync

---

## Capture Scenario 3: `changed-recapture`

### Purpose

Verify that a second capture with the same canonical URL but changed body content takes the changed-update path, removes the prior LightRAG document first, and then uses the normal LightRAG `insert` path.

### Command

```bash
pnpm clean
pnpm test:phase5:capture changed-recapture
```

### Steps

1. Reset all state with `pnpm clean`.
2. Send Virtual Page A v1 to `POST /captures`.
3. After the first request completes, type `c` and press Enter to continue.
4. Send Virtual Page A v2 to `POST /captures`.

### Requests Sent

Step 1 request payload:

- Virtual Page A v1

Step 2 request payload:

- Virtual Page A v2

The URL stays the same:

- `https://docs.surfrag.dev/blog/phase5-launch`

The main content changes:

- v1 says the preview explains replaying ingestion and comparing changed captures
- v2 says the rollout includes reset flow, MCP capture harness, and direct LightRAG API smoke test

### Expected Result

For the first request:

- HTTP response is `201`
- response `status` is `persisted`
- `lightRagSync.mode === "insert"`

For the second request:

- HTTP response is `201`
- response `status` is `persisted`
- response `unchanged` is `false`
- `lightRagSync.attempted === true`
- `lightRagSync.mode === "insert"`

---

## Capture Scenario 4: `contradiction-company-facts`

### Purpose

Replay a page whose facts intentionally change so later contradiction-oriented phases have a realistic input.

### Command

```bash
pnpm clean
pnpm test:phase5:capture contradiction-company-facts
```

### Steps

1. Reset all state with `pnpm clean`.
2. Send Virtual Page B v1 to `POST /captures`.
3. After the first request completes, type `c` and press Enter to continue.
4. Send Virtual Page B v2 to `POST /captures`.

### Requests Sent

Step 1 request payload:

- Virtual Page B v1

Step 2 request payload:

- Virtual Page B v2

The URL stays the same:

- `https://example.com/company/facts`

The intentionally contradictory facts change:

- CEO changes from `Avery Chen` to `Jordan Patel`
- headquarters changes from `Singapore` to `Tokyo`

### Expected Result

For the first request:

- HTTP response is `201`
- response `status` is `persisted`
- `lightRagSync.mode === "insert"`

For the second request:

- HTTP response is `201`
- response `status` is `persisted`
- response `unchanged` is `false`
- `lightRagSync.attempted === true`
- `lightRagSync.mode === "insert"`

### Manual Review

This scenario is not supposed to automatically decide whether the contradiction reasoning is good.

Developers should manually inspect:

- whether downstream LightRAG output reflects the changed facts
- whether future contradiction-detection behavior is reasonable
- whether delete-then-insert semantics are acceptable for this case

---

## Direct LightRAG Scenario 1: `insert-article`

### Purpose

Smoke-test the normal LightRAG text insert endpoint using the same MCP-shaped document payload built from Virtual Page B v1.

### Command

```bash
pnpm clean
pnpm test:phase5:lightrag insert-article
```

### Steps

1. Reset all state with `pnpm clean`.
2. Send a direct request to `POST /documents/text`.

### Request Sent

The direct LightRAG request body is:

```json
{
  "text": "Title: Example Company Facts\nURL: https://example.com/company/facts\nCaptured: 2026-04-09T10:00:00.000Z\n\nExample Company says its CEO is Avery Chen and its headquarters is Singapore. The company focuses on retrieval tooling for enterprise teams.",
  "file_source": "https://example.com/company/facts"
}
```

### Expected Result

- HTTP response is 2xx
- response `status` is `success`
- response contains `track_id`

---

## Direct LightRAG Scenario 2: `insert-company-facts-update`

### Purpose

Smoke-test the standard LightRAG text insert endpoint using an MCP-shaped updated document request.

### Command

```bash
pnpm clean
pnpm test:phase5:lightrag insert-company-facts-update
```

### Steps

1. Reset all state with `pnpm clean`.
2. Send a direct request to `POST /documents/text`.

### Request Sent

The direct LightRAG request body is:

```json
{
  "text": "Title: Example Company Facts\nURL: https://example.com/company/facts\nCaptured: 2026-04-09T10:20:00.000Z\n\nExample Company now says its CEO is Jordan Patel and its headquarters is Tokyo. The company focuses on retrieval tooling for enterprise teams.",
  "file_source": "https://example.com/company/facts"
}
```

### Expected Result

- HTTP response is 2xx
- response `status` is `success`
- response contains `track_id`

### Manual Review

Developers may optionally inspect:

- whether updated insert ingestion behaves sensibly downstream
- whether entity/relationship merging still looks correct
- whether the semantic result matches expectations

---

## Suggested Execution Order

For a normal developer validation pass, run:

```bash
pnpm clean
pnpm test:phase5:capture new-article
pnpm clean
pnpm test:phase5:capture unchanged-recapture
pnpm clean
pnpm test:phase5:capture changed-recapture
pnpm clean
pnpm test:phase5:capture contradiction-company-facts
pnpm clean
pnpm test:phase5:lightrag insert-article
pnpm clean
pnpm test:phase5:lightrag insert-company-facts-update
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

To test a changed recapture, send the same `url` again with different `bodyText`.

### Option 2: Add a new scenario fixture

Add a new fixture and scenario in:

- `services/local-mcp-server/src/scripts/fixtures/phase5.ts`

Then run:

```bash
pnpm test:phase5:capture <your-scenario-id>
```

If your custom scenario has multiple steps, the script will pause between non-final requests and wait for `c` + Enter.

This is the better option when you want to reuse the existing automatic assertions.
