import { GLMLlmProvider } from "./glm.js"
import type { LlmProvider } from "./types.js"

export type LlmEnv = {
  LLM_API_KEY?: string
  LLM_API_PROVIDER?: string
  LLM_MODEL?: string
}

export function getLlmProvider(env: LlmEnv = process.env): LlmProvider {
  const provider = (env.LLM_API_PROVIDER ?? "glm").toLowerCase()

  switch (provider) {
    case "glm":
      return new GLMLlmProvider({
        apiKey: env.LLM_API_KEY ?? "",
        model: env.LLM_MODEL ?? "glm-4-flash"
      })
    default:
      throw new Error(`Unknown LLM_API_PROVIDER: ${provider}. Supported: glm`)
  }
}
