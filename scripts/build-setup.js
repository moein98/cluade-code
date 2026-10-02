// Builds the installer for other computers: Setup/Agentic OS Setup <version>.exe
//
//   npm run setup
//
// 1. scripts/build.js builds dist/Agentic OS/ (the app).
// 2. scripts/setup/Setup.cs is compiled without a payload into "Uninstall Agentic OS.exe" inside it.
// 3. The app folder is zipped and compiled into the installer as the "payload.zip" resource.
// Uses the C# compiler that ships with Windows (.NET Framework 4.x); nothing is downloaded.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const APP = path.join(ROOT, "dist", "Agentic OS");
const ZIP = path.join(ROOT, "dist", "payload.zip");
const OUT_DIR = path.join(ROOT, "Setup");
const OUT = path.join(OUT_DIR, `Agentic OS Setup ${pkg.version}.exe`);
const SRC = path.join(__dirname, "setup");
const CSC = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");

if (!fs.existsSync(CSC)) {
  console.error(`C# compiler not found: ${CSC} (.NET Framework 4.x)`);
  process.exit(1);
}

execFileSync(process.execPath, [path.join(__dirname, "build.js"), "--no-restart"], { stdio: "inherit" });

// Version info for both executables.
const versionFile = path.join(ROOT, "dist", "version.cs");
fs.writeFileSync(
  versionFile,
  `[assembly: System.Reflection.AssemblyVersion("${pkg.version}.0")]\n[assembly: System.Reflection.AssemblyFileVersion("${pkg.version}.0")]\n`
);

function csc(out, extra = []) {
  execFileSync(
    CSC,
    [
      "/nologo",
      "/optimize+",
      "/target:winexe",
      `/out:${out}`,
      `/win32icon:${path.join(ROOT, "dist", "icon.ico")}`,
      `/win32manifest:${path.join(SRC, "app.manifest")}`,
      "/r:System.IO.Compression.dll",
      "/r:System.IO.Compression.FileSystem.dll",
      "/r:Microsoft.CSharp.dll",
      "/r:System.Windows.Forms.dll",
      "/r:System.Drawing.dll",
      ...extra,
      path.join(SRC, "Setup.cs"),
      versionFile,
    ],
    { stdio: "inherit" }
  );
}

console.log("Compiling the uninstaller…");
csc(path.join(APP, "Uninstall Agentic OS.exe"));

console.log("Zipping the app…");
fs.rmSync(ZIP, { force: true });
const ps =
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
  `[System.IO.Compression.ZipFile]::CreateFromDirectory('${APP.replace(/'/g, "''")}', '${ZIP.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`;
execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "inherit" });

console.log("Compiling the installer…");
fs.mkdirSync(OUT_DIR, { recursive: true });
csc(OUT, [`/resource:${ZIP},payload.zip`]);
fs.rmSync(ZIP, { force: true });
console.log(`Done: ${OUT}\nSize: ${(fs.statSync(OUT).size / 1e6).toFixed(0)} MB`);
