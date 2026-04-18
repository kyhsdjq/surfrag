import { randomUUID } from "node:crypto"

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { ServerResponse } from "node:http"

import { createSurfRagMcpServer } from "./factory.js"

type SessionEntry = {
  transport: StreamableHTTPServerTransport
  server: Awaited<ReturnType<typeof createSurfRagMcpServer>>
}

const MCP_SESSION_HEADER = "mcp-session-id"

const setMcpCorsHeaders = (request: FastifyRequest, reply: FastifyReply) => {
  const origin = request.headers.origin
  if (origin) {
    reply.raw.setHeader("Access-Control-Allow-Origin", origin)
    reply.raw.setHeader("Vary", "Origin")
  } else {
    reply.raw.setHeader("Access-Control-Allow-Origin", "*")
  }

  reply.raw.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Mcp-Session-Id"
  )
  reply.raw.setHeader(
    "Access-Control-Allow-Methods",
    "POST, GET, DELETE, OPTIONS"
  )
  reply.raw.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id")
}

const sendJsonRpcHttpError = (
  reply: FastifyReply,
  statusCode: number,
  message: string
) =>
  reply.code(statusCode).send({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message
    },
    id: null
  })

const sendRawJsonRpcHttpError = (
  response: ServerResponse,
  statusCode: number,
  message: string
) => {
  response.statusCode = statusCode
  response.setHeader("Content-Type", "application/json")
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message
      },
      id: null
    })
  )
}

export async function registerMcpHttpRoutes(app: FastifyInstance) {
  const sessions = new Map<string, SessionEntry>()

  app.options("/mcp", async (request, reply) => {
    setMcpCorsHeaders(request, reply)
    reply.code(204).send()
  })

  app.post("/mcp", async (request, reply) => {
    setMcpCorsHeaders(request, reply)

    const sessionIdHeader = request.headers[MCP_SESSION_HEADER]
    const sessionId =
      typeof sessionIdHeader === "string" && sessionIdHeader.trim()
        ? sessionIdHeader
        : undefined

    let hijacked = false

    try {
      let entry = sessionId ? sessions.get(sessionId) : undefined

      if (!entry) {
        if (sessionId) {
          return sendJsonRpcHttpError(reply, 404, "Session not found")
        }

        if (!isInitializeRequest(request.body)) {
          return sendJsonRpcHttpError(
            reply,
            400,
            "Bad Request: No valid session ID provided"
          )
        }

        const server = await createSurfRagMcpServer()
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, { transport, server })
          }
        })

        transport.onclose = () => {
          const currentSessionId = transport.sessionId
          if (currentSessionId) {
            sessions.delete(currentSessionId)
          }
          void Promise.resolve(server.close())
        }

        await server.connect(transport as unknown as Transport)
        entry = { transport, server }
      }

      reply.hijack()
      hijacked = true
      await entry.transport.handleRequest(request.raw, reply.raw, request.body)
      return reply
    } catch (error) {
      app.log.error({ err: error }, "Failed to handle MCP HTTP request")
      if (!reply.raw.headersSent) {
        if (hijacked) {
          sendRawJsonRpcHttpError(reply.raw, 500, "Internal server error")
          return reply
        }
        return sendJsonRpcHttpError(reply, 500, "Internal server error")
      }
      return reply
    }
  })

  app.get("/mcp", async (request, reply) => {
    setMcpCorsHeaders(request, reply)
    reply.header("Allow", "POST, DELETE, OPTIONS")
    return sendJsonRpcHttpError(reply, 405, "Method not allowed")
  })

  app.delete("/mcp", async (request, reply) => {
    setMcpCorsHeaders(request, reply)

    const sessionIdHeader = request.headers[MCP_SESSION_HEADER]
    const sessionId =
      typeof sessionIdHeader === "string" && sessionIdHeader.trim()
        ? sessionIdHeader
        : undefined

    if (!sessionId) {
      return sendJsonRpcHttpError(
        reply,
        400,
        "Bad Request: No valid session ID provided"
      )
    }

    const entry = sessions.get(sessionId)
    if (!entry) {
      return sendJsonRpcHttpError(reply, 404, "Session not found")
    }

    sessions.delete(sessionId)
    entry.transport.onclose = () => {}
    await Promise.resolve(entry.transport.close())
    await Promise.resolve(entry.server.close())
    reply.code(204).send()
  })
}
