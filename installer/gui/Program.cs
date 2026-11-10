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
                   "Uninstall.exe [/silent] [/remove=<ids>]   removes what was installed; a window asks which tools to take away, and /remove names them\r\n" +
                   "  /remove=python,node   takes away only those tools (the ids are the ones of /components); with no /remove, everything goes";
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

            InstallRecord record = InstallRecord.Load(dir);

            // /pictures=<folder> draws the window of the choice with a made-up record (the pages of the wizard are drawn the same way)
            string pictures;
            if (o.TryGetValue("pictures", out pictures) && pictures.Length > 0)
            {
                InstallRecord sample = new InstallRecord();
                sample.Dir = dir;
                string[] ids = new string[] { "app", "editor", "python", "java", "gcc", "node", "ocr" };
                string[] titles = new string[] { Engine.AppTitle, "VSCodium (the editor)", "Python", "Java (Temurin)", "C and C++ (GCC)", "Node.js", "Better text reading (Indra OCR)" };
                for (int i = 0; i < ids.Length; i++) { sample.BeginTool(ids[i], titles[i]); sample.EndTool(); }
                UninstallChoice.Draw(sample, pictures);
                return 0;
            }

            // what to take away: everything, or the tools that were named (/remove=python,node) or ticked (D-478)
            List<string> only = null;
            string named;
            if (o.TryGetValue("remove", out named) && named.Trim().Length > 0)
            {
                only = new List<string>();
                foreach (string id in named.Split(',')) if (id.Trim().Length > 0) only.Add(id.Trim());
            }
            else if (!silent && record.Tools.Count > 0)
            {
                only = UninstallChoice.Ask(record);
                if (only == null) return 3;
            }
            else if (!silent)
            {
                // a record from an older setup does not say what each tool put in: it is all or nothing
                DialogResult ask = MessageBox.Show(
                    "Remove " + Product.Name + " and the tools that were installed with it?\r\n\r\n" + dir +
                    "\r\n\r\nYour drawings are kept by the browser and are not deleted.",
                    Product.Name + " Uninstall", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (ask != DialogResult.Yes) return 3;
            }

            Engine engine = new Engine();
            List<string> notes = engine.Uninstall(dir, true, only);
            // the running uninstaller deletes itself once it has ended - when the whole install is gone; when some tools
            // stay, so does it (it is what takes the rest away later)
            if (engine.RemovedEverything) Engine.RemoveSelfLater(dir);
            if (!silent)
            {
                string what = engine.RemovedEverything ? Product.Name + " was removed." :
                    "What you chose was removed. The rest stays installed; run Uninstall again to take more away.";
                MessageBox.Show(notes.Count == 0 ? what :
                    what + "\r\n\r\nNotes:\r\n\r\n" + string.Join("\r\n", notes.ToArray()),
                    Product.Name + " Uninstall");
            }
            return 0;
        }
    }

    /// <summary>The list of what is installed, with a tick for each: the ticked ones are taken away.</summary>
    internal sealed class UninstallChoice : Form
    {
        private readonly CheckedListBox list = new CheckedListBox();
        private readonly Button remove = new Button();
        private readonly List<ToolRecord> tools;

        /// <summary>The ids of the tools to remove, or null when the person cancelled.</summary>
        public static List<string> Ask(InstallRecord record)
        {
            using (UninstallChoice form = new UninstallChoice(record))
            {
                if (form.ShowDialog() != DialogResult.OK) return null;
                return form.Ticked();
            }
        }

        /// <summary>Draws the window to a picture in the folder (for the proofs; nothing is asked or removed).</summary>
        public static void Draw(InstallRecord record, string folder)
        {
            Directory.CreateDirectory(folder);
            using (UninstallChoice form = new UninstallChoice(record))
            {
                form.CreateControl();
                form.Show();
                Application.DoEvents();
                using (System.Drawing.Bitmap bmp = new System.Drawing.Bitmap(form.Width, form.Height))
                {
                    form.DrawToBitmap(bmp, new System.Drawing.Rectangle(0, 0, form.Width, form.Height));
                    bmp.Save(Path.Combine(folder, "uninstall-choice.png"), System.Drawing.Imaging.ImageFormat.Png);
                }
                form.Hide();
            }
        }

        private UninstallChoice(InstallRecord record)
        {
            tools = record.Tools;
            Text = Product.Name + " Uninstall";
            Font = System.Drawing.SystemFonts.MessageBoxFont;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new System.Drawing.Size(460, 360);

            Label head = new Label();
            head.Text = "Choose what to remove. Tick all of it to remove everything; what you leave unticked stays installed and keeps working.";
            head.SetBounds(16, 14, 428, 48);
            Controls.Add(head);

            list.SetBounds(16, 68, 428, 200);
            list.CheckOnClick = true;
            foreach (ToolRecord t in tools) list.Items.Add(t.Title.Length > 0 ? t.Title : t.Id, true);
            list.ItemCheck += delegate { BeginInvoke(new MethodInvoker(Refresh2)); };
            Controls.Add(list);

            Label note = new Label();
            note.Text = "Your drawings are kept by the browser and are not deleted.\r\nFolder: " + record.Dir;
            note.SetBounds(16, 276, 428, 40);
            Controls.Add(note);

            remove.Text = "Remove";
            remove.SetBounds(268, 322, 84, 28);
            remove.DialogResult = DialogResult.OK;
            Controls.Add(remove);

            Button cancel = new Button();
            cancel.Text = "Cancel";
            cancel.SetBounds(360, 322, 84, 28);
            cancel.DialogResult = DialogResult.Cancel;
            Controls.Add(cancel);

            AcceptButton = remove;
            CancelButton = cancel;
        }

        private void Refresh2()
        {
            remove.Enabled = list.CheckedItems.Count > 0;
        }

        private List<string> Ticked()
        {
            List<string> ids = new List<string>();
            for (int i = 0; i < tools.Count; i++) if (list.GetItemChecked(i)) ids.Add(tools[i].Id);
            return ids;
        }
    }
}
