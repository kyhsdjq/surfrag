# Phase 5.4 Prompt Extension

## Purpose

This file records the **Phase 5.4 prompt extension** applied on top of the existing Phase 5.3 contradiction query.

Phase 5.4 should not introduce a completely separate first-pass judgment prompt. Instead, it should extend the existing Phase 5.3 structured LightRAG query so the model returns both:

- the original contradiction-classification fields from Phase 5.3
- the contradiction-set signals needed for Phase 5.4 preliminary action derivation

For the original Phase 5.3 prompt baseline, refer to:

- `phases/phase5/phase5-3/prompt5-3.md`

For the signal-extension response shape, refer to:

- `phases/phase5/phase5-4/schema5-4.md`

---

## Prompting Strategy

The recommended strategy is:

1. Keep the existing Phase 5.3 contradiction query structure.
2. Add a new section that asks the model to output `policy_signals`.
3. Ask the model to also return `preliminary_action` and `preliminary_action_reason`.
4. Let MCP validate the response and conservatively recompute the action if needed.
5. If that action is `hold`, the later Phase 5.4 debate loop will take over claim by claim.

This keeps the system incremental and avoids a major Phase 5.3 redesign.

This file only covers the **pre-debate** extension. The later debate stage should:

- debate unresolved claims one by one
- let both debaters query LightRAG directly for evidence
- update the same article-level JSON shape from `schema5-3.md`
- run one final article-level aggregation step that must not return `hold`

The full prompt family for Phase 5.4 should therefore contain four prompt types:

1. pre-debate contradiction and signal prompt
2. claim-level Debater 1 prompt
3. claim-level Debater 2 prompt
4. claim-level Judge prompt
5. final article-level aggregation prompt

---

## Recommended Extension To The Phase 5.3 Contradiction Query

Append or merge the following instructions into the existing contradiction query prompt from `prompt5-3.md`.

```text
In addition to the original contradiction-classification fields, you must also return a Phase 5.4 policy summary.

When producing that policy summary:
- Count how many contradictory documents support the old side
- Estimate how many independent evidence sources those contradictory documents represent after grouping same-lineage sources together
- Decide whether the graph already appears to preserve multiple plausible viewpoints on this issue
- Decide whether the new document appears strong enough to become the preferred conclusion because it is stronger, newer, more direct, or more authoritative than the current preferred support
- Decide whether the evidence remains too sparse, mixed, or ambiguous for automatic trust

Important interpretation rules:
- `contradictoryDocumentCount` is the number of contradictory retrieved documents
- `contradictorySourceCount` is the number of independent evidence sources, not just the number of URLs or chunks
- Multiple contradictory documents from the same source lineage are weaker than contradictory documents from multiple independent sources
- The incoming document's own source identity should not be the main decision rule
- A document may be worth storing even if it should not become the currently preferred conclusion

You must return JSON ONLY.
Do not use markdown fences.
Do not add any text before or after the JSON object.

Required additional JSON fields:
{
  "policy_signals": {
    "contradictoryDocumentCount": 0,
    "contradictorySourceCount": 0,
    "hasMultiViewExisting": false,
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": false,
    "sourceLineageNotes": "short explanation"
  },
  "preliminary_action": "allow-add" | "allow-add-prefer-new" | "hold" | "reject",
  "preliminary_action_reason": "short explanation"
}

Preliminary action guidance:
- choose `allow-add` when there is no meaningful contradictory evidence, or when the graph already preserves multiple plausible views and the new document adds another plausible view without decisive evidence
- choose `allow-add-prefer-new` when the new document contributes decisive evidence strong enough to become the preferred conclusion
- choose `hold` when exactly one contradictory document is retrieved, when multiple contradictory documents come from one source lineage, or when the evidence is sparse, mixed, or ambiguous
- choose `reject` or conservative `hold` when multiple contradictory documents come from multiple independent sources and the old-side support is materially stronger
```

---

## Combined Response Shape

The extended prompt should still preserve the original Phase 5.3 fields:

```json
{
  "classification": "contradictory",
  "summary_reason": "At least one important claim conflicts with current graph-backed evidence.",
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
    "sourceLineageNotes": "Both contradictory references come from the same source lineage."
  },
  "preliminary_action": "hold",
  "preliminary_action_reason": "There are multiple contradictory documents, but they mostly come from one source lineage."
}
```

---

## Implementation Note

