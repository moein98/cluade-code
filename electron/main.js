// Agentic OS desktop app: dashboard window, floating widget, tray menu and run notifications.
// Runs the dashboard server in-process (or attaches to one that is already running).
// Kept light: windows are destroyed (not hidden) when closed, the tray reads state in-process
// only when its menu opens or once a minute for the tooltip, and run notifications come from a
// server hook instead of polling.
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, ipcMain, shell, nativeTheme, dialog, screen } =
  require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const server = require("../server");

const PREFS_FILE = path.join(server.home, "data", "desktop.json");
const WIDGET_WIDTH = 340;

let prefs = { widgetVisible: true, widgetPos: null };
try {
  prefs = { ...prefs, ...JSON.parse(fs.readFileSync(PREFS_FILE, "utf8")) };
} catch {}
const savePrefs = () => {
  fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true });
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 1));
};

let baseUrl;
let mainWin = null;
let widgetWin = null;
let tray = null;
let quitting = false;
let lastState = null;
let inProcess = false; // this process runs the server (else it attached to another instance)
const seenStatus = new Map(); // run id -> status, to notify on RUNNING -> done (attached mode)

// Same pixel robot as public/robot.svg, drawn into a BGRA bitmap (tray icons can't be SVG).
function robotIcon(scale) {
  const rects = [
    [3, 0, 2, 1, "#C2552F"], [1, 1, 6, 3, "#C2552F"], [2, 4, 4, 1, "#C2552F"], [0, 5, 8, 1, "#C2552F"],
    [0, 6, 1, 1, "#C2552F"], [7, 6, 1, 1, "#C2552F"], [2, 6, 4, 2, "#9A4024"], [2, 8, 1, 2, "#9A4024"],
    [5, 8, 1, 2, "#9A4024"], [2, 2, 1, 1, "#161616"], [5, 2, 1, 1, "#161616"], [3, 3, 2, 1, "#7D3219"],
  ];
  const size = 10 * scale;
  const offX = Math.floor((size - 8 * scale) / 2);
  const buf = Buffer.alloc(size * size * 4);
  for (const [x, y, w, h, hex] of rects) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let py = y * scale; py < (y + h) * scale; py++) {
      for (let px = offX + x * scale; px < offX + (x + w) * scale; px++) {
        const i = (py * size + px) * 4;
        buf[i] = b;
        buf[i + 1] = g;
        buf[i + 2] = r;
        buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: path.join(__dirname, "preload.js"),
};

// Keep every window on the dashboard origin; other http(s) links open in the default browser.
function lockNavigation(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === baseUrl || url.startsWith(baseUrl + "/")) showMain();
    else if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(baseUrl)) e.preventDefault();
  });
}

function showMain() {
  if (!mainWin) {
    mainWin = new BrowserWindow({
      width: 1560,
      height: 1000,
      minWidth: 900,
      minHeight: 600,
      title: "Agentic OS",
      icon: robotIcon(6),
      backgroundColor: "#0e0e0e",
      autoHideMenuBar: true,
      show: false,
      webPreferences,
    });
    lockNavigation(mainWin);
    mainWin.loadURL(baseUrl);
    mainWin.once("ready-to-show", () => mainWin.show());
    // Closing frees the window's memory; the app, scheduler and tray keep running.
    mainWin.on("closed", () => (mainWin = null));
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function widgetPosition() {
  const p = prefs.widgetPos;
  if (p) {
    const d = screen.getDisplayMatching({ x: p.x, y: p.y, width: WIDGET_WIDTH, height: 100 });
    const a = d.workArea;
    if (p.x >= a.x - 20 && p.x <= a.x + a.width - 60 && p.y >= a.y - 20 && p.y <= a.y + a.height - 60) return p;
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - WIDGET_WIDTH - 24, y: a.y + 24 };
}

function createWidget() {
  const pos = widgetPosition();
  widgetWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: WIDGET_WIDTH,
    height: 560,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: "Agentic OS Widget",
    webPreferences,
  });
  lockNavigation(widgetWin);
  widgetWin.loadURL(`${baseUrl}/widget`);
  widgetWin.once("ready-to-show", () => {
    if (prefs.widgetVisible) widgetWin.showInactive();
  });
  widgetWin.on("moved", () => {
    const [x, y] = widgetWin.getPosition();
    prefs.widgetPos = { x, y };
    savePrefs();
  });
  widgetWin.on("closed", () => (widgetWin = null));
}

