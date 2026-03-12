# Phase 1.1: Extension Development Strategy

A simple extension that captures everything the user is viewing.

## Selected Tech Stack: Plasmo + React

We have chosen **Plasmo Framework** with **React** for the following reasons:

### 1. Why Plasmo?
*   **Best-in-class Developer Experience:** Handles manifest generation, Hot Module Replacement (HMR), and cross-browser support automatically.
*   **Abstraction:** Abstracts away the painful parts of extension configuration (manifest versions, reloading, assets).
*   **Built-in Features:** First-class support for React, Vue, Svelte, and built-in messaging/storage hooks.

### 2. Why React?
It's a common misconception that React is only for "websites." A Chrome extension is composed of several HTML pages and scripts where React shines:

*   **Popup & Side Panel:** These are standard HTML pages. React allows us to build complex UIs (like a chat interface for RAG) with state management, components, and hooks.
*   **Injected UI (Content Scripts):** If we need to inject a "Chat with this page" button or floating modal, React can render a component tree directly into the page (via Shadow DOM), which is much cleaner than manual DOM manipulation.
*   **State Management:** RAG applications involve complex state (chat history, loading indicators, streaming responses). React's ecosystem makes managing this significantly easier than vanilla JS.

### 3. Future Proofing (Referrer & Scroll Tracking)
*   **Referrer:** Trivial to capture in a Content Script (`document.referrer`).
*   **Scroll Depth:** React hooks (`useEffect`) make managing event listeners and state (like max scroll depth) clean and declarative. We can easily debounce scroll events to calculate percentage read without performance impact.

## Implementation Plan (Phase 1.1)

1.  **Initialize Project:** Set up a Plasmo + React + TypeScript project.
2.  **Content Script:** Create a script that runs on page load.
    *   Extract `document.title`, `window.location.href`.
    *   Extract `document.referrer` (Source).
    *   Extract main body text (using a library like `@mozilla/readability` or simple DOM traversal).
3.  **Scroll Tracking:**
    *   Add a scroll listener to update a `maxScrollPercentage` state.
    *   Save this metric when the user leaves the page or after a timeout.
4.  **Storage:** Save the extracted data to `chrome.storage.local` or send to a local server.