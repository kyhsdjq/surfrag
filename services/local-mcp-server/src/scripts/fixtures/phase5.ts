import type { CaptureIngestInput } from "../../schema/capture.js"
import {
  buildLightRAGTextRequestPayload,
  type LightRAGTextRequestPayload
} from "../../lightrag/payload.js"

type CaptureExpectation = {
  httpStatus: number
  status: "persisted" | "unchanged"
  unchanged: boolean
  lightRagSyncAttempted?: boolean
  lightRagSyncMode?: "insert" | "overwrite-add"
  contradictionClassification?: "consistent" | "contradictory" | "uncertain"
  contradictionPreliminaryAction?: "allow-add" | "allow-add-prefer-new" | "hold" | "reject"
  contradictionFinalAction?: "allow-add" | "allow-add-prefer-new" | "reject"
  contradictionBlocked?: boolean
  contradictionDebateTodo?: boolean
  contradictionEnteredDebate?: boolean
  contradictionLowConfidence?: boolean
}

export type CaptureScenarioStep = {
  name: string
  payload: CaptureIngestInput
  expect: CaptureExpectation
}

export type CaptureScenario = {
  id: string
  description: string
  steps: CaptureScenarioStep[]
  manualReview?: string
}

export type LightRAGApiScenario = {
  id: string
  description: string
  endpoint: "/documents/text" | "/documents/text/overwrite"
  payload: LightRAGTextRequestPayload
  expectedStatus: "success"
  manualReview?: string
}

type Phase5CaptureFixture = CaptureIngestInput & {
  capturedAt: string
}

type CaptureFixtureInput = {
  pageId: string
  title: string
  url: string
  capturedAt: string
  bodyText: string
  maxScrollPercentage?: number
}

function buildCaptureFixture(input: CaptureFixtureInput): Phase5CaptureFixture {
  return {
    pageId: input.pageId,
    title: input.title,
    url: input.url,
    referrer: "https://search.example.test/phase5",
    bodyText: input.bodyText,
    maxScrollPercentage: input.maxScrollPercentage ?? 100,
    capturedAt: input.capturedAt,
    sourceSession: "phase5-dev-script"
  }
}

const firstArticle = buildCaptureFixture({
  pageId: "phase5-article-v1",
  title: "Phase 5 Launch Notes",
  url: "https://docs.surfrag.dev/blog/phase5-launch",
  capturedAt: "2026-04-09T09:00:00.000Z",
  bodyText:
    "SurfRAG Phase 5 introduces contradiction-aware ingestion. The first public preview explains how developers can replay ingestion and compare changed captures."
})

const changedArticle = buildCaptureFixture({
  pageId: "phase5-article-v2",
  title: "Phase 5 Launch Notes",
  url: "https://docs.surfrag.dev/blog/phase5-launch",
  capturedAt: "2026-04-09T09:15:00.000Z",
  bodyText:
    "SurfRAG Phase 5 introduces contradiction-aware ingestion. The updated article now states the rollout includes a reset flow, an MCP capture harness, and a direct LightRAG API smoke test."
})

const companyFactsV1 = buildCaptureFixture({
  pageId: "company-facts-v1",
  title: "Example Company Facts",
  url: "https://example.com/company/facts",
  capturedAt: "2026-04-09T10:00:00.000Z",
  bodyText:
    "Example Company says its CEO is Avery Chen and its headquarters is Singapore. The company focuses on retrieval tooling for enterprise teams."
})

const companyFactsV2 = buildCaptureFixture({
  pageId: "company-facts-v2",
  title: "Example Company Facts",
  url: "https://example.com/company/facts-update",
  capturedAt: "2026-04-09T10:20:00.000Z",
  bodyText:
    "Example Company now says its CEO is Jordan Patel and its headquarters is Tokyo. The company focuses on retrieval tooling for enterprise teams."
})

const policyNoConflict = buildCaptureFixture({
  pageId: "phase5-4-no-conflict",
  title: "Nebula Labs Atlas Launch",
  url: "https://phase5.mock/5.4.1/no-conflict",
  capturedAt: "2026-04-10T08:00:00.000Z",
  bodyText:
    "Nebula Labs launched the Atlas search appliance in 2026 and described it as a new product for enterprise knowledge search."
})

