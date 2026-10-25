// The offline setup: one file, no internet, nothing to install.
//
// It does THREE things, and the third is the point:
//
//   1. It CARRIES the payload. The payload is carried in PIECES - resources of
//      this program - and they are written straight to
//      %LOCALAPPDATA%\ExcalidrawClassroom\payload on the first run, one piece at
//      a time. The SHA-256 of every file is checked against the manifest as it
//      is written, and a payload that does not match is REFUSED - not
//      installed, not half-installed. (Pieces, and not one big resource,
//      because the payload is about 780 MB: a resource that size has to be
//      held in memory by the runtime, and the disk would have to hold the
//      payload twice - once as the resource, once unpacked.)
//
//   2. It INSTALLS, offline, what is missing - asking first, one thing at a
//      time. `-Yes` accepts the answers and `-DryRun` reports and installs
//      NOTHING at all. The parts that need administrator rights (the virtual
//      display driver, the machine-wide PATH) elevate the program with the
//      runas verb.
//
//   3. It RUNS the app with NOTHING installed: a built-in HTTP server serves
//      the prebuilt app out of the payload and the browser is opened on it. No
//      Node, no Python, no editor - just the whiteboard.
//
// This program NEVER reaches the internet. There is no download code in it at
// all: a file that is missing from the payload is REPORTED, never fetched.
//
// C# 5: this is compiled by the compiler that ships with Windows, so no string
// interpolation, no expression-bodied members and no 'nameof'.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class OfflineSetup
{
    /// <summary>
    /// The index of the payload's pieces. The pieces themselves are resources
    /// named payload.NNNN, and the index says which pieces make up which file.
    /// </summary>
    private const string PayloadIndexResource = "payload.index.json";
    private const string RootFolderName = "ExcalidrawClassroom";
    private const string PayloadFolderName = "payload";
    private const string WebAppFolderName = "app";
    private const string ManifestName = "manifest.json";
    private const string AppZipName = "app.zip";

    /** The port the app is served on, unless another one is asked for. */
    private const int DefaultPort = 4173;

    /** The port the bridge listens on when nothing says otherwise. */
    private const int DefaultBridgePort = 47511;

    // -----------------------------------------------------------------------
    // what the program was asked to do
    // -----------------------------------------------------------------------

    private static bool assumeYes = false;
    private static bool dryRun = false;
    private static bool noServe = false;
    private static bool noBrowser = false;
    private static bool showHelp = false;
    private static int port = DefaultPort;
    private static string elevatedTask = null;
    private static string payloadRoot = null;

    // -----------------------------------------------------------------------
    // the manifest
    // -----------------------------------------------------------------------

    /// <summary>One file of the payload.</summary>
    private sealed class PayloadFile
    {
        public string Role;
        public string Name;
        public string Version;
        public string Sha256;
        public long Size;
    }

    /// <summary>What the payload carries.</summary>
    private sealed class Manifest
    {
        public string Arch = "";
        public string BridgeUrl = "";
        public readonly List<PayloadFile> Files = new List<PayloadFile>();
    }

    private static int Main(string[] args)
    {
        try
        {
            ParseArgs(args);

            if (showHelp)
            {
                PrintHelp();
                return 0;
            }

            string root = payloadRoot != null
                ? payloadRoot
                : Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    RootFolderName);
            string payloadDir = Path.Combine(root, PayloadFolderName);

            if (elevatedTask != null)
            {
                // this process was relaunched with administrator rights, for
                // one task and one task only
                return RunElevatedTask(elevatedTask, payloadDir);
            }

            Console.WriteLine("Excalidraw for the classroom - the OFFLINE setup");
            Console.WriteLine("No internet is needed from here on. Everything comes from");
            Console.WriteLine("the payload this program carries with it.");
            Console.WriteLine("");

            // 1. the payload
            Manifest manifest = PreparePayload(payloadDir);

            if (manifest == null)
            {
                return 2;
            }

            // 2. what it carries, and what it installs
            Report(manifest, payloadDir);
            InstallEverything(manifest, payloadDir, root);

            // 3. the app, with nothing installed
            if (!noServe)
            {
                return ServeApp(manifest, payloadDir);
            }

            Console.WriteLine("");
            Console.WriteLine("Done.");
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine("");
            Console.WriteLine("The offline setup could not finish: " + e.Message);
            return 1;
        }
    }

    // -----------------------------------------------------------------------
    // the arguments
    // -----------------------------------------------------------------------

    private static void ParseArgs(string[] args)
    {
        for (int index = 0; index < args.Length; index++)
        {
            string arg = args[index];

            if (string.Equals(arg, "-Yes", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(arg, "--yes", StringComparison.OrdinalIgnoreCase))
            {
                assumeYes = true;
            }
            else if (string.Equals(arg, "-DryRun", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(arg, "--dry-run", StringComparison.OrdinalIgnoreCase))
            {
                dryRun = true;
            }
            else if (string.Equals(arg, "-NoServe", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(arg, "--no-serve", StringComparison.OrdinalIgnoreCase))
            {
                noServe = true;
            }
            else if (string.Equals(arg, "-NoBrowser", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(arg, "--no-browser", StringComparison.OrdinalIgnoreCase))
            {
                noBrowser = true;
            }
            else if (string.Equals(arg, "-Help", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(arg, "--help", StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(arg, "/?", StringComparison.Ordinal))
            {
                showHelp = true;
            }
            else if (string.Equals(arg, "-Elevated", StringComparison.OrdinalIgnoreCase))
            {
                elevatedTask = index + 1 < args.Length ? args[index + 1] : "";
                index++;
            }
            else if (string.Equals(arg, "-Port", StringComparison.OrdinalIgnoreCase))
            {
                int parsed;
                if (index + 1 < args.Length && int.TryParse(args[index + 1], out parsed))
                {
                    port = parsed;
                    index++;
                }
            }
            else if (string.Equals(arg, "-PayloadRoot", StringComparison.OrdinalIgnoreCase))
            {
                // where the payload is unpacked. It defaults to the user's own
                // application data, but a big payload on a USB stick or a
                // second drive needs a home of its own.
                if (index + 1 < args.Length)
                {
                    payloadRoot = args[index + 1];
                    index++;
                }
            }
        }
    }

    private static void PrintHelp()
    {
        Console.WriteLine("The offline setup - one file, no internet, nothing to install.");
        Console.WriteLine("");
        Console.WriteLine("  OfflineSetup.exe            report, ask, install, then serve the app");
        Console.WriteLine("  OfflineSetup.exe -Yes       accept the answers; install without asking");
        Console.WriteLine("  OfflineSetup.exe -DryRun    report only; NOTHING is installed");
        Console.WriteLine("  OfflineSetup.exe -NoServe   do not start the app's web server");
        Console.WriteLine("  OfflineSetup.exe -NoBrowser  do not open a browser");
        Console.WriteLine("  OfflineSetup.exe -Port <n>  serve the app on another port");
        Console.WriteLine("  OfflineSetup.exe -PayloadRoot <dir>  unpack the payload somewhere else");
        Console.WriteLine("");
        Console.WriteLine("The payload is extracted to");
        Console.WriteLine("  %LOCALAPPDATA%\\" + RootFolderName + "\\" + PayloadFolderName);
        Console.WriteLine("and is checked against its manifest before anything is installed.");
    }

    // -----------------------------------------------------------------------
    // 1. the payload
    // -----------------------------------------------------------------------

    /// <summary>
    /// The payload is there, and it matches its manifest.
    ///
    /// Returns the manifest, or null when the payload does not match - in
    /// which case NOTHING is installed.
    /// </summary>
    private static Manifest PreparePayload(string payloadDir)
    {
        Console.WriteLine("The payload");

        string manifestPath = Path.Combine(payloadDir, ManifestName);

        if (Directory.Exists(payloadDir) && File.Exists(manifestPath))
        {
            string problem = VerifyFolder(payloadDir);

            if (problem == null)
            {
                Console.WriteLine("   already extracted, and every file matches its hash");
                return ReadManifest(manifestPath);
            }

            Console.WriteLine("   the extracted payload does not match (" + problem + ")");
            Console.WriteLine("   extracting it again from the copy this program carries");
        }

        Console.WriteLine("   extracting the payload this program carries");
        string trouble = ExtractPayload(payloadDir);

        if (trouble != null)
        {
            Console.WriteLine("");
            Console.WriteLine("The payload does NOT match its manifest: " + trouble);
            Console.WriteLine("Nothing was installed and nothing was served. A payload that");
            Console.WriteLine("does not match is refused rather than half-trusted.");
            return null;
        }

        // the pieces were checked as they were written; now the payload is
        // checked again against its OWN manifest, so the two have to agree
        trouble = VerifyFolder(payloadDir);

        if (trouble != null)
        {
            Console.WriteLine("");
            Console.WriteLine("The payload does NOT match its manifest: " + trouble);
            Console.WriteLine("Nothing was installed and nothing was served. A payload that");
            Console.WriteLine("does not match is refused rather than half-trusted.");
            return null;
        }

        Console.WriteLine("   every file matches its hash");
        return ReadManifest(manifestPath);
    }

    /// <summary>
    /// The payload is carried in pieces, and the pieces are written straight
    /// into the payload folder - one at a time, and hashed as they are
    /// written.
    ///
    /// The payload is about 780 MB, and a single resource that size is trouble
    /// on a small machine: the runtime has to hold it in memory, and the disk
    /// would have to hold it twice (once as the resource, once unpacked). So
    /// the builder splits it into pieces of a few megabytes, and this program
    /// puts them back together on the disk - once, never twice - and checks
    /// each file's SHA-256 as it goes.
    ///
    /// Returns null when the payload is good, and the reason when it is not.
    /// </summary>
    private static string ExtractPayload(string payloadDir)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        string indexText = ReadResourceText(assembly, PayloadIndexResource);

        if (indexText == null)
        {
            Console.WriteLine("   THIS PROGRAM CARRIES NO PAYLOAD.");
            Console.WriteLine("   It was built without one, so there is nothing to install and");
            Console.WriteLine("   nothing to serve. Build it with the payload beside it:");
            Console.WriteLine("     node installer/offline/build-offline-setup.mjs");
            return "this program carries no payload";
        }

        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 64 * 1024 * 1024;

        Dictionary<string, object> index;

        try
        {
            index = serializer.Deserialize<Dictionary<string, object>>(indexText);
        }
        catch (Exception e)
        {
            return "the payload's index could not be read (" + e.Message + ")";
        }

        object files;

        if (!index.TryGetValue("files", out files))
        {
            return "the payload's index lists no files";
        }

        ArrayList list = files as ArrayList;

        if (list == null)
        {
            return "the payload's index lists no files";
        }

        Directory.CreateDirectory(payloadDir);

        foreach (object entry in list)
        {
            Dictionary<string, object> file = entry as Dictionary<string, object>;

            if (file == null)
            {
                continue;
            }

            string name = StringValue(file, "name");
            string expected = StringValue(file, "sha256");
            string problem = WritePayloadFile(assembly, payloadDir, name, expected, file);

            if (problem != null)
            {
                return problem;
            }
        }

        return null;
    }

    /// <summary>
    /// Write one file of the payload out of its pieces, and check its hash.
    /// </summary>
    private static string WritePayloadFile(Assembly assembly, string payloadDir, string name, string expected, Dictionary<string, object> file)
    {
        string path = Path.Combine(payloadDir, name);
        object chunks;

        if (!file.TryGetValue("chunks", out chunks))
        {
            return "the payload's index says nothing about " + name;
        }

        ArrayList names = chunks as ArrayList;

        if (names == null)
        {
            return "the payload's index says nothing about " + name;
        }

        using (SHA256 sha = SHA256.Create())
        {
            using (FileStream output = new FileStream(path, FileMode.Create, FileAccess.Write))
            {
                foreach (object chunk in names)
                {
                    string chunkName = chunk.ToString();
                    Stream source = assembly.GetManifestResourceStream(chunkName);

                    if (source == null)
                    {
                        return "the payload is missing a piece of " + name + " (" + chunkName + ")";
                    }

                    using (source)
                    {
                        byte[] buffer = new byte[65536];
                        int read;

                        while ((read = source.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            sha.TransformBlock(buffer, 0, read, null, 0);
                            output.Write(buffer, 0, read);
                        }
                    }
                }
            }

            sha.TransformFinalBlock(new byte[0], 0, 0);
            string hash = Hex(sha.Hash);

            if (!string.Equals(hash, expected, StringComparison.OrdinalIgnoreCase))
            {
                return name + " does not match its hash";
            }
        }

        return null;
    }

    /// <summary>A resource as text, or null when it is not there.</summary>
    private static string ReadResourceText(Assembly assembly, string name)
    {
        Stream stream = assembly.GetManifestResourceStream(name);

        if (stream == null)
        {
            return null;
        }

        using (stream)
        {
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }
    }

    /// <summary>Bytes as the hex string the manifest gives them in.</summary>
    private static string Hex(byte[] bytes)
    {
        StringBuilder text = new StringBuilder();

        for (int index = 0; index < bytes.Length; index++)
        {
            text.Append(bytes[index].ToString("x2"));
        }

        return text.ToString();
    }

    /// <summary>Unpack a zip into a folder.</summary>
    private static void ExtractZip(string zipPath, string target)
    {
        if (Directory.Exists(target))
        {
            Directory.Delete(target, true);
        }

        Directory.CreateDirectory(target);

        using (ZipArchive archive = ZipFile.OpenRead(zipPath))
        {
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                if (entry.FullName.EndsWith("/", StringComparison.Ordinal))
                {
                    continue;
                }

                string destination = Path.Combine(target, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                string folder = Path.GetDirectoryName(destination);

                if (!string.IsNullOrEmpty(folder))
                {
                    Directory.CreateDirectory(folder);
                }

                using (Stream source = entry.Open())
                using (FileStream file = new FileStream(destination, FileMode.Create, FileAccess.Write))
                {
                    source.CopyTo(file);
                }
            }
        }
    }

    /// <summary>
    /// Every file of the payload matches the hash the manifest gives it.
    ///
    /// Returns null when it all matches, and the reason when it does not.
    /// </summary>
    private static string VerifyFolder(string payloadDir)
    {
        string manifestPath = Path.Combine(payloadDir, ManifestName);

        if (!File.Exists(manifestPath))
        {
            return "the payload has no " + ManifestName;
        }

        Manifest manifest;

        try
        {
            manifest = ReadManifest(manifestPath);
        }
        catch (Exception e)
        {
            return "the manifest could not be read (" + e.Message + ")";
        }

        foreach (PayloadFile file in manifest.Files)
        {
            string path = Path.Combine(payloadDir, file.Name);

            if (!File.Exists(path))
            {
                return "the payload is missing " + file.Name;
            }

            string hash = Sha256(path);

            if (!string.Equals(hash, file.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                return file.Name + " does not match its hash";
            }
        }

        return null;
    }

    /// <summary>The SHA-256 of a file, as the manifest gives it.</summary>
    private static string Sha256(string path)
    {
        using (SHA256 sha = SHA256.Create())
        using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read))
        {
            return Hex(sha.ComputeHash(stream));
        }
    }

    /// <summary>Read the manifest.</summary>
    private static Manifest ReadManifest(string path)
    {
        JavaScriptSerializer serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 64 * 1024 * 1024;

        Dictionary<string, object> root =
            serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(path));

        Manifest manifest = new Manifest();
        manifest.Arch = StringValue(root, "arch");
        manifest.BridgeUrl = StringValue(root, "bridgeUrl");

        object files;

        if (root.TryGetValue("files", out files))
        {
            ArrayList list = files as ArrayList;

            if (list != null)
            {
                foreach (object entry in list)
                {
                    Dictionary<string, object> file = entry as Dictionary<string, object>;

                    if (file == null)
                    {
                        continue;
                    }

                    PayloadFile item = new PayloadFile();
                    item.Role = StringValue(file, "role");
                    item.Name = StringValue(file, "name");
                    item.Version = StringValue(file, "version");
                    item.Sha256 = StringValue(file, "sha256");
                    item.Size = LongValue(file, "size");
                    manifest.Files.Add(item);
                }
            }
        }

        return manifest;
    }

    private static string StringValue(Dictionary<string, object> source, string key)
    {
        object value;

        if (source.TryGetValue(key, out value) && value != null)
        {
            return value.ToString();
        }

        return "";
    }

    private static long LongValue(Dictionary<string, object> source, string key)
    {
        object value;

        if (source.TryGetValue(key, out value) && value != null)
        {
            try
            {
                return Convert.ToInt64(value);
            }
            catch (Exception)
            {
                return 0;
            }
        }

        return 0;
    }

    // -----------------------------------------------------------------------
    // 2. the report, and the installs
    // -----------------------------------------------------------------------

    /// <summary>
    /// What the payload carries, and the bridge the app was built for.
    /// </summary>
    private static void Report(Manifest manifest, string payloadDir)
    {
        Console.WriteLine("");
        Console.WriteLine("What the payload carries (" + manifest.Files.Count + " file(s))");

        foreach (PayloadFile file in manifest.Files)
        {
            string size = (file.Size / (1024.0 * 1024.0)).ToString("0.0") + " MB";
            Console.WriteLine("   " + file.Name + "   " + file.Version + "   " + size);
        }

        ReportBridge(manifest);
    }

    /// <summary>
    /// The bridge URL the app was built with.
    ///
    /// The app's bundle carries it (VITE_APP_BRIDGE_URL is baked in at build
    /// time), so it cannot be changed afterwards. If it is not the port the
    /// bridge will actually run on, the teacher has to know - the program says
    /// so plainly rather than pretending.
    /// </summary>
    private static void ReportBridge(Manifest manifest)
    {
        string url = string.IsNullOrEmpty(manifest.BridgeUrl)
            ? "ws://127.0.0.1:" + DefaultBridgePort + "/"
            : manifest.BridgeUrl;

        int builtPort = PortOf(url);
        Console.WriteLine("");
        Console.WriteLine("The bridge");
        Console.WriteLine("   the app was built for: " + url);

        if (builtPort == DefaultBridgePort)
        {
            Console.WriteLine("   that is the bridge's own default port, so it matches the");
            Console.WriteLine("   extension unless the setting `excalidraw-bridge.port` says otherwise.");
        }
        else
        {
            Console.WriteLine("   that is NOT the bridge's default port (" + DefaultBridgePort + ").");
            Console.WriteLine("   The extension listens on " + DefaultBridgePort + " unless its");
            Console.WriteLine("   setting `excalidraw-bridge.port` says otherwise, so the panel will");
            Console.WriteLine("   NOT connect unless the two are made to agree.");
        }

        if (IsSomethingListening(builtPort))
        {
            Console.WriteLine("   something is listening on port " + builtPort + " right now - the");
            Console.WriteLine("   bridge is probably already running.");
        }
        else
        {
            Console.WriteLine("   nothing is listening on port " + builtPort + " yet. The bridge runs");
            Console.WriteLine("   inside the editor: open VS Code or VSCodium and the panel starts it.");
        }
    }

    /// <summary>The port of a URL, or 0 when it has none.</summary>
    private static int PortOf(string url)
    {
        try
        {
            Uri uri = new Uri(url);
            return uri.Port;
        }
        catch (Exception)
        {
            return 0;
        }
    }

    /// <summary>Whether anything is listening on a loopback port.</summary>
    private static bool IsSomethingListening(int port)
    {
        try
        {
            System.Net.Sockets.TcpClient client = new System.Net.Sockets.TcpClient();

            try
            {
                IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);

                if (!result.AsyncWaitHandle.WaitOne(400, false))
                {
                    return false;
                }

                client.EndConnect(result);
                return true;
            }
            finally
            {
                client.Close();
            }
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>
    /// Install what is missing - after asking, one thing at a time.
    /// </summary>
    private static void InstallEverything(Manifest manifest, string payloadDir, string root)
    {
        Console.WriteLine("");
        Console.WriteLine("What is missing");

        // THE DRY RUN STOPS HERE. Nothing below this line runs when -DryRun is
        // given: the report above is the whole of a dry run.
        if (dryRun)
        {
            Console.WriteLine("   Dry run: nothing was installed. Nothing below this line runs.");
            Console.WriteLine("");
            Console.WriteLine("Would install, from the payload, without any internet:");
            DescribePlan(manifest, payloadDir);
            return;
        }

        InstallNode(manifest, payloadDir);
        InstallEditor(manifest, payloadDir, "vscode", "VS Code", "code");
        InstallEditor(manifest, payloadDir, "vscodium", "VSCodium", "codium");
        InstallPython(manifest, payloadDir);
        InstallJava(manifest, payloadDir, root);
        InstallDisplayDriver(manifest, payloadDir, root);
        InstallExtension(manifest, payloadDir);
    }

    /// <summary>What a full run would install, in words.</summary>
    private static void DescribePlan(Manifest manifest, string payloadDir)
    {
        List<string> lines = new List<string>();

        if (FindFile(manifest, "node") == null)
        {
            lines.Add("   Node.js - the payload has no Node.js installer");
        }

        if (!HasEditor("code"))
        {
            lines.Add("   VS Code - the payload has no VS Code installer");
        }

        if (!HasEditor("codium"))
        {
            lines.Add("   VSCodium - the payload has no VSCodium installer");
        }

        if (!HasRuntime("python"))
        {
            lines.Add("   Python - the payload has no Python installer");
        }

        if (!HasRuntime("java"))
        {
            lines.Add("   Java - the payload has no Java archive");
        }

        lines.Add("   the virtual display driver - needs administrator rights and a reboot");
        lines.Add("   the extension - into whichever editor is found");

        foreach (string line in lines)
        {
            Console.WriteLine(line);
        }
    }

    /// <summary>The payload's file with a role, or null.</summary>
    private static PayloadFile FindFile(Manifest manifest, string role)
    {
        foreach (PayloadFile file in manifest.Files)
        {
            if (string.Equals(file.Role, role, StringComparison.OrdinalIgnoreCase))
            {
                return file;
            }
        }

        return null;
    }

    /// <summary>
    /// Ask a question. `-Yes` accepts; without it the answer is read from the
    /// console, and a console that cannot answer means NO - nothing is ever
    /// installed silently.
    /// </summary>
    private static bool Confirm(string question)
    {
        if (assumeYes)
        {
            Console.WriteLine(question + " yes");
            return true;
        }

        Console.Write(question + " [y/N] ");

        try
        {
            string answer = Console.ReadLine();

            if (answer == null)
            {
                Console.WriteLine("no answer was given - treating it as no");
                return false;
            }

            answer = answer.Trim().ToLowerInvariant();
            return answer == "y" || answer == "yes";
        }
        catch (Exception)
        {
            Console.WriteLine("no answer could be read - treating it as no");
            return false;
        }
    }

    /// <summary>
    /// Run a program and wait for it. Returns its exit code, or -1 when it
    /// could not be started.
    /// </summary>
    private static int Run(string fileName, string arguments, bool useShell)
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(fileName, arguments);
            start.UseShellExecute = useShell;
            start.CreateNoWindow = true;

            Process process = Process.Start(start);

            if (process == null)
            {
                return -1;
            }

            process.WaitForExit();
            return process.ExitCode;
        }
        catch (Exception e)
        {
            Console.WriteLine("   could not run " + fileName + ": " + e.Message);
            return -1;
        }
    }

    // -----------------------------------------------------------------------
    // the installs
    // -----------------------------------------------------------------------

    /// <summary>Node.js - the MSI, with msiexec.</summary>
    private static void InstallNode(Manifest manifest, string payloadDir)
    {
        if (HasRuntime("node"))
        {
            Console.WriteLine("   Node.js is already there");
            return;
        }

        PayloadFile file = FindFile(manifest, "node");

        if (file == null)
        {
            Console.WriteLine("   Node.js is missing, and the payload has no Node.js installer.");
            Console.WriteLine("      The panel's Run button needs Node for the teacher's own code.");
            return;
        }

        if (!Confirm("   Node.js " + file.Version + " - install it from the payload?"))
        {
            Console.WriteLine("      skipped");
            return;
        }

        string path = Path.Combine(payloadDir, file.Name);
        Console.WriteLine("      installing");

        int code = Run("msiexec.exe", "/i \"" + path + "\" /qn /norestart", false);

        if (code == 0)
        {
            Console.WriteLine("      Node.js " + file.Version + " is installed");
        }
        else
        {
            Console.WriteLine("      the installer returned " + code + " - Node.js is NOT installed");
        }
    }

    /// <summary>VS Code or VSCodium - the official installer, which is Inno Setup.</summary>
    private static void InstallEditor(Manifest manifest, string payloadDir, string role, string label, string cli)
    {
        if (HasEditor(cli))
        {
            Console.WriteLine("   " + label + " is already there");
            return;
        }

        PayloadFile file = FindFile(manifest, role);

        if (file == null)
        {
            Console.WriteLine("   " + label + " is missing, and the payload has no " + label + " installer.");
            Console.WriteLine("      The bridge lives INSIDE the editor, so one of the two is needed.");
            return;
        }

        if (!Confirm("   " + label + " " + file.Version + " - install it from the payload?"))
        {
            Console.WriteLine("      skipped");
            return;
        }

        string path = Path.Combine(payloadDir, file.Name);
        Console.WriteLine("      installing");

        int code = Run(path, "/VERYSILENT /NORESTART /SP-", true);

        if (code == 0)
        {
            Console.WriteLine("      " + label + " " + file.Version + " is installed");
        }
        else
        {
            Console.WriteLine("      the installer returned " + code + " - " + label + " is NOT installed");
        }
    }

    /// <summary>Python - the amd64 installer.</summary>
    private static void InstallPython(Manifest manifest, string payloadDir)
    {
        if (HasRuntime("python"))
        {
            Console.WriteLine("   Python is already there");
            return;
        }

        PayloadFile file = FindFile(manifest, "python");

        if (file == null)
        {
            Console.WriteLine("   Python is missing, and the payload has no Python installer.");
            Console.WriteLine("      Python is only for the indra and paddle OCR engines; the");
            Console.WriteLine("      default engine (tesseract) runs inside the extension.");
            return;
        }

        if (!Confirm("   Python " + file.Version + " - install it from the payload?"))
        {
            Console.WriteLine("      skipped");
            return;
        }

        string path = Path.Combine(payloadDir, file.Name);
        Console.WriteLine("      installing");

        int code = Run(path, "/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1", true);

        if (code == 0)
        {
            Console.WriteLine("      Python " + file.Version + " is installed");
        }
        else
        {
            Console.WriteLine("      the installer returned " + code + " - Python is NOT installed");
        }
    }

    /// <summary>
    /// Java - a Temurin archive, unpacked, with its bin on the machine's PATH.
    ///
    /// The machine-wide PATH needs administrator rights, so this task is
    /// relaunched with the runas verb.
    /// </summary>
    private static void InstallJava(Manifest manifest, string payloadDir, string root)
    {
        if (HasRuntime("java"))
        {
            Console.WriteLine("   Java is already there");
            return;
        }

        PayloadFile file = FindFile(manifest, "java");

        if (file == null)
        {
            Console.WriteLine("   Java is missing, and the payload has no Java archive.");
            Console.WriteLine("      Java is only for the Run button on .java files.");
            return;
        }

        if (!Confirm("   Java " + file.Version + " - install it from the payload?"))
        {
            Console.WriteLine("      skipped");
            return;
        }

        Console.WriteLine("      installing (this asks for administrator rights: the PATH is");
        Console.WriteLine("      changed for the whole machine)");

        int code = RunElevated("java", new string[] { payloadDir, file.Name, root });

        if (code == 0)
        {
            Console.WriteLine("      Java " + file.Version + " is installed");
        }
        else
        {
            Console.WriteLine("      the elevated step returned " + code + " - Java is NOT installed");
        }
    }

    /// <summary>
    /// The virtual display driver.
    ///
    /// It needs administrator rights AND a reboot, so the program says both
    /// plainly - and it does NOT claim the display works before the reboot.
    /// </summary>
    private static void InstallDisplayDriver(Manifest manifest, string payloadDir, string root)
    {
        if (DisplayDriverInstalled())
        {
            Console.WriteLine("   the virtual display driver is already installed");
            return;
        }

        PayloadFile file = FindFile(manifest, "display-driver");

        if (file == null)
        {
            Console.WriteLine("   the virtual display driver is missing, and the payload has no");
            Console.WriteLine("      driver package. It is only for a second screen.");
            return;
        }

        if (!Confirm("   the virtual display driver " + file.Version +
                     " - install it? (needs administrator rights, and a REBOOT afterwards)"))
        {
            Console.WriteLine("      skipped");
            return;
        }

        Console.WriteLine("      installing (this asks for administrator rights)");

        int code = RunElevated("driver", new string[] { payloadDir, file.Name, root });

        if (code == 0)
        {
            Console.WriteLine("      the driver was installed.");
            Console.WriteLine("      IT NEEDS A REBOOT before there is a second screen. Until the");
            Console.WriteLine("      machine has been restarted, the display does NOT work - and the");
            Console.WriteLine("      extension will say so, because there is no virtual display yet.");
        }
        else
        {
            Console.WriteLine("      the elevated step returned " + code +
                              " - the driver is NOT installed");
        }
    }

    /// <summary>The extension, into whichever editor is there.</summary>
    private static void InstallExtension(Manifest manifest, string payloadDir)
    {
        PayloadFile file = FindFile(manifest, "extension");

        if (file == null)
        {
            Console.WriteLine("   the extension is missing, and the payload has no .vsix.");
            return;
        }

        string path = Path.Combine(payloadDir, file.Name);
        string editor = null;
        string editorPath = null;

        string codeCli = EditorPath("code");
        string codiumCli = EditorPath("codium");

        if (codeCli != null)
        {
            editor = "code";
            editorPath = codeCli;
        }
        else if (codiumCli != null)
        {
            editor = "codium";
            editorPath = codiumCli;
        }

        if (editor == null)
        {
            Console.WriteLine("   the extension is in the payload, but no editor is installed to");
            Console.WriteLine("      put it in. Install VS Code or VSCodium and run this again.");
            return;
        }

        if (!Confirm("   the extension " + file.Version + " - install it into " + editor + "?"))
        {
            Console.WriteLine("      skipped");
            return;
        }

        Console.WriteLine("      installing");

        int code = Run(editorPath, "--install-extension \"" + path + "\" --force", true);

        if (code == 0)
        {
            Console.WriteLine("      the extension is installed into " + editor);
            Console.WriteLine("      restart the editor, and the bridge panel is on the canvas.");
        }
        else
        {
            Console.WriteLine("      the editor returned " + code + " - the extension is NOT installed");
        }
    }

    // -----------------------------------------------------------------------
    // the elevated tasks
    // -----------------------------------------------------------------------

    /// <summary>
    /// Relaunch this program with administrator rights, for one task.
    ///
    /// The runas verb is what makes Windows ask for the password.
    /// </summary>
    private static int RunElevated(string task, string[] extra)
    {
        StringBuilder arguments = new StringBuilder();
        arguments.Append("-Elevated ");
        arguments.Append(task);

        foreach (string argument in extra)
        {
            arguments.Append(" \"");
            arguments.Append(argument);
            arguments.Append("\"");
        }

        try
        {
            ProcessStartInfo start = new ProcessStartInfo();
            // the program relaunches ITSELF, so the path comes from the
            // assembly and not from the shell that started it
            start.FileName = Assembly.GetExecutingAssembly().Location;
            start.Arguments = arguments.ToString();
            start.Verb = "runas";
            start.UseShellExecute = true;
            start.WorkingDirectory = Path.GetTempPath();

            Process process = Process.Start(start);

            if (process == null)
            {
                Console.WriteLine("   the elevated program could not be started");
                return -1;
            }

            process.WaitForExit();
            return process.ExitCode;
        }
        catch (Exception e)
        {
            Console.WriteLine("   the elevated program could not be started: " + e.Message);
            return -1;
        }
    }

    /// <summary>
    /// The one elevated task this process was started for.
    /// </summary>
    private static int RunElevatedTask(string task, string payloadDir)
    {
        string[] args = Environment.GetCommandLineArgs();
        string archive = "";
        string root = "";

        for (int index = 0; index < args.Length - 1; index++)
        {
            if (args[index] == "-Elevated" && index + 2 < args.Length)
            {
                archive = args[index + 2];
                root = args[index + 3];
                break;
            }
        }

        if (task == "java")
        {
            return ElevatedJava(payloadDir, archive, root);
        }

        if (task == "driver")
        {
            return ElevatedDriver(payloadDir, archive, root);
        }

        Console.WriteLine("Unknown elevated task: " + task);
        return -1;
    }

    /// <summary>Unpack Java and put its bin on the machine's PATH.</summary>
    private static int ElevatedJava(string payloadDir, string archive, string root)
    {
        try
        {
            string target = Path.Combine(root, "java");
            ExtractZip(Path.Combine(payloadDir, archive), target);

            string[] folders = Directory.GetDirectories(target);

            if (folders.Length == 0)
            {
                Console.WriteLine("the Java archive holds no folder");
                return 1;
            }

            string bin = Path.Combine(folders[0], "bin");

            if (!Directory.Exists(bin))
            {
                Console.WriteLine("the Java archive holds no bin folder");
                return 1;
            }

            AddToMachinePath(bin);
            Console.WriteLine("Java is unpacked at " + folders[0]);
            Console.WriteLine("Its bin folder is now on the machine's PATH.");
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine("Java could not be installed: " + e.Message);
            return 1;
        }
    }

    /// <summary>Install the virtual display driver.</summary>
    private static int ElevatedDriver(string payloadDir, string archive, string root)
    {
        try
        {
            string target = Path.Combine(root, "virtual-display");
            ExtractZip(Path.Combine(payloadDir, archive), target);

            string[] drivers = Directory.GetFiles(target, "*.inf", SearchOption.AllDirectories);

            if (drivers.Length == 0)
            {
                Console.WriteLine("the driver package holds no .inf file");
                return 1;
            }

            foreach (string inf in drivers)
            {
                int code = Run("pnputil.exe", "/add-driver \"" + inf + "\" /install", false);

                if (code != 0)
                {
                    Console.WriteLine("pnputil returned " + code + " for " + Path.GetFileName(inf));
                    return code;
                }

                Console.WriteLine("the driver " + Path.GetFileName(inf) + " was installed");
            }

            Console.WriteLine("IT NEEDS A REBOOT before the second screen exists.");
            return 0;
        }
        catch (Exception e)
        {
            Console.WriteLine("the driver could not be installed: " + e.Message);
            return 1;
        }
    }

    /// <summary>Add a folder to the machine's PATH.</summary>
    private static void AddToMachinePath(string folder)
    {
        string current = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine);

        if (current == null)
        {
            current = "";
        }

        if (current.IndexOf(folder, StringComparison.OrdinalIgnoreCase) >= 0)
        {
            return;
        }

        string updated = current.TrimEnd(';') + ";" + folder;
        Environment.SetEnvironmentVariable("Path", updated, EnvironmentVariableTarget.Machine);
    }

    // -----------------------------------------------------------------------
    // what is already on the machine
    // -----------------------------------------------------------------------

    /// <summary>Whether a program runs and says its version.</summary>
    private static bool HasRuntime(string name)
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(name, "--version");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;

            Process process = Process.Start(start);

            if (process == null)
            {
                return false;
            }

            string output = process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            process.WaitForExit(5000);

            return process.ExitCode == 0 && output.Trim().Length > 0;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>Whether an editor is installed - its CLI, or its usual path.</summary>
    private static bool HasEditor(string cli)
    {
        return EditorPath(cli) != null;
    }

    /// <summary>
    /// The full path of an editor's CLI, or null when it is not installed.
    ///
    /// The PATH is searched first; then the usual install folders, because an
    /// editor that was JUST installed is not on the PATH of the program that
    /// installed it yet.
    /// </summary>
    private static string EditorPath(string cli)
    {
        string onPath = FindOnPath(cli);

        if (onPath != null)
        {
            return onPath;
        }

        string[] folders =
        {
            @"C:\Program Files\Microsoft VS Code\bin",
            @"C:\Program Files\VSCodium\bin",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Microsoft VS Code", "bin"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "VSCodium", "bin"),
        };

        foreach (string folder in folders)
        {
            string candidate = Path.Combine(folder, cli + ".cmd");

            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    /// <summary>Whether the virtual display driver is installed.</summary>
    private static bool DisplayDriverInstalled()
    {
        string driver = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System), "drivers", "IddCxDriver.sys");

        return File.Exists(driver);
    }

    /// <summary>A program on the PATH, or null.</summary>
    private static string FindOnPath(string name)
    {
        string path = Environment.GetEnvironmentVariable("Path");

        if (path == null)
        {
            return null;
        }

        string[] folders = path.Split(';');
        string[] extensions = { ".exe", ".cmd", ".bat" };

        foreach (string folder in folders)
        {
            if (string.IsNullOrEmpty(folder))
            {
                continue;
            }

            foreach (string extension in extensions)
            {
                string candidate = Path.Combine(folder.Trim(), name + extension);

                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }

        return null;
    }

    // -----------------------------------------------------------------------
    // 3. the app, with nothing installed
    // -----------------------------------------------------------------------

    /// <summary>
    /// Serve the prebuilt app out of the payload, and open the browser on it.
    ///
    /// This is the point of the whole program: the whiteboard, with nothing
    /// installed at all.
    /// </summary>
    private static int ServeApp(Manifest manifest, string payloadDir)
    {
        string appDir = Path.Combine(payloadDir, WebAppFolderName);
        string appZip = Path.Combine(payloadDir, AppZipName);

        if (!Directory.Exists(appDir))
        {
            if (!File.Exists(appZip))
            {
                Console.WriteLine("");
                Console.WriteLine("The payload carries no app, so there is nothing to serve.");
                return 1;
            }

            Console.WriteLine("");
            Console.WriteLine("Unpacking the app");
            ExtractZip(appZip, appDir);
        }

        string index = Path.Combine(appDir, "index.html");

        if (!File.Exists(index))
        {
            Console.WriteLine("");
            Console.WriteLine("The app has no index.html, so there is nothing to serve.");
            return 1;
        }

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");

        try
        {
            listener.Start();
        }
        catch (Exception e)
        {
            Console.WriteLine("");
            Console.WriteLine("The app's web server could not start on port " + port + ": " + e.Message);
            Console.WriteLine("Try another port with -Port <n>.");
            return 1;
        }

        string url = "http://127.0.0.1:" + port + "/";
        Console.WriteLine("");
        Console.WriteLine("The app is being served at " + url);
        Console.WriteLine("Nothing is installed: the app is a static bundle, and this program");
        Console.WriteLine("is the server. Press Ctrl+C to stop it.");

        if (!noBrowser)
        {
            OpenBrowser(url);
        }

        while (true)
        {
            HttpListenerContext context;

            try
            {
                context = listener.GetContext();
            }
            catch (Exception)
            {
                break;
            }

            try
            {
                Answer(context, appDir);
            }
            catch (Exception)
            {
                // a broken request must not stop the server
            }
        }

        listener.Stop();
        return 0;
    }

    /// <summary>Answer one request.</summary>
    private static void Answer(HttpListenerContext context, string appDir)
    {
        string path = context.Request.Url.AbsolutePath;
        string relative = Uri.UnescapeDataString(path).TrimStart('/');

        if (relative.Length == 0)
        {
            relative = "index.html";
        }

        string file = Path.Combine(appDir, relative.Replace('/', Path.DirectorySeparatorChar));

        if (!File.Exists(file))
        {
            // the app is a single page: an unknown path is the page itself
            file = Path.Combine(appDir, "index.html");
        }

        byte[] body = File.ReadAllBytes(file);

        context.Response.StatusCode = 200;
        context.Response.ContentType = ContentType(file);
        context.Response.ContentLength64 = body.Length;
        context.Response.OutputStream.Write(body, 0, body.Length);
        context.Response.OutputStream.Close();
    }

    /// <summary>The content type of a file, by its extension.</summary>
    private static string ContentType(string path)
    {
        string extension = Path.GetExtension(path).ToLowerInvariant();

        if (extension == ".html") return "text/html; charset=utf-8";
        if (extension == ".js") return "application/javascript; charset=utf-8";
        if (extension == ".mjs") return "application/javascript; charset=utf-8";
        if (extension == ".css") return "text/css; charset=utf-8";
        if (extension == ".json") return "application/json; charset=utf-8";
        if (extension == ".svg") return "image/svg+xml";
        if (extension == ".png") return "image/png";
        if (extension == ".jpg" || extension == ".jpeg") return "image/jpeg";
        if (extension == ".gif") return "image/gif";
        if (extension == ".webp") return "image/webp";
        if (extension == ".ico") return "image/x-icon";
        if (extension == ".woff") return "font/woff";
        if (extension == ".woff2") return "font/woff2";
        if (extension == ".ttf") return "font/ttf";
        if (extension == ".wasm") return "application/wasm";
        if (extension == ".map") return "application/json; charset=utf-8";
        if (extension == ".txt") return "text/plain; charset=utf-8";

        return "application/octet-stream";
    }

    /// <summary>Open the browser on a URL.</summary>
    private static void OpenBrowser(string url)
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(url);
            start.UseShellExecute = true;
            Process.Start(start);
        }
        catch (Exception e)
        {
            Console.WriteLine("The browser could not be opened: " + e.Message);
            Console.WriteLine("Open " + url + " yourself.");
        }
    }
}
