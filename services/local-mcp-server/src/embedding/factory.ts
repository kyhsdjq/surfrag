import { GLMEmbeddingProvider } from "./glm.js"
import type { EmbeddingProvider } from "./types.js"

export type EmbeddingEnv = {
  EMBED_PROVIDER?: string
  API_KEY?: string
  ZHIPU_API_KEY?: string
  EMBED_MODEL?: string
}

/**
 * Returns the embedding provider based on env config.
 * GLM (智谱) is implemented first; OpenAI, Ollama etc. can be added later.
 */
export function getEmbeddingProvider(env: EmbeddingEnv = process.env): EmbeddingProvider {
  const provider = (env.EMBED_PROVIDER ?? "glm").toLowerCase()

  switch (provider) {
    case "glm": {
      const apiKey = env.ZHIPU_API_KEY ?? env.API_KEY
      return new GLMEmbeddingProvider({
        apiKey: apiKey ?? "",
        model: env.EMBED_MODEL ?? "embedding-2"
      })
    }
    // case "openai": return new OpenAIEmbeddingProvider(env)  // Phase 2.2+
    // case "ollama": return new OllamaEmbeddingProvider(env)  // Phase 2.2+
    default:
      throw new Error(`Unknown EMBED_PROVIDER: ${provider}. Supported: glm`)
  }
}
