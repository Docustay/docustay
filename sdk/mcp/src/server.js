#!/usr/bin/env node
// Docustay MCP server over stdio. Configure with environment variables:
//   DOCUSTAY_API_KEY   a key from Developers (use a dsk_test_ key to practise)
//   DOCUSTAY_BASE_URL  default https://app.docustay.app
//   DOCUSTAY_READ_ONLY set to 1 to remove every tool that changes anything
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Docustay } from "@docustay2026/sdk";
import { registerTools } from "./tools.js";

const key = process.env.DOCUSTAY_API_KEY;
if (!key) { process.stderr.write("docustay-mcp: set DOCUSTAY_API_KEY (a key from Developers)\n"); process.exit(1); }
const docustay = new Docustay(key, { baseUrl: process.env.DOCUSTAY_BASE_URL || undefined });
const readOnly = ["1", "true", "yes"].includes(String(process.env.DOCUSTAY_READ_ONLY ?? "").toLowerCase());
const server = new McpServer({ name: "docustay", version: "0.2.0" }, { instructions: `Docustay sends documents for signature. ${docustay.testMode ? "This key is a TEST key: everything is a practice run." : "This key is LIVE: sending emails real people."} Sending, reminding and cancelling need a preview and the person's agreement first.${readOnly ? " This server is read-only." : ""}` });
registerTools(server, docustay, { readOnly });
await server.connect(new StdioServerTransport());
