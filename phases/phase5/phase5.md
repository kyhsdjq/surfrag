# Phase 5: Evaluator

## Objective
Add the next-stage quality pipeline before heavy ingestion:

1. **SurfRAG Evaluator:** judge whether a page is useful before storing to vector/graph systems.

This phase formalizes the "Future Framework" design and separates advanced quality control from Phase 4 core trigger/hash work.

---

## Scope

### 1. Server-Side Evaluator
After receiving a capture payload, SurfRAG Server evaluates usefulness before expensive indexing.

- **Heuristic pre-filtering:** fast checks first (minimum word count, link-to-text ratio, obvious boilerplate pages).
- **LLM usefulness check (optional/fallback):** ask a cheap model if the page is meaningful knowledge-base content.
- **Useful pages:** continue full pipeline (SQLite + optional LanceDB + default LightRAG).
- **Not useful pages:** store metadata/basic record in SQLite with `is_useful=false`, skip LanceDB/LightRAG ingest.

**Expected outcome:** expensive processing is reserved for high-value pages.

---

## Dataflow (Future)

```text
Extension capture
  -> POST /captures
  -> Evaluator (heuristics -> optional LLM)
     -> useful: SQLite + (optional) LanceDB + LightRAG
     -> not useful: SQLite only (is_useful=false)
```

---

## Deliverables

- Evaluator module in SurfRAG Server capture ingestion path.
- Config flags and defaults for evaluator behavior (heuristics thresholds, LLM enable switch).
- Documentation update describing Future Framework behavior and decision path.
