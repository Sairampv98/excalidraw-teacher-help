// The program a teacher starts: it serves the app on this computer and opens it in a window of its own.
// No console window. A small icon by the clock says it is running; "Quit" there stops it.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace ExcalidrawClassroom
{
    internal static class LauncherProgram
    {
        [STAThread]
        private static int Main(string[] args)
        {
            string home = AppDomain.CurrentDomain.BaseDirectory;
            string appDir = Path.Combine(home, "app");
            string portFile = Path.Combine(home, "port.txt");

            bool first;
            using (Mutex mutex = new Mutex(true, "Local\\ExcalidrawClassroomLauncher", out first))
            {
                if (!first)
                {
                    // it is already running: a window is opened on it, and this one ends
                    OpenWindow(ReadPort(portFile));
                    return 0;
                }

                if (!File.Exists(Path.Combine(appDir, "index.html")))
                {
                    MessageBox.Show("The app's files are missing from\n" + appDir + "\n\nRun the setup again to repair it.",
                        Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }

                StaticServer server = new StaticServer(appDir);
                int port;
                try { port = server.Start(Product.Port, 20); }
                catch (Exception e)
                {
                    MessageBox.Show("The board could not start on this computer: " + e.Message, Product.Name,
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                try { File.WriteAllText(portFile, port.ToString()); } catch { }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                using (NotifyIcon tray = new NotifyIcon())
                {
                    try { tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
                    catch { tray.Icon = SystemIcons.Application; }
                    tray.Text = Product.Name;
                    ContextMenuStrip menu = new ContextMenuStrip();
                    menu.Items.Add("Open " + Product.Name, null, delegate { OpenWindow(port); });
                    menu.Items.Add("Quit", null, delegate { Application.ExitThread(); });
                    tray.ContextMenuStrip = menu;
                    tray.DoubleClick += delegate { OpenWindow(port); };
                    tray.Visible = true;

                    OpenWindow(port);
                    if (port != Product.Port)
                    {
                        tray.ShowBalloonTip(6000, Product.Name,
                            "The usual address was busy, so this is a new place for your drawings. Close the other copy to get yours back.",
                            ToolTipIcon.Warning);
                    }
                    Application.Run();
                    tray.Visible = false;
                }
                server.Stop();
            }
            return 0;
        }

        private static int ReadPort(string file)
        {
            int port;
            try { if (int.TryParse(File.ReadAllText(file).Trim(), out port)) return port; } catch { }
            return Product.Port;
        }

        /// <summary>A window of its own (no tabs, no address bar) in Edge or Chrome, or the browser the machine has.</summary>
        private static void OpenWindow(int port)
        {
            // a test starts the launcher without a window opening
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CLASSROOM_NO_WINDOW"))) return;

            string url = "http://127.0.0.1:" + port + "/";
            string browser = FindBrowser();
            try
            {
                if (browser != null)
                {
                    // the window fits a small screen too (1024x768 and the like): never wider or taller than the working area
                    Rectangle area = Screen.PrimaryScreen.WorkingArea;
                    int width = Math.Min(1500, area.Width - 40), height = Math.Min(950, area.Height - 40);
                    // the Chromium that is not Google's own build says that it has no Google keys: told "no", it says nothing
                    Environment.SetEnvironmentVariable("GOOGLE_API_KEY", "no");
                    Environment.SetEnvironmentVariable("GOOGLE_DEFAULT_CLIENT_ID", "no");
                    Environment.SetEnvironmentVariable("GOOGLE_DEFAULT_CLIENT_SECRET", "no");
                    Process.Start(browser, "--app=" + url + " --window-size=" + width + "," + height + " --window-position=" + area.Left + "," + area.Top);
                    return;
                }
            }
            catch { }
            try { Process.Start(url); } catch { }
        }

        private static string FindBrowser()
        {
            string pf = Environment.GetEnvironmentVariable("ProgramFiles");
            string pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            string local = Environment.GetEnvironmentVariable("LocalAppData");
            string[] candidates = new string[]
            {
                // the browser the Windows 7 setup puts beside the program (Windows 7 has none that can run the board)
                Combine(AppDomain.CurrentDomain.BaseDirectory, "tools\\chromium\\chrome.exe"),
                Combine(pf86, "Microsoft\\Edge\\Application\\msedge.exe"),
                Combine(pf, "Microsoft\\Edge\\Application\\msedge.exe"),
                Combine(pf, "Google\\Chrome\\Application\\chrome.exe"),
                Combine(pf86, "Google\\Chrome\\Application\\chrome.exe"),
                Combine(local, "Google\\Chrome\\Application\\chrome.exe"),
            };
            foreach (string c in candidates) if (c != null && File.Exists(c)) return c;
            return null;
        }

        private static string Combine(string a, string b)
        {
            return string.IsNullOrEmpty(a) ? null : Path.Combine(a, b);
        }
    }
}
