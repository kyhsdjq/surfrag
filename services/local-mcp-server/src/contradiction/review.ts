import { z } from "zod"

import { listLightRAGDocuments } from "../lightrag/documents.js"
import { getLlmProvider } from "../llm/index.js"
import type { CaptureRecord } from "../schema/capture.js"
import { queryLightRAG, type LightRAGReference } from "../lightrag/query.js"
import { buildLightRAGDocumentText } from "../lightrag/payload.js"

const MAX_CANDIDATE_CLAIMS = 5
const MAX_DOCUMENT_PROMPT_LENGTH = 8_000
const MAX_CLAIM_EXTRACTION_DOCUMENT_LENGTH = 8_000

export const contradictionClassificationSchema = z.enum([
  "consistent",
  "contradictory",
  "uncertain"
])

export const preliminaryActionSchema = z.enum([
  "allow-add",
  "allow-add-prefer-new",
  "hold",
  "reject"
])

export const finalActionSchema = z.enum([
  "allow-add",
  "allow-add-prefer-new",
  "reject"
])

export const claimDebateResultSchema = z.enum([
  "retain",
  "prefer-new",
  "reject"
])

export const debateWinnerSchema = z.enum([
  "new-side",
  "old-side",
  "none"
])

const oldSideSupportStrengthSchema = z.enum(["weak", "medium", "strong"])

export const policySignalsSchema = z.object({
  contradictoryDocumentCount: z.number().int().min(0),
  contradictorySourceCount: z.number().int().min(0),
  hasMultiViewExisting: z.boolean(),
  hasDecisiveNewEvidence: z.boolean(),
  hasInsufficientEvidence: z.boolean(),
  sourceLineageNotes: z.string().min(1).optional(),
  oldSideSupportStrength: oldSideSupportStrengthSchema.optional()
})

const contradictionReferenceSchema = z.object({
  reference_id: z.string().min(1),
  file_path: z.string().min(1)
})

const debateHistoryItemSchema = z.object({
  round: z.number().int().min(1),
  new_side_argument: z.string().min(1),
  old_side_argument: z.string().min(1),
  judge_feedback: z.string().min(1),
  judge_decision: debateWinnerSchema
})

const contradictionClaimResultSchema = z.object({
  claim_text: z.string().min(1),
  classification: contradictionClassificationSchema,
  reason: z.string().min(1),
  graph_answer: z.string().min(1),
  references: z.array(contradictionReferenceSchema),
  debate_result: claimDebateResultSchema.optional(),
  debate_reason: z.string().min(1).optional(),
  debate_rounds: z.number().int().min(0).optional(),
  debate_winner: debateWinnerSchema.optional(),
  low_confidence: z.boolean().optional(),
  debate_history: z.array(debateHistoryItemSchema).optional()
})

export const finalPolicySignalsSchema = z.object({
  hasDecisiveNewEvidence: z.boolean(),
  hasInsufficientEvidence: z.boolean(),
  debateSummary: z.string().min(1),
  reasonCode: z.string().min(1).optional()
})

export const contradictionResultSchema = z.object({
  classification: contradictionClassificationSchema,
  summary_reason: z.string().min(1),
  claims: z.array(contradictionClaimResultSchema).min(1),
  policy_signals: policySignalsSchema,
  preliminary_action: preliminaryActionSchema,
  preliminary_action_reason: z.string().min(1),
  final_policy_signals: finalPolicySignalsSchema.optional(),
  final_action: finalActionSchema.optional(),
  final_action_reason: z.string().min(1).optional(),
  low_confidence: z.boolean().optional()
})

export type ContradictionClassification = z.infer<
  typeof contradictionClassificationSchema
>

export type ContradictionClaimResult = z.infer<
  typeof contradictionClaimResultSchema
>

