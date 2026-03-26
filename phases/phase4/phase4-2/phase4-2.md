# Phase 4.2: Server-Side Change Detection

## Objective
Add hash-based change detection to the MCP server so repeated captures of unchanged pages do not re-run expensive ingestion (LightRAG/LanceDB), while still preserving reliable capture records in SQLite.

## Key Features to Implement

### 0. Prev-Task Alignment: De-dup by Web Link (Not `pageId`)
SQLite should no longer treat `pageId` as the primary duplicate guard. Use the page web link (canonical URL) as stable identity instead.
*   **Implementation:**
    *   Replace duplicate-check logic based on `pageId` with canonical URL identity (e.g. `https://example.com/frontpage`).
    *   Normalize URLs before lookup/store (scheme/host casing, trailing slash policy, query-fragment policy based on product rules).
    *   Ensure SQLite lookup/index path is optimized for URL-based latest-capture resolution.
    *   With URL identity in place, compare `content_hash` across captures of the same URL to determine whether the page has changed.

### 1. SQLite Schema Extension (`content_hash`)
Store a deterministic content fingerprint for each capture record.
*   **Implementation:**
    *   Add a nullable `content_hash` column to the `captures` table (safe migration for existing databases).
    *   Add an index strategy appropriate for lookup path (e.g. by stable page identity + latest row, and/or direct hash checks as needed).
    *   Backward compatibility: rows without hash continue to work; first new capture after deployment writes the hash.

### 2. Hash Generation on `POST /captures`
Compute hash as soon as payload is accepted by the server.
*   **Implementation:**
    *   Canonicalize incoming text consistently (at minimum ensure deterministic encoding and trimming policy).
    *   Compute SHA-256 from canonical `bodyText` and persist as `content_hash`.
    *   Keep the hashing utility centralized so future pipelines (e.g., evaluator) reuse the same function.

### 3. Unchanged-Content Fast Path
Skip heavy ingestion when page content did not change.
*   **Implementation:**
    *   Resolve the prior capture for the same page identity (canonical web link URL).
    *   Compare incoming `content_hash` with stored latest hash.
    *   If equal, short-circuit before LightRAG/LanceDB steps and return a success response indicating unchanged content.
    *   If different, continue normal ingestion flow.

### 4. Response Semantics and Observability
Make skip behavior explicit and debuggable.
*   **Implementation:**
    *   Return a stable response contract for unchanged requests (e.g., `200 OK` with `unchanged: true` and optional reason).
    *   Log decision points (`new`, `changed`, `unchanged-skip`) with page identity and capture IDs (avoid logging full body text).
    *   Add lightweight counters/metrics if available to show how many requests skip expensive ingestion.

## Development Steps
1.  **Identity Update:** Switch duplicate/page-identity resolution from `pageId` to canonical URL in SQLite query/index path.
2.  **Migration:** Add `content_hash` column and required indexes to SQLite migration/bootstrap path.
3.  **Hash Utility:** Implement a shared SHA-256 helper for normalized `bodyText`.
4.  **Capture Route Update:** In `POST /captures`, compute hash and load prior hash for the same canonical URL.
5.  **Branching Logic:** If unchanged, return fast success and skip expensive processors; otherwise run existing pipeline.
6.  **Testing:** Add unit/integration tests for first capture, changed capture, unchanged capture, URL normalization edge cases, and legacy-row compatibility.

---

## Q&A (expected backend behavior)

### Does unchanged content mean the request fails?

**No.** Unchanged content is still a successful request; the server returns success but marks that heavy ingestion was skipped.

### Which field is hashed for change detection?

**`bodyText`** (after deterministic normalization policy). Metadata-only changes should not trigger full ingestion unless the project explicitly decides otherwise.

### What happens for old rows created before `content_hash` existed?

They remain valid. On first new capture of that page after rollout, the server computes and stores hash so future comparisons can use the fast path.

### If only tiny text changes occur, will ingestion run?

**Yes.** Any hash difference is treated as changed content, so normal downstream processing executes.

### Why return `200` for unchanged instead of a non-2xx code?

Because the server handled the request correctly. The unchanged state is an optimization outcome, not an error condition.
