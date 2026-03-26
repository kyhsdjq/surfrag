# Phase 4: Data Input Optimization and Filtering

## Objective
Optimize what data gets ingested into the SurfRAG datasets (SQLite, LanceDB, LightRAG). 

## Current Situation & Challenges
1. **Performance Bottleneck:** LightRAG takes a significant amount of time and compute to analyze and extract entities from a web page.
2. **Low-Quality Data:** Many visited web pages are useless for a knowledge base (e.g., navigation hubs, search engine result pages, login screens, short transient pages).

To solve this, we need a multi-layered filtering system across both the Chrome Extension (Client) and the MCP Server (Backend).

---

## Proposed Solutions

### 1. Client-Side (Chrome Extension) Filtering
Instead of automatically posting every single web page we surf, we should restrict automatic capture and give the user more control. UI for thresholds, blocklist, and toggles lives on a **Settings** (secondary) screen in the popup; the **main** popup keeps **manual capture** and a short **latest-capture preview** only.

* **Trigger 1: Bookmarks:** Capture when the user adds a bookmark (`chrome.bookmarks.onCreated` only—no scan of existing bookmarks on install). A **“Capture when bookmarking”** toggle in **Settings** (default **on**, `chrome.storage.local`) must be on before the background script messages the tab.
* **Trigger 2: Active time (configurable):** Track cumulative **active** time only when the tab is **visible** and the document **has focus**; pause when the tab is hidden or unfocused. After threshold minutes (key `surfrag:auto-capture-active-minutes`, default **5**, clamped e.g. **1–120**, user-editable under **Settings**), trigger capture. Open tabs pick up changes via `chrome.storage.onChanged` without reload.
* **Trigger 3: Manual capture:** A **Capture Page** button on the main popup and/or a manifest keyboard shortcut. **Deduplication:** For a stable `pageId` per document visit (`location.href` + `performance.timeOrigin`), the first successful local write sets a **committed** flag; further **manual** or **bookmark** triggers in the same visit are rejected with a clear error (auto-capture and periodic pipeline updates behave as designed). The popup reflects whether this document is already captured where possible.
* **Trigger 4: Domain blocklist:** Configurable URL/domain patterns (e.g., `google.com/search`, `localhost`) in **Settings**, stored in `chrome.storage` (`sync` or `local`). Check before starting the time tracker or allowing manual/bookmark capture.

### 2. Server-Side (MCP Server) Change Detection
If a web page has already been recorded, we should not waste time and tokens re-processing it if the content hasn't changed.

* **Content Hashing:** Generate a hash (e.g., SHA-256) of the `bodyText` when a page is received. 
* **Diff Check:** Compare the incoming hash with the stored hash in SQLite. If it hasn't changed, skip the LightRAG and LanceDB ingestion pipelines entirely.

---

## Implementation Plan (Draft)

### Phase 4.1: Extension Triggers & Blocklists
(See [`phase4-1/phase4-1.md`](phase4-1/phase4-1.md) for full specs and Q&A.)

- **Manifest:** Permissions as needed (`bookmarks`, `storage`, etc.).
- **Settings popup:** Blocklist, API URL, bookmark-capture toggle, auto-capture minutes, sync-queue controls—synced with Chrome storage; **main** popup stays manual capture + latest-capture preview.
- **Content script:** Active-time tracking (visibility + focus, one-second ticks, in-memory timer resets on full navigation/reload); trigger capture from threshold and manual messages; honor blocklist; `pageId` + committed dedup for manual/bookmark; react to storage changes for the minutes threshold.
- **Background:** `chrome.bookmarks.onCreated` (respect bookmark toggle); route manual capture from popup/shortcut to the content script.
- **Testing:** Triggers and blocklist behave as specified; no duplicate manual/bookmark enqueue for the same visit after commit.

### Phase 4.2: Server-Side Change Detection
- Update the SQLite `captures` table schema to include a `content_hash` column.
- Update `POST /captures` to compute the hash and check for existing records.
- Early return `200 OK (Unchanged)` if the hash matches.