// Showing creates the widget window; hiding destroys it so it uses no memory while off.
function toggleWidget(force) {
  const show = typeof force === "boolean" ? force : !widgetWin;
  if (show && !widgetWin) {
    prefs.widgetVisible = true;
    createWidget();
  } else if (!show && widgetWin) {
    widgetWin.destroy();
    widgetWin = null;
  }
  prefs.widgetVisible = show;
  savePrefs();
}

ipcMain.on("widget:resize", (e, height) => {
  if (!widgetWin || e.sender !== widgetWin.webContents) return;
  const h = Math.round(Number(height));
  if (Number.isFinite(h) && h >= 80 && h <= 1400) widgetWin.setContentSize(WIDGET_WIDTH, h);
});
ipcMain.on("widget:hide", (e) => {
  if (widgetWin && e.sender === widgetWin.webContents) toggleWidget(false);
});
ipcMain.on("app:open-dashboard", () => showMain());

async function api(pathname, body) {
  const opts = body
    ? { method: "POST", headers: { "Content-Type": "application/json", "X-Agentic-OS": "1" }, body: JSON.stringify(body) }
    : { cache: "no-store" };
  const r = await fetch(baseUrl + pathname, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { code: j.code });
  return j;
}

// Tray, dialog and notification strings; the language follows the dashboard setting.
const STR = {
  en: {
    open: "Open dashboard", widget: "Widget", runSkill: "Run skill", running: "running",
    login: "Start at login", quit: "Quit Agentic OS", run: "Run", cancel: "Cancel",
    confirm: "Run {label}?", detail: "{model} · headless claude -p in the vault. This uses plan usage.",
    complete: "complete", failed: "failed", tokensOut: "tokens out", offline: "dashboard offline",
    week: "Week", runs: "Runs", inbox: "Inbox",
    quota: "Quota guard", runAnyway: "Run anyway", remote: "Remote Control (phone)",
  },
  fa: {
    open: "باز کردن داشبورد", widget: "ویجت", runSkill: "اجرای مهارت", running: "در حال اجرا",
    login: "اجرا هنگام ورود به ویندوز", quit: "خروج از Agentic OS", run: "اجرا", cancel: "انصراف",
    confirm: "«{label}» اجرا شود؟", detail: "{model} · اجرای پس‌زمینه با claude -p در مخزن. از سهمیهٔ پلن مصرف می‌کند.",
    complete: "انجام شد", failed: "ناموفق", tokensOut: "توکن خروجی", offline: "داشبورد در دسترس نیست",
    week: "هفته", runs: "اجرا", inbox: "صندوق",
    quota: "محافظ سهمیه", runAnyway: "باز هم اجرا کن", remote: "کنترل از گوشی (Remote Control)",
  },
};
function L(key, vars) {
  const lang = (lastState && lastState.meta && lastState.meta.language) || "en";
  let s = (STR[lang] || STR.en)[key] || STR.en[key];
  for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, v);
  return s;
}
const skillLabel = (k) => {
  const lang = lastState && lastState.meta && lastState.meta.language;
  return (k.labels && k.labels[lang]) || k.label;
};

