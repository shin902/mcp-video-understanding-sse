#!/usr/bin/env node
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  console.error(`Gemini Video MCP Server ready (model: ${config.model})`);
}

main().catch((error) => {
  console.error("Fatal error while running Gemini MCP server:", error);
  process.exit(1);
});
