# Phase 4.1: Extension Triggers & Blocklists

## Objective
Update the Chrome extension (Plasmo + React) to optimize data ingestion by replacing the automatic "capture everything" behavior with intelligent triggers and user controls.

## Key Features to Implement

### 1. Active Time Tracker (Configurable Threshold, Default 5 Minutes)
Instead of capturing immediately on page load, track how long the user is actively engaging with the page.
*   **Implementation:** 
    *   Update the content script to track active time (considering visibility state and focus).
    *   Trigger a capture only after the user has been active on the page for a cumulative total that meets a **user-configurable** threshold (stored in `chrome.storage.local`, key `surfrag:auto-capture-active-minutes`; default **5** minutes, clamped e.g. **1–120**).
    *   Reset or pause the timer if the tab becomes hidden or loses focus.
    *   The content script reads the threshold on load and reacts to `chrome.storage.onChanged` so open tabs pick up edits without reload.
*   **UI:** The threshold is edited under the popup **Settings** (secondary) screen, not on the main popup (which keeps manual capture and a short latest-capture preview only).

### 2. Bookmark Listener
Automatically capture pages that the user explicitly bookmarks, as this is a strong signal of value.
*   **Implementation:**
    *   Add the `bookmarks` permission to the extension manifest.
    *   Implement a listener in the background script using `chrome.bookmarks.onCreated`.
    *   When a bookmark is created, fetch the page content (either by messaging the content script of that tab or fetching it directly if possible) and send it to the local MCP server.
    *   **Toggle:** Store a boolean in `chrome.storage.local` (default **on**). The background listener checks it before messaging the tab; the popup **Settings** screen exposes a switch (e.g. “Capture when bookmarking”).

### 3. Manual Capture Button
Give the user explicit control to capture a page immediately, bypassing the time threshold.
*   **Implementation:**
    *   Add a "Capture Page" button to the extension's popup UI (React component).
    *   Alternatively or additionally, implement a keyboard shortcut (command) in the manifest to trigger a manual capture.
    *   When triggered, message the content script to extract the page data and send it to the server.
    *   **One capture per document visit (manual/bookmark):** For a given tab document, `pageId` is stable (`location.href` + `performance.timeOrigin`). Repeated **manual** or **bookmark** triggers would enqueue redundant work. The content script sets a **committed** flag after the first successful local write for that `pageId`; further **manual** or **bookmark** triggers are rejected with a clear error. Periodic saves after the pipeline is enabled still update the same record. Reloading the page resets `pageId` and the flag.
    *   **Popup note:** The popup asks the content script whether this document has already been committed, and shows a short status (captured / not yet / unavailable on restricted pages).

### 4. Domain Blocklist
Prevent the extension from capturing or tracking time on sensitive or useless domains.
*   **Implementation:**
    *   Create a configurable list of blocked domains/URL patterns (e.g., `google.com/search`, `localhost`, `github.com/login`).
    *   Store this list in `chrome.storage.sync` or `chrome.storage.local` so the user can modify it via an options page or the popup **Settings** screen.
    *   Check the current URL against this blocklist before starting the time tracker or allowing manual/bookmark captures.

## Development Steps
1.  **Update Manifest:** Add necessary permissions (`bookmarks`, `storage`, etc.).
2.  **State Management:** Implement blocklist, API URL, bookmark toggle, auto-capture minutes, and sync-queue controls in the React popup **Settings** view; sync with Chrome storage. Keep the main popup to manual capture plus a brief latest-capture preview.
3.  **Content Script Update:** Refactor the existing capture logic to be triggered by the new conditions (time threshold, manual message) rather than automatically on load. Implement the active time tracking logic.
4.  **Background Script Update:** Add the bookmark listener and handle the routing of manual capture requests from the popup to the content script.
5.  **Testing:** Verify that pages are only captured when the specific triggers are met and that blocklisted domains are ignored.

---

## Q&A (current extension behavior)

### Does bookmark-based capture run only for newly added bookmarks, or for all bookmarks in the bar?

**Only newly created bookmarks, while the extension is running.** The background script uses `chrome.bookmarks.onCreated`, which fires when the user (or another extension) **adds** a bookmark node. It does **not** scan or replay your existing bookmarks on install or reload. Editing, moving, or reordering an existing bookmark does not fire `onCreated` and therefore does not trigger capture by itself.

### Is there a setting to turn bookmark-triggered capture on or off?

**Yes.** A **“Capture when bookmarking”** switch in the popup **Settings** screen persists to `chrome.storage.local`. When off, `chrome.bookmarks.onCreated` does not message the tab. Manual capture, the active-time threshold, and the blocklist are unchanged.

### Can I change how long “active focus” must last before auto-capture?

**Yes.** Under **Settings**, set **Auto-capture after active focus** (minutes). Default is 5; allowed range is clamped (e.g. 1–120). The content script uses `surfrag:auto-capture-active-minutes` and listens for storage updates.

### Will the same page (same `pageId` in one tab visit) be sent many times via bookmark or manual capture?

**Not after deduplication is enabled.** The first successful capture for that document sets an internal **committed** flag. Additional **manual** or **bookmark** triggers in the same visit return an error instead of enqueueing again. The **configured auto** (default 5 minutes of active focus) path and subsequent **periodic** updates still run as before once the pipeline is enabled, so the backend can still receive updates for scroll/body changes until you navigate away.

### Does the active-time timer update by itself, or do I need to refresh the page or extension?

**It updates automatically** while you stay on the **same document**: the content script adds time in one-second ticks whenever the tab is visible and focused. You do **not** need to refresh for the counter to advance.

**Caveat:** The accumulated time lives **in memory** in that tab’s content script. A **full navigation or reload** loads a new document and **resets** the timer to zero. Typical **client-side (SPA) navigations** that do not replace the document may keep the same content script instance and thus **preserve** accumulated time (behavior depends on how the site does routing).

### Does “active” time include time when the tab is in the background?

**No.** Time is counted only when `document.visibilityState === "visible"` **and** `document.hasFocus()` is true for that page. Switching to another tab, minimizing the window, or moving focus to another app **pauses** the timer; it does **not** keep accruing in the background.
