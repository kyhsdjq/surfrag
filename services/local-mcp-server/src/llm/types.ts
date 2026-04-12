export interface LlmProvider {
  complete(prompt: string): Promise<string>
  readonly name: string
  readonly model: string
}
