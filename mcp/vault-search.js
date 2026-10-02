#!/usr/bin/env node
// MCP server (stdio, zero dependencies) exposing `search_vault` over the Obsidian vault configured
// in config.json. While the dashboard runs, it answers (hybrid meaning + keyword search; it starts
// and stops Ollama on demand); otherwise this process does BM25 keyword search itself.
// Register with:
//   claude mcp add vault-search --scope user -- node "<path>\mcp\vault-search.js"
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createSearch } = require("../lib/search");

const { findHome, loadConfig } = require("../lib/home");

// Same config as the app (lib/home.js); in the installed app this runs as
// "Agentic OS.exe" with ELECTRON_RUN_AS_NODE=1, so no separate Node is needed.
const cfg = loadConfig(findHome());
const vault = process.env.VAULT_PATH || cfg.vault.path;
const search = createSearch(vault, { skipDirs: [cfg.vault.runsFolder, ...(cfg.vault.searchSkip || [])] });

// Ask the dashboard first (semantic + keywords); null when it isn't running.
async function viaDashboard(q, limit) {
  try {
    const r = await fetch(`http://127.0.0.1:${cfg.port || 4747}/api/search?q=${encodeURIComponent(q)}&n=${limit}`, {
      signal: AbortSignal.timeout(60e3),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

const TOOL = {
  name: "search_vault",
  description:
    "Search the user's Obsidian vault (notes, wiki, projects, research) by meaning and keywords, in Persian " +
    "or English (a Persian query also finds English notes). Returns the best-matching notes with a snippet; " +
    "read a file for full content. For where things live, MAP.md in the vault root is the index.",
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

async function handle(req) {
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
    const q = String(args.query || "");
    const limit = Math.min(20, Number(args.limit) || 8);
    const hits = (await viaDashboard(q, limit)) || search.search(q, limit);
    const text = hits.length
      ? hits.map((h, i) => `${i + 1}. ${h.file} (score ${h.score}${h.mode ? `, ${h.mode}` : ""})\n   ${h.snippet}`).join("\n")
      : "No matching notes.";
    return send({ id, result: { content: [{ type: "text", text: `Vault: ${vault}\n\n${text}` }] } });
  }
  if (method === "ping") return send({ id, result: {} });
  if (id !== undefined) send({ id, error: { code: -32601, message: `method not found: ${method}` } });
  // Notifications (no id), e.g. notifications/initialized, need no reply.
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    return send({ id: null, error: { code: -32700, message: e.message } });
  }
  handle(req).catch((e) => send({ id: req.id ?? null, error: { code: -32603, message: e.message } }));
});
