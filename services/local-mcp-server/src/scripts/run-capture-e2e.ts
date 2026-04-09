import "dotenv/config"

import {
  getCaptureScenario,
  listCaptureScenarioIds,
  type CaptureScenarioStep
} from "./fixtures/phase5.js"

const DEFAULT_SCENARIO_ID = "changed-recapture"
const DEFAULT_PORT = "3030"
const DEFAULT_STEP_DELAY_MS = 60_000

type CaptureResponse = {
  ok?: boolean
  status?: string
  unchanged?: boolean
  id?: string
  canonicalUrl?: string
  lightRagSync?: {
    attempted?: boolean
    reason?: string
    mode?: string
    fileSource?: string
    lookupFileSources?: string[]
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function parseJson<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    throw new Error(
      `Expected JSON response but received: ${raw.slice(0, 300) || "<empty>"}`
    )
  }
}

function getBaseUrl(): string {
  const configuredBaseUrl = process.env.MCP_BASE_URL?.trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, "")
  }

  const port = process.env.PORT?.trim() || DEFAULT_PORT
  return `http://localhost:${port}`.replace(/\/$/, "")
}

function getScenarioId(): string {
  const raw = process.argv[2]?.trim()
  if (!raw || raw === "--help" || raw === "-h") {
    return raw || DEFAULT_SCENARIO_ID
  }

  return raw
}

function printHelp() {
  console.log("Usage: pnpm test:phase5:capture [scenario-id]")
  console.log(`Default scenario: ${DEFAULT_SCENARIO_ID}`)
  console.log(`Available scenarios: ${listCaptureScenarioIds().join(", ")}`)
  console.log(
    `Base URL resolution: MCP_BASE_URL > http://localhost:${process.env.PORT?.trim() || DEFAULT_PORT}`
  )
  console.log(
    `Step delay: CAPTURE_STEP_DELAY_MS > ${DEFAULT_STEP_DELAY_MS} (applied between requests when a scenario has multiple steps)`
  )
  console.log("Tip: run pnpm clean before a scenario for repeatable results.")
}

function getStepDelayMs(): number {
  const raw = process.env.CAPTURE_STEP_DELAY_MS?.trim()
  if (!raw) {
    return DEFAULT_STEP_DELAY_MS
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `Invalid CAPTURE_STEP_DELAY_MS="${raw}". Expected a non-negative number of milliseconds.`
    )
  }

  return parsed
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function runStep(
  baseUrl: string,
  step: CaptureScenarioStep,
  index: number
) {
  console.log(`\n[step ${index + 1}] ${step.name}`)
  console.log(`POST ${baseUrl}/captures`)

  const response = await fetch(`${baseUrl}/captures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(step.payload)
  })
  const rawBody = await response.text()
  const body = parseJson<CaptureResponse>(rawBody)

  console.log(`HTTP ${response.status} ${response.statusText}`)
  console.log(JSON.stringify(body, null, 2))

  assert(
    response.status === step.expect.httpStatus,
    `Expected HTTP ${step.expect.httpStatus} but received ${response.status}`
  )
  assert(body.ok === true, "Expected response.ok === true")
  assert(
    body.status === step.expect.status,
    `Expected status=${step.expect.status} but received ${body.status ?? "<missing>"}`
  )
  assert(
    body.unchanged === step.expect.unchanged,
    `Expected unchanged=${step.expect.unchanged} but received ${String(body.unchanged)}`
  )
  assert(typeof body.id === "string" && body.id.length > 0, "Expected capture id")

  if (step.expect.lightRagSyncAttempted) {
    assert(
      body.lightRagSync?.attempted === true,
      "Expected lightRagSync.attempted === true"
    )
    assert(
      body.lightRagSync.mode === step.expect.lightRagSyncMode,
      `Expected lightRagSync.mode=${step.expect.lightRagSyncMode} but received ${body.lightRagSync?.mode ?? "<missing>"}`
    )
    assert(
      typeof body.lightRagSync.fileSource === "string" &&
        body.lightRagSync.fileSource.length > 0,
      "Expected lightRagSync.fileSource for persisted capture"
    )
  } else {
    assert(
      body.lightRagSync?.attempted === false,
      "Expected lightRagSync.attempted === false"
    )
  }
}

async function main() {
  const scenarioId = getScenarioId()
  if (scenarioId === "--help" || scenarioId === "-h") {
    printHelp()
    return
  }

  const scenario = getCaptureScenario(scenarioId)
  assert(
    scenario,
    `Unknown scenario "${scenarioId}". Available: ${listCaptureScenarioIds().join(", ")}`
  )

  const baseUrl = getBaseUrl()
  const stepDelayMs = getStepDelayMs()
  console.log(`Running capture scenario "${scenario.id}" against ${baseUrl}`)
  console.log(scenario.description)
  console.log("Expected automatic checks: HTTP status, persisted/unchanged status, and LightRAG sync path.")
  console.log(`Inter-step wait: ${stepDelayMs}ms`)

  for (const [index, step] of scenario.steps.entries()) {
    await runStep(baseUrl, step, index)

    const hasNextStep = index < scenario.steps.length - 1
    if (hasNextStep && stepDelayMs > 0) {
      const waitSeconds = Math.ceil(stepDelayMs / 1000)
      console.log(
        `Waiting ${waitSeconds}s before the next capture so the previous page has time to finish processing.`
      )
      await sleep(stepDelayMs)
    }
  }

  console.log(`\nScenario "${scenario.id}" passed.`)

  if (scenario.manualReview) {
    console.log(`Manual review: ${scenario.manualReview}`)
  }
}

main().catch((error) => {
  console.error("Capture E2E scenario failed.")
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
