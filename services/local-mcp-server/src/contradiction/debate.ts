import { z } from "zod"

import { getLlmProvider } from "../llm/index.js"
import { queryLightRAG, type LightRAGReference } from "../lightrag/query.js"
import {
  claimDebateResultSchema,
  contradictionResultSchema,
  debateWinnerSchema,
  finalActionSchema,
  finalPolicySignalsSchema,
  type ClaimDebateResult,
  type ContradictionClaimResult,
  type ContradictionReviewPacket,
  type ContradictionResult,
  type DebateWinner,
  type FinalAction
} from "./review.js"

export const DEFAULT_MAX_DEBATE_ROUNDS = 3

const MAX_DEBATE_ARTICLE_LENGTH = 4_000
const MAX_DEBATE_ARGUMENT_LENGTH = 1_500
const MAX_AGGREGATION_JSON_LENGTH = 10_000

const debaterStanceSchema = z.enum(["new-side", "old-side"])
const debaterConfidenceSchema = z.enum(["low", "medium", "high"])

const debateReferenceSchema = z.object({
  reference_id: z.string().min(1),
  file_path: z.string().min(1)
})

const debaterOutputSchema = z.object({
  stance: debaterStanceSchema,
  argument_summary: z.string().min(1),
  evidence_points: z.array(z.string().min(1)).min(1),
  citations: z.array(debateReferenceSchema),
  response_to_opponent: z.string().min(1),
  confidence: debaterConfidenceSchema
})

const judgeOutputSchema = z.object({
  decision: z.enum(["new-side", "old-side", "no-decision"]),
  reason: z.string().min(1),
  feedback_for_next_round: z.string().min(1),
  claim_result_if_final: claimDebateResultSchema.nullable(),
  low_confidence: z.boolean()
})

const aggregationOutputSchema = z.object({
  final_policy_signals: finalPolicySignalsSchema,
  final_action: finalActionSchema,
  final_action_reason: z.string().min(1),
  low_confidence: z.boolean()
})

type DebaterStance = z.infer<typeof debaterStanceSchema>
type DebaterOutput = z.infer<typeof debaterOutputSchema>
type JudgeOutput = z.infer<typeof judgeOutputSchema>
type AggregationOutput = z.infer<typeof aggregationOutputSchema>

type ClaimRoundRecord = {
  round: number
  newSide: DebaterOutput
  oldSide: DebaterOutput
  judge: JudgeOutput
}

type RunContradictionDebateInput = {
  review: ContradictionReviewPacket
  baseUrl: string
  apiKey?: string | null
  maxRounds?: number
}

function parsePositiveInt(value: string | undefined): number | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null
  }

  return parsed
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function trimForPrompt(value: string, maxLength: number): string {
  const normalized = value.trim()
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized
}

function formatReferences(references: LightRAGReference[]): string {
  if (references.length === 0) {
    return "[]"
  }

  return JSON.stringify(references, null, 2)
}

