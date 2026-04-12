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

export type LightRAGClearDocumentsResponse = {
  status?: string
  message?: string
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

export async function listLightRAGDocuments(
  baseUrl: string,
  apiKey?: string | null
): Promise<LightRAGDocumentSummary[]> {
  const summaries: LightRAGDocumentSummary[] = []
  let page = 1

  while (true) {
    const payload = await fetchDocumentPage(page, baseUrl, apiKey)
    const documents = payload.documents ?? []

    summaries.push(
      ...documents.map((document) => ({
        id: document.id,
        filePath: document.file_path,
        status: document.status,
        trackId: document.track_id ?? null
      }))
    )

    const totalPages = payload.pagination?.total_pages ?? page
    if (page >= totalPages) {
      return summaries
    }

    page += 1
  }
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

export async function clearAllLightRAGDocuments(
  baseUrl: string,
  apiKey?: string | null
): Promise<LightRAGClearDocumentsResponse> {
  const response = await fetch(`${baseUrl}/documents`, {
    method: "DELETE",
    headers: buildHeaders(apiKey)
  })

  const payload = await readJson<LightRAGClearDocumentsResponse>(response)

  if (!response.ok) {
    const fallback = payload ? JSON.stringify(payload) : ""
    throw new Error(
      `LightRAG document reset failed (${response.status}): ${(fallback || response.statusText).slice(0, 300)}`
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

export async function waitForLightRAGDocumentsCleared(
  baseUrl: string,
  apiKey?: string | null,
  log?: LightRAGLogger
): Promise<boolean> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < LIGHTRAG_DELETE_TIMEOUT_MS) {
    const documents = await listLightRAGDocuments(baseUrl, apiKey)

    if (documents.length === 0) {
      return true
    }

    log?.info?.(
      {
        remainingDocuments: documents.length,
        elapsedMs: Date.now() - startedAt
      },
      "Waiting for LightRAG document reset to finish"
    )

    await sleep(LIGHTRAG_DELETE_POLL_MS)
  }

  return false
}

export async function removeLightRAGDocumentsByFileSources(
  fileSources: string[],
  baseUrl: string,
  apiKey?: string | null,
  log?: LightRAGLogger
): Promise<boolean> {
  const uniqueSources = [...new Set(fileSources.map((value) => value.trim()))].filter(
    (value) => value.length > 0
  )

  for (const fileSource of uniqueSources) {
    const existingDocument = await findLightRAGDocumentByFileSource(
      fileSource,
      baseUrl,
      apiKey
    )

    if (!existingDocument) {
      continue
    }

    log?.info?.(
      {
        fileSource,
        docId: existingDocument.id,
        status: existingDocument.status
      },
      "Removing existing LightRAG document before re-ingestion"
    )

    const deleteResult = await deleteLightRAGDocument(
      existingDocument.id,
      baseUrl,
      apiKey
    )

    if (deleteResult.status !== "deletion_started") {
      log?.warn?.(
        {
          fileSource,
          docId: existingDocument.id,
          deleteStatus: deleteResult.status,
          message: deleteResult.message
        },
        "LightRAG document deletion could not be started"
      )
      return false
    }

    const removed = await waitForLightRAGDocumentRemoval(
      fileSource,
      baseUrl,
      apiKey,
      log
    )

    if (!removed) {
      log?.error(
        {
          fileSource,
          docId: existingDocument.id
        },
        "Timed out waiting for LightRAG document deletion"
      )
      return false
    }
  }

  return true
}
