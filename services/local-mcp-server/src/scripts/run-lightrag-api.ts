import "dotenv/config"

import { buildLightRAGHeaders } from "../lightrag/payload.js"
import {
  getLightRAGApiScenario,
  listLightRAGApiScenarioIds
} from "./fixtures/phase5.js"

const DEFAULT_BASE_URL = "http://localhost:9621"
const DEFAULT_SCENARIO_ID = "insert-company-facts-update"

type LightRAGInsertResponse = {
  status?: string
  message?: string
  track_id?: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(
      `Expected JSON response but received: ${raw.slice(0, 300) || "<empty>"}`
    )
  }
}

function getBaseUrl(): string {
  return (
    process.env.LIGHTRAG_TEST_BASE_URL?.trim() ||
    process.env.LIGHTRAG_URL?.trim() ||
    DEFAULT_BASE_URL
  ).replace(/\/$/, "")
}

function getApiKey(): string | null {
  return process.env.LIGHTRAG_API_KEY?.trim() || null
}

function getScenarioId(): string {
  const raw = process.argv[2]?.trim()
  if (!raw || raw === "--help" || raw === "-h") {
    return raw || DEFAULT_SCENARIO_ID
  }

  return raw
}

function printHelp() {
  console.log("Usage: pnpm test:phase5:lightrag [scenario-id]")
  console.log(`Default scenario: ${DEFAULT_SCENARIO_ID}`)
  console.log(`Available scenarios: ${listLightRAGApiScenarioIds().join(", ")}`)
  console.log("This smoke test only verifies deterministic request/response behavior.")
}

async function main() {
  const scenarioId = getScenarioId()
  if (scenarioId === "--help" || scenarioId === "-h") {
    printHelp()
    return
  }

  const scenario = getLightRAGApiScenario(scenarioId)
  assert(
    scenario,
    `Unknown scenario "${scenarioId}". Available: ${listLightRAGApiScenarioIds().join(", ")}`
  )

  const baseUrl = getBaseUrl()
  const apiKey = getApiKey()
  const endpointUrl = `${baseUrl}${scenario.endpoint}`

  console.log(`Running LightRAG API scenario "${scenario.id}" against ${endpointUrl}`)
  console.log(scenario.description)

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: buildLightRAGHeaders(apiKey),
    body: JSON.stringify(scenario.payload)
  })
  const rawBody = await response.text()
  const body = parseJson<LightRAGInsertResponse>(rawBody)

  console.log(`HTTP ${response.status} ${response.statusText}`)
  console.log(JSON.stringify(body, null, 2))

  assert(response.ok, `Expected 2xx response but received ${response.status}`)
  assert(
    body.status === scenario.expectedStatus,
    `Expected status=${scenario.expectedStatus} but received ${body.status ?? "<missing>"}`
  )
  assert(
    typeof body.track_id === "string" && body.track_id.length > 0,
    "Expected LightRAG to return a track_id"
  )

  console.log(`Scenario "${scenario.id}" passed.`)

  if (scenario.manualReview) {
    console.log(`Manual review: ${scenario.manualReview}`)
  }
}

main().catch((error) => {
  console.error("LightRAG API scenario failed.")
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