function mergeReferences(
  primary: LightRAGReference[],
  secondary: LightRAGReference[]
): LightRAGReference[] {
  const seen = new Set<string>()
  const merged: LightRAGReference[] = []

  for (const ref of [...primary, ...secondary]) {
    const key = `${ref.reference_id}::${ref.file_path}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(ref)
  }

  return merged
}

function deriveFallbackClaimResult(
  decision: JudgeOutput["decision"]
): ClaimDebateResult {
  switch (decision) {
    case "old-side":
      return "reject"
    case "new-side":
      return "retain"
    case "no-decision":
    default:
      return "retain"
  }
}

function buildClaimRoundHistory(rounds: ClaimRoundRecord[]) {
  return rounds.map((round) => ({
    round: round.round,
    new_side_argument: round.newSide.argument_summary,
    old_side_argument: round.oldSide.argument_summary,
    judge_feedback: round.judge.feedback_for_next_round,
    judge_decision: (
      round.judge.decision === "no-decision" ? "none" : round.judge.decision
    ) as DebateWinner
  }))
}

function buildDebaterFallback(
  stance: DebaterStance,
  queryReferences: LightRAGReference[],
  reason: string,
  previousOpponentArgument?: string
): DebaterOutput {
  const summary = normalizeWhitespace(reason) || "No structured debate argument was produced."

  return {
    stance,
    argument_summary: summary,
    evidence_points: [summary],
    citations: queryReferences.slice(0, 3),
    response_to_opponent:
      previousOpponentArgument?.trim()
        ? "The opponent's prior argument could not be fully rebutted due to debate parsing fallback."
        : "No opponent argument was available in this round.",
    confidence: "low"
  }
}

function buildJudgeFallback(
  round: number,
  maxRounds: number,
  reason: string
): JudgeOutput {
  const normalizedReason =
    normalizeWhitespace(reason) || "Judge parsing fallback was used."
  const finalRound = round >= maxRounds

  return {
    decision: finalRound ? "no-decision" : "no-decision",
    reason: normalizedReason,
    feedback_for_next_round: finalRound
      ? "No further debate rounds remain; use a cautious fallback."
      : "Address the strongest opposing evidence more directly in the next round.",
    claim_result_if_final: finalRound ? "retain" : null,
    low_confidence: true
  }
}

function buildAggregationFallback(
  reason: string,
  lowConfidence = true
): AggregationOutput {
  const normalizedReason =
    normalizeWhitespace(reason) || "Final aggregation parsing fallback was used."

  return {
    final_policy_signals: {
      hasDecisiveNewEvidence: false,
      hasInsufficientEvidence: true,
      debateSummary: normalizedReason,
      reasonCode: "aggregation-fallback"
    },
    final_action: "allow-add",
    final_action_reason:
      "The final aggregation could not produce a stronger conclusion, so the document was retained conservatively.",
    low_confidence: lowConfidence
  }
}

function buildDebaterPrompt(input: {
  stance: DebaterStance
  review: ContradictionReviewPacket
  claim: ContradictionClaimResult
  round: number
  maxRounds: number
  previousSelfArgument: DebaterOutput | undefined
  previousOpponentArgument: DebaterOutput | undefined
  previousJudgeFeedback: string | undefined
}): string {
  const roleInstruction =
    input.stance === "new-side"
      ? "Argue that the new claim deserves retention or preference."
      : "Argue that the current graph-backed position should remain preferred or should block insertion."

  const articleExcerpt = trimForPrompt(input.review.rawDocument, MAX_DEBATE_ARTICLE_LENGTH)
  const previousSelf = input.previousSelfArgument
    ? trimForPrompt(JSON.stringify(input.previousSelfArgument, null, 2), MAX_DEBATE_ARGUMENT_LENGTH)
    : "None."
  const previousOpponent = input.previousOpponentArgument
    ? trimForPrompt(JSON.stringify(input.previousOpponentArgument, null, 2), MAX_DEBATE_ARGUMENT_LENGTH)
    : "None."
  const judgeFeedback = input.previousJudgeFeedback?.trim() || "None."

  return `
You are a claim-level debate agent connected to LightRAG retrieval.

Round ${input.round} of ${input.maxRounds}.
Fixed stance: ${input.stance}
Role instruction: ${roleInstruction}

Use the LightRAG graph-backed retrieval context available to this query.
Base your answer on graph-backed evidence and cited references.
Return JSON ONLY.
Do not use markdown fences.
Do not add any text before or after the JSON object.

ORIGINAL CLAIM CASE:
- claim_text: ${input.claim.claim_text}
- original_phase5_3_classification: ${input.claim.classification}
- original_reason: ${input.claim.reason}
- original_graph_answer: ${input.claim.graph_answer}
- original_references: ${formatReferences(input.claim.references)}

ARTICLE CONTEXT:
${articleExcerpt}

PREVIOUS SELF ARGUMENT:
${previousSelf}

PREVIOUS OPPONENT ARGUMENT:
${previousOpponent}

PREVIOUS JUDGE FEEDBACK:
${judgeFeedback}

Required JSON schema:
{
  "stance": "${input.stance}",
  "argument_summary": "short argument summary",
  "evidence_points": [
    "point 1",
    "point 2"
  ],
  "citations": [
    {
      "reference_id": "reference identifier",
      "file_path": "source path or url"
    }
  ],
  "response_to_opponent": "short rebuttal",
  "confidence": "low" | "medium" | "high"
}
  `.trim()
}

function buildJudgePrompt(input: {
  claim: ContradictionClaimResult
  round: number
  maxRounds: number
  newSide: DebaterOutput
  oldSide: DebaterOutput
  previousJudgeFeedback: string | undefined
}): string {
  const previousJudgeFeedback = input.previousJudgeFeedback?.trim() || "None."

  return `
You are the Judge for a claim-level debate in Phase 5.4.

You must evaluate the two debaters' current arguments.
Do not query LightRAG yourself.
Use only the claim case, the debaters' arguments, and prior Judge feedback.
Return JSON ONLY.
Do not use markdown fences.
Do not add any text before or after the JSON object.

Round ${input.round} of ${input.maxRounds}.

CLAIM CASE:
${JSON.stringify(
    {
      claim_text: input.claim.claim_text,
      classification: input.claim.classification,
      reason: input.claim.reason,
      graph_answer: input.claim.graph_answer,
      references: input.claim.references
    },
    null,
    2
  )}

DEBATER 1 CURRENT ARGUMENT:
${JSON.stringify(input.newSide, null, 2)}

DEBATER 2 CURRENT ARGUMENT:
${JSON.stringify(input.oldSide, null, 2)}

PREVIOUS JUDGE FEEDBACK:
${previousJudgeFeedback}

Judge guidance:
- choose "new-side" when the new claim should at least be retained and may deserve preference
- choose "old-side" when the old-side support is materially stronger
- choose "no-decision" only when another round is justified and the maximum round count has not been reached
- on the last round, avoid another unresolved loop signal; produce the best available final claim outcome and use low_confidence=true if needed

Required JSON schema:
{
  "decision": "new-side" | "old-side" | "no-decision",
  "reason": "short explanation",
  "feedback_for_next_round": "short instruction",
  "claim_result_if_final": "retain" | "prefer-new" | "reject" | null,
  "low_confidence": false
}
  `.trim()
}

function buildFinalAggregationPrompt(input: {
  review: ContradictionReviewPacket
  updatedResult: ContradictionResult
}): string {
  const serializedResult = trimForPrompt(
    JSON.stringify(input.updatedResult, null, 2),
    MAX_AGGREGATION_JSON_LENGTH
  )

  return `
You are performing the final article-level aggregation for Phase 5.4 after claim-level debate.

You must decide the final retention outcome for the article.
Do not output "hold".
If the article should still be retained but cannot be strongly preferred or rejected, choose "allow-add" and set low_confidence=true when appropriate.
Return JSON ONLY.
Do not use markdown fences.
Do not add any text before or after the JSON object.

ARTICLE REVIEW KEY:
- review_url: ${input.review.reviewUrl}
- file_source: ${input.review.fileSource}
- candidate_claims: ${JSON.stringify(input.review.candidateClaims)}

UPDATED ARTICLE JSON:
${serializedResult}

Required JSON schema:
{
  "final_policy_signals": {
    "hasDecisiveNewEvidence": false,
    "hasInsufficientEvidence": false,
    "debateSummary": "short article-level summary",
    "reasonCode": "optional-machine-readable-code"
  },
  "final_action": "allow-add" | "allow-add-prefer-new" | "reject",
  "final_action_reason": "short explanation",
  "low_confidence": false
}
  `.trim()
}

async function runDebater(
  stance: DebaterStance,
  input: {
    review: ContradictionReviewPacket
    claim: ContradictionClaimResult
    round: number
    maxRounds: number
    baseUrl: string
    apiKey: string | null | undefined
    previousSelfArgument: DebaterOutput | undefined
    previousOpponentArgument: DebaterOutput | undefined
    previousJudgeFeedback: string | undefined
  }
): Promise<DebaterOutput> {
  const prompt = buildDebaterPrompt({
    stance,
    review: input.review,
    claim: input.claim,
    round: input.round,
    maxRounds: input.maxRounds,
    previousSelfArgument: input.previousSelfArgument,
    previousOpponentArgument: input.previousOpponentArgument,
    previousJudgeFeedback: input.previousJudgeFeedback
  })

  try {
    const result = await queryLightRAG(
      {
        query: prompt,
        mode: "mix",
        limit: Math.max(8, input.claim.references.length + 4)
      },
      input.baseUrl,
      input.apiKey
    )

    const parsed = debaterOutputSchema.parse(JSON.parse(result.response) as unknown)

    return {
      ...parsed,
      stance,
      citations: mergeReferences(parsed.citations, result.references ?? [])
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "error" in error
          ? String(error.error)
          : "Debater query failed."

    return buildDebaterFallback(
      stance,
      input.claim.references,
      message,
      input.previousOpponentArgument?.argument_summary
    )
  }
}

async function runJudge(input: {
  claim: ContradictionClaimResult
  round: number
  maxRounds: number
  newSide: DebaterOutput
  oldSide: DebaterOutput
  previousJudgeFeedback: string | undefined
}): Promise<JudgeOutput> {
  const prompt = buildJudgePrompt(input)
  const llmProvider = getLlmProvider()

  try {
    const raw = await llmProvider.complete(prompt)
    return judgeOutputSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Judge generation failed."
    return buildJudgeFallback(input.round, input.maxRounds, message)
  }
}

async function runFinalAggregation(input: {
  review: ContradictionReviewPacket
  updatedResult: ContradictionResult
}): Promise<AggregationOutput> {
  const prompt = buildFinalAggregationPrompt(input)
  const llmProvider = getLlmProvider()

  try {
    const raw = await llmProvider.complete(prompt)
    const parsed = aggregationOutputSchema.parse(JSON.parse(raw) as unknown)

    return parsed.final_action === "reject" ||
      parsed.final_action === "allow-add" ||
      parsed.final_action === "allow-add-prefer-new"
      ? parsed
      : buildAggregationFallback("Final aggregation returned an invalid action.")
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Final aggregation failed."
    return buildAggregationFallback(message)
  }
}

async function runClaimDebate(input: {
  review: ContradictionReviewPacket
  claim: ContradictionClaimResult
  baseUrl: string
  apiKey: string | null | undefined
  maxRounds: number
}): Promise<ContradictionClaimResult> {
  const rounds: ClaimRoundRecord[] = []
  let previousNewSide: DebaterOutput | undefined
  let previousOldSide: DebaterOutput | undefined
  let previousJudgeFeedback: string | undefined

  for (let round = 1; round <= input.maxRounds; round += 1) {
    const newSide = await runDebater("new-side", {
      review: input.review,
      claim: input.claim,
      round,
      maxRounds: input.maxRounds,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      previousSelfArgument: previousNewSide,
      previousOpponentArgument: previousOldSide,
      previousJudgeFeedback
    })

    const oldSide = await runDebater("old-side", {
      review: input.review,
      claim: input.claim,
      round,
      maxRounds: input.maxRounds,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      previousSelfArgument: previousOldSide,
      previousOpponentArgument: previousNewSide,
      previousJudgeFeedback
    })

    const judge = await runJudge({
      claim: input.claim,
      round,
      maxRounds: input.maxRounds,
      newSide,
      oldSide,
      previousJudgeFeedback
    })

    rounds.push({ round, newSide, oldSide, judge })

    const finalRound = round >= input.maxRounds
    const shouldContinue =
      judge.decision === "no-decision" &&
      judge.claim_result_if_final === null &&
      !finalRound

    if (shouldContinue) {
      previousNewSide = newSide
      previousOldSide = oldSide
      previousJudgeFeedback = judge.feedback_for_next_round
      continue
    }

    const claimResult =
      judge.claim_result_if_final ??
      (finalRound
        ? "retain"
        : deriveFallbackClaimResult(judge.decision))

    const debateWinner =
      judge.decision === "no-decision" ? "none" : judge.decision

    const lowConfidence = judge.low_confidence || judge.decision === "no-decision"

    return {
      ...input.claim,
      debate_result: claimResult,
      debate_reason: normalizeWhitespace(judge.reason),
      debate_rounds: round,
      debate_winner: debateWinner,
      low_confidence: lowConfidence,
      debate_history: buildClaimRoundHistory(rounds)
    }
  }

  return {
    ...input.claim,
    debate_result: "retain",
    debate_reason:
      "The debate exhausted all rounds without a strong winner, so the claim was retained conservatively.",
    debate_rounds: input.maxRounds,
    debate_winner: "none",
    low_confidence: true,
    debate_history: buildClaimRoundHistory(rounds)
  }
}

function buildMockClaimWithDebate(
  claim: ContradictionClaimResult,
  input: {
    result: ClaimDebateResult
    rounds: number
    winner: DebateWinner
    reason: string
    lowConfidence: boolean
    judgeFeedback: string
  }
): ContradictionClaimResult {
  return {
    ...claim,
    debate_result: input.result,
    debate_reason: input.reason,
    debate_rounds: input.rounds,
    debate_winner: input.winner,
    low_confidence: input.lowConfidence,
    debate_history: Array.from({ length: input.rounds }, (_, index) => ({
      round: index + 1,
      new_side_argument: `Mock new-side argument round ${index + 1}`,
      old_side_argument: `Mock old-side argument round ${index + 1}`,
      judge_feedback:
        index + 1 === input.rounds
          ? input.reason
          : input.judgeFeedback,
      judge_decision: (
        index + 1 === input.rounds ? input.winner : "none"
      ) as DebateWinner
    }))
  }
}

function applyMockDebateOutcome(
  review: ContradictionReviewPacket,
  input: {
    claimResult: ClaimDebateResult
    claimReason: string
    claimWinner: DebateWinner
    claimRounds: number
    lowConfidence: boolean
    debateSummary: string
    finalAction: FinalAction
    finalActionReason: string
    reasonCode?: string
  }
): ContradictionReviewPacket {
  const updatedClaims = review.result.claims.map((claim) =>
    claim.classification === "consistent"
      ? claim
      : buildMockClaimWithDebate(claim, {
          result: input.claimResult,
          rounds: input.claimRounds,
          winner: input.claimWinner,
          reason: input.claimReason,
          lowConfidence: input.lowConfidence,
          judgeFeedback: "Address the strongest opposing evidence more directly."
        })
  )

  const updatedResult: ContradictionResult = contradictionResultSchema.parse({
    ...review.result,
    claims: updatedClaims,
    final_policy_signals: {
      hasDecisiveNewEvidence: input.finalAction === "allow-add-prefer-new",
      hasInsufficientEvidence: input.lowConfidence,
      debateSummary: input.debateSummary,
      reasonCode: input.reasonCode
    },
    final_action: input.finalAction,
    final_action_reason: input.finalActionReason,
    low_confidence: input.lowConfidence
  })

  return {
    ...review,
    result: updatedResult,
    disputedClaims: updatedClaims.filter((claim) => claim.classification !== "consistent"),
    enteredDebate: true,
    blocked: input.finalAction === "reject",
    debateTodo: false
  }
}

function getMockDebateReview(
  review: ContradictionReviewPacket,
  maxRounds: number
): ContradictionReviewPacket | null {
  switch (review.reviewUrl.trim().toLowerCase()) {
    case "https://phase5.mock/5.4.2/one-doc-conflict":
      return applyMockDebateOutcome(review, {
        claimResult: "retain",
        claimReason:
          "After debate, the single old-side contradiction was not strong enough to block retaining the new source.",
        claimWinner: "new-side",
        claimRounds: Math.min(2, maxRounds),
        lowConfidence: false,
        debateSummary:
          "The one-document conflict remained too weak to justify rejection after claim-level debate.",
        finalAction: "allow-add",
        finalActionReason:
          "Post-debate aggregation retained the document as non-preferred evidence.",
        reasonCode: "one-doc-retain"
      })
    case "https://phase5.mock/5.4.3/multi-doc-single-source-conflict":
      return applyMockDebateOutcome(review, {
        claimResult: "retain",
        claimReason:
          "The contradictory evidence came from a single lineage and did not outweigh the value of retaining the new source.",
        claimWinner: "new-side",
        claimRounds: Math.min(2, maxRounds),
        lowConfidence: false,
        debateSummary:
          "Single-lineage contradiction was insufficient to reject the document after debate.",
        finalAction: "allow-add",
        finalActionReason:
          "Post-debate aggregation kept the document as retained, non-preferred evidence.",
        reasonCode: "single-lineage-retain"
      })
    case "https://phase5.mock/5.4.7/insufficient-evidence":
      return applyMockDebateOutcome(review, {
        claimResult: "retain",
        claimReason:
          "The debate exhausted the available rounds without a strong winner, so the claim was retained conservatively.",
        claimWinner: "none",
        claimRounds: maxRounds,
        lowConfidence: true,
        debateSummary:
          "The claim-level debate remained inconclusive and used a low-confidence retain fallback.",
        finalAction: "allow-add",
        finalActionReason:
          "The document is retained as low-confidence supporting evidence after unresolved debate.",
        reasonCode: "max-rounds-fallback"
      })
    default:
      return null
  }
}

function applyAggregationToReview(
  review: ContradictionReviewPacket,
  updatedClaims: ContradictionClaimResult[],
  aggregation: AggregationOutput
): ContradictionReviewPacket {
  const updatedResult: ContradictionResult = contradictionResultSchema.parse({
    ...review.result,
    claims: updatedClaims,
    final_policy_signals: aggregation.final_policy_signals,
    final_action: aggregation.final_action,
    final_action_reason: normalizeWhitespace(aggregation.final_action_reason),
    low_confidence:
      aggregation.low_confidence || updatedClaims.some((claim) => claim.low_confidence)
  })

  return {
    ...review,
    result: updatedResult,
    disputedClaims: updatedClaims.filter((claim) => claim.classification !== "consistent"),
    enteredDebate: true,
    blocked: aggregation.final_action === "reject",
    debateTodo: false
  }
}

export function getMaxDebateRounds(): number {
  return parsePositiveInt(process.env.MAX_DEBATE_ROUNDS) ?? DEFAULT_MAX_DEBATE_ROUNDS
}

export async function runContradictionDebate(
  input: RunContradictionDebateInput
): Promise<ContradictionReviewPacket> {
  const maxRounds = input.maxRounds ?? getMaxDebateRounds()

  if (input.review.result.preliminary_action !== "hold") {
    return input.review
  }

  const mockReview = getMockDebateReview(input.review, maxRounds)
  if (mockReview) {
    return mockReview
  }

  if (input.review.disputedClaims.length === 0) {
    return applyAggregationToReview(
      input.review,
      input.review.result.claims,
      buildAggregationFallback(
        "The preliminary action required debate, but no disputed claims were available."
      )
    )
  }

  const updatedClaims: ContradictionClaimResult[] = []
  for (const claim of input.review.result.claims) {
    if (claim.classification === "consistent") {
      updatedClaims.push(claim)
      continue
    }

    const debatedClaim = await runClaimDebate({
      review: input.review,
      claim,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      maxRounds
    })
    updatedClaims.push(debatedClaim)
  }

  const updatedResult: ContradictionResult = {
    ...input.review.result,
    claims: updatedClaims
  }
  const aggregation = await runFinalAggregation({
    review: input.review,
    updatedResult
  })

  return applyAggregationToReview(input.review, updatedClaims, aggregation)
}