export type ContradictionResult = z.infer<typeof contradictionResultSchema>
export type PreliminaryAction = z.infer<typeof preliminaryActionSchema>
export type FinalAction = z.infer<typeof finalActionSchema>
export type PolicySignals = z.infer<typeof policySignalsSchema>
export type ClaimDebateResult = z.infer<typeof claimDebateResultSchema>
export type DebateWinner = z.infer<typeof debateWinnerSchema>
export type FinalPolicySignals = z.infer<typeof finalPolicySignalsSchema>
export type SignalPattern =
  | "no-conflict"
  | "one-doc-conflict"
  | "multi-doc-single-source-conflict"
  | "multi-doc-multi-source-conflict"
  | "multi-view-existing"
  | "decisive-new-evidence"
  | "insufficient-evidence"

export type ContradictionReviewPacket = {
  captureId: string
  reviewUrl: string
  fileSource: string
  rawDocument: string
  candidateClaims: string[]
  query: string
  result: ContradictionResult
  queryReferences: LightRAGReference[]
  disputedClaims: ContradictionClaimResult[]
  enteredDebate: boolean
  blocked: boolean
  debateTodo: boolean
}

type MockContradictionScenario = {
  candidateClaims: string[]
  query: string
  queryReferences: LightRAGReference[]
  result: ContradictionResult
}

