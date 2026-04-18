import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { createSurfRagMcpServer } from "./factory.js"

const main = async () => {
  const mcpServer = await createSurfRagMcpServer()
  const transport = new StdioServerTransport()
  await mcpServer.connect(transport)
}

main().catch((error) => {
  console.error("MCP server error:", error)
  process.exit(1)
})
