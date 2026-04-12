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

const contradictionReferenceSchema = z.object({
  reference_id: z.string().min(1),
  file_path: z.string().min(1)
})

const contradictionClaimResultSchema = z.object({
  claim_text: z.string().min(1),
  classification: contradictionClassificationSchema,
  reason: z.string().min(1),
  graph_answer: z.string().min(1),
  references: z.array(contradictionReferenceSchema)
})

export const contradictionResultSchema = z.object({
  classification: contradictionClassificationSchema,
  summary_reason: z.string().min(1),
  claims: z.array(contradictionClaimResultSchema).min(1)
})

export type ContradictionClassification = z.infer<
  typeof contradictionClassificationSchema
>

export type ContradictionClaimResult = z.infer<
  typeof contradictionClaimResultSchema
>

export type ContradictionResult = z.infer<typeof contradictionResultSchema>

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
  ]
}

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
  return contradictionResultSchema.parse(parsed)
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
    }))
  }
}

export async function evaluateCaptureForContradictions(
  input: EvaluateCaptureForContradictionsInput
): Promise<ContradictionReviewPacket> {
  const rawDocument = buildLightRAGDocumentText(input.capture)
  let queryReferences: LightRAGReference[] = []
  let result: ContradictionResult
  let candidateClaims: string[] = []
  let query = ""

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
        claims: []
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
        blocked: false
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
    blocked: result.classification !== "consistent"
  }
}
