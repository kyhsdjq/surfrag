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
Instead of automatically posting every single web page we surf, we should restrict the automatic triggers and give the user more control.

* **Trigger 1: Bookmarks:** Only automatically send pages that the user explicitly bookmarks (`chrome.bookmarks.onCreated`).
* **Trigger 2: Time-on-Page:** Only send pages where the user has actively spent more than a threshold of time (e.g., > 5 minutes).
* **Trigger 3: Manual Capture (New Suggestion):** Add a "Capture Page" button to the extension popup or a keyboard shortcut, allowing the user to explicitly say "this is useful."
* **Trigger 4: Domain Blocklist (New Suggestion):** Maintain a customizable list of domains/URL patterns to always ignore (e.g., `google.com/search`, `mail.google.com`, `localhost`).

### 2. Server-Side (MCP Server) Change Detection
If a web page has already been recorded, we should not waste time and tokens re-processing it if the content hasn't changed.

* **Content Hashing:** Generate a hash (e.g., SHA-256) of the `bodyText` when a page is received. 
* **Diff Check:** Compare the incoming hash with the stored hash in SQLite. If it hasn't changed, skip the LightRAG and LanceDB ingestion pipelines entirely.

### 3. Server-Side (MCP Server) Content Evaluation
Even if a page is sent to the server, it might just be a long navigation page or a privacy policy. We can evaluate its usefulness before heavy processing.

* **Heuristic Pre-filtering (New Suggestion):** Before invoking an LLM, apply fast rules. For example, if the page has fewer than 100 words, or if the ratio of links to text is extremely high (indicating a navigation hub), drop it.
* **LLM Usefulness Check:** Use a fast/cheap LLM (e.g., GLM-4-flash or GPT-4o-mini) to evaluate the page content.
  * **Prompt:** Ask the LLM, "Is this web page an article, documentation, or meaningful content worth saving to a knowledge base, or is it just a navigation/useless page?"
  * **Action if Useful:** Proceed to save in all configured datasets (SQLite, LanceDB, LightRAG).
  * **Action if Useless:** Save the metadata in SQLite only, and mark it with a flag (e.g., `is_useful: false`). This prevents the system from repeatedly evaluating the same useless page if the user visits it again.

---

## Implementation Plan (Draft)

### Phase 4.1: Extension Triggers & Blocklists
- Update the Chrome extension's background/content scripts.
- Implement the 5-minute active time tracker.
- Implement the bookmark listener.
- Add a manual capture button in the UI.

### Phase 4.2: Server-Side Change Detection
- Update the SQLite `captures` table schema to include a `content_hash` column.
- Update `POST /captures` to compute the hash and check for existing records.
- Early return `200 OK (Unchanged)` if the hash matches.

### Phase 4.3: Server-Side LLM Evaluation & Heuristics
- Add basic heuristic checks (word count, etc.) in the `POST /captures` route.
- Integrate an LLM call to evaluate usefulness.
- Update the SQLite schema to include an `is_useful` boolean flag.
- Gate the LanceDB and LightRAG syncs behind the `is_useful === true` condition.
