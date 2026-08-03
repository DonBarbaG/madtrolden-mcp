// Local/stdio entrypoint — `npm run dev:stdio`. Profile persists to
// ~/.tilbudstrolden.json exactly like the base repo (file backend is only
// active outside HTTP request context).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAll, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "./create-server";

const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { instructions: SERVER_INSTRUCTIONS },
);

registerAll(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Madtrolden MCP server v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