const modelName = (id) => {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id || "");
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? "." + m[3] : ""}` : "default model";
};
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(n || 0));

async function runSkill(skill) {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: [L("run"), L("cancel")],
    defaultId: 0,
    cancelId: 1,
    title: "Agentic OS",
    message: L("confirm", { label: skillLabel(skill) }),
    detail: L("detail", { model: modelName(skill.model) }),
  });
  if (response !== 0) return;
  try {
    try {
      await api(`/api/run/${skill.name}`, {});
    } catch (e) {
      if (e.code !== "QUOTA") throw e;
      const again = await dialog.showMessageBox({
        type: "warning",
        buttons: [L("runAnyway"), L("cancel")],
        defaultId: 1,
        cancelId: 1,
        title: "Agentic OS",
        message: L("quota"),
        detail: e.message,
      });
      if (again.response !== 0) return;
      await api(`/api/run/${skill.name}`, { force: true });
    }
    poll();
  } catch (e) {
    dialog.showErrorBox("Agentic OS", e.message);
  }
}

// Current state: straight from the in-process server, else over HTTP.
async function readState() {
  try {
    lastState = inProcess ? server.state() : await api("/api/state");
  } catch {
    lastState = null;
  }
  return lastState;
}

// The menu is built fresh each time it opens, so it never needs polling to stay current.
async function showTrayMenu() {
  await readState();
  updateTooltip();
  const s = lastState;
  const skills = (s && s.skills) || [];
  const login = loginEnabled();
  tray.popUpContextMenu(
    Menu.buildFromTemplate([
      { label: L("open"), click: showMain },
      { label: L("widget"), type: "checkbox", checked: !!widgetWin, click: () => toggleWidget() },
      { label: L("remote"), click: () => api("/api/open/remote", {}).catch((e) => dialog.showErrorBox("Agentic OS", e.message)) },
      { type: "separator" },
      {
        label: L("runSkill"),
        enabled: skills.length > 0,
        submenu: skills.map((k) => ({
          label: `${skillLabel(k)}   ${modelName(k.model)}${k.running ? `   · ${L("running")}` : ""}`,
          enabled: !k.running,
          click: () => runSkill(k),
        })),
      },
      { type: "separator" },
      {
        label: L("login"),
        type: "checkbox",
        checked: login,
        click: (item) => setLogin(item.checked),
      },
      { type: "separator" },
      {
        label: L("quit"),
        click: () => app.quit(),
      },
    ])
  );
}

function updateTooltip() {
  if (!tray) return;
  const s = lastState;
  if (s) {
    const share = (x) => (x.pct != null ? `${Math.round(x.pct)}%` : `${fmtTok(x.used)} / ${fmtTok(x.limit)}`);
    const inboxText = s.inbox && s.inbox.count ? ` · ${L("inbox")} ${s.inbox.count}` : "";
    tray.setToolTip(`Agentic OS\n5H ${share(s.fiveHour)} · ${L("week")} ${share(s.weekly)} · ${L("runs")} ${s.routines.runsToday}${inboxText}`);
  } else {
    tray.setToolTip(`Agentic OS — ${L("offline")}`);
  }
}

// At login, start in the tray (widget only). In development the app runs as `electron <dir>`,
// so the login item must also pass the app path.
function loginOptions() {
  return app.isPackaged
    ? { name: "Agentic OS", path: process.execPath, args: ["--hidden"] }
    : { name: "Agentic OS", path: process.execPath, args: [app.getAppPath(), "--hidden"] };
}
const loginEnabled = () => app.getLoginItemSettings(loginOptions()).openAtLogin;
const setLogin = (on) => app.setLoginItemSettings({ ...loginOptions(), openAtLogin: on });

// The exe takes over an "Agentic OS" login entry that points at the development launcher
// (electron.exe in node_modules) or at an exe that no longer exists; a working one is left alone.
function migrateLoginItem() {
  if (!app.isPackaged || loginEnabled()) return;
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  execFile("reg.exe", ["query", key, "/v", "Agentic OS"], { windowsHide: true }, (err, out) => {
    const m = /Agentic OS\s+REG_SZ\s+"([^"]+)"/i.exec(String(out || ""));
    if (err || !m) return;
    if (/[\\/]node_modules[\\/]electron[\\/]/i.test(m[1]) || !fs.existsSync(m[1])) {
      setLogin(true);
      console.log("Start at login now launches this exe");
    }
  });
}

// Installed copy (the installer put its uninstaller next to the exe): keep the Start Menu shortcut
// carrying the app id — Windows shows an unpackaged app's notifications only through it.
function ensureStartMenuShortcut() {
  if (!app.isPackaged || !fs.existsSync(path.join(path.dirname(process.execPath), "Uninstall Agentic OS.exe"))) return;
  const lnk = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Agentic OS.lnk");
  try {
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? "update" : "create", {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      appUserModelId: "Agentic OS",
      description: "Agentic OS — Claude Code + Obsidian command center",
      icon: process.execPath,
      iconIndex: 0,
    });
  } catch {}
}

// `--set-login=on|off` toggles start-at-login from the command line (also via a second instance).
function applyLoginFlag(argv) {
  const flag = argv.find((a) => a.startsWith("--set-login="));
  if (!flag) return false;
  setLogin(flag === "--set-login=on");
  return true;
}

function notifyFinished(run) {
  if (!Notification.isSupported()) return;
  const ok = run.status === "COMPLETE";
  const skill = (lastState && lastState.skills.find((k) => k.name === run.skill)) || run;
  const n = new Notification({
    title: `${skillLabel(skill)} · ${ok ? L("complete") : L("failed")}`,
    body: ok
      ? `$${(run.cost ?? 0).toFixed(4)} · ${modelName(run.model)} · ${run.output ?? 0} ${L("tokensOut")}`
      : run.error || L("failed"),
    icon: robotIcon(6),
    silent: ok,
  });
  if (run.note) n.on("click", () => api("/api/open/note", { file: run.note }).catch(() => {}));
  n.show();
}

// Tooltip once a minute. Attached to another server instance, this is also how finished runs
// are noticed (no hook across processes), so it checks more often while one is running.
async function poll() {
  await readState();
  if (!inProcess && lastState) {
    for (const r of lastState.recentRuns) {
      const before = seenStatus.get(r.id);
      if (before === "RUNNING" && r.status !== "RUNNING") notifyFinished(r);
      seenStatus.set(r.id, r.status);
    }
  }
  updateTooltip();
  const busy = !inProcess && lastState && lastState.recentRuns.some((r) => r.status === "RUNNING");
  clearTimeout(poll.timer);
  poll.timer = setTimeout(poll, busy ? 5000 : 60e3);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch shows the dashboard; `--quit` closes the running app (e.g. before a rebuild).
  app.on("second-instance", (_e, argv) => {
    if (argv.includes("--quit")) app.quit();
    else if (!applyLoginFlag(argv)) showMain();
  });
  app.on("window-all-closed", (e) => e.preventDefault()); // stay in the tray
  // Quit: stop the Ollama this app started (unless another program uses it), then exit.
  app.on("before-quit", (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    Promise.race([server.stop(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
  });

  app.whenReady().then(async () => {
    if (process.argv.includes("--quit")) return app.quit(); // nothing was running
    nativeTheme.themeSource = "dark";
    app.setAppUserModelId("Agentic OS"); // needed for Windows notifications
    const started = await server.start({
      hooks: {
        toggleWidget: () => toggleWidget(),
        onRunFinished: (run) => {
          notifyFinished(run);
          readState().then(updateTooltip);
        },
      },
    });
    baseUrl = started.url;
    inProcess = !started.alreadyRunning;
    if (!inProcess) console.log("Attached to the dashboard server that is already running.");

    tray = new Tray(robotIcon(3));
    tray.on("click", showMain);
    tray.on("right-click", () => showTrayMenu());
    if (prefs.widgetVisible) createWidget();
    migrateLoginItem();
    ensureStartMenuShortcut();
    const loginFlag = applyLoginFlag(process.argv);
    if (!process.argv.includes("--hidden") && !loginFlag) showMain();
    poll();
  });
}
