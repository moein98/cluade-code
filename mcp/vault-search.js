#!/usr/bin/env node
// MCP server (stdio, zero dependencies) exposing `search_vault`: BM25 search over the
// Obsidian vault configured in config.json. Register with:
//   claude mcp add vault-search --scope user -- node "<path>\mcp\vault-search.js"
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createSearch } = require("../lib/search");

const ROOT = path.join(__dirname, "..");
const cfgFile = ["config.json", "config.example.json"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
const vault = process.env.VAULT_PATH || cfg.vault.path;
const search = createSearch(vault, { skipDirs: [cfg.vault.runsFolder] });

const TOOL = {
  name: "search_vault",
  description:
    "Search the user's Obsidian vault (notes, wiki, projects, research) by keywords, in Persian or English. " +
    "Returns the best-matching notes with a snippet; read a file for full content.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keywords to search for" },
      limit: { type: "number", description: "Max results (default 8)" },
    },
    required: ["query"],
  },
};

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");

function handle(req) {
  const { id, method, params } = req;
  if (method === "initialize") {
    return send({
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "vault-search", version: "1.0.0" },
      },
    });
  }
  if (method === "tools/list") return send({ id, result: { tools: [TOOL] } });
  if (method === "tools/call") {
    const args = (params && params.arguments) || {};
    if (!params || params.name !== TOOL.name) {
      return send({ id, error: { code: -32602, message: `unknown tool: ${params && params.name}` } });
    }
    const hits = search.search(String(args.query || ""), Math.min(20, Number(args.limit) || 8));
    const text = hits.length
      ? hits.map((h, i) => `${i + 1}. ${h.file} (score ${h.score})\n   ${h.snippet}`).join("\n")
      : "No matching notes.";
    return send({ id, result: { content: [{ type: "text", text: `Vault: ${vault}\n\n${text}` }] } });
  }
  if (method === "ping") return send({ id, result: {} });
  if (id !== undefined) send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  // Notifications (no id), e.g. notifications/initialized, need no reply.
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line));
  } catch (e) {
    send({ id: null, error: { code: -32700, message: e.message } });
  }
});
