import type { CaptureIngestInput } from "../../schema/capture.js"
import {
  buildLightRAGTextRequestPayload,
  type LightRAGTextRequestPayload
} from "../../lightrag/payload.js"

type CaptureExpectation = {
  httpStatus: number
  status: "persisted" | "unchanged"
  unchanged: boolean
  lightRagSyncAttempted: boolean
  lightRagSyncMode?: "insert" | "overwrite-add"
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

const captureScenarios: CaptureScenario[] = [
  {
    id: "new-article",
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
          lightRagSyncMode: "insert"
        }
      }
    ]
  },
  {
    id: "unchanged-recapture",
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
          lightRagSyncMode: "insert"
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
    id: "changed-recapture",
    description: "Change body text for the same canonical URL and verify overwrite-add sync is selected.",
    steps: [
      {
        name: "baseline insert",
        payload: firstArticle,
        expect: {
          httpStatus: 201,
          status: "persisted",
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert"
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
          lightRagSyncMode: "overwrite-add"
        }
      }
    ]
  },
  {
    id: "contradiction-company-facts",
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
          unchanged: false,
          lightRagSyncAttempted: true,
          lightRagSyncMode: "insert"
        }
      }
    ],
    manualReview:
      "Review LightRAG output manually for contradiction quality. This script only checks transport and routing behavior."
  }
]

const lightRagApiScenarios: LightRAGApiScenario[] = [
  {
    id: "insert-article",
    description: "Send a direct MCP-shaped insert payload to the standard text endpoint.",
    endpoint: "/documents/text",
    payload: buildLightRAGTextRequestPayload(companyFactsV1, companyFactsV1.url),
    expectedStatus: "success"
  },
  {
    id: "overwrite-company-facts",
    description: "Send a direct MCP-shaped overwrite payload to the new overwrite endpoint.",
    endpoint: "/documents/text/overwrite",
    payload: buildLightRAGTextRequestPayload(companyFactsV2, companyFactsV2.url),
    expectedStatus: "success",
    manualReview:
      "Inspect downstream LightRAG reasoning manually if you need to judge semantic overwrite quality."
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
