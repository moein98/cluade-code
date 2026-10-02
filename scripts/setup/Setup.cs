// Agentic OS installer and uninstaller (C# 5 / .NET Framework 4.5, compiled by scripts/build-setup.js
// with the csc.exe that ships with Windows — no installer toolkit needed).
//
// Built with the app zip embedded as the "payload.zip" resource, it installs per user (no admin):
//   %LOCALAPPDATA%\Programs\Agentic OS      the app (or another folder: the form or /dir:)
//   %APPDATA%\Agentic OS                    config.json and data\ (kept on update and uninstall)
// plus Start Menu / Desktop shortcuts, start at login, the sample skills in the vault, the
// vault-search MCP server for Claude Code, and an entry in Windows "Apps".
// Built without the payload it is the uninstaller ("Uninstall Agentic OS.exe" in the app folder).
//
// Command line: /silent  /vault:"<folder>"  /dir:"<install folder>"
//               /nodesktop  /nologin  /noskills  /nomcp  /nolaunch
//               /uninstall  (with /silent: keeps settings and data)
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Agentic OS Setup")]
[assembly: AssemblyProduct("Agentic OS")]

static class Paths
{
    public const string AppName = "Agentic OS";
    public static readonly string DefaultInstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName);
    // The app folder: chosen in the form or with /dir:; an update keeps the previous one; the
    // uninstaller uses the folder it runs from.
    public static string InstallDir = DefaultInstallDir;
    public static string Exe { get { return Path.Combine(InstallDir, AppName + ".exe"); } }
    public static string AppCode { get { return Path.Combine(InstallDir, "resources", "app"); } }
    public static readonly string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName);
    public static readonly string Config = Path.Combine(Home, "config.json");
    public static readonly string StartMenuLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk");
    public static readonly string DesktopLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AgenticOS";
    public const string Uninstaller = "Uninstall Agentic OS.exe";
}

class Options
{
    public string Vault;
    public bool Desktop = true, Login = true, Skills = true, Mcp = true, Launch = true;
}

static class Installer
{
    public static string Version
    {
        get { var v = Assembly.GetExecutingAssembly().GetName().Version; return v.Major + "." + v.Minor + "." + v.Build; }
    }

    public static string PreviousInstallDir()
    {
        using (var k = Registry.CurrentUser.OpenSubKey(Paths.UninstallKey))
        {
            var v = k == null ? null : k.GetValue("InstallLocation") as string;
            return v != null && Directory.Exists(v) ? v : null;
        }
    }

    public static Stream Payload()
    {
        return Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip");
    }

