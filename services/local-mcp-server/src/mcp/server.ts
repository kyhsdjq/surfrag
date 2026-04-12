import path from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"

// Load .env from package root (services/local-mcp-server) regardless of cwd.
// When Cursor runs MCP, cwd may be workspace root, so process.cwd()/.env would be wrong.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, "../..")
loadDotenv({ path: path.join(PACKAGE_ROOT, ".env") })

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { bootstrapSqlite, getCaptureById, searchCaptures } from "../db/sqlite.js"
import { buildSearchMatch, buildSnippet } from "../search/match.js"
import { bootstrapVectorIfEnabled } from "../vector/bootstrap.js"
import { queryLightRAG, type LightRAGQueryError } from "../lightrag/query.js"

const SEARCH_LIMIT_DEFAULT = 10
const SEARCH_LIMIT_MAX = 50
const VECTOR_SEARCH_DISABLED_MSG =
  "Error: Vector search is disabled. Set VECTOR_SEARCH_ENABLED=true, VECTOR_DB_ENABLED=true, EMBED_API, and VECTOR_DB_PATH to enable semantic search."

const LIGHTRAG_QUERY_DISABLED_MSG =
  "Error: LightRAG query is disabled. Set LIGHTRAG_QUERY_ENABLED=true and ensure LightRAG server is running at LIGHTRAG_URL."

function parseBoolEnv(value: string | undefined): boolean {
  const v = value?.toLowerCase().trim()
  return v === "true" || v === "1" || v === "yes" || v === "on"
}

const lightragQueryEnabled =
  process.env.LIGHTRAG_QUERY_ENABLED === undefined ||
  (process.env.LIGHTRAG_QUERY_ENABLED ?? "").trim() === ""
    ? true
    : parseBoolEnv(process.env.LIGHTRAG_QUERY_ENABLED)
const lightragUrl = process.env.LIGHTRAG_URL?.trim() || "http://localhost:9621"
const lightragApiKey = process.env.LIGHTRAG_API_KEY?.trim() || null

const searchCapturesEnabled =
  process.env.SEARCH_CAPTURES_ENABLED === undefined ||
  (process.env.SEARCH_CAPTURES_ENABLED ?? "").trim() === ""
    ? false
    : parseBoolEnv(process.env.SEARCH_CAPTURES_ENABLED)
const vectorSearchEnabled = parseBoolEnv(process.env.VECTOR_SEARCH_ENABLED)

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
    .describe("Query mode: naive (vector only), local (entity-focused), global (community), hybrid, mix (recommended)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(SEARCH_LIMIT_DEFAULT)
    .describe("Max text chunks to retrieve")
})

const mcpServer = new McpServer({
  name: "surfrag-local-mcp-server",
  version: "1.0.0"
})

const { db } = bootstrapSqlite()
const vectorBootstrap = await bootstrapVectorIfEnabled({
  basePath: PACKAGE_ROOT
})

const getCaptureByIdEnabled =
  searchCapturesEnabled || (vectorSearchEnabled && !!vectorBootstrap)

if (searchCapturesEnabled) {
  mcpServer.registerTool(
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

    const sinceIso = sinceValidation.data
    const result = searchCaptures(
      db,
      keyword,
      limit ?? SEARCH_LIMIT_DEFAULT,
      sinceIso
    )
    const summary = `Found ${result.matches.length} matching captures. Use get_capture_by_id(id) for full content.`

    return {
      content: [
        {
          type: "text",
          text: `${summary}\n\n${JSON.stringify(result, null, 2)}`
        }
      ]
    }
  }
  )
}

mcpServer.registerTool(
  "lightrag_query",
  {
    description:
      "Query captured web pages via LightRAG graph-based RAG. Primary retrieval tool. Returns LLM-generated answer with source references. Use when the user asks questions that benefit from knowledge graph context (entities, relationships). Requires LightRAG server running.",
    inputSchema: lightragQueryInputSchema.shape
  },
  async ({ query, mode, limit }) => {
    if (!lightragQueryEnabled || !lightragUrl) {
      return {
        content: [{ type: "text", text: LIGHTRAG_QUERY_DISABLED_MSG }],
        isError: true
      }
    }

    try {
      const result = await queryLightRAG(
        { query, mode: mode ?? "mix", limit: limit ?? SEARCH_LIMIT_DEFAULT },
        lightragUrl,
        lightragApiKey
      )
      const refCount = result.references?.length ?? 0
      const summary = `LightRAG returned ${refCount} reference(s). Use get_capture_by_id if capture UUID is known.`
      const output = {
        response: result.response,
        references: result.references ?? [],
        query_mode: result.query_mode,
        summary
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

if (vectorSearchEnabled) {
  mcpServer.registerTool(
    "vector_search",
    {
      description:
        "Search across captured web pages by semantic similarity. Finds pages conceptually related to the query (e.g. 'machine learning tutorials' matches neural networks, deep learning). Use when the user asks by meaning rather than exact keywords. Returns matches with id, pageId, title, url, capturedAt, snippet, and distance. Call get_capture_by_id(id) for full content. Requires VECTOR_SEARCH_ENABLED=true, VECTOR_DB_ENABLED=true, EMBED_API, and VECTOR_DB_PATH.",
      inputSchema: vectorSearchInputSchema.shape
    },
    async ({ query, limit, since }) => {
    if (!vectorBootstrap) {
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

    const sinceIso = sinceValidation.data

    try {
      const { lanceClient, embedProvider } = vectorBootstrap
      const queryVector = await embedProvider.embed(query)
      const rawResults = await lanceClient.vectorSearch(
        queryVector,
        limit ?? SEARCH_LIMIT_DEFAULT
      )

      // Dedupe by capture_id (keep lowest _distance)
      const bestByCaptureId = new Map<
        string,
        { _distance: number | undefined }
      >()
      for (const r of rawResults) {
        const existing = bestByCaptureId.get(r.capture_id)
        const dist = r._distance ?? Infinity
        if (!existing || (existing._distance ?? Infinity) > dist) {
          bestByCaptureId.set(r.capture_id, { _distance: r._distance })
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
        const capture = getCaptureById(db, captureId)
        if (!capture) continue
        if (sinceIso && capture.capturedAt < sinceIso) continue

        const entry = bestByCaptureId.get(captureId)!
        const opts: { snippet: string; distance?: number } = {
          snippet: buildSnippet(capture.bodyText)
        }
        if (entry._distance !== undefined) {
          opts.distance = entry._distance
        }
        matches.push(buildSearchMatch(capture, opts))
      }

      const totalMatches = matches.length
      const summary = `Found ${totalMatches} semantically similar captures. Use get_capture_by_id(id) for full content.`

      return {
        content: [
          {
            type: "text",
            text: `${summary}\n\n${JSON.stringify({ matches, totalMatches }, null, 2)}`
          }
        ]
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Embedding or vector search failed"
      return {
        content: [
          {
            type: "text",
            text: `Error: ${message}`
          }
        ],
        isError: true
      }
    }
  }
  )
}

if (getCaptureByIdEnabled) {
  mcpServer.registerTool(
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

      const captureRecord = getCaptureById(db, id)
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

const main = async () => {
  const transport = new StdioServerTransport()
  await mcpServer.connect(transport)
}

main().catch((error) => {
  console.error("MCP server error:", error)
  process.exit(1)
})
