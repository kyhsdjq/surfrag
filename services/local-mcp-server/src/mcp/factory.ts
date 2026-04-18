import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getCaptureById, searchCaptures } from "../db/sqlite.js"
import { queryLightRAG, type LightRAGQueryError } from "../lightrag/query.js"
import { buildSearchMatch, buildSnippet } from "../search/match.js"
import { getSurfRagMcpRuntime } from "./runtime.js"

const SEARCH_LIMIT_DEFAULT = 10
const SEARCH_LIMIT_MAX = 50
const VECTOR_SEARCH_DISABLED_MSG =
  "Error: Vector search is disabled. Set VECTOR_SEARCH_ENABLED=true, VECTOR_DB_ENABLED=true, EMBED_API, and VECTOR_DB_PATH to enable semantic search."

const LIGHTRAG_QUERY_DISABLED_MSG =
  "Error: LightRAG query is disabled. Set LIGHTRAG_QUERY_ENABLED=true and ensure LightRAG server is running at LIGHTRAG_URL."

const searchInputSchema = z.object({
  keyword: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Search term. Case-insensitive. Matches in page title, URL, and body text."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMIT_MAX)
    .default(SEARCH_LIMIT_DEFAULT)
    .describe("Maximum number of results to return"),
  since: z
    .string()
    .optional()
    .describe(
      "Optional. Only captures after this datetime. ISO 8601 format (e.g. 2025-03-01T00:00:00.000Z)"
    )
})

const vectorSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Natural language query. Matched by semantic similarity (e.g. 'machine learning tutorials', 'pages about neural networks')."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(SEARCH_LIMIT_MAX)
    .default(SEARCH_LIMIT_DEFAULT)
    .describe("Maximum number of results to return"),
  since: z
    .string()
    .optional()
    .describe(
      "Optional. Only captures after this datetime. ISO 8601 format (e.g. 2025-03-01T00:00:00.000Z)"
    )
})

const getByIdInputSchema = z.object({
  id: z
    .string()
    .describe("UUID of the capture (from search_captures or vector_search matches)")
})

const lightragQueryInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(3)
    .describe(
      "Natural language question. Graph-based RAG retrieval over captured pages. Min 3 characters."
    ),
  mode: z
    .enum(["naive", "local", "global", "hybrid", "mix"])
    .default("mix")
    .describe(
      "Query mode: naive (vector only), local (entity-focused), global (community), hybrid, mix (recommended)"
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(SEARCH_LIMIT_DEFAULT)
    .describe("Max text chunks to retrieve")
})