    // Vault of an existing installation (config.json is kept on update).
    public static string ExistingVault()
    {
        if (!File.Exists(Paths.Config)) return null;
        var m = Regex.Match(File.ReadAllText(Paths.Config), "\"vault\"\\s*:\\s*\\{[^}]*?\"path\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
        return m.Success ? Regex.Unescape(m.Groups[1].Value) : null;
    }

    public static bool ClaudeAvailable()
    {
        return Run("where claude", 15000) == 0;
    }

    // cmd /s /c "<line>": the outer quotes are stripped, inner quotes stay.
    static int Run(string line, int timeoutMs)
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/d /s /c \"" + line + "\"");
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (var p = Process.Start(psi))
            {
                p.StandardOutput.ReadToEndAsync();
                p.StandardError.ReadToEndAsync();
                if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } return -1; }
                return p.ExitCode;
            }
        }
        catch { return -1; }
    }

    // Close every running Agentic OS (it holds the port and the single-instance lock).
    public static void CloseRunning()
    {
        var procs = Process.GetProcessesByName(Paths.AppName);
        if (procs.Length == 0) return;
        string exe = null;
        foreach (var p in procs)
        {
            try { exe = p.MainModule.FileName; break; } catch { }
        }
        if (exe != null)
        {
            try
            {
                var psi = new ProcessStartInfo(exe, "--quit");
                psi.UseShellExecute = false;
                psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                Process.Start(psi);
            }
            catch { }
        }
        for (int i = 0; i < 40 && Process.GetProcessesByName(Paths.AppName).Length > 0; i++) Thread.Sleep(500);
        foreach (var p in Process.GetProcessesByName(Paths.AppName))
        {
            try { p.Kill(); } catch { }
        }
        Thread.Sleep(800);
    }

    static string JsonString(string s)
    {
        return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }

    // config.json from the shipped example, with the chosen vault.
    static void WriteConfig(string vault)
    {
        Directory.CreateDirectory(Paths.Home);
        string text = File.ReadAllText(Path.Combine(Paths.AppCode, "config.example.json"), Encoding.UTF8);
        int start = text.IndexOf("\"vault\"");
        int end = text.IndexOf('}', start);
        string block = text.Substring(start, end - start);
        string name = Path.GetFileName(vault.TrimEnd('\\', '/'));
        block = Regex.Replace(block, "\"path\"\\s*:\\s*\"(?:[^\"\\\\]|\\\\.)*\"", m => "\"path\": " + JsonString(vault));
        block = Regex.Replace(block, "\"name\"\\s*:\\s*\"(?:[^\"\\\\]|\\\\.)*\"", m => "\"name\": " + JsonString(name));
        block = Regex.Replace(block, "\"label\"\\s*:\\s*\"(?:[^\"\\\\]|\\\\.)*\"", m => "\"label\": " + JsonString(name.ToUpperInvariant()));
        File.WriteAllText(Paths.Config, text.Substring(0, start) + block + text.Substring(end), new UTF8Encoding(false));
    }

    static void CopyDir(string src, string dst)
    {
        Directory.CreateDirectory(dst);
        foreach (var f in Directory.GetFiles(src)) File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), false);
        foreach (var d in Directory.GetDirectories(src)) CopyDir(d, Path.Combine(dst, Path.GetFileName(d)));
    }

    static void Shortcut(string link, string target)
    {
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        dynamic shell = Activator.CreateInstance(t);
        dynamic lnk = shell.CreateShortcut(link);
        lnk.TargetPath = target;
        lnk.WorkingDirectory = Path.GetDirectoryName(target);
        lnk.IconLocation = target + ",0";
        lnk.Description = "Agentic OS — Claude Code + Obsidian command center";
        lnk.Save();
    }

    static long DirSizeKb(string dir)
    {
        long n = 0;
        foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) n += new FileInfo(f).Length;
        return n / 1024;
    }

    // progress(percent, message); returns warnings (steps that were skipped or failed).
    public static List<string> Install(Options o, Action<int, string> progress)
    {
        var warnings = new List<string>();
        progress(2, "بستن نسخهٔ در حال اجرا…");
        CloseRunning();

        progress(5, "کپی فایل‌های برنامه…");
        if (Directory.Exists(Paths.InstallDir))
        {
            bool ours = File.Exists(Paths.Exe) || Directory.GetFileSystemEntries(Paths.InstallDir).Length == 0;
            if (!ours) throw new Exception("پوشهٔ نصب خالی نیست و Agentic OS هم در آن نیست: " + Paths.InstallDir);
            Directory.Delete(Paths.InstallDir, true);
        }
        Directory.CreateDirectory(Paths.InstallDir);
        using (var zip = new ZipArchive(Payload(), ZipArchiveMode.Read))
        {
            int i = 0, n = zip.Entries.Count;
            foreach (var e in zip.Entries)
            {
                string dest = Path.GetFullPath(Path.Combine(Paths.InstallDir, e.FullName));
                if (!dest.StartsWith(Paths.InstallDir, StringComparison.OrdinalIgnoreCase)) continue;
                if (e.Name.Length == 0) Directory.CreateDirectory(dest);
                else
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    e.ExtractToFile(dest, true);
                }
                if (++i % 20 == 0) progress(5 + 75 * i / n, "کپی فایل‌های برنامه… " + (100 * i / n) + "٪");
            }
        }
        progress(82, "تنظیمات…");
        if (!File.Exists(Paths.Config)) WriteConfig(o.Vault);

        if (o.Skills && !string.IsNullOrEmpty(o.Vault) && Directory.Exists(o.Vault))
        {
            progress(85, "کپی مهارت‌ها در vault…");
            string src = Path.Combine(Paths.AppCode, "skills");
            string dst = Path.Combine(o.Vault, ".claude", "skills");
            if (Directory.Exists(src))
            {
                foreach (var d in Directory.GetDirectories(src))
                {
                    string target = Path.Combine(dst, Path.GetFileName(d));
                    if (!Directory.Exists(target)) CopyDir(d, target);
                }
            }
        }

        progress(88, "میان‌برها…");
        try
        {
            Shortcut(Paths.StartMenuLink, Paths.Exe);
            if (o.Desktop) Shortcut(Paths.DesktopLink, Paths.Exe);
            else if (File.Exists(Paths.DesktopLink)) File.Delete(Paths.DesktopLink);
        }
        catch (Exception ex) { warnings.Add("میان‌بر: " + ex.Message); }

        using (var run = Registry.CurrentUser.CreateSubKey(Paths.RunKey))
        {
            if (o.Login) run.SetValue(Paths.AppName, "\"" + Paths.Exe + "\" --hidden");
            else if (run.GetValue(Paths.AppName) != null) run.DeleteValue(Paths.AppName);
        }

        if (o.Mcp)
        {
            progress(91, "ثبت جست‌وجوی vault در Claude Code…");
            string js = Path.Combine(Paths.AppCode, "mcp", "vault-search.js");
            Run("claude mcp remove vault-search --scope user", 60000);
            int code = Run("claude mcp add vault-search --scope user -e ELECTRON_RUN_AS_NODE=1 -- \"" + Paths.Exe + "\" \"" + js + "\"", 60000);
            if (code != 0) warnings.Add("ثبت MCP انجام نشد (Claude Code پیدا نشد یا خطا داد).");
        }

        progress(96, "ثبت در فهرست برنامه‌های ویندوز…");
        // The small uninstaller (this program built without the payload) ships inside the app zip.
        string uninstaller = Path.Combine(Paths.InstallDir, Paths.Uninstaller);
        using (var k = Registry.CurrentUser.CreateSubKey(Paths.UninstallKey))
        {
            k.SetValue("DisplayName", Paths.AppName);
            k.SetValue("DisplayVersion", Version);
            k.SetValue("Publisher", Paths.AppName);
            k.SetValue("DisplayIcon", Paths.Exe + ",0");
            k.SetValue("InstallLocation", Paths.InstallDir);
            k.SetValue("UninstallString", "\"" + uninstaller + "\" /uninstall");
            k.SetValue("QuietUninstallString", "\"" + uninstaller + "\" /uninstall /silent");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)DirSizeKb(Paths.InstallDir), RegistryValueKind.DWord);
        }

        if (o.Launch)
        {
            progress(99, "اجرای برنامه…");
            var psi = new ProcessStartInfo(Paths.Exe);
            psi.UseShellExecute = false;
            psi.WorkingDirectory = Paths.InstallDir;
            psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(psi);
        }
        progress(100, "نصب کامل شد.");
        return warnings;
    }

    public static void Uninstall(bool removeData)
    {
        CloseRunning();
        try { if (File.Exists(Paths.StartMenuLink)) File.Delete(Paths.StartMenuLink); } catch { }
        try { if (File.Exists(Paths.DesktopLink)) File.Delete(Paths.DesktopLink); } catch { }
        using (var run = Registry.CurrentUser.OpenSubKey(Paths.RunKey, true))
        {
            var v = run == null ? null : run.GetValue(Paths.AppName) as string;
            if (v != null && v.IndexOf(Paths.InstallDir, StringComparison.OrdinalIgnoreCase) >= 0) run.DeleteValue(Paths.AppName);
        }
        Run("claude mcp remove vault-search --scope user", 60000);
        try { Registry.CurrentUser.DeleteSubKeyTree(Paths.UninstallKey, false); } catch { }
        if (removeData && Directory.Exists(Paths.Home)) { try { Directory.Delete(Paths.Home, true); } catch { } }
        // Never remove a folder that isn't an Agentic OS installation.
        if (!File.Exists(Paths.Exe)) return;
        // This uninstaller runs from the app folder: a detached cmd removes the folder after it exits.
        var psi = new ProcessStartInfo("cmd.exe", "/d /c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"" + Paths.InstallDir + "\"");
        psi.CreateNoWindow = true;
        psi.UseShellExecute = false;
        psi.WorkingDirectory = Path.GetTempPath();
        Process.Start(psi);
    }
}