const policyOneDocConflict = buildCaptureFixture({
  pageId: "phase5-4-one-doc-conflict",
  title: "Orchid AI Leadership Update",
  url: "https://phase5.mock/5.4.2/one-doc-conflict",
  capturedAt: "2026-04-10T08:10:00.000Z",
  bodyText:
    "Orchid AI says Mina Park is now the company's CEO after a recent executive transition."
})

const policySingleSourceConflict = buildCaptureFixture({
  pageId: "phase5-4-single-source-conflict",
  title: "Quartz Systems Relocation Notice",
  url: "https://phase5.mock/5.4.3/multi-doc-single-source-conflict",
  capturedAt: "2026-04-10T08:20:00.000Z",
  bodyText:
    "Quartz Systems says it moved its headquarters to Toronto and has started relocating leadership teams there."
})

const policyMultiSourceReject = buildCaptureFixture({
  pageId: "phase5-4-multi-source-reject",
  title: "Aster Bank Office Move Rumor",
  url: "https://phase5.mock/5.4.4/multi-doc-multi-source-conflict",
  capturedAt: "2026-04-10T08:30:00.000Z",
  bodyText:
    "Aster Bank's headquarters is now in Dubai according to this newly captured page."
})

const policyMultiViewExisting = buildCaptureFixture({
  pageId: "phase5-4-multi-view-existing",
  title: "Aurora Policy Interpretation",
  url: "https://phase5.mock/5.4.5/multi-view-existing",
  capturedAt: "2026-04-10T08:40:00.000Z",
  bodyText:
    "This page argues that the Aurora policy should be classified as privacy-first rather than growth-first."
})

const policyDecisiveNewEvidence = buildCaptureFixture({
  pageId: "phase5-4-decisive-new-evidence",
  title: "Northstar Robotics Official CEO Announcement",
  url: "https://phase5.mock/5.4.6/decisive-new-evidence",
  capturedAt: "2026-04-10T08:50:00.000Z",
  bodyText:
    "Northstar Robotics officially announced that Eva Lin became CEO on 2026-04-10."
})

const policyInsufficientEvidence = buildCaptureFixture({
  pageId: "phase5-4-insufficient-evidence",
  title: "Helios Cloud Regional Expansion Speculation",
  url: "https://phase5.mock/5.4.7/insufficient-evidence",
  capturedAt: "2026-04-10T09:00:00.000Z",
  bodyText:
    "Helios Cloud may move its primary region to Madrid next year, according to an ambiguous industry note."
})

