// Integration status from `claude mcp list` (claude.ai connectors, plugin and local MCP servers).
const { execFile } = require("child_process");

function parse(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^(.+?): .* - (.+)$/.exec(line.trim());
    if (!m) continue;
    const status = m[2].replace(/^[^A-Za-z]+/, "").trim();
    out.push({
      name: m[1].replace(/^claude\.ai /, "").replace(/^plugin:/, ""),
      ok: /connected/i.test(status) && !/fail|not |disconnected/i.test(status),
      status,
    });
  }
  return out;
}

function createIntegrations(cfg) {
  let items = null;
  let busy = false;
  function refresh() {
    if (busy) return;
    busy = true;
    execFile(
      cfg.claudePath || "claude",
      ["mcp", "list"],
      { cwd: cfg.vault.path, timeout: 120e3, windowsHide: true },
      (err, stdout) => {
        busy = false;
        if (stdout) items = parse(stdout);
        else if (err) items = items || [];
      }
    );
  }
  // `claude mcp list` starts every MCP server to check it, so it runs rarely: at start, hourly,
  // and from the dashboard's refresh button.
  refresh();
  setInterval(refresh, 60 * 60e3);
  return {
    list: () => (items === null ? null : [...items, ...(cfg.integrations || [])]),
    refresh,
  };
}

module.exports = { createIntegrations };
