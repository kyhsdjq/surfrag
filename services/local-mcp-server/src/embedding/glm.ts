import type { EmbeddingProvider } from "./types.js"

const GLM_EMBEDDING_BASE_URL = "https://open.bigmodel.cn/api/paas/v4/embeddings"
const GLM_EMBEDDING_2_DIMENSION = 1024

export type GLMEmbeddingConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
}

type GLMEmbeddingResponse = {
  data: Array<{ embedding: number[]; index: number }>
}

export class GLMEmbeddingProvider implements EmbeddingProvider {
  readonly name = "glm"
  readonly dimension = GLM_EMBEDDING_2_DIMENSION

  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(config: GLMEmbeddingConfig) {
    const key = config.apiKey?.trim()
    if (!key) {
      throw new Error("GLMEmbeddingProvider requires apiKey (API_KEY or ZHIPU_API_KEY)")
    }
    this.apiKey = key
    this.model = config.model ?? "embedding-2"
    this.baseUrl = config.baseUrl ?? GLM_EMBEDDING_BASE_URL
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text])
    return results[0] ?? []
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    const input = texts.length === 1 ? texts[0] : texts
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        input
      })
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `GLM embedding API error ${res.status}: ${res.statusText}. ${body}`
      )
    }

    const json = (await res.json()) as GLMEmbeddingResponse
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error("GLM embedding API returned invalid response: missing data array")
    }

    const vectors: number[][] = new Array(texts.length)
    for (const item of json.data) {
      if (item.embedding && Array.isArray(item.embedding)) {
        vectors[item.index] = item.embedding
      }
    }

    return vectors
  }
}
