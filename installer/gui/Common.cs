// The shared parts of the installer, the uninstaller and the launcher.
// C# 5 (the compiler that ships with Windows): no string interpolation, no `?.`.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace ExcalidrawClassroom
{
    /// <summary>
    /// Which setup this is. The classroom setup carries the board and the tools. The student setup carries the
    /// tools alone (VS Code, Python, Java, C and C++, Node.js): the one a teacher passes to students so that
    /// their computers are ready for the class. The setup says which it is by a resource, edition.json.
    /// </summary>
    internal static class Edition
    {
        private static readonly string id = Read();

        private static string Read()
        {
            string text = Payload.ReadText("edition.json");
            if (text == null) return "classroom";
            string value = Json.Text(Json.Parse(text), "edition");
            return value.Length == 0 ? "classroom" : value;
        }

        public static string Id { get { return id; } }

        public static bool Student { get { return id == "student"; } }
    }

    // Which Windows this setup is made for: 64-bit Windows 10 (build 17763, version 1809) or newer, and Windows 11.
    // The tools it carries are 64-bit and ask for a Windows 10 of that age or later. The lowest build is a careful
    // choice, not a measured one: the builds below 19041 have not been tried.
    internal static class Supported
    {
        public const int LowestBuild = 17763;

        public static bool Is64()
        {
#if NET35
            return IntPtr.Size == 8 || Environment.GetEnvironmentVariable("PROCESSOR_ARCHITEW6432") != null;
#else
            return Environment.Is64BitOperatingSystem;
#endif
        }

        public static int Build()
        {
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
            {
                int build;
                object v = key == null ? null : key.GetValue("CurrentBuildNumber");
                return v != null && int.TryParse(v.ToString(), out build) ? build : 0;
            }
        }

        // null when this computer is one the setup is made for, else what to tell the person
        public static string Problem(bool is64, int build)
        {
#if NET35
            // the Windows 7 setup: Windows 7 with Service Pack 1 (build 7601), 32 or 64 bit (its tools are 32-bit, which run on both)
            if (build > 0 && build < 7600)
            {
                return "This setup is for Windows 7 with Service Pack 1. This Windows is older (build " + build + ").";
            }
            if (build > 0 && build < 7601)
            {
                return "This Windows 7 has no Service Pack 1 (build 7600), and the tools need it. Install Service Pack 1 (Windows Update, or the file from Microsoft), then run the setup again.";
            }
            if (build >= 10240)
            {
                return "This setup is for Windows 7. For Windows 10 and 11 use the other setup from the same download page.";
            }
            return null;
#else
            if (!is64)
            {
                return "This setup needs 64-bit Windows. The tools it carries (Java, Node, Python, the C compiler) are 64-bit only, and this computer runs 32-bit Windows.";
            }
            if (build > 0 && build < 10240)
            {
                return "This setup is for Windows 10 and 11. For Windows 7, 8 or 8.1 use the Windows 7 setup from the same download page.";
            }
            if (build > 0 && build < LowestBuild)
            {
                return "This Windows 10 is too old (build " + build + "). The setup needs Windows 10 version 1809 (build " + LowestBuild + ") or newer: update Windows first.";
            }
            return null;
#endif
        }

        public static bool HasModernBrowser()
        {
            string[] roots = { Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("LOCALAPPDATA") };
            string[] files = { @"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe", @"Mozilla Firefox\firefox.exe", @"BraveSoftware\Brave-Browser\Application\brave.exe" };
            foreach (string r in roots)
            {
                if (string.IsNullOrEmpty(r)) continue;
                foreach (string f in files) if (File.Exists(Path.Combine(r, f))) return true;
            }
            return false;
        }
    }

    internal static class Product
    {
        public static readonly string Name = Edition.Student ? "Class Tools" : "Excalidraw Classroom";
        public static readonly string Folder = Edition.Student ? "Class Tools" : "Excalidraw Classroom";
        public const string LauncherExe = "ExcalidrawClassroom.exe";
        public const string UninstallExe = "Uninstall.exe";
        public const string RecordFile = "install.json";
        public static readonly string UninstallKey = Edition.Student
            ? @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ClassTools"
            : @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ExcalidrawClassroom";

        /// <summary>The address the app is always served from: the same origin every time, so what is drawn is kept.</summary>
        public const int Port = 47750;

        /// <summary>The folder's name with no space in it: the C compiler cannot work from a path that has one.</summary>
        public static readonly string DirName = Edition.Student ? "ClassTools" : "ExcalidrawClassroom";

        public static string DefaultDir()
        {
            return Files.Join(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", DirName);
        }

        public static string Version()
        {
            Version v = Assembly.GetExecutingAssembly().GetName().Version;
            return v.Major + "." + v.Minor + "." + v.Build;
        }
    }

    // ---------------------------------------------------------------------------------- json

    internal static class Json
    {
        private static JavaScriptSerializer Serializer()
        {
            JavaScriptSerializer s = new JavaScriptSerializer();
            s.MaxJsonLength = int.MaxValue;
            return s;
        }

        public static Dictionary<string, object> Parse(string text)
        {
            return Serializer().DeserializeObject(text) as Dictionary<string, object>;
        }

        public static string Write(object value)
        {
            return Serializer().Serialize(value);
        }

        public static string Text(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v != null ? v.ToString() : "";
        }

        public static long Number(Dictionary<string, object> d, string key)
        {
            long n;
            return long.TryParse(Text(d, key), out n) ? n : 0;
        }

        public static object[] List(Dictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v is object[]) return (object[])v;
            if (d != null && d.TryGetValue(key, out v) && v is System.Collections.ArrayList)
            {
                return ((System.Collections.ArrayList)v).ToArray();
            }
            return new object[0];
        }
    }

    // ---------------------------------------------------------------------------------- the user's environment

    /// <summary>The PATH and the variables of the user alone (HKCU\Environment): no administrator is needed.</summary>
    internal sealed class UserEnvironment
    {
        private readonly string subKey;

        public UserEnvironment(string subKey)
        {
            this.subKey = subKey;
        }

        public static UserEnvironment Real()
        {
            return new UserEnvironment("Environment");
        }

        private static string Normal(string folder)
        {
            return folder.Trim().TrimEnd('\\', '/').ToLowerInvariant();
        }

        public string GetPath()
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(subKey))
            {
                return (key.GetValue("Path", "", RegistryValueOptions.DoNotExpandEnvironmentNames) as string) ?? "";
            }
        }

        private void SetPath(string value)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(subKey))
            {
                key.SetValue("Path", value, RegistryValueKind.ExpandString);
            }
        }

        /// <summary>Takes out every PATH entry that is the folder or inside it (a tool's own installer may have added some).</summary>
        public int RemoveFromPathUnder(string folder)
        {
            string whole = Normal(folder);
            string inside = whole + "\\";
            List<string> kept = new List<string>();
            int removed = 0;
            foreach (string part in GetPath().Split(';'))
            {
                string n = Normal(part);
                if (part.Trim().Length > 0 && (n == whole || (n + "\\").StartsWith(inside, StringComparison.Ordinal))) { removed++; continue; }
                kept.Add(part);
            }
            if (removed > 0) SetPath(string.Join(";", kept.ToArray()));
            return removed;
        }

        public bool AddToPath(string folder)
        {
            string current = GetPath();
            foreach (string part in current.Split(';'))
            {
                if (part.Trim().Length > 0 && Normal(part) == Normal(folder)) return false;
            }
            // a PATH that ends with ";" keeps ending with it, so taking the folder out again gives back the very same text
            string joined = current.Length == 0 ? folder : current.EndsWith(";") ? current + folder + ";" : current + ";" + folder;
            SetPath(joined);
            return true;
        }

        public bool RemoveFromPath(string folder)
        {
            List<string> kept = new List<string>();
            bool removed = false;
            foreach (string part in GetPath().Split(';'))
            {
                // the other parts stay as they were, an empty one too: only our folder goes
                if (part.Trim().Length > 0 && Normal(part) == Normal(folder)) { removed = true; continue; }
                kept.Add(part);
            }
            if (removed) SetPath(string.Join(";", kept.ToArray()));
            return removed;
        }

        public string GetVariable(string name)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(subKey))
            {
                return key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
            }
        }

        public void SetVariable(string name, string value)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(subKey))
            {
                key.SetValue(name, value, RegistryValueKind.String);
            }
        }

        public void RemoveVariable(string name)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(subKey))
            {
                key.DeleteValue(name, false);
            }
        }

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam,
            uint flags, uint timeout, out UIntPtr result);

        /// <summary>Tells the open programs that the environment changed, so a new terminal sees it.</summary>
        public static void Broadcast()
        {
            try
            {
                UIntPtr result;
                SendMessageTimeout(new IntPtr(0xffff), 0x001A, UIntPtr.Zero, "Environment", 0x2, 3000, out result);
            }
            catch { }
        }
    }

    // ---------------------------------------------------------------------------------- shortcuts

    internal static class Shortcuts
    {
        public static void Create(string lnkPath, string target, string arguments, string workDir, string icon, string description)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(lnkPath));
            Type shell = Type.GetTypeFromProgID("WScript.Shell");
            object sh = Activator.CreateInstance(shell);
            object lnk = shell.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnkPath });
            Type t = lnk.GetType();
            t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
            t.InvokeMember("Arguments", BindingFlags.SetProperty, null, lnk, new object[] { arguments ?? "" });
            t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workDir ?? "" });
            t.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { description ?? "" });
            if (!string.IsNullOrEmpty(icon))
            {
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { icon });
            }
            t.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
        }

        public static string Desktop()
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        }

        public static string StartMenu()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Product.Folder);
        }
    }

    // ---------------------------------------------------------------------------------- files

    internal static class Files
    {
        /// <summary>Path.Combine for any number of parts (the .NET 3.5 one takes two).</summary>
        public static string Join(params string[] parts)
        {
            string path = parts[0];
            for (int i = 1; i < parts.Length; i++) path = Path.Combine(path, parts[i]);
            return path;
        }

        /// <summary>RegistryKey.DeleteSubKeyTree(name, false) (.NET 4) for .NET 3.5: no error when the key is not there.</summary>
        public static void DeleteKeyTree(RegistryKey parent, string name)
        {
            try { parent.DeleteSubKeyTree(name); } catch (ArgumentException) { }
        }

        /// <summary>Stream.CopyTo (.NET 4) for .NET 3.5.</summary>
        public static void CopyStream(Stream from, Stream to)
        {
            byte[] buffer = new byte[256 * 1024];
            int n;
            while ((n = from.Read(buffer, 0, buffer.Length)) > 0) to.Write(buffer, 0, n);
        }

        public static string Sha256(string path)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream stream = File.OpenRead(path))
            {
                return Hex(sha.ComputeHash(stream));
            }
        }

        public static string Hex(byte[] bytes)
        {
            StringBuilder b = new StringBuilder(bytes.Length * 2);
            foreach (byte x in bytes) b.Append(x.ToString("x2"));
            return b.ToString();
        }

        /// <summary>Is `child` inside `folder`? Used so an archive cannot write outside the folder it is unpacked into.</summary>
        public static bool IsInside(string folder, string child)
        {
            string a = Path.GetFullPath(folder).TrimEnd('\\') + "\\";
            string b = Path.GetFullPath(child);
            return b.StartsWith(a, StringComparison.OrdinalIgnoreCase);
        }

