// Where config.json and data/ live (HOME), shared by the server and the vault-search MCP server:
//   1. AGENTIC_OS_HOME
//   2. from source: the project folder when it has a config.json
//   3. packaged (code in resources/app): a config.json beside or up to two folders above the exe
//   4. %APPDATA%\Agentic OS — where the installer puts it; created from config.example.json
// So source checked out without a config.json runs against the installed app's settings and data.
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP = path.join(__dirname, "..");

function findHome() {
  if (process.env.AGENTIC_OS_HOME) return path.resolve(process.env.AGENTIC_OS_HOME);
  if (!/[\\/]resources[\\/]app$/i.test(APP)) {
    if (fs.existsSync(path.join(APP, "config.json"))) return APP;
  } else {
    // home.txt beside the exe names the home folder, for processes started without
    // AGENTIC_OS_HOME (e.g. the vault-search MCP server launched by an older Claude Code).
    try {
      const named = fs.readFileSync(path.join(path.dirname(process.execPath), "home.txt"), "utf8").trim();
      if (named && fs.existsSync(path.join(named, "config.json"))) return named;
    } catch {}
    let dir = path.dirname(process.execPath);
    for (let i = 0; i < 3; i++, dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, "config.json"))) return dir;
    }
  }
  const home = path.join(process.env.APPDATA || os.homedir(), "Agentic OS");
  fs.mkdirSync(home, { recursive: true });
  const conf = path.join(home, "config.json");
  if (!fs.existsSync(conf)) fs.copyFileSync(path.join(APP, "config.example.json"), conf);
  return home;
}

// config.json from HOME, else the example shipped with the code.
function loadConfig(home) {
  const file = [path.join(home, "config.json"), path.join(APP, "config.example.json")].find((f) => fs.existsSync(f));
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

module.exports = { APP, findHome, loadConfig };
