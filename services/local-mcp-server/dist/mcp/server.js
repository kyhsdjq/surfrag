import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bootstrapSqlite, getCaptureById, searchCaptures } from "../db/sqlite.js";
const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 50;
const searchInputSchema = z.object({
    keyword: z
        .string()
        .trim()
        .min(1)
        .describe("Search term. Case-insensitive. Matches in page title, URL, and body text."),
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
        .describe("Optional. Only captures after this datetime. ISO 8601 format (e.g. 2025-03-01T00:00:00.000Z)")
});
const getByIdInputSchema = z.object({
    id: z.string().describe("UUID of the capture (from search_captures matches)")
});
const mcpServer = new McpServer({
    name: "surfrag-local-mcp-server",
    version: "1.0.0"
});
const { db } = bootstrapSqlite();
mcpServer.registerTool("search_captures", {
    description: "Search across captured web pages by keyword. Returns matches with id, title, url, capturedAt, snippet, and keywordCount.",
    inputSchema: searchInputSchema.shape
}, async ({ keyword, limit, since }) => {
    const sinceValidation = since
        ? z.iso.datetime({ offset: true }).safeParse(since)
        : { success: true, data: undefined };
    if (!sinceValidation.success) {
        return {
            content: [
                {
                    type: "text",
                    text: "Error: Invalid since format. Expected ISO 8601 datetime."
                }
            ],
            isError: true
        };
    }
    const sinceIso = sinceValidation.data;
    const result = searchCaptures(db, keyword, limit ?? SEARCH_LIMIT_DEFAULT, sinceIso);
    const summary = `Found ${result.matches.length} matching captures. Use get_capture_by_id(id) for full content.`;
    return {
        content: [
            {
                type: "text",
                text: `${summary}\n\n${JSON.stringify(result, null, 2)}`
            }
        ]
    };
});
mcpServer.registerTool("get_capture_by_id", {
    description: "Fetch the full content of a single captured page by UUID. Returns null capture when no record exists.",
    inputSchema: getByIdInputSchema.shape
}, async ({ id }) => {
    const idValidation = z.string().uuid().safeParse(id);
    if (!idValidation.success) {
        return {
            content: [
                {
                    type: "text",
                    text: "Error: Invalid capture id format. Expected UUID."
                }
            ],
            isError: true
        };
    }
    const captureRecord = getCaptureById(db, id);
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
        : null;
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ capture }, null, 2)
            }
        ]
    };
});
const main = async () => {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
};
main().catch((error) => {
    console.error("MCP server error:", error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map