const captureScenarios: CaptureScenario[] = [
  {
    id: "5.1.1",
    description: "Single first-time capture should persist and use insert sync.",
    steps: [
      {
        name: "first capture",
        payload: firstArticle,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "consistent",
          contradictionPreliminaryAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false
        }
      }
    ]
  },
  {
    id: "5.1.2",
    description: "Repeat the same capture and verify the second request is skipped as unchanged.",
    steps: [
      {
        name: "baseline insert",
        payload: firstArticle,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "consistent",
          contradictionPreliminaryAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false
        }
      },
      {
        name: "repeat unchanged capture",
        payload: firstArticle,
        expect: {
          httpStatus: 200,
          status: "unchanged",
          unchanged: true,
          lightRagSyncAttempted: false
        }
      }
    ]
  },
  {
    id: "5.1.3",
    description: "Change body text for the same canonical URL and verify the old LightRAG document is removed before contradiction review, then a normal insert sync is used.",
    steps: [
      {
        name: "baseline insert",
        payload: firstArticle,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "consistent",
          contradictionPreliminaryAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false
        }
      },
      {
        name: "changed capture",
        payload: changedArticle,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "consistent",
          contradictionPreliminaryAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false
        }
      }
    ]
  },
  {
    id: "5.3.1",
    description: "Replay two contradictory company facts pages under different URLs for later contradiction evaluation.",
    steps: [
      {
        name: "baseline company facts",
        payload: companyFactsV1,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert"
        }
      },
      {
        name: "contradictory company facts from a different page",
        payload: companyFactsV2,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false
        }
      }
    ],
    manualReview:
      "Review LightRAG output manually for contradiction quality. This script only checks transport and routing behavior."
  },
  {
    id: "5.4.1",
    description:
      "Deterministic no-conflict policy scenario routed through POST /captures with a mocked contradiction response.",
    steps: [
      {
        name: "no-conflict allow-add capture",
        payload: policyNoConflict,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "consistent",
          contradictionPreliminaryAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false
        }
      }
    ],
    manualReview:
      "This is a deterministic mock policy scenario. It validates MCP-side routing, not real LightRAG reasoning quality."
  },
  {
    id: "5.4.2",
    description:
      "Deterministic one-doc-conflict policy scenario routed through POST /captures and expected to complete debate before allowing add.",
    steps: [
      {
        name: "one-doc-conflict hold capture",
        payload: policyOneDocConflict,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "contradictory",
          contradictionPreliminaryAction: "hold",
          contradictionFinalAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false,
          contradictionEnteredDebate: true,
          contradictionLowConfidence: false
        }
      }
    ]
  },
  {
    id: "5.4.3",
    description:
      "Deterministic multi-doc single-source policy scenario routed through POST /captures and expected to complete debate before allowing add.",
    steps: [
      {
        name: "multi-doc single-source hold capture",
        payload: policySingleSourceConflict,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "contradictory",
          contradictionPreliminaryAction: "hold",
          contradictionFinalAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false,
          contradictionEnteredDebate: true,
          contradictionLowConfidence: false
        }
      }
    ]
  },
  {
    id: "5.4.4",
    description:
      "Deterministic multi-doc multi-source policy scenario routed through POST /captures and expected to reject automatic insertion.",
    steps: [
      {
        name: "multi-doc multi-source reject capture",
        payload: policyMultiSourceReject,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: false,
          contradictionClassification: "contradictory",
          contradictionPreliminaryAction: "reject",
          contradictionBlocked: true,
          contradictionDebateTodo: false
        }
      }
    ]
  },
  {
    id: "5.4.5",
    description:
      "Deterministic multi-view-existing policy scenario routed through POST /captures and expected to allow add.",
    steps: [
      {
        name: "multi-view-existing allow-add capture",
        payload: policyMultiViewExisting,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "contradictory",
          contradictionPreliminaryAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false
        }
      }
    ],
    manualReview:
      "This is a deterministic mock policy scenario. It validates that multi-view disagreement may still be retained."
  },
  {
    id: "5.4.6",
    description:
      "Deterministic decisive-new-evidence policy scenario routed through POST /captures and expected to allow-add-prefer-new.",
    steps: [
      {
        name: "decisive-new-evidence allow-add-prefer-new capture",
        payload: policyDecisiveNewEvidence,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "overwrite-add",
          contradictionClassification: "contradictory",
          contradictionPreliminaryAction: "allow-add-prefer-new",
          contradictionBlocked: false,
          contradictionDebateTodo: false
        }
      }
    ],
    manualReview:
      "This deterministic mock policy scenario should now route through the overwrite-add transport."
  },
  {
    id: "5.4.7",
    description:
      "Deterministic insufficient-evidence policy scenario routed through POST /captures and expected to complete debate with low-confidence allow-add.",
    steps: [
      {
        name: "insufficient-evidence hold capture",
        payload: policyInsufficientEvidence,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert",
          contradictionClassification: "uncertain",
          contradictionPreliminaryAction: "hold",
          contradictionFinalAction: "allow-add",
          contradictionBlocked: false,
          contradictionDebateTodo: false,
          contradictionEnteredDebate: true,
          contradictionLowConfidence: true
        }
      }
    ]
  }
]

const lightRagApiScenarios: LightRAGApiScenario[] = [
  {
    id: "5.1.4",
    description: "Send a direct MCP-shaped insert payload to the standard text endpoint.",
    endpoint: "/documents/text",
    payload: buildLightRAGTextRequestPayload(companyFactsV1, companyFactsV1.url),
    expectedStatus: "success"
  },
  {
    id: "5.1.5",
    description: "Send a direct MCP-shaped payload to the overwrite-style text endpoint for an updated document insert.",
    endpoint: "/documents/text/overwrite",
    payload: buildLightRAGTextRequestPayload(companyFactsV2, companyFactsV2.url),
    expectedStatus: "success",
    manualReview:
      "Inspect downstream LightRAG overwrite reasoning manually if you need to judge update quality after prior deletion."
  }
]

export function getCaptureScenario(id: string): CaptureScenario | undefined {
  return captureScenarios.find((scenario) => scenario.id === id)
}

export function getLightRAGApiScenario(
  id: string
): LightRAGApiScenario | undefined {
  return lightRagApiScenarios.find((scenario) => scenario.id === id)
}

export function listCaptureScenarioIds(): string[] {
  return captureScenarios.map((scenario) => scenario.id)
}

export function listLightRAGApiScenarioIds(): string[] {
  return lightRagApiScenarios.map((scenario) => scenario.id)
}
