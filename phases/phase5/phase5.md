# Phase 5: Cleaner and Evaluator

## Objective
Add the next-stage quality pipeline before heavy ingestion:

1. **Extension Cleaner:** clean HTML/content on the client before sending to SurfRAG Server.
2. **SurfRAG Evaluator:** judge whether a page is useful before storing to vector/graph systems.

This phase formalizes the "Future Framework" design and separates advanced quality control from Phase 4 core trigger/hash work.

---

## Scope

### 1. Extension-Side Cleaner
The extension should run a lightweight cleaner before sending capture payloads.

- Remove obvious noise from raw HTML extraction (navigation-only blocks, boilerplate wrappers, repeated UI text).
- Normalize whitespace and trim empty sections.
- Keep metadata (`url`, `title`, timestamps, `pageId`) unchanged.
- Output should remain compatible with existing `POST /captures` payload format.

**Expected outcome:** less noisy `bodyText`, lower server compute cost, better downstream retrieval quality.

### 2. Server-Side Evaluator
After receiving a cleaned payload, SurfRAG Server evaluates usefulness before expensive indexing.

- **Heuristic pre-filtering:** fast checks first (minimum word count, link-to-text ratio, obvious boilerplate pages).
- **LLM usefulness check (optional/fallback):** ask a cheap model if the page is meaningful knowledge-base content.
- **Useful pages:** continue full pipeline (SQLite + optional LanceDB + default LightRAG).
- **Not useful pages:** store metadata/basic record in SQLite with `is_useful=false`, skip LanceDB/LightRAG ingest.

**Expected outcome:** expensive processing is reserved for high-value pages.

---

## Dataflow (Future)

```text
Extension capture
  -> Cleaner
  -> POST /captures
  -> Evaluator (heuristics -> optional LLM)
     -> useful: SQLite + (optional) LanceDB + LightRAG
     -> not useful: SQLite only (is_useful=false)
```

---

## Deliverables

- Cleaner design and implementation in extension capture pipeline.
- Evaluator module in SurfRAG Server capture ingestion path.
- Config flags and defaults for evaluator behavior (heuristics thresholds, LLM enable switch).
- Documentation update describing Future Framework behavior and decision path.