The code path should still treat the original Phase 5.3 contradiction query as the main query. This file only defines the extra instructions needed so that same query can return policy-ready outputs for Phase 5.4.

---

## Claim-Level Debate Prompt Contracts

### Shared debate rules

- Debate runs only for claims whose `preliminary_action` still requires escalation
- Debate is claim-scoped, not full-document scoped
- Both debaters query LightRAG directly
- The Judge uses only the MCP-side LLM
- The maximum rounds default to `3` and should be read from `MAX_DEBATE_ROUNDS`
- Round 2 and later must include prior self argument, opponent argument, and Judge feedback

### Debater 1 Prompt Contract

Debater 1's role is to argue that the new claim deserves retention or preference.

Its prompt should include:

- the original claim text
- the article context
- the Phase 5.3 graph answer
- the cited references already retrieved
- the debater's fixed stance: support the new claim
- the current round number
- the debater's previous argument, if any
- the opponent's previous argument, if any
- the Judge's previous feedback, if any

Its output should be structured and should contain:

- `stance`: always `new-side`
- `argument_summary`
- `evidence_points`
- `citations`
- `response_to_opponent`
- `confidence`

### Debater 2 Prompt Contract

Debater 2's role is to argue that the current graph-side support should remain preferred or should block insertion.

Its prompt should include the same context shape as Debater 1, but with the fixed stance reversed.

Its output should be structured and should contain:

- `stance`: always `old-side`
- `argument_summary`
- `evidence_points`
- `citations`
- `response_to_opponent`
- `confidence`

### Judge Prompt Contract

The Judge should not call LightRAG directly. The Judge prompt should contain:

- the original claim case
- Debater 1 current argument
- Debater 2 current argument
- prior Judge feedback, if any
- the current round number
- the maximum rounds

The Judge output should contain:

- `decision`: `new-side`, `old-side`, or `no-decision`
- `reason`
- `feedback_for_next_round`
- `claim_result_if_final`: `retain`, `prefer-new`, `reject`, or `null`
- `low_confidence`

The Judge guidance should be:

- choose `new-side` when the new claim should at least be retained and may deserve preference
- choose `old-side` when the old-side support is materially stronger
- choose `no-decision` only when another round is justified and the maximum round count has not been reached
- on the last round, avoid returning another unresolved loop signal; instead produce the best available final claim outcome and use `low_confidence = true` if needed

---

## Final Article Aggregation Prompt Contract

After all debated claims are complete, MCP should run one final article-level prompt.

This prompt should include:

- the original article-level JSON from Phase 5.3
- the updated claim list including debate outcomes
- the original `policy_signals`
- the original `preliminary_action`
- whether any claims used low-confidence fallback

The aggregation output should contain:

- `final_policy_signals`
- `final_action`
- `final_action_reason`
- `low_confidence`

The aggregation prompt guidance should be:

- do not output `hold`
- choose `allow-add` when the document should still be retained but not preferred
- choose `allow-add-prefer-new` when the debated claim set now supports preference for the new side
- choose `reject` when the debated claim set still supports the old side strongly enough to block insertion
- if the result would otherwise remain unresolved, downgrade to `allow-add` and set `low_confidence = true`

---

## Suggested Debate Output Shapes

### Debater output

```json
{
  "stance": "new-side",
  "argument_summary": "The new document is more direct and more recent than the old-side support.",
  "evidence_points": [
    "The new document is an official update.",
    "The old-side references are indirect summaries."
  ],
  "citations": [
    {
      "reference_id": "chunk-001",
      "file_path": "https://example.com/source"
    }
  ],
  "response_to_opponent": "The opponent relies on weaker secondary evidence.",
  "confidence": "medium"
}
```

### Judge output

```json
{
  "decision": "new-side",
  "reason": "The new-side argument is more direct and better supported by current evidence.",
  "feedback_for_next_round": "Address whether the older graph-side sources come from the same lineage.",
  "claim_result_if_final": "prefer-new",
  "low_confidence": false
}
```

### Final aggregation output

```json
{
  "final_policy_signals": {
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": true,
    "debateSummary": "The claim-level debate did not produce a strong winner.",
    "reasonCode": "max-rounds-fallback"
  },
  "final_action": "allow-add",
  "final_action_reason": "The document is retained as low-confidence supporting evidence after debate.",
  "low_confidence": true
}
```

If later prompt wording diverges from implementation, update this file together with:

- `phases/phase5/phase5-4/schema5-4.md`
- `services/local-mcp-server/src/contradiction/review.ts`
