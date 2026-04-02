const LIGHTRAG_PAGE_SIZE = 200
const LIGHTRAG_DELETE_TIMEOUT_MS = 30_000
const LIGHTRAG_DELETE_POLL_MS = 1_000

export type LightRAGDocumentSummary = {
  id: string
  filePath: string
  status: string
  trackId: string | null
}

type LightRAGPaginatedDocument = {
  id: string
  file_path: string
  status: string
  track_id?: string | null
}

type LightRAGPaginatedResponse = {
  documents?: LightRAGPaginatedDocument[]
  pagination?: {
    page?: number
    total_pages?: number
  }
}

type LightRAGDeleteResponse = {
  status?: string
  message?: string
  doc_id?: string
}

export type LightRAGLogger = {
  info?: (obj: unknown, msg?: string) => void
  warn?: (obj: unknown, msg?: string) => void
  error: (obj: unknown, msg?: string) => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function buildHeaders(apiKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  }

  if (apiKey?.trim()) {
    headers["X-API-Key"] = apiKey.trim()
  }

  return headers
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function fetchDocumentPage(
  page: number,
  baseUrl: string,
  apiKey?: string | null
): Promise<LightRAGPaginatedResponse> {
  const response = await fetch(`${baseUrl}/documents/paginated`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      page,
      page_size: LIGHTRAG_PAGE_SIZE,
      sort_field: "updated_at",
      sort_direction: "desc"
    })
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `LightRAG document lookup failed (${response.status}): ${body.slice(0, 300) || response.statusText}`
    )
  }

  return (await readJson<LightRAGPaginatedResponse>(response)) ?? {}
}

export async function findLightRAGDocumentByFileSource(
  fileSource: string,
  baseUrl: string,
  apiKey?: string | null
): Promise<LightRAGDocumentSummary | null> {
  let page = 1

  while (true) {
    const payload = await fetchDocumentPage(page, baseUrl, apiKey)
    const documents = payload.documents ?? []
    const match = documents.find((document) => document.file_path === fileSource)

    if (match) {
      return {
        id: match.id,
        filePath: match.file_path,
        status: match.status,
        trackId: match.track_id ?? null
      }
    }

    const totalPages = payload.pagination?.total_pages ?? page
    if (page >= totalPages) {
      return null
    }

    page += 1
  }
}

export async function deleteLightRAGDocument(
  docId: string,
  baseUrl: string,
  apiKey?: string | null
): Promise<LightRAGDeleteResponse> {
  const response = await fetch(`${baseUrl}/documents/delete_document`, {
    method: "DELETE",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      doc_ids: [docId],
      delete_file: false,
      delete_llm_cache: false
    })
  })

  const payload = await readJson<LightRAGDeleteResponse>(response)

  if (!response.ok) {
    const fallback = payload ? JSON.stringify(payload) : ""
    throw new Error(
      `LightRAG document delete failed (${response.status}): ${(fallback || response.statusText).slice(0, 300)}`
    )
  }

  return payload ?? {}
}

export async function waitForLightRAGDocumentRemoval(
  fileSource: string,
  baseUrl: string,
  apiKey?: string | null,
  log?: LightRAGLogger
): Promise<boolean> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < LIGHTRAG_DELETE_TIMEOUT_MS) {
    const existingDocument = await findLightRAGDocumentByFileSource(
      fileSource,
      baseUrl,
      apiKey
    )

    if (!existingDocument) {
      return true
    }

    log?.info?.(
      {
        fileSource,
        docId: existingDocument.id,
        elapsedMs: Date.now() - startedAt
      },
      "Waiting for LightRAG document deletion to finish"
    )

    await sleep(LIGHTRAG_DELETE_POLL_MS)
  }

  return false
}
