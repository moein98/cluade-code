// Builds the Windows app: dist/Agentic OS/Agentic OS.exe — no downloads needed.
//
//   npm run dist
//
// It reuses the Electron runtime from node_modules/electron/dist, renames electron.exe, puts the
// app code in resources/app (no node_modules: the app has no runtime dependencies), keeps only
// the en-US and fa locales, and sets the exe's icon and version info with rcedit. A running copy
// is closed first (`Agentic OS.exe --quit`) and started again in the tray afterwards, unless
// --no-restart is given (scripts/build-setup.js). The sample skills ship in resources/app/skills
// for the installer. Where the app keeps config.json and data/: lib/home.js.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync, spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist");
const OUT = path.join(ROOT, "dist", "Agentic OS");
const EXE = path.join(OUT, "Agentic OS.exe");
const APP_FILES = ["server.js", "config.example.json", "lib", "electron", "public", "mcp", "skills"];
const KEEP_LOCALES = new Set(["en-US.pak", "fa.pak"]);

function copy(src, dest, filter = () => true) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      const s = path.join(src, name);
      if (filter(s)) copy(s, path.join(dest, name), filter);
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function dirSize(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

// ---------- icon: the pixel robot (same as public/robot.svg) as a multi-size .ico ----------
const ROBOT = [
  [3, 0, 2, 1, "#C2552F"], [1, 1, 6, 3, "#C2552F"], [2, 4, 4, 1, "#C2552F"], [0, 5, 8, 1, "#C2552F"],
  [0, 6, 1, 1, "#C2552F"], [7, 6, 1, 1, "#C2552F"], [2, 6, 4, 2, "#9A4024"], [2, 8, 1, 2, "#9A4024"],
  [5, 8, 1, 2, "#9A4024"], [2, 2, 1, 1, "#161616"], [5, 2, 1, 1, "#161616"], [3, 3, 2, 1, "#7D3219"],
];

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Robot centered on a 10x10 grid (8 units wide), nearest-neighbour scaled to size x size.
function robotPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      const ux = Math.floor((px * 10) / size) - 1;
      const uy = Math.floor((py * 10) / size);
      let hex = null;
      for (const [x, y, w, h, c] of ROBOT) if (ux >= x && ux < x + w && uy >= y && uy < y + h) hex = c;
      if (!hex) continue;
      const i = py * (size * 4 + 1) + 1 + px * 4;
      raw[i] = parseInt(hex.slice(1, 3), 16);
      raw[i + 1] = parseInt(hex.slice(3, 5), 16);
      raw[i + 2] = parseInt(hex.slice(5, 7), 16);
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function robotIco(sizes) {
  const pngs = sizes.map(robotPng);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s >= 256 ? 0 : s;
    head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits per pixel
    head.writeUInt32LE(pngs[i].length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([head, ...pngs]);
}

// ---------- a running copy locks its files: close it first, start it again afterwards ----------
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const appEnv = () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // set inside VS Code; makes the exe behave like plain Node
  return env;
};
function isRunning() {
  try {
    return execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq Agentic OS.exe", "/NH"], { encoding: "utf8" }).includes("Agentic OS.exe");
  } catch {
    return false;
  }
}
function closeRunning() {
  if (!fs.existsSync(EXE) || !isRunning()) return false;
  console.log("Closing the running Agentic OS…");
  spawn(EXE, ["--quit"], { detached: true, stdio: "ignore", env: appEnv() }).unref();
  for (let i = 0; i < 40 && isRunning(); i++) sleep(500);
  if (isRunning()) {
    console.error("Agentic OS is still running; quit it from the tray and build again.");
    process.exit(1);
  }
  return true;
}

// ---------- build ----------
if (!fs.existsSync(path.join(ELECTRON, "electron.exe"))) {
  console.error("node_modules/electron/dist/electron.exe is missing — run npm install first.");
  process.exit(1);
}
const electronVersion = fs.readFileSync(path.join(ELECTRON, "version"), "utf8").trim();

console.log(`Building Agentic OS ${pkg.version} on Electron ${electronVersion}`);
const wasRunning = closeRunning();
fs.rmSync(OUT, { recursive: true, force: true });
copy(ELECTRON, OUT, (p) => {
  const rel = path.relative(ELECTRON, p);
  if (rel === path.join("resources", "default_app.asar")) return false;
  if (path.dirname(rel) === "locales") return KEEP_LOCALES.has(path.basename(rel));
  return true;
});
fs.renameSync(path.join(OUT, "electron.exe"), EXE);

const appDir = path.join(OUT, "resources", "app");
for (const f of APP_FILES) copy(path.join(ROOT, f), path.join(appDir, f));
const appPkg = { name: pkg.name, version: pkg.version, private: true, description: pkg.description, main: pkg.main };
fs.writeFileSync(path.join(appDir, "package.json"), JSON.stringify(appPkg, null, 2) + "\n");

const ico = path.join(ROOT, "dist", "icon.ico");
fs.writeFileSync(ico, robotIco([16, 24, 32, 48, 64, 128, 256]));
const rcedit = path.join(ROOT, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
if (fs.existsSync(rcedit)) {
  execFileSync(rcedit, [
    EXE,
    "--set-icon", ico,
    "--set-file-version", pkg.version,
    "--set-product-version", pkg.version,
    "--set-version-string", "ProductName", "Agentic OS",
    "--set-version-string", "FileDescription", "Agentic OS",
    "--set-version-string", "CompanyName", "Agentic OS",
    "--set-version-string", "OriginalFilename", "Agentic OS.exe",
    "--set-version-string", "InternalName", "Agentic OS",
  ]);
} else {
  console.log("rcedit not found (npm install): the exe keeps Electron's icon");
}

console.log(`Done: ${EXE}\nSize: ${(dirSize(OUT) / 1e6).toFixed(0)} MB`);
if (wasRunning && !process.argv.includes("--no-restart")) {
  spawn(EXE, ["--hidden"], { detached: true, stdio: "ignore", env: appEnv() }).unref();
  console.log("Started Agentic OS again (tray).");
}
