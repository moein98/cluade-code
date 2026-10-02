// Screenshots an HTML page with a headless Chromium (Edge or Chrome, already on the machine) and
// cuts it into Telegram-sized pages. Pages are cut only on rows that are plain background, so a
// card or a line of text is never split. No dependencies: PNG decoding and encoding use zlib.
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

const CANDIDATES = [
  process.env.CARD_BROWSER,
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

let browser;
function findBrowser() {
  if (browser === undefined) browser = CANDIDATES.find((p) => p && fs.existsSync(p)) || null;
  return browser;
}

// ---------- PNG ----------
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// Decodes 8-bit RGB/RGBA, non-interlaced (what Chromium writes) into RGBA rows.
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const name = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (type !== 2 && type !== 6)) throw new Error("unsupported PNG");
    } else if (name === "IDAT") idat.push(data);
    else if (name === "IEND") break;
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = 0;
      if (f === 1) v = a;
      else if (f === 2) v = b;
      else if (f === 3) v = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + v) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      px[o] = line[x * bpp];
      px[o + 1] = line[x * bpp + 1];
      px[o + 2] = line[x * bpp + 2];
      px[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px };
}

// Encodes rows [y0, y1) as an opaque RGB PNG (Telegram photos have no transparency anyway).
// Pages shorter than minH get rows of their last background colour added (Telegram needs a
// photo no wider than about 20:1, and short strips look odd).
function encodePng(img, y0, y1, minH = 0) {
  const { width, px } = img;
  const h = Math.max(y1 - y0, minH);
  const raw = Buffer.alloc((width * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (width * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < width; x++) {
      const s = (Math.min(y0 + y, y1 - 1) * width + (y0 + y < y1 ? x : 2)) * 4;
      raw[o + 1 + x * 3] = px[s];
      raw[o + 2 + x * 3] = px[s + 1];
      raw[o + 3 + x * 3] = px[s + 2];
    }
  }
  const chunk = (name, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(name, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- page cutting ----------
// Last row that has any opaque pixel: the page ends there (the window below it is transparent).
function contentBottom(img) {
  const { width, height, px } = img;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x += 2) if (px[(y * width + x) * 4 + 3] > 0) return y + 1;
  }
  return 0;
}

// A row is a safe cut when every pixel has the colour of the page background (taken at x=2) or
// of the mind-map branches (#9E9E9E, templates.js), which run down through the whole page.
const BRANCH = [158, 158, 158];
function plainRows(img, bottom) {
  const { width, px } = img;
  const plain = new Uint8Array(bottom);
  const near = (o, c) => Math.abs(px[o] - c[0]) < 3 && Math.abs(px[o + 1] - c[1]) < 3 && Math.abs(px[o + 2] - c[2]) < 3;
  for (let y = 0; y < bottom; y++) {
    const r = y * width * 4;
    const bg = [px[r + 8], px[r + 9], px[r + 10]];
    let ok = true;
    for (let x = 2; x < width - 2 && ok; x++) {
      const o = r + x * 4;
      ok = near(o, bg) || near(o, BRANCH);
    }
    plain[y] = ok ? 1 : 0;
  }
  return plain;
}

// Splits [0, bottom) into pages of at most maxH rows, cutting in the middle of the gap between
// blocks that is closest to the page limit. A short remainder stays on the page before it
// (Telegram rejects very wide, short photos).
function cutPages(img, bottom, maxH) {
  if (bottom <= maxH * 1.25) return [[0, bottom]];
  const plain = plainRows(img, bottom);
  const pages = [];
  let start = 0;
  while (bottom - start > maxH * 1.25) {
    let cut = 0;
    for (let y = start + maxH - 1; y > start + maxH * 0.45; y--) {
      if (!plain[y]) continue;
      let top = y;
      while (top > start && plain[top - 1]) top--;
      cut = Math.round((top + y) / 2);
      if (y - top >= 6) break; // a real gap, not a thin line between two text rows
    }
    if (!cut) cut = start + maxH;
    pages.push([start, cut]);
    start = cut;
  }
  pages.push([start, bottom]);
  return pages;
}

// ---------- browser ----------
// One browser profile, reused: a fresh profile costs a first-run setup on every shot (several
// seconds on some disks). Renders are queued, so it is never shared. It lives in the app's cache
// folder (AGENTIC_OS_CACHE, set by server.js beside config.json and data/), else in temp.
const profileDir = () => path.join(process.env.AGENTIC_OS_CACHE || os.tmpdir(), "card-profile");

let queue = Promise.resolve();
function capture(file, out, width, height, scale) {
  const exe = findBrowser();
  if (!exe) return Promise.reject(new Error("no Edge or Chrome found for rendering cards"));
  const PROFILE = profileDir();
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--hide-scrollbars",
    "--mute-audio",
    `--user-data-dir=${PROFILE}`,
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    "--default-background-color=00000000",
    "--virtual-time-budget=4000",
    `--screenshot=${out}`,
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "file:///" + file.replace(/\\/g, "/"),
  ];
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => p.kill(), 45e3);
    p.on("error", reject);
    p.on("close", () => {
      clearTimeout(timer);
      fs.existsSync(out) ? resolve() : reject(new Error("browser did not write a screenshot"));
    });
  });
}

// Renders html at `width` CSS pixels and returns PNG buffers, each at most maxH device pixels
// tall. The window starts at a guessed height and doubles while the page does not fit in it.
async function shoot(html, { width = 720, scale = 2, maxH = 2500, guess = 2200 } = {}) {
  const run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-shot-"));
    try {
      const file = path.join(dir, "card.html");
      fs.writeFileSync(file, html, "utf8");
      let height = guess;
      for (;;) {
        const out = path.join(dir, `shot-${height}.png`);
        await capture(file, out, width, height, scale);
        const img = decodePng(fs.readFileSync(out));
        const bottom = contentBottom(img);
        if (!bottom) throw new Error("empty screenshot");
        if (bottom >= img.height - 2 && height < 16000) {
          height *= 2;
          continue;
        }
        return cutPages(img, bottom, maxH).map(([a, b]) => encodePng(img, a, b, Math.round(img.width / 3)));
      }
    } finally {
      fs.rm(dir, { recursive: true, force: true }, () => {});
    }
  };
  // One browser at a time: renders are queued.
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}

module.exports = { shoot, findBrowser };
