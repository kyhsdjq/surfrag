import type { LlmProvider } from "./types.js"

const GLM_CHAT_COMPLETION_BASE_URL =
  "https://open.bigmodel.cn/api/paas/v4/chat/completions"

export type GLMLlmConfig = {
  apiKey: string
  model?: string
  baseUrl?: string
}

type GLMChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export class GLMLlmProvider implements LlmProvider {
  readonly name = "glm"

  readonly model: string

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: GLMLlmConfig) {
    const key = config.apiKey?.trim()
    if (!key) {
      throw new Error("GLMLlmProvider requires apiKey (LLM_API_KEY)")
    }

    this.apiKey = key
    this.model = config.model?.trim() || "glm-4-flash"
    this.baseUrl = config.baseUrl ?? GLM_CHAT_COMPLETION_BASE_URL
  }

  async complete(prompt: string): Promise<string> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(
        `GLM LLM API error ${res.status}: ${res.statusText}. ${body}`
      )
    }

    const json = (await res.json()) as GLMChatCompletionResponse
    const content = json.choices?.[0]?.message?.content?.trim()

    if (!content) {
      throw new Error("GLM LLM API returned empty content")
    }

    return content
  }
}