type EvaluateCaptureForContradictionsInput = {
  capture: CaptureRecord
  reviewUrl: string
  fileSource: string
  baseUrl: string
  apiKey?: string | null
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function buildMockReferences(
  ...filePaths: string[]
): LightRAGReference[] {
  return filePaths.map((filePath, index) => ({
    reference_id: `mock-ref-${index + 1}`,
    file_path: filePath
  }))
}

function buildMockContradictionResult(input: {
  classification: ContradictionClassification
  summaryReason: string
  claims: ContradictionClaimResult[]
  policySignals: PolicySignals
  preliminaryActionReason: string
}): ContradictionResult {
  const preliminaryAction = derivePreliminaryAction(input.policySignals)

  return {
    classification: input.classification,
    summary_reason: normalizeWhitespace(input.summaryReason),
    claims: input.claims,
    policy_signals: input.policySignals,
    preliminary_action: preliminaryAction,
    preliminary_action_reason: normalizeWhitespace(input.preliminaryActionReason)
  }
}

function getMockContradictionScenario(
  reviewUrl: string
): MockContradictionScenario | null {
  const normalizedUrl = reviewUrl.trim().toLowerCase()

  switch (normalizedUrl) {
    case "https://phase5.mock/5.4.1/no-conflict": {
      const queryReferences = buildMockReferences(
        "https://phase5.mock/references/no-conflict-consensus"
      )

      return {
        candidateClaims: [
          "Nebula Labs launched the Atlas search appliance in 2026."
        ],
        query:
          "MOCK Phase 5.4 contradiction query for 5.4.1 no-conflict allow-add.",
        queryReferences,
        result: buildMockContradictionResult({
          classification: "consistent",
          summaryReason:
            "No meaningful contradictory evidence was retrieved for the evaluated claim.",
          claims: [
            {
              claim_text: "Nebula Labs launched the Atlas search appliance in 2026.",
              classification: "consistent",
              reason:
                "The retrieved graph-backed material does not contradict this launch claim.",
              graph_answer:
                "The current graph does not contain contradictory evidence against the 2026 Atlas launch claim.",
              references: queryReferences
            }
          ],
          policySignals: {
            contradictoryDocumentCount: 0,
            contradictorySourceCount: 0,
            hasMultiViewExisting: false,
            hasDecisiveNewEvidence: false,
            hasInsufficientEvidence: false,
            sourceLineageNotes: "No contradictory sources were retrieved."
          },
          preliminaryActionReason:
            "No contradictory evidence was found, so the document can be added normally."
        })
      }
    }

    case "https://phase5.mock/5.4.2/one-doc-conflict": {
      const queryReferences = buildMockReferences(
        "https://phase5.mock/references/one-doc-conflict"
      )

      return {
        candidateClaims: ["Orchid AI's CEO is Mina Park."],
        query:
          "MOCK Phase 5.4 contradiction query for 5.4.2 one-doc-conflict hold.",
        queryReferences,
        result: buildMockContradictionResult({
          classification: "contradictory",
          summaryReason:
            "One contradictory graph-backed document conflicts with the new CEO claim.",
          claims: [
            {
              claim_text: "Orchid AI's CEO is Mina Park.",
              classification: "contradictory",
              reason:
                "A retrieved graph-backed document currently supports Daniel Cho as CEO.",
              graph_answer:
                "The current graph indicates that Orchid AI's CEO is Daniel Cho.",
              references: queryReferences
            }
          ],
          policySignals: {
            contradictoryDocumentCount: 1,
            contradictorySourceCount: 1,
            hasMultiViewExisting: false,
            hasDecisiveNewEvidence: false,
            hasInsufficientEvidence: false,
            sourceLineageNotes:
              "Exactly one contradictory source was retrieved for this claim."
          },
          preliminaryActionReason:
            "A single contradictory document is not enough for automatic rejection or automatic trust, so the case should be held."
        })
      }
    }

    case "https://phase5.mock/5.4.3/multi-doc-single-source-conflict": {
      const queryReferences = buildMockReferences(
        "https://phase5.mock/references/same-lineage-press-release",
        "https://phase5.mock/references/same-lineage-investor-faq"
      )

      return {
        candidateClaims: ["Quartz Systems moved its headquarters to Toronto."],
        query:
          "MOCK Phase 5.4 contradiction query for 5.4.3 multi-doc-single-source hold.",
        queryReferences,
        result: buildMockContradictionResult({
          classification: "contradictory",
          summaryReason:
            "Multiple contradictory documents were found, but they appear to come from one source lineage.",
          claims: [
            {
              claim_text: "Quartz Systems moved its headquarters to Toronto.",
              classification: "contradictory",
              reason:
                "Two retrieved documents disagree with the move, but they both trace back to the same source lineage.",
              graph_answer:
                "The current graph still supports Vancouver as the headquarters location.",
              references: queryReferences
            }
          ],
          policySignals: {
            contradictoryDocumentCount: 2,
            contradictorySourceCount: 1,
            hasMultiViewExisting: false,
            hasDecisiveNewEvidence: false,
            hasInsufficientEvidence: false,
            sourceLineageNotes:
              "The contradictory documents appear to be the same corporate source lineage restated in multiple places."
          },
          preliminaryActionReason:
            "Multiple contradictory documents from one lineage are stronger than one document, but still weak enough to hold for later debate."
        })
      }
    }

    case "https://phase5.mock/5.4.4/multi-doc-multi-source-conflict": {
      const queryReferences = buildMockReferences(
        "https://phase5.mock/references/independent-source-a",
        "https://phase5.mock/references/independent-source-b",
        "https://phase5.mock/references/independent-source-c"
      )

      return {
        candidateClaims: ["Aster Bank's headquarters is now in Dubai."],
        query:
          "MOCK Phase 5.4 contradiction query for 5.4.4 multi-doc-multi-source reject.",
        queryReferences,
        result: buildMockContradictionResult({
          classification: "contradictory",
          summaryReason:
            "Multiple independent contradictory sources materially outweigh the new headquarters claim.",
          claims: [
            {
              claim_text: "Aster Bank's headquarters is now in Dubai.",
              classification: "contradictory",
              reason:
                "Several independent sources still support London as the headquarters location.",
              graph_answer:
                "The current graph strongly supports London as Aster Bank's headquarters.",
              references: queryReferences
            }
          ],
          policySignals: {
            contradictoryDocumentCount: 3,
            contradictorySourceCount: 3,
            hasMultiViewExisting: false,
            hasDecisiveNewEvidence: false,
            hasInsufficientEvidence: false,
            sourceLineageNotes:
              "The contradictory documents come from multiple independent evidence sources.",
            oldSideSupportStrength: "strong"
          },
          preliminaryActionReason:
            "Materially stronger multi-source contradictory support should reject automatic insertion."
        })
      }
    }

    case "https://phase5.mock/5.4.5/multi-view-existing": {
      const queryReferences = buildMockReferences(
        "https://phase5.mock/references/viewpoint-a",
        "https://phase5.mock/references/viewpoint-b"
      )

      return {
        candidateClaims: ["The Aurora policy should be classified as privacy-first."],
        query:
          "MOCK Phase 5.4 contradiction query for 5.4.5 multi-view-existing allow-add.",
        queryReferences,
        result: buildMockContradictionResult({
          classification: "contradictory",
          summaryReason:
            "The graph already preserves multiple plausible views on this policy question.",
          claims: [
            {
              claim_text:
                "The Aurora policy should be classified as privacy-first.",
              classification: "contradictory",
              reason:
                "The graph contains disagreement on how the policy should be characterized, but the issue is already multi-view.",
              graph_answer:
                "The current graph preserves multiple plausible interpretations of the Aurora policy.",
              references: queryReferences
            }
          ],
          policySignals: {
            contradictoryDocumentCount: 2,
            contradictorySourceCount: 2,
            hasMultiViewExisting: true,
            hasDecisiveNewEvidence: false,
            hasInsufficientEvidence: false,
            sourceLineageNotes:
              "Contradictory references exist, but the graph already stores multiple plausible views."
          },
          preliminaryActionReason:
            "Because the graph already preserves disagreement, this additional plausible viewpoint can still be added."
        })
      }
    }

    case "https://phase5.mock/5.4.6/decisive-new-evidence": {
      const queryReferences = buildMockReferences(
        "https://phase5.mock/references/older-news-coverage",
        "https://phase5.mock/references/outdated-directory"
      )

      return {
        candidateClaims: ["Northstar Robotics appointed Eva Lin as CEO on 2026-04-10."],
        query:
          "MOCK Phase 5.4 contradiction query for 5.4.6 decisive-new-evidence allow-add-prefer-new.",
        queryReferences,
        result: buildMockContradictionResult({
          classification: "contradictory",
          summaryReason:
            "Older graph-backed support conflicts with the new claim, but the new document is stronger and more authoritative.",
          claims: [
            {
              claim_text:
                "Northstar Robotics appointed Eva Lin as CEO on 2026-04-10.",
              classification: "contradictory",
              reason:
                "The old graph-backed answer still supports a prior CEO, but the new document is an official leadership announcement.",
              graph_answer:
                "The current graph still indicates that Omar Reed is CEO.",
              references: queryReferences
            }
          ],
          policySignals: {
            contradictoryDocumentCount: 2,
            contradictorySourceCount: 2,
            hasMultiViewExisting: false,
            hasDecisiveNewEvidence: true,
            hasInsufficientEvidence: false,
            sourceLineageNotes:
              "Contradictory sources exist, but the new official announcement is more authoritative."
          },
          preliminaryActionReason:
            "The new document is strong enough to become the preferred conclusion."
        })
      }
    }

    case "https://phase5.mock/5.4.7/insufficient-evidence": {
      const queryReferences = buildMockReferences(
        "https://phase5.mock/references/ambiguous-analyst-note"
      )

      return {
        candidateClaims: ["Helios Cloud will move its primary region to Madrid next year."],
        query:
          "MOCK Phase 5.4 contradiction query for 5.4.7 insufficient-evidence hold.",
        queryReferences,
        result: buildMockContradictionResult({
          classification: "uncertain",
          summaryReason:
            "Relevant evidence exists, but it is too sparse and ambiguous for safe automatic trust.",
          claims: [
            {
              claim_text:
                "Helios Cloud will move its primary region to Madrid next year.",
              classification: "uncertain",
              reason:
                "The retrieved material suggests European expansion but does not clearly confirm or deny the specific move.",
              graph_answer:
                "The current graph contains partial regional information without a decisive answer.",
              references: queryReferences
            }
          ],
          policySignals: {
            contradictoryDocumentCount: 1,
            contradictorySourceCount: 1,
            hasMultiViewExisting: false,
            hasDecisiveNewEvidence: false,
            hasInsufficientEvidence: true,
            sourceLineageNotes:
              "Only one weak, ambiguous source was retrieved for this issue."
          },
          preliminaryActionReason:
            "The evidence remains too sparse or mixed, so the case should be held for future debate."
        })
      }
    }

    default:
      return null
  }
}

const claimExtractionSchema = z.object({
  claims: z.array(z.string().min(1)).min(1).max(MAX_CANDIDATE_CLAIMS)
})

export function buildClaimExtractionPrompt(rawDocument: string): string {
  const trimmedDocument =
    rawDocument.length > MAX_CLAIM_EXTRACTION_DOCUMENT_LENGTH
      ? `${rawDocument.slice(0, MAX_CLAIM_EXTRACTION_DOCUMENT_LENGTH)}...`
      : rawDocument

  return `
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
${trimmedDocument}
  `.trim()
}

export function parseClaimExtractionResult(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown
  const result = claimExtractionSchema.parse(parsed)

  return [...new Set(result.claims.map((claim) => normalizeWhitespace(claim)).filter(Boolean))]
}

export async function extractCandidateClaims(capture: CaptureRecord): Promise<string[]> {
  const prompt = buildClaimExtractionPrompt(capture.bodyText)
  const llmProvider = getLlmProvider()
  const completion = await llmProvider.complete(prompt)
  const claims = parseClaimExtractionResult(completion)

  if (claims.length === 0) {
    throw new Error("Claim extraction returned no usable claims")
  }

  return claims.slice(0, MAX_CANDIDATE_CLAIMS)
}

export function buildContradictionPrompt(input: {
  fileSource: string
  documentText: string
  claims: string[]
}): string {
  const trimmedDocument =
    input.documentText.length > MAX_DOCUMENT_PROMPT_LENGTH
      ? `${input.documentText.slice(0, MAX_DOCUMENT_PROMPT_LENGTH)}...`
      : input.documentText

  const claimList = input.claims
    .map((claim, index) => `${index + 1}. ${claim}`)
    .join("\n")

  return `
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
  ],
  "policy_signals": {
    "contradictoryDocumentCount": 0,
    "contradictorySourceCount": 0,
    "hasMultiViewExisting": false,
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": false,
    "sourceLineageNotes": "short explanation",
    "oldSideSupportStrength": "weak" | "medium" | "strong"
  },
  "preliminary_action": "allow-add" | "allow-add-prefer-new" | "hold" | "reject",
  "preliminary_action_reason": "short explanation"
}

Phase 5.4 policy summary rules:
- In addition to contradiction classification, estimate the contradiction-set structure around the new claim
- "contradictoryDocumentCount" counts contradictory retrieved documents that support the old side
- "contradictorySourceCount" counts independent evidence sources after grouping same-lineage sources together; it is not just the number of URLs
- Set "hasMultiViewExisting" when the graph already appears to preserve multiple plausible viewpoints on this issue
- Set "hasDecisiveNewEvidence" when the new document appears stronger, newer, more direct, or more authoritative than the current preferred old-side support
- Set "hasInsufficientEvidence" when evidence remains too sparse, mixed, or ambiguous for safe automatic trust
- The incoming document's own source identity should not be the main decision rule
- A document may be worth storing even if it should not become the currently preferred conclusion

Preliminary action guidance:
- choose "allow-add" when there is no meaningful contradictory evidence, or when the graph already preserves multiple plausible views and the new document adds another plausible view without decisive evidence
- choose "allow-add-prefer-new" when the new document contributes decisive evidence strong enough to become the preferred conclusion
- choose "hold" when exactly one contradictory document is retrieved, when multiple contradictory documents come from one source lineage, or when the evidence is sparse, mixed, or ambiguous
- choose "reject" or conservative "hold" when multiple contradictory documents come from multiple independent sources and the old-side support is materially stronger

NEW DOCUMENT FILE SOURCE:
${input.fileSource}

CANDIDATE CLAIMS:
${claimList}

NORMALIZED DOCUMENT TEXT:
${trimmedDocument}
  `.trim()
}

export function parseContradictionResult(raw: string): ContradictionResult {
  const parsed = JSON.parse(raw) as unknown
  const result = contradictionResultSchema.parse(parsed)
  const preliminaryAction = derivePreliminaryAction(result.policy_signals)

  return {
    ...result,
    preliminary_action: preliminaryAction,
    preliminary_action_reason:
      result.preliminary_action === preliminaryAction
        ? normalizeWhitespace(result.preliminary_action_reason)
        : normalizeWhitespace(
            [
              `MCP recomputed preliminary action as "${preliminaryAction}" from policy signals.`,
              `Model proposed "${result.preliminary_action}".`,
              result.preliminary_action_reason
            ].join(" ")
          )
  }
}

export function derivePreliminaryAction(
  policySignals: PolicySignals
): PreliminaryAction {
  if (policySignals.hasInsufficientEvidence) {
    return "hold"
  }

  if (policySignals.contradictoryDocumentCount === 0) {
    return "allow-add"
  }

  if (policySignals.hasDecisiveNewEvidence) {
    return "allow-add-prefer-new"
  }

  if (policySignals.hasMultiViewExisting) {
    return "allow-add"
  }

  if (
    policySignals.contradictoryDocumentCount >= 2 &&
    policySignals.contradictorySourceCount >= 2 &&
    policySignals.oldSideSupportStrength === "strong"
  ) {
    return "reject"
  }

  if (policySignals.contradictoryDocumentCount === 1) {
    return "hold"
  }

  if (
    policySignals.contradictoryDocumentCount >= 2 &&
    policySignals.contradictorySourceCount <= 1
  ) {
    return "hold"
  }

  return "hold"
}

export function getEffectiveAction(
  result: ContradictionResult
): PreliminaryAction | FinalAction {
  return result.final_action ?? result.preliminary_action
}

export function deriveSignalPatterns(policySignals: PolicySignals): SignalPattern[] {
  const patterns: SignalPattern[] = []

  if (policySignals.contradictoryDocumentCount === 0) {
    patterns.push("no-conflict")
  } else if (policySignals.contradictoryDocumentCount === 1) {
    patterns.push("one-doc-conflict")
  } else if (policySignals.contradictorySourceCount <= 1) {
    patterns.push("multi-doc-single-source-conflict")
  } else {
    patterns.push("multi-doc-multi-source-conflict")
  }

  if (policySignals.hasMultiViewExisting) {
    patterns.push("multi-view-existing")
  }

  if (policySignals.hasDecisiveNewEvidence) {
    patterns.push("decisive-new-evidence")
  }

  if (policySignals.hasInsufficientEvidence) {
    patterns.push("insufficient-evidence")
  }

  return patterns
}

function buildFailClosedResult(
  claims: string[],
  reason: string,
  queryReferences: LightRAGReference[]
): ContradictionResult {
  const normalizedReason = normalizeWhitespace(reason) || "Contradiction review failed closed."
  const fallbackReferences = queryReferences.slice(0, 3)

  return {
    classification: "uncertain",
    summary_reason: normalizedReason,
    claims: claims.map((claim) => ({
      claim_text: claim,
      classification: "uncertain",
      reason: normalizedReason,
      graph_answer: "No reliable graph answer was produced.",
      references: fallbackReferences
    })),
    policy_signals: {
      contradictoryDocumentCount: 0,
      contradictorySourceCount: 0,
      hasMultiViewExisting: false,
      hasDecisiveNewEvidence: false,
      hasInsufficientEvidence: true,
      sourceLineageNotes: "No reliable contradiction-set signal could be derived."
    },
    preliminary_action: "hold",
    preliminary_action_reason:
      "Phase 5.4 failed conservative because contradiction-set signals were missing or malformed."
  }
}

export async function evaluateCaptureForContradictions(
  input: EvaluateCaptureForContradictionsInput
): Promise<ContradictionReviewPacket> {
  const rawDocument = buildLightRAGDocumentText(input.capture)
  const mockScenario = getMockContradictionScenario(input.reviewUrl)
  let queryReferences: LightRAGReference[] = []
  let result: ContradictionResult
  let candidateClaims: string[] = []
  let query = ""

  if (mockScenario) {
    const disputedClaims = mockScenario.result.claims.filter(
      (claim) => claim.classification !== "consistent"
    )

    return {
      captureId: input.capture.id,
      reviewUrl: input.reviewUrl,
      fileSource: input.fileSource,
      rawDocument,
      candidateClaims: mockScenario.candidateClaims,
      query: mockScenario.query,
      result: mockScenario.result,
      queryReferences: mockScenario.queryReferences,
      disputedClaims,
      enteredDebate: false,
      blocked:
        mockScenario.result.preliminary_action === "hold" ||
        mockScenario.result.preliminary_action === "reject",
      debateTodo: mockScenario.result.preliminary_action === "hold"
    }
  }

  try {
    const existingDocuments = await listLightRAGDocuments(
      input.baseUrl,
      input.apiKey
    )

    if (existingDocuments.length === 0) {
      result = {
        classification: "consistent",
        summary_reason:
          "No existing LightRAG documents were available, so contradiction review allowed the first document to enter the graph.",
        claims: [],
        policy_signals: {
          contradictoryDocumentCount: 0,
          contradictorySourceCount: 0,
          hasMultiViewExisting: false,
          hasDecisiveNewEvidence: false,
          hasInsufficientEvidence: false,
          sourceLineageNotes: "No contradictory LightRAG sources existed yet."
        },
        preliminary_action: "allow-add",
        preliminary_action_reason:
          "No contradictory evidence was retrieved because the graph is still empty."
      }

      return {
        captureId: input.capture.id,
        reviewUrl: input.reviewUrl,
        fileSource: input.fileSource,
        rawDocument,
        candidateClaims,
        query,
        result,
        queryReferences,
        disputedClaims: [],
        enteredDebate: false,
        blocked: false,
        debateTodo: false
      }
    }

    candidateClaims = await extractCandidateClaims(input.capture)
    query = buildContradictionPrompt({
      fileSource: input.fileSource,
      documentText: rawDocument,
      claims: candidateClaims
    })

    const queryResult = await queryLightRAG(
      {
        query,
        mode: "mix",
        limit: Math.max(10, candidateClaims.length * 3)
      },
      input.baseUrl,
      input.apiKey
    )

    queryReferences = queryResult.references ?? []
    result = parseContradictionResult(queryResult.response)
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "error" in error
          ? String(error.error)
          : "Contradiction review failed closed."

    candidateClaims =
      candidateClaims.length > 0
        ? candidateClaims
        : ["Claim extraction failed before contradiction review completed."]

    result = buildFailClosedResult(candidateClaims, message, queryReferences)
  }

  const disputedClaims = result.claims.filter(
    (claim) => claim.classification !== "consistent"
  )

  return {
    captureId: input.capture.id,
    reviewUrl: input.reviewUrl,
    fileSource: input.fileSource,
    rawDocument,
    candidateClaims,
    query,
    result,
    queryReferences,
    disputedClaims,
    enteredDebate: false,
    blocked:
      result.preliminary_action === "hold" || result.preliminary_action === "reject",
    debateTodo: result.preliminary_action === "hold"
  }
}