#if NET35
        /// <summary>
        /// Unpacks a zip into a folder (the .NET 3.5 build, for Windows 7: ZipLite reads the zip). When every entry is
        /// under one top folder, that folder is dropped.
        /// </summary>
        public static int ExtractZip(string zipPath, string target, Action<string> onFile)
        {
            int count = 0;
            Directory.CreateDirectory(target);
            using (FileStream zip = new FileStream(zipPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                List<ZipEntryInfo> entries = ZipLite.Entries(zip);
                foreach (ZipEntryInfo entry in entries)
                {
                    foreach (string segment in entry.Name.Replace('\\', '/').Split('/'))
                    {
                        if (segment == "..") throw new InvalidDataException("an entry of the archive points outside its folder: " + entry.Name);
                    }
                }
                string top = null;
                bool one = true;
                foreach (ZipEntryInfo entry in entries)
                {
                    string n = entry.Name.Replace('/', '\\');
                    int slash = n.IndexOf('\\');
                    if (slash < 0) { one = false; break; }
                    string first = n.Substring(0, slash);
                    if (top == null) top = first;
                    else if (!string.Equals(top, first, StringComparison.OrdinalIgnoreCase)) { one = false; break; }
                }
                if (!one || top == null) top = "";
                foreach (ZipEntryInfo entry in entries)
                {
                    string name = entry.Name.Replace('/', '\\');
                    if (top.Length > 0)
                    {
                        if (!name.StartsWith(top + "\\", StringComparison.OrdinalIgnoreCase)) continue;
                        name = name.Substring(top.Length + 1);
                    }
                    if (name.Length == 0) continue;
                    string full = Path.Combine(target, name);
                    if (!IsInside(target, full)) throw new InvalidDataException("an entry of the archive points outside its folder: " + entry.Name);
                    if (name.EndsWith("\\"))
                    {
                        Directory.CreateDirectory(full);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    ZipLite.ExtractTo(zip, entry, full);
                    count++;
                    if (onFile != null && count % 400 == 0) onFile(name);
                }
            }
            return count;
        }
#else
        /// <summary>
        /// Unpacks a zip into a folder. When every entry is under one top folder (a JDK, Node, a compiler
        /// all come that way), that folder is dropped, so the tool is directly in the target.
        /// </summary>
        public static int ExtractZip(string zipPath, string target, Action<string> onFile)
        {
            int count = 0;
            Directory.CreateDirectory(target);
            using (ZipArchive zip = ZipFile.OpenRead(zipPath))
            {
                // an entry that climbs out of its folder (..) is refused before anything is written
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    foreach (string segment in entry.FullName.Replace('\\', '/').Split('/'))
                    {
                        if (segment == "..") throw new InvalidDataException("an entry of the archive points outside its folder: " + entry.FullName);
                    }
                }
                string top = CommonTop(zip);
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string name = entry.FullName.Replace('/', '\\');
                    if (top.Length > 0)
                    {
                        if (!name.StartsWith(top + "\\", StringComparison.OrdinalIgnoreCase)) continue;
                        name = name.Substring(top.Length + 1);
                    }
                    if (name.Length == 0) continue;
                    string full = Path.Combine(target, name);
                    if (!IsInside(target, full)) throw new InvalidDataException("an entry of the archive points outside its folder: " + entry.FullName);
                    if (name.EndsWith("\\"))
                    {
                        Directory.CreateDirectory(full);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(full));
                    entry.ExtractToFile(full, true);
                    count++;
                    if (onFile != null && count % 400 == 0) onFile(name);
                }
            }
            return count;
        }

        private static string CommonTop(ZipArchive zip)
        {
            string top = null;
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string name = entry.FullName.Replace('/', '\\');
                int slash = name.IndexOf('\\');
                if (slash < 0) return "";
                string first = name.Substring(0, slash);
                if (top == null) top = first;
                else if (!string.Equals(top, first, StringComparison.OrdinalIgnoreCase)) return "";
            }
            return top ?? "";
        }

