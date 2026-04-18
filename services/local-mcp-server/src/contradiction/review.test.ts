import assert from "node:assert/strict"
import test from "node:test"

import {
  derivePreliminaryAction,
  parseContradictionResult,
  type PolicySignals
} from "./review.js"

function buildSignals(overrides: Partial<PolicySignals> = {}): PolicySignals {
  return {
    contradictoryDocumentCount: 0,
    contradictorySourceCount: 0,
    hasMultiViewExisting: false,
    hasDecisiveNewEvidence: false,
    hasInsufficientEvidence: false,
    sourceLineageNotes: "Default test lineage notes.",
    ...overrides
  }
}

function buildRawResult(
  policySignals: PolicySignals,
  preliminaryAction: "allow-add" | "allow-add-prefer-new" | "hold" | "reject" = "allow-add"
): string {
  return JSON.stringify({
    classification: "contradictory",
    summary_reason: "Structured contradiction review result for testing.",
    claims: [
      {
        claim_text: "Example claim under review.",
        classification: "contradictory",
        reason: "Existing graph-backed evidence disagrees.",
        graph_answer: "The current graph says something else.",
        references: [
          {
            reference_id: "chunk-001",
            file_path: "https://example.test/source"
          }
        ]
      }
    ],
    policy_signals: policySignals,
    preliminary_action: preliminaryAction,
    preliminary_action_reason: "Model-supplied preliminary action for testing."
  })
}

test("5.4.1 derives allow-add when no contradictory evidence exists", () => {
  const action = derivePreliminaryAction(
    buildSignals({
      contradictoryDocumentCount: 0,
      contradictorySourceCount: 0
    })
  )

  assert.equal(action, "allow-add")
})

test("5.4.2 derives hold for one-doc conflict", () => {
  const action = derivePreliminaryAction(
    buildSignals({
      contradictoryDocumentCount: 1,
      contradictorySourceCount: 1
    })
  )

  assert.equal(action, "hold")
})

test("5.4.3 derives hold for multiple contradictory documents from one source lineage", () => {
  const action = derivePreliminaryAction(
    buildSignals({
      contradictoryDocumentCount: 3,
      contradictorySourceCount: 1
    })
  )

  assert.equal(action, "hold")
})

test("5.4.4 derives reject for strong multi-source contradiction", () => {
  const action = derivePreliminaryAction(
    buildSignals({
      contradictoryDocumentCount: 3,
      contradictorySourceCount: 2,
      oldSideSupportStrength: "strong"
    })
  )

  assert.equal(action, "reject")
})

test("5.4.5 derives allow-add when multiple views already exist", () => {
  const action = derivePreliminaryAction(
    buildSignals({
      contradictoryDocumentCount: 2,
      contradictorySourceCount: 2,
      hasMultiViewExisting: true
    })
  )

  assert.equal(action, "allow-add")
})

test("5.4.6 derives allow-add-prefer-new for decisive new evidence", () => {
  const action = derivePreliminaryAction(
    buildSignals({
      contradictoryDocumentCount: 2,
      contradictorySourceCount: 2,
      hasDecisiveNewEvidence: true
    })
  )

  assert.equal(action, "allow-add-prefer-new")
})

test("5.4.7 derives hold when evidence is insufficient", () => {
  const action = derivePreliminaryAction(
    buildSignals({
      contradictoryDocumentCount: 1,
      contradictorySourceCount: 1,
      hasInsufficientEvidence: true
    })
  )

  assert.equal(action, "hold")
})

test("5.4.8 parseContradictionResult recomputes preliminary action from policy signals", () => {
  const raw = buildRawResult(
    buildSignals({
      contradictoryDocumentCount: 3,
      contradictorySourceCount: 2,
      oldSideSupportStrength: "strong"
    }),
    "allow-add"
  )

  const result = parseContradictionResult(raw)

  assert.equal(result.preliminary_action, "reject")
  assert.match(result.preliminary_action_reason, /MCP recomputed preliminary action/i)
  assert.match(result.preliminary_action_reason, /Model proposed "allow-add"/i)
})
