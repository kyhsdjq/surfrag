# Phase 5.3 Prompt

## Purpose

This file records the contradiction-detection prompt currently used by the Phase 5.3 implementation in `services/local-mcp-server/src/contradiction/review.ts`.

It is the single structured prompt sent to LightRAG `/query` after MCP extracts a bounded set of candidate claims from the new document.

---

## Claim Extraction Prompt

This prompt is currently used by the claim-extraction step in `services/local-mcp-server/src/contradiction/review.ts`.

```text
You are extracting the most important factual claims from a newly captured document for contradiction review.

Your job is to identify a small set of high-signal factual assertions that are worth comparing against an existing knowledge graph.
Only use the article body provided below. Do not infer claims from title, URL, capture time, or other metadata.

Return JSON ONLY.
Do not use markdown fences.
Do not add any text before or after the JSON object.

Extraction rules:
- Extract at most 5 claims
- Extract only important claims that are central to the article body
- Prefer concrete factual claims over generic summaries
- Prefer entity-value style claims such as role, title, headquarters, location, date, quantity, ownership, status, policy, launch, or leadership changes
- Keep each claim as a short standalone sentence
- Avoid subjective opinions, marketing language, vague benefits, metadata, or duplicate restatements
- Do not return two claims with the same or very similar meaning
- If two candidate claims are semantically similar, keep only the more complete and informative one
- If the document contains very little factual content, return the single most important claim you can confidently restate
- Normalize wording for clarity, but do not invent facts not supported by the document

Required JSON schema:
{
  "claims": [
    "short factual claim 1",
    "short factual claim 2"
  ]
}

ARTICLE BODY:
${rawDocument}
```

### Claim Extraction Variables

- `${rawDocument}`: the article body text only, without title, URL, capture time, or other metadata

---

## Contradiction Query Prompt

```text
You are reviewing whether a NEW document contradicts the CURRENT LightRAG graph.

Use the retrieved graph-backed context and references to judge the claims below.
Return JSON ONLY.
Do not use markdown fences.
Do not add any text before or after the JSON object.

Classification rules:
- "consistent": the new document is consistent with the current graph-backed facts; if the graph does not contain relevant information about a claim, treat that claim as "consistent"
- "uncertain": there is relevant graph-backed information, but it is still not possible to judge confidently whether the claim is contradictory; use this only as a fallback when relevant evidence exists but remains inconclusive
- "contradictory": there is relevant graph-backed information and it clearly conflicts with the new claim

Decision rules:
- Prefer "consistent" when no relevant graph-backed conflict is found
- If the graph does not contain relevant information for a claim, classify that claim as "consistent"
- Prefer "contradictory" only when relevant graph-backed evidence clearly conflicts with an important claim
- Prefer "uncertain" only when relevant graph-backed evidence exists but is still too incomplete, mixed, or ambiguous to decide
- The top-level classification should be "contradictory" if any important claim is contradictory
- Otherwise the top-level classification should be "uncertain" if any important claim is uncertain
- Otherwise the top-level classification should be "consistent"

Required JSON schema:
{
  "classification": "consistent" | "contradictory" | "uncertain",
  "summary_reason": "short explanation",
  "claims": [
    {
      "claim_text": "normalized claim text",
      "classification": "consistent" | "contradictory" | "uncertain",
      "reason": "short explanation",
      "graph_answer": "what the current graph appears to say",
      "references": [
        {
          "reference_id": "reference identifier",
          "file_path": "source path or url"
        }
      ]
    }
  ]
}

NEW DOCUMENT FILE SOURCE:
${input.fileSource}

CANDIDATE CLAIMS:
${claimList}

NORMALIZED DOCUMENT TEXT:
${trimmedDocument}
```

---

## Contradiction Query Variables

- `${input.fileSource}`: the stable LightRAG `file_source` / review identity for the document
- `${claimList}`: the extracted candidate claims, rendered as a numbered list
- `${trimmedDocument}`: the normalized MCP document text, truncated when needed before prompt assembly

---

## Notes

- The implementation now uses two MCP-side prompts in sequence: one for claim extraction, then one contradiction query sent through LightRAG.
- The parser is fail-closed: malformed JSON or invalid schema is treated as an `uncertain` review result and blocks automatic LightRAG insertion.
- If the code prompt changes later, this file should be updated together with `services/local-mcp-server/src/contradiction/review.ts`.