export async function createSurfRagMcpServer() {
  const runtime = await getSurfRagMcpRuntime()
  const server = new McpServer({
    name: "surfrag-local-mcp-server",
    version: "1.0.0"
  })

  const getCaptureByIdEnabled =
    runtime.searchCapturesEnabled ||
    (runtime.vectorSearchEnabled && !!runtime.vectorBootstrap)

  if (runtime.searchCapturesEnabled) {
    server.registerTool(
      "search_captures",
      {
        description:
          "Search across captured web pages by keyword. Returns matches with id, pageId, title, url, capturedAt, snippet, and keywordCount.",
        inputSchema: searchInputSchema.shape
      },
      async ({ keyword, limit, since }) => {
        const sinceValidation = since
          ? z.iso.datetime({ offset: true }).safeParse(since)
          : { success: true as const, data: undefined }

        if (!sinceValidation.success) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Invalid since format. Expected ISO 8601 datetime."
              }
            ],
            isError: true
          }
        }

        const result = searchCaptures(
          runtime.db,
          keyword,
          limit ?? SEARCH_LIMIT_DEFAULT,
          sinceValidation.data
        )

        return {
          content: [
            {
              type: "text",
              text: `Found ${result.matches.length} matching captures. Use get_capture_by_id(id) for full content.\n\n${JSON.stringify(result, null, 2)}`
            }
          ]
        }
      }
    )
  }

  server.registerTool(
    "lightrag_query",
    {
      description:
        "Query captured web pages via LightRAG graph-based RAG. Primary retrieval tool. Returns LLM-generated answer with source references. Use when the user asks questions that benefit from knowledge graph context (entities, relationships). Requires LightRAG server running.",
      inputSchema: lightragQueryInputSchema.shape
    },
    async ({ query, mode, limit }) => {
      if (!runtime.lightragQueryEnabled || !runtime.lightragUrl) {
        return {
          content: [{ type: "text", text: LIGHTRAG_QUERY_DISABLED_MSG }],
          isError: true
        }
      }

      try {
        const result = await queryLightRAG(
          { query, mode: mode ?? "mix", limit: limit ?? SEARCH_LIMIT_DEFAULT },
          runtime.lightragUrl,
          runtime.lightragApiKey
        )
        const refCount = result.references?.length ?? 0
        const output = {
          response: result.response,
          references: result.references ?? [],
          query_mode: result.query_mode,
          summary: `LightRAG returned ${refCount} reference(s). Use get_capture_by_id if capture UUID is known.`
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(output, null, 2)
            }
          ]
        }
      } catch (err) {
        const errorMsg =
          err && typeof err === "object" && "error" in err
            ? (err as LightRAGQueryError).error
            : err instanceof Error
              ? err.message
              : "LightRAG query failed"

        return {
          content: [{ type: "text", text: `Error: ${errorMsg}` }],
          isError: true
        }
      }
    }
  )

  if (runtime.vectorSearchEnabled) {
    server.registerTool(
      "vector_search",
      {
        description:
          "Search across captured web pages by semantic similarity. Finds pages conceptually related to the query (e.g. 'machine learning tutorials' matches neural networks, deep learning). Use when the user asks by meaning rather than exact keywords. Returns matches with id, pageId, title, url, capturedAt, snippet, and distance. Call get_capture_by_id(id) for full content. Requires VECTOR_SEARCH_ENABLED=true, VECTOR_DB_ENABLED=true, EMBED_API, and VECTOR_DB_PATH.",
        inputSchema: vectorSearchInputSchema.shape
      },
      async ({ query, limit, since }) => {
        if (!runtime.vectorBootstrap) {
          return {
            content: [{ type: "text", text: VECTOR_SEARCH_DISABLED_MSG }],
            isError: true
          }
        }

        const sinceValidation = since
          ? z.iso.datetime({ offset: true }).safeParse(since)
          : { success: true as const, data: undefined }

        if (!sinceValidation.success) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Invalid since format. Expected ISO 8601 datetime."
              }
            ],
            isError: true
          }
        }

        try {
          const { lanceClient, embedProvider } = runtime.vectorBootstrap
          const queryVector = await embedProvider.embed(query)
          const rawResults = await lanceClient.vectorSearch(
            queryVector,
            limit ?? SEARCH_LIMIT_DEFAULT
          )

          const bestByCaptureId = new Map<
            string,
            { _distance: number | undefined }
          >()

          for (const result of rawResults) {
            const existing = bestByCaptureId.get(result.capture_id)
            const distance = result._distance ?? Infinity
            if (!existing || (existing._distance ?? Infinity) > distance) {
              bestByCaptureId.set(result.capture_id, {
                _distance: result._distance
              })
            }
          }

          const matches: Array<{
            id: string
            pageId: string
            title: string
            url: string
            capturedAt: string
            snippet: string
            distance?: number
          }> = []

          for (const captureId of bestByCaptureId.keys()) {
            const capture = getCaptureById(runtime.db, captureId)
            if (!capture) continue
            if (sinceValidation.data && capture.capturedAt < sinceValidation.data) {
              continue
            }

            const entry = bestByCaptureId.get(captureId)!
            matches.push(
              buildSearchMatch(capture, {
                snippet: buildSnippet(capture.bodyText),
                ...(entry._distance !== undefined
                  ? { distance: entry._distance }
                  : {})
              })
            )
          }

          return {
            content: [
              {
                type: "text",
                text: `Found ${matches.length} semantically similar captures. Use get_capture_by_id(id) for full content.\n\n${JSON.stringify({ matches, totalMatches: matches.length }, null, 2)}`
              }
            ]
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Embedding or vector search failed"

          return {
            content: [{ type: "text", text: `Error: ${message}` }],
            isError: true
          }
        }
      }
    )
  }

  if (getCaptureByIdEnabled) {
    server.registerTool(
      "get_capture_by_id",
      {
        description:
          "Fetch the full content of a single captured page by UUID. Returns null capture when no record exists. Only available when search_captures or vector_search is enabled.",
        inputSchema: getByIdInputSchema.shape
      },
      async ({ id }) => {
        const idValidation = z.string().uuid().safeParse(id)
        if (!idValidation.success) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Invalid capture id format. Expected UUID."
              }
            ],
            isError: true
          }
        }

        const captureRecord = getCaptureById(runtime.db, id)
        const capture = captureRecord
          ? {
              id: captureRecord.id,
              title: captureRecord.title,
              url: captureRecord.url,
              referrer: captureRecord.referrer,
              bodyText: captureRecord.bodyText,
              maxScrollPercentage: captureRecord.maxScrollPercentage,
              capturedAt: captureRecord.capturedAt,
              sourceSession: captureRecord.sourceSession
            }
          : null

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ capture }, null, 2)
            }
          ]
        }
      }
    )
  }

  return server
}
