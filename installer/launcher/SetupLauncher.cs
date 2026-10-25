// The setup, as one file a teacher can double-click.
//
// It finds the repository it belongs to, runs installer/setup.ps1 inside it,
// and waits for it. Every argument is passed straight through, so
//
//     setup.exe -DryRun
//     setup.exe -Yes
//
// mean exactly what they mean in PowerShell.
//
// The installer scripts are EMBEDDED, so the executable still works if the
// installer folder was deleted: they are extracted to a temporary folder and
// used from there. The repository is still needed for the extension's .vsix
// and the app's dependencies - the script says so when it cannot find them.
//
// C# 5: this is compiled by the compiler that ships with Windows, so no
// string interpolation, no expression-bodied members and no 'nameof'.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.InteropServices;
using System.Text;

internal static class SetupLauncher
{
    private const string ScriptResource = "setup.ps1";
    private const string LibResource = "check.mjs";
    private const string ShellResource = "setup.sh";
    private const string InstallerFolder = "installer";

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    [DllImport("kernel32.dll")]
    private static extern bool AllocConsole();

    private static int Main(string[] args)
    {
        try
        {
            string repo = FindRepository();
            string script;

            if (repo != null)
            {
                script = Path.Combine(repo, InstallerFolder, "setup.ps1");
                if (!File.Exists(script))
                {
                    script = ExtractInstaller();
                }
                Console.WriteLine("Excalidraw for the classroom - setup");
                Console.WriteLine("Repository: " + repo);
            }
            else
            {
                script = ExtractInstaller();
                Console.WriteLine("Excalidraw for the classroom - setup");
                Console.WriteLine(
                    "No repository found next to this executable, so the extension and" +
                    Environment.NewLine +
                    "the app's dependencies cannot be installed from here. Run it from a" +
                    Environment.NewLine +
                    "clone of the project, or copy this executable into one.");
            }

            string quoted = Quote(script);
            for (int i = 0; i < args.Length; i++)
            {
                quoted += " " + Quote(args[i]);
            }

            Console.WriteLine();
            Console.WriteLine("Running: powershell -ExecutionPolicy Bypass -File " + quoted);
            Console.WriteLine();

            ProcessStartInfo start = new ProcessStartInfo(
                "powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File " + quoted);
            start.UseShellExecute = false;
            start.WorkingDirectory = repo ?? Path.GetTempPath();

            Process process = Process.Start(start);
            process.WaitForExit();

            Console.WriteLine();
            Console.WriteLine(
                "The setup finished with exit code " + process.ExitCode + ".");
            return process.ExitCode;
        }
        catch (Exception e)
        {
            Console.WriteLine("The setup could not start: " + e.Message);
            return 1;
        }
    }

    /// <summary>
    /// The repository this executable belongs to: the folder it sits in, or any
    /// folder above it, that holds an installer/setup.ps1.
    /// </summary>
    private static string FindRepository()
    {
        string[] starts = new string[]
        {
            Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),
            Environment.CurrentDirectory,
        };

        for (int i = 0; i < starts.Length; i++)
        {
            string dir = starts[i];
            if (string.IsNullOrEmpty(dir))
            {
                continue;
            }

            for (int depth = 0; depth < 6; depth++)
            {
                if (File.Exists(Path.Combine(dir, InstallerFolder, "setup.ps1")))
                {
                    return dir;
                }

                string parent = Path.GetDirectoryName(dir);
                if (string.IsNullOrEmpty(parent) || parent == dir)
                {
                    break;
                }
                dir = parent;
            }
        }

        return null;
    }

    /// <summary>
    /// The embedded installer, written to a temporary folder. The folder is
    /// kept for the run and removed afterwards.
    /// </summary>
    private static string ExtractInstaller()
    {
        string dir = Path.Combine(
            Path.GetTempPath(),
            "excalidraw-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        string installer = Path.Combine(dir, InstallerFolder);
        string lib = Path.Combine(installer, "lib");

        Directory.CreateDirectory(lib);
        Write(ScriptResource, Path.Combine(installer, "setup.ps1"));
        Write(ShellResource, Path.Combine(installer, "setup.sh"));
        Write(LibResource, Path.Combine(lib, "check.mjs"));

        return Path.Combine(installer, "setup.ps1");
    }

    private static void Write(string resource, string path)
    {
        Assembly assembly = Assembly.GetExecutingAssembly();

        using (Stream stream = assembly.GetManifestResourceStream(resource))
        {
            if (stream == null)
            {
                throw new InvalidOperationException(
                    "the embedded " + resource + " is missing from this executable");
            }

            byte[] bytes = new byte[stream.Length];
            int read = 0;
            while (read < bytes.Length)
            {
                int n = stream.Read(bytes, read, bytes.Length - read);
                if (n <= 0)
                {
                    break;
                }
                read += n;
            }

            File.WriteAllBytes(path, bytes);
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
