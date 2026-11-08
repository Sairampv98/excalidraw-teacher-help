// What the installer does, and what the uninstaller undoes. No window in here: the wizard, the silent
// mode and the self test all call it, and it reports through two callbacks.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using Microsoft.Win32;

namespace ExcalidrawClassroom
{
    internal sealed class Component
    {
        public string Id;
        public string Title;
        public string Detail;
        public string Role;
        public bool Required;
        public bool Checked;
        public long Bytes;
    }

    internal sealed class InstallOptions
    {
        public string Dir = Product.DefaultDir();
        public HashSet<string> Components = new HashSet<string>();
        public bool DesktopShortcut = true;
        public bool StartMenuShortcut = true;
        public string KeepFolder;   // the online setup: also keep what it downloads here, to install elsewhere with no internet
    }

    internal static class Components
    {
        /// <summary>The choices the wizard offers, made from what the setup carries.</summary>
        public static List<Component> All(List<PayloadFile> files)
        {
            Dictionary<string, PayloadFile> byRole = new Dictionary<string, PayloadFile>();
            foreach (PayloadFile f in files)
            {
                if (!string.IsNullOrEmpty(f.Role) && !byRole.ContainsKey(f.Role)) byRole[f.Role] = f;
            }

            List<Component> list = new List<Component>();
            Add(list, byRole, "app", "app", "The classroom board",
                "The app itself, with its short videos. Works with no internet.", true, true);
            // Windows 7 has no browser that can run the board: its setup carries one (Chromium 109, the last for Windows 7)
            Add(list, byRole, "browser", "browser", "Chromium (the browser for the board)",
                "The last browser that runs on Windows 7. Only the board uses it; your own browser is not changed.", true, true);
            AddUpdates(list, files);
            Add(list, byRole, "editor", "vscode", "VS Code (the editor)",
                Edition.Student
                    ? "Installed for you alone, with no administrator."
                    : "Installed for you alone, with no administrator. The connection to the board is added to it.", false, true);
            Add(list, byRole, "python", "python", "Python",
                "Installed for you alone. For the lessons in Python.", false, true);
            Add(list, byRole, "java", "java", "Java (Temurin)",
                "Unpacked for you alone, with JAVA_HOME set. For the lessons in Java.", false, true);
            Add(list, byRole, "gcc", "gcc", "C and C++ (GCC)",
                "A compiler, unpacked for you alone. For the lessons in C and C++.", false, true);
            Add(list, byRole, "node", "node", "Node.js",
                
#if NET35
                "Unpacked for you alone. For JavaScript (the assistant of the board needs a newer Windows than 7).", false, true);
#else
                "Unpacked for you alone. For JavaScript and the assistant's server.", false, true);
#endif
            Add(list, byRole, "ocr", "indra-models", "Better text reading (Indra OCR)",
                "Reads the words in a picture or a PDF faster and better than the built-in reader. Needs the editor and Python.", false, false);

            // the extension travels with the editor: it is not a choice of its own
            return list;
        }

        /// <summary>Windows 7 without the universal C runtime cannot run Python 3.8: its setup carries the updates that bring it.</summary>
        public static bool UcrtPresent()
        {
            return File.Exists(Path.Combine(Environment.SystemDirectory, "ucrtbase.dll"));
        }

        /// <summary>The update files for this Windows (32 or 64 bit), in the order they are to go in.</summary>
        public static List<PayloadFile> UpdatesFor(List<PayloadFile> files)
        {
            string arch = Supported.Is64() ? "x64" : "x86";
            List<PayloadFile> list = new List<PayloadFile>();
            foreach (PayloadFile f in files) if (f.Role == "update" && f.Arch == arch) list.Add(f);
            return list;
        }