#endif

        public static void DeleteFolder(string folder)
        {
            if (!Directory.Exists(folder)) return;
            // read-only files (git, some archives) would stop the delete
            foreach (string file in Directory.GetFiles(folder, "*", SearchOption.AllDirectories))
            {
                try { File.SetAttributes(file, FileAttributes.Normal); } catch { }
            }
            for (int attempt = 0; attempt < 3; attempt++)
            {
                try { Directory.Delete(folder, true); return; }
                catch { System.Threading.Thread.Sleep(400); }
            }
        }

        public static string Size(long bytes)
        {
            if (bytes >= 1024L * 1024 * 1024) return (bytes / 1073741824.0).ToString("0.0") + " GB";
            return (bytes / 1048576.0).ToString("0") + " MB";
        }
    }

    // ---------------------------------------------------------------------------------- the payload

    internal sealed class PayloadFile
    {
        public string Name;
        public string Role;
        public string Version;
        public long Size;
        public string Sha256;
        public List<string> Chunks = new List<string>();
        public List<string> Urls = new List<string>();
        public string Path;           // the payload as files in a folder beside the setup (the Windows 7 setup): where this one is
        public string Arch;           // update files: x86 or x64   // the online setup: where the file is, the maker's first, then mirrors
    }

    /// <summary>
    /// What the setup carries inside itself: files cut in pieces (so no piece has to be held whole in memory),
    /// with an index that says which pieces make which file, and a manifest that says what each file is.
    /// </summary>
    internal static class Payload
    {
        private static readonly Assembly Self = Assembly.GetExecutingAssembly();
        private static readonly HashSet<string> Verified = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>The online setup carries a list of addresses (online.json) and no files; a test may name a list of its own.</summary>
        private static string OnlineText()
        {
            string test = Environment.GetEnvironmentVariable("CLASSROOM_SETUP_ONLINE_MANIFEST");
            if (!string.IsNullOrEmpty(test) && File.Exists(test)) return File.ReadAllText(test, Encoding.UTF8);
            return ReadText("online.json");
        }

        public static bool Online { get { return OnlineText() != null; } }

        /// <summary>
        /// The payload as files in a folder named payload beside the setup (or CLASSROOM_SETUP_PAYLOAD_DIR): the Windows 7
        /// setup is made so, because a 32-bit program cannot map a file of a gigabyte or two as its own image.
        /// </summary>
        public static string Folder()
        {
            string named = Environment.GetEnvironmentVariable("CLASSROOM_SETUP_PAYLOAD_DIR");
            string dir = !string.IsNullOrEmpty(named) ? named : System.IO.Path.Combine(System.IO.Path.GetDirectoryName(Self.Location), "payload");
            return File.Exists(System.IO.Path.Combine(dir, "manifest.json")) ? dir : null;
        }

        public static bool Present()
        {
            return Online || Folder() != null || Self.GetManifestResourceStream("payload.index.json") != null;
        }

        public static bool HasResource(string name)
        {
            return Self.GetManifestResourceStream(name) != null;
        }

        public static string ReadText(string resource)
        {
            using (Stream s = Self.GetManifestResourceStream(resource))
            {
                if (s == null) return null;
                using (StreamReader r = new StreamReader(s, Encoding.UTF8)) return r.ReadToEnd();
            }
        }

        /// <summary>The files, with the role each one has in the manifest (app, python, java...).</summary>
        public static List<PayloadFile> Files()
        {
            List<PayloadFile> list = new List<PayloadFile>();
            string folder = Folder();
            if (folder != null && OnlineText() == null)
            {
                foreach (object o in Json.List(Json.Parse(File.ReadAllText(System.IO.Path.Combine(folder, "manifest.json"), Encoding.UTF8)), "files"))
                {
                    Dictionary<string, object> f = o as Dictionary<string, object>;
                    if (f == null) continue;
                    PayloadFile file = new PayloadFile();
                    file.Name = Json.Text(f, "name");
                    file.Role = Json.Text(f, "role");
                    file.Version = Json.Text(f, "version");
                    file.Size = Json.Number(f, "size");
                    file.Sha256 = Json.Text(f, "sha256");
                    file.Arch = Json.Text(f, "arch");
                    file.Path = System.IO.Path.Combine(folder, file.Name);
                    list.Add(file);
                }
                return list;
            }
            string onlineText = OnlineText();
            if (onlineText != null)
            {
                foreach (object o in Json.List(Json.Parse(onlineText), "files"))
                {
                    Dictionary<string, object> f = o as Dictionary<string, object>;
                    if (f == null) continue;
                    PayloadFile file = new PayloadFile();
                    file.Name = Json.Text(f, "name");
                    file.Role = Json.Text(f, "role");
                    file.Version = Json.Text(f, "version");
                    file.Size = Json.Number(f, "size");
                    file.Sha256 = Json.Text(f, "sha256");
                    foreach (object u in Json.List(f, "urls")) file.Urls.Add(u.ToString());
                    list.Add(file);
                }
                return list;
            }
            string indexText = ReadText("payload.index.json");
            if (indexText == null) return list;

            Dictionary<string, Dictionary<string, object>> roles = new Dictionary<string, Dictionary<string, object>>();
            string manifestText = ReadManifestText();
            if (manifestText != null)
            {
                foreach (object o in Json.List(Json.Parse(manifestText), "files"))
                {
                    Dictionary<string, object> f = o as Dictionary<string, object>;
                    if (f != null) roles[Json.Text(f, "name")] = f;
                }
            }

            foreach (object o in Json.List(Json.Parse(indexText), "files"))
            {
                Dictionary<string, object> f = o as Dictionary<string, object>;
                if (f == null) continue;
                PayloadFile file = new PayloadFile();
                file.Name = Json.Text(f, "name");
                file.Size = Json.Number(f, "size");
                file.Sha256 = Json.Text(f, "sha256");
                foreach (object c in Json.List(f, "chunks")) file.Chunks.Add(c.ToString());
                Dictionary<string, object> info;
                if (roles.TryGetValue(file.Name, out info))
                {
                    file.Role = Json.Text(info, "role");
                    file.Version = Json.Text(info, "version");
                }
                list.Add(file);
            }
            return list;
        }

        /// <summary>The manifest is a payload file too (its pieces are named in the index).</summary>
        private static string ReadManifestText()
        {
            string indexText = ReadText("payload.index.json");
            foreach (object o in Json.List(Json.Parse(indexText), "files"))
            {
                Dictionary<string, object> f = o as Dictionary<string, object>;
                if (f == null || Json.Text(f, "name") != "manifest.json") continue;
                StringBuilder text = new StringBuilder();
                foreach (object c in Json.List(f, "chunks"))
                {
                    using (Stream s = Self.GetManifestResourceStream(c.ToString()))
                    using (StreamReader r = new StreamReader(s, Encoding.UTF8)) text.Append(r.ReadToEnd());
                }
                return text.ToString();
            }
            return null;
        }

        /// <summary>Writes one payload file out, once, and checks its hash as it goes.</summary>
        public static string Extract(PayloadFile file, string folder, Action<long> progress)
        {
            if (file.Urls.Count > 0) return Downloader.Fetch(file, folder, progress);
            if (file.Path != null)
            {
                // a file beside the setup: used where it is, once its hash is the recorded one
                if (!File.Exists(file.Path)) throw new FileNotFoundException(file.Name + " is not in the payload folder beside the setup");
                if (new FileInfo(file.Path).Length != file.Size) throw new InvalidDataException(file.Name + " is not the size recorded: copy the whole folder again");
                if (!Verified.Contains(file.Path))
                {
                    using (SHA256 sha = SHA256.Create())
                    using (FileStream input = new FileStream(file.Path, FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        byte[] buffer = new byte[1024 * 1024];
                        int n;
                        while ((n = input.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            sha.TransformBlock(buffer, 0, n, null, 0);
                            if (progress != null) progress(n);
                        }
                        sha.TransformFinalBlock(new byte[0], 0, 0);
                        if (!string.Equals(ExcalidrawClassroom.Files.Hex(sha.Hash), file.Sha256, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidDataException(file.Name + " is damaged (its hash is not the one recorded): copy the folder again");
                        }
                    }
                    Verified.Add(file.Path);
                }
                else if (progress != null) progress(file.Size);
                return file.Path;
            }
            Directory.CreateDirectory(folder);
            string target = Path.Combine(folder, file.Name);
            if (File.Exists(target) && new FileInfo(target).Length == file.Size && Files_Sha(target) == file.Sha256)
            {
                return target;
            }
            using (SHA256 sha = SHA256.Create())
            using (FileStream output = File.Create(target))
            {
                byte[] buffer = new byte[1024 * 1024];
                foreach (string chunk in file.Chunks)
                {
                    using (Stream s = Self.GetManifestResourceStream(chunk))
                    {
                        int n;
                        while ((n = s.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            output.Write(buffer, 0, n);
                            sha.TransformBlock(buffer, 0, n, null, 0);
                            if (progress != null) progress(n);
                        }
                    }
                }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                string got = ExcalidrawClassroom.Files.Hex(sha.Hash);
                if (!string.Equals(got, file.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    output.Close();
                    File.Delete(target);
                    throw new InvalidDataException(file.Name + " is damaged (its hash is not the one recorded): the setup file did not download completely");
                }
            }
            return target;
        }

        private static string Files_Sha(string path)
        {
            return ExcalidrawClassroom.Files.Sha256(path);
        }

        /// <summary>A file carried beside the pieces, as a resource of its own (the launcher and the uninstaller).</summary>
        public static void ExtractResource(string resource, string target)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            using (Stream s = Self.GetManifestResourceStream(resource))
            {
                if (s == null) throw new FileNotFoundException("the setup does not carry " + resource);
                using (FileStream o = File.Create(target)) ExcalidrawClassroom.Files.CopyStream(s, o);
            }
        }
    }

    // ---------------------------------------------------------------------------------- the record of an install

    /// <summary>What an install did, so that the uninstaller can undo exactly that and nothing else.</summary>
    internal sealed class InstallRecord
    {
        public string Dir = "";
        public string Version = "";
        public List<string> Components = new List<string>();
        public List<string> PathEntries = new List<string>();
        public List<string> Variables = new List<string>();
        public List<string> Shortcuts = new List<string>();
        /// <summary>Programs that undo what another installer did: "exe|arguments".</summary>
        public List<string> Uninstallers = new List<string>();
        /// <summary>Folders outside the install folder that the setup made (the compiler, when the install path has a space).</summary>
        public List<string> ExtraFolders = new List<string>();

        private static object[] Array(List<string> list)
        {
            return list.ToArray();
        }

        public void Save()
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["dir"] = Dir;
            d["version"] = Version;
            d["components"] = Array(Components);
            d["pathEntries"] = Array(PathEntries);
            d["variables"] = Array(Variables);
            d["shortcuts"] = Array(Shortcuts);
            d["uninstallers"] = Array(Uninstallers);
            d["extraFolders"] = Array(ExtraFolders);
            Directory.CreateDirectory(Dir);
            File.WriteAllText(Path.Combine(Dir, Product.RecordFile), Json.Write(d), Encoding.UTF8);
        }

        public static InstallRecord Load(string dir)
        {
            string file = Path.Combine(dir, Product.RecordFile);
            InstallRecord r = new InstallRecord();
            r.Dir = dir;
            if (!File.Exists(file)) return r;
            Dictionary<string, object> d = Json.Parse(File.ReadAllText(file, Encoding.UTF8));
            r.Version = Json.Text(d, "version");
            foreach (object o in Json.List(d, "components")) r.Components.Add(o.ToString());
            foreach (object o in Json.List(d, "pathEntries")) r.PathEntries.Add(o.ToString());
            foreach (object o in Json.List(d, "variables")) r.Variables.Add(o.ToString());
            foreach (object o in Json.List(d, "shortcuts")) r.Shortcuts.Add(o.ToString());
            foreach (object o in Json.List(d, "uninstallers")) r.Uninstallers.Add(o.ToString());
            foreach (object o in Json.List(d, "extraFolders")) r.ExtraFolders.Add(o.ToString());
            return r;
        }
    }

    // ---------------------------------------------------------------------------------- running programs

    internal static class Run
    {
        /// <summary>Runs a program and waits; its output is given line by line. Returns the exit code.</summary>
        public static int Program(string file, string arguments, Action<string> onLine, int timeoutMs)
        {
            ProcessStartInfo info = new ProcessStartInfo(file, arguments);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            Process started;
            try
            {
                started = Process.Start(info);
            }
            catch (System.ComponentModel.Win32Exception e)
            {
                // error 740: the program asks Windows for an administrator (a system installer): ask, then wait; no output can be read
                if (e.NativeErrorCode != 740) throw;
                ProcessStartInfo elevated = new ProcessStartInfo(file, arguments);
                elevated.UseShellExecute = true;
                elevated.Verb = "runas";
                using (Process q = Process.Start(elevated))
                {
                    if (!q.WaitForExit(timeoutMs))
                    {
                        try { q.Kill(); } catch { }
                        return -1;
                    }
                    return q.ExitCode;
                }
            }
            using (Process p = started)
            {
                DataReceivedEventHandler handler = delegate (object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null && onLine != null) onLine(e.Data);
                };
                p.OutputDataReceived += handler;
                p.ErrorDataReceived += handler;
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch { }
                    return -1;
                }
                p.WaitForExit();
                return p.ExitCode;
            }
        }
    }
}
