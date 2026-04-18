# Phase 5.4: Signal Extension and Preliminary Action Schema

## Purpose

This file defines the **Phase 5.4 extension contract** added on top of the existing Phase 5.3 contradiction response.

Phase 5.4 should not replace the Phase 5.3 classification flow. Instead, it should extend the same structured LightRAG contradiction query so the response also includes the contradiction-set signals needed to compute a `Preliminary action`.

This file is the canonical reference for:

- which new signal fields are added on top of the Phase 5.3 response
- how those signal fields should be interpreted
- how MCP should derive `allow-add`, `allow-add-prefer-new`, `hold`, or `reject`
- how claim-level debate metadata should be added after the preliminary action is `hold`
- how the final post-debate aggregation result should be stored

For the original contradiction classification contract, refer to:

- `phases/phase5/phase5-3/schema5-3.md`

---

## Relationship To Phase 5.3

Phase 5.4 extends Phase 5.3 instead of redefining it.

That means:

- Phase 5.3 still owns the core contradiction classification contract
- Phase 5.3 still returns `consistent`, `contradictory`, or `uncertain`
- Phase 5.4 adds policy-ready contradiction-set signals to the same response shape
- MCP then computes a deterministic `preliminary_action` from those signals
- if `preliminary_action = hold`, Phase 5.4 later enriches the same article JSON with debate metadata and a final non-`hold` action

---

## Extended Top-Level Shape

```json
{
  "classification": "contradictory",
  "summary_reason": "At least one important claim conflicts with the current graph-backed evidence.",
  "claims": [
    {
      "claim_text": "Acme's CEO is Bob.",
      "classification": "contradictory",
      "reason": "The current graph-backed evidence supports Alice as CEO.",
      "graph_answer": "The current graph indicates that Acme's CEO is Alice.",
      "references": [
        {
          "reference_id": "chunk-001",
          "file_path": "https://docs.example.com/acme-leadership"
        }
      ]
    }
  ],
  "policy_signals": {
    "contradictoryDocumentCount": 2,
    "contradictorySourceCount": 1,
    "hasMultiViewExisting": false,
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": false,
    "sourceLineageNotes": "Both contradictory references appear to come from the same company source lineage."
  },
  "preliminary_action": "hold",
  "preliminary_action_reason": "There are multiple contradictory documents, but they come from one source lineage rather than multiple independent sources.",
  "final_policy_signals": {
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": false,
    "debateSummary": "The claim-level debate did not justify preference for the new side."
  },
  "final_action": "allow-add",
  "final_action_reason": "Post-debate aggregation concluded the document should still be retained as non-preferred evidence.",
  "low_confidence": true
}
```

---

## Field Definitions

### Existing Phase 5.3 Fields

These fields keep the same semantics as in `schema5-3.md`:

- `classification`
- `summary_reason`
- `claims`

### New Phase 5.4 Extension Fields

- `policy_signals`
  - required for the Phase 5.4 extension
  - object containing contradiction-set signals used for preliminary action derivation

- `preliminary_action`
  - required for the Phase 5.4 extension
  - enum: `allow-add`, `allow-add-prefer-new`, `hold`, `reject`
  - LightRAG may return this directly if prompted to do so, but MCP should still be able to recompute it from `policy_signals`

- `preliminary_action_reason`
  - required for the Phase 5.4 extension
  - short natural-language explanation of why the preliminary action was chosen

- `final_policy_signals`
  - optional before debate
  - expected after debate or after the final aggregation pass
  - object containing the post-debate article-level policy summary

- `final_action`
  - optional before debate
  - required once Phase 5.4 finishes the final aggregation pass
  - enum: `allow-add`, `allow-add-prefer-new`, `reject`
  - must not remain `hold`

- `final_action_reason`
  - optional before debate
  - required once `final_action` exists
  - short natural-language explanation of the post-debate final action