class SetupForm : Form
{
    TextBox vault, dir;
    Button browse, browseDir, install, cancel;
    CheckBox desktop, login, skills, mcp, launch;
    ProgressBar bar;
    Label status;
    readonly string existingVault = Installer.ExistingVault();

    public SetupForm()
    {
        Text = "نصب Agentic OS " + Installer.Version;
        Font = new Font("Segoe UI", 9.5f);
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(560, 480);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        AutoScaleMode = AutoScaleMode.Font;

        int y = 16;
        Add(new Label { Text = "Agentic OS", Font = new Font("Segoe UI Semibold", 16f), AutoSize = true, Location = new Point(20, y) });
        y += 40;
        Add(new Label { Text = "داشبورد محلی برای Claude Code و vault ابسیدین: مصرف، مهارت‌ها، زمان‌بندی، جست‌وجو.", AutoSize = true, Location = new Point(20, y) });
        y += 26;
        Add(new Label { Text = "پیش‌نیاز: Claude Code نصب و لاگین‌شده، و یک vault ابسیدین.", AutoSize = true, ForeColor = Color.DimGray, Location = new Point(20, y) });
        y += 36;

        Add(new Label { Text = "پوشهٔ vault ابسیدین:", AutoSize = true, Location = new Point(20, y) });
        y += 24;
        vault = new TextBox { Location = new Point(20, y), Width = 410, RightToLeft = RightToLeft.No };
        browse = new Button { Text = "انتخاب…", Location = new Point(440, y - 1), Width = 100 };
        browse.Click += delegate
        {
            using (var d = new FolderBrowserDialog { Description = "پوشهٔ vault ابسیدین را انتخاب کنید" })
            {
                if (d.ShowDialog(this) == DialogResult.OK) vault.Text = d.SelectedPath;
            }
        };
        Add(vault);
        Add(browse);
        y += 30;
        if (existingVault != null)
        {
            vault.Text = existingVault;
            vault.Enabled = false;
            browse.Enabled = false;
            Add(new Label { Text = "نسخهٔ قبلی پیدا شد؛ تنظیمات و داده‌ها حفظ می‌شوند.", AutoSize = true, ForeColor = Color.SeaGreen, Location = new Point(20, y) });
        }
        y += 30;

        bool claude = Installer.ClaudeAvailable();
        desktop = Check("میان‌بر روی دسکتاپ", true, ref y);
        login = Check("اجرا هنگام ورود به ویندوز (فقط در tray)", true, ref y);
        skills = Check("کپی مهارت‌های نمونه در vault (فقط آن‌هایی که نیستند)", existingVault == null, ref y);
        mcp = Check("ثبت جست‌وجوی vault در Claude Code (MCP)" + (claude ? "" : " — Claude Code پیدا نشد"), claude, ref y);
        launch = Check("اجرای برنامه بعد از نصب", true, ref y);
        y += 8;
        Add(new Label { Text = "محل نصب برنامه:", AutoSize = true, Location = new Point(20, y) });
        y += 24;
        dir = new TextBox { Location = new Point(20, y), Width = 410, RightToLeft = RightToLeft.No, Text = Paths.InstallDir };
        browseDir = new Button { Text = "انتخاب…", Location = new Point(440, y - 1), Width = 100 };
        browseDir.Click += delegate
        {
            using (var d = new FolderBrowserDialog { Description = "پوشه‌ای که Agentic OS در آن نصب شود (یک زیرپوشهٔ Agentic OS ساخته می‌شود)" })
            {
                if (d.ShowDialog(this) == DialogResult.OK) dir.Text = Path.Combine(d.SelectedPath, Paths.AppName);
            }
        };
        Add(dir);
        Add(browseDir);
        y += 36;
        bar = new ProgressBar { Location = new Point(20, y), Width = 520, Height = 16 };
        Add(bar);
        y += 22;
        status = new Label { AutoSize = true, Location = new Point(20, y) };
        Add(status);

        install = new Button { Text = existingVault != null ? "به‌روزرسانی" : "نصب", Location = new Point(330, 434), Width = 100, Height = 30 };
        cancel = new Button { Text = "انصراف", Location = new Point(440, 434), Width = 100, Height = 30 };
        install.Click += delegate { Start(); };
        cancel.Click += delegate { Close(); };
        Add(install);
        Add(cancel);
        AcceptButton = install;
        CancelButton = cancel;
    }