        private static void AddUpdates(List<Component> list, List<PayloadFile> files)
        {
            if (UcrtPresent()) return;
            List<PayloadFile> updates = UpdatesFor(files);
            if (updates.Count == 0) return;
            Component c = new Component();
            c.Id = "updates";
            c.Role = "update";
            c.Title = "Windows updates (the C runtime that Python needs)";
            c.Detail = "Asks for an administrator, and Windows must be restarted after it. Python goes in when you run the setup again.";
            c.Required = false;
            c.Checked = true;
            foreach (PayloadFile f in updates) c.Bytes += f.Size;
            list.Add(c);
        }

        private static void Add(List<Component> list, Dictionary<string, PayloadFile> byRole, string id, string role,
            string title, string detail, bool required, bool isChecked)
        {
            PayloadFile file;
            if (!byRole.TryGetValue(role, out file)) return;
            Component c = new Component();
            c.Id = id;
            c.Role = role;
            c.Title = title;
            c.Detail = detail;
            c.Required = required;
            c.Checked = isChecked;
            c.Bytes = file.Size;
            if (id == "editor" && !Edition.Student)
            {
                PayloadFile ext;
                if (byRole.TryGetValue("extension", out ext)) c.Bytes += ext.Size;
            }
            if (id == "ocr")
            {
                PayloadFile wheels;
                if (byRole.TryGetValue("indra-wheels", out wheels)) c.Bytes += wheels.Size;
            }
            list.Add(c);
        }
    }

    internal sealed class Engine
    {
        public Action<string> Log = delegate { };

        /// <summary>The tools that could not be put in (the rest still were): the exit code and the last page say so.</summary>
        public List<string> NotInstalled = new List<string>();

        /// <summary>A Windows update was put in: Windows must be restarted before the rest can finish.</summary>
        public bool RestartNeeded;

        private List<PayloadFile> allFiles = new List<PayloadFile>();

        private void InstallUpdates(string temp)
        {
            Step("Installing the Windows updates (this asks for an administrator, and takes a few minutes)");
            foreach (PayloadFile update in Components.UpdatesFor(allFiles))
            {
                string path = Payload.Extract(update, temp, delegate (long n) { Advance(n); });
                Log("  " + update.Version + ": " + update.Name);
                int code = Run.Program("wusa.exe", "\"" + path + "\" /quiet /norestart", delegate (string line) { Log("  " + line); }, 40 * 60 * 1000);
                // 0 done; 3010 done and Windows must restart; 2359302 (0x240006) it is there already
                if (code != 0 && code != 3010 && code != 2359302) throw new IOException("the update " + update.Version + " ended with code " + code);
                if (code != 2359302) RestartNeeded = true;
            }
            if (RestartNeeded) Log("! Restart Windows, then run this setup again: Python goes in after the restart.");
        }
        /// <summary>fraction 0..1 of the whole, and the words for what is being done now</summary>
        public Action<double, string> Progress = delegate { };

        private long totalBytes;
        private long doneBytes;

        private void Step(string words)
        {
            Progress(totalBytes > 0 ? Math.Min(1.0, (double)doneBytes / totalBytes) : 0, words);
            Log(words);
        }

        private void Advance(long bytes)
        {
            doneBytes += bytes;
            Progress(totalBytes > 0 ? Math.Min(1.0, (double)doneBytes / totalBytes) : 0, null);
        }

        // ------------------------------------------------------------------------------------------ plan

        public static List<string> DescribePlan(InstallOptions options, List<Component> all)
        {
            List<string> lines = new List<string>();
            lines.Add("Install to: " + options.Dir);
            long bytes = 0;
            foreach (Component c in all)
            {
                if (!options.Components.Contains(c.Id)) continue;
                lines.Add("  " + c.Title + "  (" + Files.Size(c.Bytes) + ")");
                bytes += c.Bytes;
            }
            lines.Add("");
            if (Payload.Online) lines.Add("About " + Files.Size(bytes) + " is downloaded from the internet first.");
            if (!string.IsNullOrEmpty(options.KeepFolder)) lines.Add("The downloaded files are kept in " + options.KeepFolder + ".");
            lines.Add("About " + Files.Size(bytes * 2) + " of disk space is used while it installs.");
            if (options.DesktopShortcut) lines.Add("A shortcut on the desktop.");
            if (options.StartMenuShortcut) lines.Add("A shortcut in the Start menu, with an uninstaller.");
            lines.Add("Nothing needs administrator rights, and nothing is changed for other users.");
            return lines;
        }

        public static long FreeSpace(string dir)
        {
            try
            {
                string root = Path.GetPathRoot(Path.GetFullPath(dir));
                return new DriveInfo(root).AvailableFreeSpace;
            }
            catch { return long.MaxValue; }
        }

        // ------------------------------------------------------------------------------------------ install

        public InstallRecord Install(InstallOptions options, string pythonTargetOverride)
        {
            Downloader.KeepFolder = options.KeepFolder;
            Downloader.Log = Log;
            List<PayloadFile> files = Payload.Files();
            allFiles = files;
            List<Component> all = Components.All(files);
            Dictionary<string, PayloadFile> byRole = new Dictionary<string, PayloadFile>();
            foreach (PayloadFile f in files) if (!string.IsNullOrEmpty(f.Role)) byRole[f.Role] = f;

            // what is to be done, in bytes, so the bar moves with the work
            totalBytes = 0;
            doneBytes = 0;
            foreach (Component c in all) if (options.Components.Contains(c.Id)) totalBytes += c.Bytes * 2;
            totalBytes += 5 * 1024 * 1024;

            string dir = Path.GetFullPath(options.Dir);
            if (Engine.FreeSpace(dir) < totalBytes)
            {
                throw new IOException("There is not enough room on that disk: about " + Files.Size(totalBytes) + " is needed.");
            }

            InstallRecord record = File.Exists(Path.Combine(dir, Product.RecordFile))
                ? InstallRecord.Load(dir) : new InstallRecord();
            record.Dir = dir;
            record.Version = Product.Version();
            Directory.CreateDirectory(dir);

            string temp = Path.Combine(Path.GetTempPath(), "ExcalidrawClassroomSetup");
            Directory.CreateDirectory(temp);
            UserEnvironment env = UserEnvironment.Real();

            try
            {
                // 1. the program files
                Step("Putting the program in place");
                bool hasLauncher = Payload.HasResource("launcher.exe");
                if (hasLauncher) Payload.ExtractResource("launcher.exe", Path.Combine(dir, Product.LauncherExe));
                Payload.ExtractResource("uninstall.exe", Path.Combine(dir, Product.UninstallExe));
                Advance(1024 * 1024);
                record.Save();

                // 2. the app
                PayloadFile app;
                if (byRole.TryGetValue("app", out app) && options.Components.Contains("app"))
                {
                    Step("Unpacking the board");
                    string appZip = Payload.Extract(app, temp, delegate (long n) { Advance(n); });
                    string appDir = Path.Combine(dir, "app");
                    Files.DeleteFolder(appDir);
                    Files.ExtractZip(appZip, appDir, null);
                    Advance(app.Size);
                    AddComponent(record, "app");
                }
                record.Save();

                // 3. the tools, one by one: a tool that fails does not stop the others
                foreach (Component c in all)
                {
                    if (c.Id == "app" || !options.Components.Contains(c.Id)) continue;
                    try
                    {
                        InstallTool(c, byRole, temp, dir, record, env, pythonTargetOverride);
                        AddComponent(record, c.Id);
                    }
                    catch (Exception e)
                    {
                        Log("! " + c.Title + " could not be installed: " + e.Message);
                        NotInstalled.Add(c.Title);
                    }
                    record.Save();
                }

                // 4. the shortcuts and the uninstaller entry
                Step("Making the shortcuts");
                string launcher = Path.Combine(dir, Product.LauncherExe);
                bool hasBoard = File.Exists(launcher);
                if (options.DesktopShortcut && hasBoard)
                {
                    string lnk = Path.Combine(Shortcuts.Desktop(), Product.Name + ".lnk");
                    Shortcuts.Create(lnk, launcher, "", dir, launcher + ",0", "Draw, teach and run code");
                    if (!record.Shortcuts.Contains(lnk)) record.Shortcuts.Add(lnk);
                }
                if (options.StartMenuShortcut)
                {
                    string menu = Shortcuts.StartMenu();
                    string lnk = Path.Combine(menu, Product.Name + ".lnk");
                    string unlnk = Path.Combine(menu, "Uninstall " + Product.Name + ".lnk");
                    if (hasBoard)
                    {
                        Shortcuts.Create(lnk, launcher, "", dir, launcher + ",0", "Draw, teach and run code");
                        if (!record.Shortcuts.Contains(lnk)) record.Shortcuts.Add(lnk);
                    }
                    Shortcuts.Create(unlnk, Path.Combine(dir, Product.UninstallExe), "", dir, "", "Remove " + Product.Name);
                    if (!record.Shortcuts.Contains(unlnk)) record.Shortcuts.Add(unlnk);
                }
                RegisterUninstall(dir, record);
                UserEnvironment.Broadcast();
                record.Save();
                Progress(1.0, "Done");
                Log("Done.");
                return record;
            }
            catch
            {
                Log("The install stopped; what was put in place is being taken out again.");
                try { Uninstall(dir, true); } catch { }
                throw;
            }
            finally
            {
                try { Files.DeleteFolder(temp); } catch { }
            }
        }

        private static void AddComponent(InstallRecord record, string id)
        {
            if (!record.Components.Contains(id)) record.Components.Add(id);
        }

        private void InstallTool(Component c, Dictionary<string, PayloadFile> byRole, string temp, string dir,
            InstallRecord record, UserEnvironment env, string pythonTargetOverride)
        {
            if (c.Id == "updates") { InstallUpdates(temp); return; }
            PayloadFile file = byRole[c.Role];
            Step("Installing " + c.Title);
            if (c.Id == "python" && File.Exists(Path.Combine(Environment.SystemDirectory, "kernel32.dll")) && Environment.OSVersion.Version.Major == 6 && Environment.OSVersion.Version.Minor < 2 && !Components.UcrtPresent())
            {
                // Windows 7 without the C runtime: Python 3.8 would refuse (and say so); the updates come first, then a restart
                throw new IOException("Python needs the Windows update for the C runtime. Install the Windows updates (and restart Windows), then run the setup again.");
            }
            string path = Payload.Extract(file, temp, delegate (long n) { Advance(n); });

            if (c.Id == "browser")
            {
                string target = Files.Join(dir, "tools", "chromium");
                Files.DeleteFolder(target);
                Files.ExtractZip(path, target, null);
            }
            else if (c.Id == "java")
            {
                string target = Files.Join(dir, "tools", "jdk");
                Files.DeleteFolder(target);
                Files.ExtractZip(path, target, null);
                env.SetVariable("JAVA_HOME", target);
                if (!record.Variables.Contains("JAVA_HOME")) record.Variables.Add("JAVA_HOME");
                AddPath(record, env, Path.Combine(target, "bin"));
            }
            else if (c.Id == "node")
            {
                string target = Files.Join(dir, "tools", "node");
                Files.DeleteFolder(target);
                Files.ExtractZip(path, target, null);
                AddPath(record, env, target);
            }
            else if (c.Id == "gcc")
            {
                string target = GccTarget(dir);
                if (!string.Equals(target, Files.Join(dir, "tools", "mingw64"), StringComparison.OrdinalIgnoreCase))
                {
                    Log("  the install folder has a space in its path, which the C compiler cannot work from: it goes to " + target);
                    string top = Path.GetDirectoryName(target);
                    if (!record.ExtraFolders.Contains(top)) record.ExtraFolders.Add(top);
                }
                Files.DeleteFolder(target);
                Files.ExtractZip(path, target, null);
                AddPath(record, env, Path.Combine(target, "bin"));
            }
            else if (c.Id == "python")
            {
                string target = pythonTargetOverride ?? Files.Join(dir, "tools", "python");
                string keep = Files.Join(dir, "tools", "installers");
                Directory.CreateDirectory(keep);
                string installer = Path.Combine(keep, file.Name);
                File.Copy(path, installer, true);
                // for this user alone: InstallAllUsers=0 asks for no administrator; it puts Python on this user's PATH
                int code = Run.Program(installer,
                    "/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=0 Include_test=0 Include_doc=0 Include_pip=1 TargetDir=\"" + target + "\"",
                    delegate (string line) { Log("  " + line); }, 20 * 60 * 1000);
                if (code != 0) throw new IOException("the Python installer ended with code " + code);
                record.Uninstallers.Add(installer + "|/uninstall /quiet");
            }
            else if (c.Id == "ocr")
            {
                // the models: a folder the reader is told of by an environment variable, so it downloads nothing
                string models = Files.Join(dir, "tools", "indra-models");
                Files.DeleteFolder(models);
                Files.ExtractZip(path, models, null);
                env.SetVariable("INDRA_OCR_MODEL_DIR", models);
                if (!record.Variables.Contains("INDRA_OCR_MODEL_DIR")) record.Variables.Add("INDRA_OCR_MODEL_DIR");

                // the wheels: into the extension's own folder, where it looks for them (it installs from them, with no index)
                PayloadFile wheels;
                if (byRole.TryGetValue("indra-wheels", out wheels))
                {
                    string wheelsZip = Payload.Extract(wheels, temp, delegate (long n) { Advance(n); });
                    string extensionDir = FindExtensionDir();
                    if (extensionDir == null)
                    {
                        Log("! the editor's connection to the board is not installed, so the reader's libraries have nowhere to go; install the editor too");
                    }
                    else
                    {
                        Files.ExtractZip(wheelsZip, Path.Combine(extensionDir, "wheels"), null);
                        Log("  the reader's libraries are in " + Path.Combine(extensionDir, "wheels"));
                    }
                    Advance(wheels.Size);
                }
            }
            else if (c.Id == "editor")
            {
                string code = EditorCli();
                if (code == null)
                {
                    int exit = Run.Program(path, "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /MERGETASKS=!runcode,addcontextmenufiles,addcontextmenufolders,addtopath",
                        delegate (string line) { Log("  " + line); }, 20 * 60 * 1000);
                    if (exit != 0) throw new IOException("the editor's installer ended with code " + exit);
                    // for this user alone (the setup of the Windows 10/11 tools), or for the computer (the Windows 7 one, a system setup)
                    string[] homes = new string[]
                    {
                        Files.Join(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Microsoft VS Code"),
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft VS Code"),
                        Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", "Microsoft VS Code"),
                    };
                    foreach (string home in homes)
                    {
                        string unins = Path.Combine(home, "unins000.exe");
                        if (File.Exists(unins)) { record.Uninstallers.Add(unins + "|/VERYSILENT /NORESTART"); break; }
                    }
                    code = EditorCli();
                }
                PayloadFile ext;
                if (code != null && !Edition.Student && byRole.TryGetValue("extension", out ext))
                {
                    Step("Adding the connection to the board to the editor");
                    string vsix = Payload.Extract(ext, temp, delegate (long n) { Advance(n); });
                    int exit = Run.Program("cmd.exe", "/c \"\"" + code + "\" --install-extension \"" + vsix + "\" --force\"",
                        delegate (string line) { Log("  " + line); }, 5 * 60 * 1000);
                    if (exit != 0) Log("! the connection could not be added to the editor (code " + exit + ")");
                }
            }
            Advance(file.Size);
        }

        /// <summary>The folder the editor made for the board's extension, or null.</summary>
        public static string FindExtensionDir()
        {
            string root = Environment.GetEnvironmentVariable("CLASSROOM_SETUP_EXTENSIONS_DIR");
            if (string.IsNullOrEmpty(root))
            {
                root = Files.Join(Environment.GetEnvironmentVariable("USERPROFILE"), ".vscode", "extensions");
            }
            if (!Directory.Exists(root)) return null;
            string[] found = Directory.GetDirectories(root, "*excalidraw-bridge*");
            return found.Length == 0 ? null : found[found.Length - 1];
        }

        /// <summary>
        /// Where the C compiler goes. GCC cannot compile from a path that has a space in it (its linker cuts the path at the
        /// space), and a person's name may be in the install path, so then it goes to a folder of its own on the system drive.
        /// </summary>
        public static string GccTarget(string dir)
        {
            string inside = Files.Join(dir, "tools", "mingw64");
            if (inside.IndexOf(' ') < 0) return inside;
            string root = (Environment.GetEnvironmentVariable("SystemDrive") ?? "C:") + Path.DirectorySeparatorChar;
            return Files.Join(root, "ClassroomTools", Product.DirName, "mingw64");
        }

        private static void AddPath(InstallRecord record, UserEnvironment env, string folder)
        {
            if (env.AddToPath(folder) && !record.PathEntries.Contains(folder)) record.PathEntries.Add(folder);
        }

        /// <summary>The command line of an editor that is already there, or null.</summary>
        public static string EditorCli()
        {
            // a test names a stand-in for the editor's command, so a real editor is never touched
            string overridden = Environment.GetEnvironmentVariable("CLASSROOM_SETUP_CODE_CLI");
            if (!string.IsNullOrEmpty(overridden)) return File.Exists(overridden) ? overridden : null;

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candidates = new string[]
            {
                Files.Join(local, "Programs", "Microsoft VS Code", "bin", "code.cmd"),
                Files.Join(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft VS Code", "bin", "code.cmd"),
                Files.Join(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? "", "Microsoft VS Code", "bin", "code.cmd"),
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        private static void RegisterUninstall(string dir, InstallRecord record)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Product.UninstallKey))
            {
                string uninstall = Path.Combine(dir, Product.UninstallExe);
                key.SetValue("DisplayName", Product.Name);
                key.SetValue("DisplayVersion", Product.Version());
                key.SetValue("Publisher", "Excalidraw Classroom");
                key.SetValue("InstallLocation", dir);
                key.SetValue("DisplayIcon", Path.Combine(dir, Product.LauncherExe) + ",0");
                key.SetValue("UninstallString", "\"" + uninstall + "\"");
                key.SetValue("QuietUninstallString", "\"" + uninstall + "\" /silent");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        // ------------------------------------------------------------------------------------------ uninstall

        /// <summary>Takes out exactly what the record says was put in. Returns the notes it made.</summary>
        public List<string> Uninstall(string dir, bool keepRunningProgram)
        {
            List<string> notes = new List<string>();
            InstallRecord record = InstallRecord.Load(dir);
            UserEnvironment env = UserEnvironment.Real();

            // the launcher may be running: it is asked to quit first (a file in use cannot be deleted)
            StopLauncher(dir);
            StopProgramsUnder(dir);

            foreach (string u in record.Uninstallers)
            {
                int bar = u.IndexOf('|');
                string exe = bar < 0 ? u : u.Substring(0, bar);
                string args = bar < 0 ? "" : u.Substring(bar + 1);
                if (!File.Exists(exe)) continue;
                Log("Removing with " + Path.GetFileName(exe));
                int code = Run.Program(exe, args, null, 10 * 60 * 1000);
                notes.Add(Path.GetFileName(exe) + " ended with code " + code);
            }
            foreach (string p in record.PathEntries) env.RemoveFromPath(p);
            // what a tool's own installer put on the PATH from our folder (Python adds its Scripts folder): not left behind
            env.RemoveFromPathUnder(dir);
            foreach (string v in record.Variables) env.RemoveVariable(v);
            foreach (string extra in record.ExtraFolders)
            {
                try
                {
                    Files.DeleteFolder(extra);
                    string parent = Path.GetDirectoryName(extra);
                    if (Directory.Exists(parent) && Directory.GetFileSystemEntries(parent).Length == 0) Directory.Delete(parent);
                }
                catch { }
            }
            UserEnvironment.Broadcast();

            foreach (string lnk in record.Shortcuts)
            {
                try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
            }
            try
            {
                string menu = Shortcuts.StartMenu();
                if (Directory.Exists(menu) && Directory.GetFileSystemEntries(menu).Length == 0) Directory.Delete(menu);
            }
            catch { }

            try { Files.DeleteKeyTree(Registry.CurrentUser, Product.UninstallKey); } catch { }

            // the folder: everything but the uninstaller that is running now; that one goes after it has ended
            if (Directory.Exists(dir))
            {
                string self = Path.Combine(dir, Product.UninstallExe);
                foreach (string entry in Directory.GetFileSystemEntries(dir))
                {
                    if (keepRunningProgram && string.Equals(entry, self, StringComparison.OrdinalIgnoreCase)) continue;
                    try
                    {
                        if (Directory.Exists(entry)) Files.DeleteFolder(entry); else { File.SetAttributes(entry, FileAttributes.Normal); File.Delete(entry); }
                    }
                    catch (Exception e) { notes.Add("could not remove " + entry + ": " + e.Message); }
                }
                if (!keepRunningProgram) { try { Directory.Delete(dir); } catch { } }
            }
            return notes;
        }

        /// <summary>
        /// Programs running from the install folder (the browser the board is in, a tool left open) would keep their files
        /// from being deleted: they are ended first. This program itself is left alone.
        /// </summary>
        public static void StopProgramsUnder(string dir)
        {
            string prefix = dir.TrimEnd('\\') + "\\";
            int self = Process.GetCurrentProcess().Id;
            foreach (Process p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == self) continue;
                    string where = p.MainModule.FileName;
                    if (where.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(4000);
                    }
                }
                catch { }
            }
        }

        public static void StopLauncher(string dir)
        {
            string exe = Path.Combine(dir, Product.LauncherExe);
            foreach (Process p in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Product.LauncherExe)))
            {
                try
                {
                    string where = p.MainModule.FileName;
                    if (string.Equals(where, exe, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(4000);
                    }
                }
                catch { }
            }
        }

        /// <summary>After the uninstaller has ended, its own file and the folder go: a small script waits for it.</summary>
        public static void RemoveSelfLater(string dir)
        {
            // the uninstaller may still be on the screen (its last message waits for a click), so the file cannot go at once:
            // try again every second, for up to ten minutes, until it is gone; then the folder
            string exe = Path.Combine(dir, Product.UninstallExe);
            string script = "/c for /l %i in (1,1,600) do @if exist \"" + exe + "\" (del /f /q \"" + exe + "\" 2>nul & ping 127.0.0.1 -n 2 >nul)" + " & rmdir \"" + dir + "\"";
            ProcessStartInfo info = new ProcessStartInfo("cmd.exe", script);
            info.CreateNoWindow = true;
            info.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.System); // not the folder that is to go: a folder in use cannot be removed
            info.UseShellExecute = false;
            Process.Start(info);
        }

        /// <summary>Where it was installed, from the entry in the uninstall list, or null.</summary>
        public static string InstalledDir()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(Product.UninstallKey))
            {
                return key == null ? null : key.GetValue("InstallLocation") as string;
            }
        }
    }
}
