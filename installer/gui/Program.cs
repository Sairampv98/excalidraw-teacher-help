// The setup and the uninstaller are one program that behaves by its name and its arguments:
//   ClassroomSetup.exe              the wizard
//   ClassroomSetup.exe /silent      no window: for a script (see /help)
//   Uninstall.exe                   the uninstaller (a small build without the payload)
//   /selftest                       checks its own parts and prints the result
//   /pictures=<folder>              draws each page of the wizard to a picture
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace ExcalidrawClassroom
{
    internal static class Program
    {
        private static Dictionary<string, string> Options(string[] args)
        {
            Dictionary<string, string> o = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string a in args)
            {
                string t = a.TrimStart('/', '-');
                int eq = t.IndexOf('=');
                if (eq < 0) o[t] = "";
                else o[t.Substring(0, eq)] = t.Substring(eq + 1).Trim('"');
            }
            return o;
        }

        [STAThread]
        private static int Main(string[] args)
        {
            Dictionary<string, string> o = Options(args);
            string name = Path.GetFileNameWithoutExtension(Application.ExecutablePath);
            bool silent = o.ContainsKey("silent") || o.ContainsKey("S");

            if (o.ContainsKey("selftest")) return SelfTest.Run();
            if (o.ContainsKey("help") || o.ContainsKey("?")) { Console.WriteLine(Help()); return 0; }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (name.Equals("Uninstall", StringComparison.OrdinalIgnoreCase) || o.ContainsKey("uninstall"))
            {
                return Uninstaller(o, silent);
            }
            return Installer(o, silent);
        }

        private static string Help()
        {
            return "ClassroomSetup.exe [/silent] [/dir=<folder>] [/components=app,editor,python,java,gcc,node] [/nodesktop] [/nostartmenu] [/log=<file>]\r\n" +
                   "  /silent        no window; the exit code says how it went (0 = installed; 1 failed; 3 not for this Windows; 4 some tools not installed)\r\n" +
                   "  /components    what to install; the default is everything the setup carries\r\n" +
                   "  /keep=<folder> the online setup also keeps the files it downloads in <folder>\r\n" +
                   "  /force         go on although this Windows is one the setup is not made for\r\n" +
                   "  /pictures=<f>  draw each page of the wizard to a picture in <f>\r\n" +
                   "Uninstall.exe [/silent]   removes what was installed";
        }

        // ---------------------------------------------------------------------------------- install

        private static int Installer(Dictionary<string, string> o, bool silent)
        {
            string problem = Supported.Problem(Supported.Is64(), Supported.Build());
            if (problem != null && !o.ContainsKey("force"))
            {
                if (!silent) MessageBox.Show(problem, Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                else Console.Error.WriteLine(problem);
                return 3;
            }
            if (!Payload.Present())
            {
                if (!silent) MessageBox.Show("This copy of the setup has nothing inside it to install.\r\nDownload the full setup file again.", Product.Name);
                return 2;
            }
            List<Component> all = Components.All(Payload.Files());

            string pictures;
            if (o.TryGetValue("pictures", out pictures))
            {
                using (WizardForm w = new WizardForm(all)) w.Pictures(pictures);
                return 0;
            }

            if (!silent)
            {
                Application.Run(new WizardForm(all));
                return 0;
            }

            InstallOptions options = new InstallOptions();
            string dir;
            if (o.TryGetValue("dir", out dir) && dir.Length > 0) options.Dir = dir;
            string list;
            if (o.TryGetValue("components", out list) && list.Length > 0)
            {
                foreach (string id in list.Split(',')) options.Components.Add(id.Trim());
                options.Components.Add("app");
                options.Components.Add("browser");
            }
            else
            {
                foreach (Component c in all) options.Components.Add(c.Id);
            }
            string keep;
            if (o.TryGetValue("keep", out keep) && keep.Length > 0) options.KeepFolder = keep;
            options.DesktopShortcut = !o.ContainsKey("nodesktop");
            options.StartMenuShortcut = !o.ContainsKey("nostartmenu");

            string logFile;
            StreamWriter writer = null;
            if (o.TryGetValue("log", out logFile) && logFile.Length > 0) writer = new StreamWriter(logFile, false, Encoding.UTF8);
            Engine engine = new Engine();
            engine.Log = delegate (string line)
            {
                Console.WriteLine(line);
                if (writer != null) { writer.WriteLine(line); writer.Flush(); }
            };
            try
            {
                engine.Install(options, null);
                if (engine.NotInstalled.Count > 0)
                {
                    engine.Log("! not everything was installed: " + string.Join(", ", engine.NotInstalled.ToArray()));
                    return 4;
                }
                return 0;
            }
            catch (Exception e)
            {
                engine.Log("! " + e.Message);
                return 1;
            }
            finally { if (writer != null) writer.Dispose(); }
        }

        // ---------------------------------------------------------------------------------- uninstall

        private static int Uninstaller(Dictionary<string, string> o, bool silent)
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (!File.Exists(Path.Combine(dir, Product.RecordFile)))
            {
                string registered = Engine.InstalledDir();
                if (registered != null && File.Exists(Path.Combine(registered, Product.RecordFile))) dir = registered;
            }

            if (!silent)
            {
                DialogResult ask = MessageBox.Show(
                    "Remove " + Product.Name + " and the tools that were installed with it?\r\n\r\n" + dir +
                    "\r\n\r\nYour drawings are kept by the browser and are not deleted.",
                    Product.Name + " Uninstall", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (ask != DialogResult.Yes) return 3;
            }

            Engine engine = new Engine();
            List<string> notes = engine.Uninstall(dir, true);
            // the running uninstaller deletes itself once it has ended
            Engine.RemoveSelfLater(dir);
            if (!silent)
            {
                MessageBox.Show(notes.Count == 0 ? Product.Name + " was removed." :
                    Product.Name + " was removed, with these notes:\r\n\r\n" + string.Join("\r\n", notes.ToArray()),
                    Product.Name + " Uninstall");
            }
            return 0;
        }
    }
}