    void Add(Control c) { Controls.Add(c); }

    CheckBox Check(string text, bool on, ref int y)
    {
        var c = new CheckBox { Text = text, Checked = on, AutoSize = true, Location = new Point(20, y) };
        Add(c);
        y += 26;
        return c;
    }

    void Start()
    {
        string v = vault.Text.Trim();
        if (existingVault == null && (v.Length == 0 || !Directory.Exists(v)))
        {
            MessageBox.Show(this, "پوشهٔ vault را انتخاب کنید.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button1, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign);
            return;
        }
        Paths.InstallDir = Path.GetFullPath(dir.Text.Trim());
        var o = new Options { Vault = v, Desktop = desktop.Checked, Login = login.Checked, Skills = skills.Checked, Mcp = mcp.Checked, Launch = launch.Checked };
        foreach (Control c in Controls) if (c is Button || c is CheckBox || c is TextBox) c.Enabled = false;
        new Thread(() =>
        {
            try
            {
                var warnings = Installer.Install(o, (p, m) => BeginInvoke((Action)(() => { bar.Value = Math.Min(100, p); status.Text = m; })));
                BeginInvoke((Action)(() =>
                {
                    string msg = "Agentic OS نصب شد." + (warnings.Count > 0 ? "\n\n" + string.Join("\n", warnings) : "");
                    MessageBox.Show(this, msg, Text, MessageBoxButtons.OK, MessageBoxIcon.Information, MessageBoxDefaultButton.Button1, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign);
                    Close();
                }));
            }
            catch (Exception ex)
            {
                BeginInvoke((Action)(() =>
                {
                    MessageBox.Show(this, "نصب انجام نشد:\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error, MessageBoxDefaultButton.Button1, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign);
                    cancel.Enabled = true;
                }));
            }
        }) { IsBackground = true }.Start();
    }
}

static class Program
{
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    static bool Has(string[] args, string name)
    {
        foreach (var a in args) if (string.Equals(a, name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    static string Value(string[] args, string name)
    {
        foreach (var a in args)
            if (a.StartsWith(name + ":", StringComparison.OrdinalIgnoreCase)) return a.Substring(name.Length + 1).Trim('"');
        return null;
    }

    const MessageBoxOptions Rtl = MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign;

    [STAThread]
    static int Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        bool silent = Has(args, "/silent");
        bool uninstall = Has(args, "/uninstall") || Installer.Payload() == null;
        Paths.InstallDir = Installer.PreviousInstallDir() ?? Paths.DefaultInstallDir;

        if (uninstall)
        {
            if (Installer.Payload() == null) Paths.InstallDir = Application.StartupPath;
            bool removeData = false;
            if (!silent)
            {
                if (MessageBox.Show("Agentic OS حذف شود؟", "حذف Agentic OS", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2, Rtl) != DialogResult.Yes) return 1;
                removeData = MessageBox.Show("تنظیمات و داده‌ها (" + Paths.Home + ") هم پاک شوند؟\nاگر «خیر» بزنید، برای نصب بعدی می‌مانند.", "حذف Agentic OS", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2, Rtl) == DialogResult.Yes;
            }
            Installer.Uninstall(removeData);
            if (!silent) MessageBox.Show("Agentic OS حذف شد.", "حذف Agentic OS", MessageBoxButtons.OK, MessageBoxIcon.Information, MessageBoxDefaultButton.Button1, Rtl);
            return 0;
        }

        if (Value(args, "/dir") != null) Paths.InstallDir = Path.GetFullPath(Value(args, "/dir"));
        if (silent)
        {
            var o = new Options
            {
                Vault = Value(args, "/vault") ?? Installer.ExistingVault(),
                Desktop = !Has(args, "/nodesktop"),
                Login = !Has(args, "/nologin"),
                Skills = !Has(args, "/noskills"),
                Mcp = !Has(args, "/nomcp") && Installer.ClaudeAvailable(),
                Launch = !Has(args, "/nolaunch"),
            };
            if (Installer.ExistingVault() == null && (o.Vault == null || !Directory.Exists(o.Vault))) return 2;
            try
            {
                var w = Installer.Install(o, (p, m) => { });
                foreach (var line in w) Console.Error.WriteLine(line);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 3;
            }
        }

        Application.Run(new SetupForm());
        return 0;
    }
}
