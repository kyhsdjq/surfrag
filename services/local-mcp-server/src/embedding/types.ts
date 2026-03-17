/**
 * Provider-agnostic embedding interface.
 * All embedding backends (GLM, OpenAI, Ollama, etc.) implement this.
 */
export interface EmbeddingProvider {
  /** Embed a single text. Returns a vector of configurable dimension. */
  embed(text: string): Promise<number[]>

  /** Embed multiple texts. May batch for efficiency. */
  embedBatch(texts: string[]): Promise<number[][]>

  /** Dimension of returned vectors (e.g. 1024 for GLM embedding-2). */
  readonly dimension: number

  /** Provider identifier (e.g. "glm", "openai", "ollama"). */
  readonly name: string
}