- `low_confidence`
  - optional before debate
  - recommended after debate
  - boolean
  - marks that the final result used a cautious fallback rather than a strong conclusion

### `policy_signals` Fields

- `contradictoryDocumentCount`
  - required
  - integer >= 0
  - number of contradictory retrieved documents supporting the old side

- `contradictorySourceCount`
  - required
  - integer >= 0
  - number of **independent evidence sources** supporting the contradictory side after source-lineage normalization
  - this is not just the raw number of returned documents or URLs

- `hasMultiViewExisting`
  - required
  - boolean
  - whether the current graph already appears to preserve more than one plausible viewpoint on this issue

- `hasDecisiveNewEvidence`
  - required
  - boolean
  - whether the new document appears stronger, newer, more direct, or more authoritative than the currently preferred old-side support

- `hasInsufficientEvidence`
  - required
  - boolean
  - whether retrieval quality, evidence quality, or ambiguity is too weak for safe automatic trust

- `sourceLineageNotes`
  - recommended
  - short explanation of how contradictory documents were grouped into independent sources

- `oldSideSupportStrength`
  - optional
  - enum: `weak`, `medium`, `strong`
  - useful if the implementation wants stricter reject logic for multi-source contradiction

### Claim-Level Debate Metadata

Phase 5.4 should extend each claim item from `schema5-3.md` with optional debate metadata.

- `debate_result`
  - optional before debate
  - enum: `retain`, `prefer-new`, `reject`
  - final claim-level outcome after debate

- `debate_reason`
  - optional before debate
  - short Judge summary for why the claim reached its debate result

- `debate_rounds`
  - optional before debate
  - integer >= 0
  - number of rounds used for this claim

- `debate_winner`
  - optional before debate
  - enum: `new-side`, `old-side`, `none`
  - records which side the Judge found more convincing

- `low_confidence`
  - optional before debate
  - boolean
  - if true at the claim level, the debate ended with a cautious fallback rather than a strong winner

- `debate_history`
  - optional
  - array of compact round records if the implementation wants replay/debug visibility
  - each item may contain debater summaries, Judge feedback, and cited references

### `final_policy_signals` Fields

The final aggregation does not need to duplicate every original signal exactly, but it should capture the post-debate article state.

Recommended fields:

- `hasDecisiveNewEvidence`
  - boolean
  - whether the updated debated article now justifies preference for the new side

- `hasInsufficientEvidence`
  - boolean
  - whether the final result still required a low-confidence fallback

- `debateSummary`
  - string
  - short summary of what the claim-level debate changed at the article level

- `reasonCode`
  - optional
  - short machine-readable reason such as `max-rounds-fallback`, `mixed-claim-results`, or `new-side-preferred`

---

## Preliminary Action Semantics

- `allow-add`
  - store the new document
  - do not necessarily make it the preferred conclusion

- `allow-add-prefer-new`
  - store the new document
  - let it become the preferred conclusion for overlapping facts

- `hold`
  - do not insert automatically yet
  - send to the Phase 5.4 claim-level debate loop

- `reject`
  - do not insert automatically
  - contradictory old-side support is already materially stronger

### Post-Debate Final Action Semantics

- `allow-add`
  - final retain decision after debate
  - may be high confidence or low confidence

- `allow-add-prefer-new`
  - final retain-and-prefer decision after debate

- `reject`
  - final block decision after debate

- `hold`
  - not allowed as a final post-debate action

---

## Recommended MCP Derivation Rules

MCP should compute `preliminary_action` conservatively from `policy_signals` using rules like:

