# Phase 5.3: Expected LightRAG Response Schema

## Purpose

This file defines the **expected JSON response shape** for the single LightRAG contradiction query used by Phase 5.3.

The flow is:

1. MCP extracts a small set of candidate claims from the incoming document.
2. MCP sends one structured contradiction query to LightRAG.
3. LightRAG returns JSON only.
4. MCP parses that JSON and decides whether the document may continue to LightRAG insertion.

This schema is a contract target for prompt design and MCP-side validation. The real runtime parser can be stricter than this document if needed.

This file also documents the **lightweight review-table row** that Phase 5.3 should persist for each document candidate.

---

## Classification Semantics

- `consistent`: the new document does not materially contradict the currently retrieved graph-backed facts
- `contradictory`: the new document conflicts with currently retrieved graph-backed facts on at least one important claim
- `uncertain`: the evidence is missing, mixed, ambiguous, or too weak for safe automatic insertion

Phase 5.3 routing should follow this default:

- `consistent` -> allow insertion
- `contradictory` -> block insertion
- `uncertain` -> block insertion
- malformed JSON -> block insertion

---

## Expected Top-Level Shape

```json
{
  "classification": "consistent",
  "summary_reason": "The new document matches the current graph on the evaluated claims.",
  "claims": [
    {
      "claim_text": "Acme's CEO is Bob.",
      "classification": "consistent",
      "reason": "The graph answer and cited references also support Bob as CEO.",
      "graph_answer": "The current graph indicates that Acme's CEO is Bob.",
      "references": [
        {
          "reference_id": "chunk-123",
          "file_path": "https://example.com/acme-profile"
        }
      ]
    }
  ]
}
```

---

## Field Definitions

### Top-Level Fields

- `classification`
  - required
  - enum: `consistent`, `contradictory`, `uncertain`
  - document-level overall result used by MCP for allow/block routing

- `summary_reason`
  - required
  - short natural-language explanation of the overall result

- `claims`
  - required
  - array of per-claim contradiction results
  - should contain at least one item when the query was able to evaluate anything meaningful

### Per-Claim Fields

- `claim_text`
  - required
  - the normalized or restated candidate claim that was evaluated

- `classification`
  - required
  - enum: `consistent`, `contradictory`, `uncertain`
  - per-claim result

- `reason`
  - required
  - short explanation for why this claim received that classification

- `graph_answer`
  - required
  - LightRAG's concise statement of what the current graph appears to say about this claim

- `references`
  - required
  - array of cited supporting documents returned from LightRAG

### Reference Fields

- `reference_id`
  - required
  - the reference or chunk identifier returned by LightRAG

- `file_path`
  - required
  - the source document path or URL returned by LightRAG

---

## Recommended MCP Parsing Rules

MCP should treat the result as valid only if:

- the response is valid JSON
- `classification` exists and is one of the allowed enum values
- `summary_reason` is a non-empty string
- `claims` is an array
- each claim item has `claim_text`, `classification`, `reason`, `graph_answer`, and `references`
- each reference has `reference_id` and `file_path`

MCP should fail closed if:

- the response is not valid JSON
- required fields are missing
- enum values are invalid
- the model returns explanatory prose outside the JSON block

---

## Lightweight Review Table Row

Phase 5.3 should persist one lightweight review-table row per document candidate. Phase 5.4 should reuse the same row instead of introducing a second result structure.

### Recommended Shape

```json
{
  "capture_id": 42,
  "url": "https://example.com/acme-profile",
  "raw_document": "Title: Acme Profile\nURL: https://example.com/acme-profile\nCaptured: 2026-04-09T09:00:00.000Z\n\nAcme's CEO is Bob.",
  "result_json": {
    "classification": "contradictory",
    "summary_reason": "At least one key claim conflicts with the current graph-backed evidence.",
    "claims": [
      {
        "claim_text": "Acme's CEO is Bob.",
        "classification": "contradictory",
        "reason": "The graph currently supports Alice as CEO.",
        "graph_answer": "The current graph indicates that Acme's CEO is Alice.",
        "references": [
          {
            "reference_id": "chunk-001",
            "file_path": "https://docs.example.com/acme-leadership"
          }
        ]
      }
    ]
  },
  "entered_debate": false
}
```

### Field Semantics

- `capture_id`
  - recommended
  - links the row back to the stored capture record

- `url`
  - required
  - canonical or review-key URL for this document row

- `raw_document`
  - required
  - the original normalized document text that was reviewed

- `result_json`
  - required
  - the current contradiction result in the same shape defined earlier in this file
  - initially this is the Phase 5.3 LightRAG result
  - after Phase 5.4, this should still keep the same shape, only updated to the final post-debate result

- `entered_debate`
  - required
  - boolean lifecycle flag
  - `false` after Phase 5.3 finishes and before debate starts
  - `true` once the document has gone through Phase 5.4 debate

### Cross-Phase Rule

The important rule is:

- Phase 5.3 creates the row and writes the initial `result_json`
- Phase 5.4 updates the same row
- Phase 5.4 should keep the same `result_json` shape rather than creating a second schema
- the only required additional lifecycle signal is `entered_debate`

---

## Minimal Valid Example

```json
{
  "classification": "contradictory",
  "summary_reason": "At least one key claim conflicts with the current graph-backed evidence.",
  "claims": [
    {
      "claim_text": "Acme's CEO is Bob.",
      "classification": "contradictory",
      "reason": "The graph currently supports Alice as CEO, which cannot both be true at the same time.",
      "graph_answer": "The current graph indicates that Acme's CEO is Alice.",
      "references": [
        {
          "reference_id": "chunk-001",
          "file_path": "https://docs.example.com/acme-leadership"
        }
      ]
    }
  ]
}
```

---

## Ambiguous Example

```json
{
  "classification": "uncertain",
  "summary_reason": "The retrieved evidence is too weak or incomplete for a safe automatic decision.",
  "claims": [
    {
      "claim_text": "Acme will move its headquarters to Berlin next year.",
      "classification": "uncertain",
      "reason": "The graph references mention expansion in Europe but do not clearly confirm or deny a headquarters move.",
      "graph_answer": "The current graph contains partial location information but no decisive answer on the headquarters move claim.",
      "references": [
        {
          "reference_id": "chunk-201",
          "file_path": "https://news.example.com/acme-europe"
        }
      ]
    }
  ]
}
```

---

## Prompting Notes

The Phase 5.3 contradiction prompt sent to LightRAG should explicitly require:

- JSON only
- no markdown fences
- no prose before or after the JSON
- one top-level `classification`
- per-claim `classification`, `reason`, `graph_answer`, and `references`
- references copied from the actual LightRAG response context rather than fabricated placeholders

---

## Open Choice

The current recommended schema keeps both:

- a top-level document classification
- per-claim classifications

This is preferred because MCP usually needs one final allow/block result, while Phase 5.4 will likely benefit from the per-claim breakdown.