1. If `hasInsufficientEvidence = true`, choose `hold`.
2. Else if `contradictoryDocumentCount = 0`, choose `allow-add`.
3. Else if `hasDecisiveNewEvidence = true`, choose `allow-add-prefer-new`.
4. Else if `hasMultiViewExisting = true`, choose `allow-add`.
5. Else if `contradictoryDocumentCount >= 2` and `contradictorySourceCount >= 2` and `oldSideSupportStrength = strong`, choose `reject` or conservative `hold`.
6. Else if `contradictoryDocumentCount = 1`, choose `hold`.
7. Else if `contradictoryDocumentCount >= 2` and `contradictorySourceCount = 1`, choose `hold`.
8. Otherwise choose `hold`.

The exact implementation may refine thresholds later, but this should be the default contract.

Important follow-up rule:

- `hold` is only the **pre-debate** preliminary action
- after the debate loop finishes and the final article-level aggregation runs, the final retention result must not remain `hold`
- if the post-debate aggregation still cannot justify `allow-add-prefer-new` or `reject`, it should fall back to `allow-add`
- if that fallback path is used, `low_confidence` should be set to `true`

---

## Recommended Parsing Rules

When Phase 5.4 signal extension is enabled, MCP should additionally validate that:

- `policy_signals` exists and is an object
- `contradictoryDocumentCount` is a non-negative integer
- `contradictorySourceCount` is a non-negative integer
- `hasMultiViewExisting`, `hasDecisiveNewEvidence`, and `hasInsufficientEvidence` are booleans
- `preliminary_action` is one of `allow-add`, `allow-add-prefer-new`, `hold`, `reject`
- `preliminary_action_reason` is a non-empty string

When debate metadata exists, MCP should additionally validate that:

- `debate_result`, if present, is one of `retain`, `prefer-new`, `reject`
- `debate_rounds`, if present, is a non-negative integer
- `debate_winner`, if present, is `new-side`, `old-side`, or `none`
- `low_confidence`, if present, is boolean at both claim and article level
- `final_action`, if present, is one of `allow-add`, `allow-add-prefer-new`, `reject`
- `final_action_reason`, if present, is a non-empty string

If the extension fields are malformed:

- MCP may recompute `preliminary_action` from any valid subset of `policy_signals` if safe
- otherwise MCP should fail conservative toward `hold`

If the post-debate fields are malformed:

- MCP should keep the original preliminary result intact for debugging
- MCP should avoid pretending a final post-debate action succeeded
- if needed, MCP may conservatively convert the final action to low-confidence `allow-add` only when the implementation explicitly chooses that fallback

---

## Minimal Valid Example

```json
{
  "classification": "uncertain",
  "summary_reason": "Relevant evidence exists, but it is still too mixed for a safe automatic contradiction verdict.",
  "claims": [
    {
      "claim_text": "Acme will move its headquarters to Berlin next year.",
      "classification": "uncertain",
      "reason": "The retrieved references mention expansion in Europe but do not establish a definitive headquarters move.",
      "graph_answer": "The current graph contains partial location information without a decisive answer on a headquarters move.",
      "references": [
        {
          "reference_id": "chunk-201",
          "file_path": "https://news.example.com/acme-europe"
        }
      ]
    }
  ],
  "policy_signals": {
    "contradictoryDocumentCount": 1,
    "contradictorySourceCount": 1,
    "hasMultiViewExisting": false,
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": true,
    "sourceLineageNotes": "Only one relevant contradictory source was retrieved."
  },
  "preliminary_action": "hold",
  "preliminary_action_reason": "Evidence is insufficient for automatic trust.",
  "final_policy_signals": {
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": true,
    "debateSummary": "The claim-level debate did not produce a strong winner.",
    "reasonCode": "max-rounds-fallback"
  },
  "final_action": "allow-add",
  "final_action_reason": "The document is retained as low-confidence supporting evidence after unresolved debate.",
  "low_confidence": true
}
```

---

## Reference Rule

If there is any conflict between the older Phase 5.3 schema text and the Phase 5.4 signal-extension contract:

- use `schema5-3.md` as the source of truth for the original contradiction-classification fields
- use this file, `schema5-4.md`, as the source of truth for the added signal fields and `preliminary_action`
