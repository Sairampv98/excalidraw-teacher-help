// The wizard: Welcome, Choose, Ready, Installing, Finished. Plain WinForms (it ships with Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace ExcalidrawClassroom
{
    internal sealed class WizardForm : Form
    {
        private enum Page { Welcome, Choose, Ready, Installing, Finished }

        private readonly List<Component> components;
        private readonly InstallOptions options = new InstallOptions();
        private readonly Dictionary<string, CheckBox> boxes = new Dictionary<string, CheckBox>();

        private Page page = Page.Welcome;
        private Panel body;
        private Label headTitle;
        private Label headSub;
        private Button back;
        private Button next;
        private Button cancel;

        private TextBox dirBox;
        private CheckBox desktopBox;
        private CheckBox menuBox;
        private Label spaceLabel;
        private Label summary;
        private ProgressBar bar;
        private Label status;
        private TextBox log;
        private CheckBox openNow;
        private Label finishText;

        private Thread worker;
        private bool installOk;
        private string missing;
        private bool restartNeeded;
        private string failure;
        private string existing;

        private static readonly Font Normal = new Font("Segoe UI", 9.5f);
        private static readonly Font Small = new Font("Segoe UI", 8.5f);
        private static readonly Font Big = new Font("Segoe UI Semibold", 17f);

        public WizardForm(List<Component> components)
        {
            this.components = components;
            foreach (Component c in components) if (c.Checked) options.Components.Add(c.Id);
            existing = Engine.InstalledDir();
            if (!string.IsNullOrEmpty(existing)) options.Dir = existing;

            Text = Product.Name + " Setup";
            Font = Normal;
            ClientSize = new Size(760, 580);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.White;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // the header band
            Panel head = new Panel();
            head.SetBounds(0, 0, 760, 78);
            head.BackColor = Color.FromArgb(247, 247, 252);
            headTitle = new Label();
            headTitle.Font = Big;
            headTitle.ForeColor = Color.FromArgb(46, 46, 117);
            headTitle.SetBounds(24, 10, 712, 36);
            headSub = new Label();
            headSub.ForeColor = Color.FromArgb(90, 90, 110);
            headSub.SetBounds(26, 48, 712, 22);
            head.Controls.Add(headTitle);
            head.Controls.Add(headSub);
            Controls.Add(head);

            Panel rule = new Panel();
            rule.SetBounds(0, 78, 760, 1);
            rule.BackColor = Color.FromArgb(220, 220, 232);
            Controls.Add(rule);

            body = new Panel();
            body.SetBounds(0, 79, 760, 441);
            Controls.Add(body);

            Panel foot = new Panel();
            foot.SetBounds(0, 520, 760, 60);
            foot.BackColor = Color.FromArgb(247, 247, 252);
            back = MakeButton("< Back", 432);
            next = MakeButton("Next >", 526);
            cancel = MakeButton("Cancel", 636);
            back.Click += delegate { Go(page - 1); };
            next.Click += delegate { OnNext(); };
            cancel.Click += delegate { OnCancel(); };
            foot.Controls.Add(back);
            foot.Controls.Add(next);
            foot.Controls.Add(cancel);
            Controls.Add(foot);
            AcceptButton = next;

            BuildPages();
            Go(Page.Welcome);
        }

        private Button MakeButton(string text, int x)
        {
            Button b = new Button();
            b.Text = text;
            b.SetBounds(x, 14, 94, 30);
            b.FlatStyle = FlatStyle.System;
            return b;
        }

        // ---------------------------------------------------------------------------------- the pages

        private Panel welcome, choose, ready, installing, finished;
        private CheckBox keepBox;

        private void BuildPages()
        {
            welcome = NewPage();
            Label w = Lab(welcome, 32, 22, 690, 140,
                Edition.Student
                    ? "This sets up this computer for the class: the editor (VS Code) and the languages the lessons use - " +
                      "Python, Java, C and C++, and Node.js.\r\n\r\n" +
                      (Payload.Online ? "This small setup downloads what it installs, so it needs the internet while it runs. " : (Payload.Folder() != null ? "Everything is in the folder this file is in, so keep them together. It needs no internet, and " : "Everything is in this one file. It needs no internet, and ")) +
                      "it asks for no administrator rights: " +
                      "it is installed for you alone, and nothing is changed for other people who use this computer."
                    : "This sets up " + Product.Name + " on this computer: a board you draw on while you teach, with pages, " +
                      "a code editor, a presenter window, animated flowcharts, and an assistant.\r\n\r\n" +
                      (Payload.Online ? "This small setup downloads what it installs, so it needs the internet while it runs. " : (Payload.Folder() != null ? "Everything is in the folder this file is in, so keep them together. It needs no internet, and " : "Everything is in this one file. It needs no internet, and ")) +
                      "it asks for no administrator rights: " +
                      "it is installed for you alone.");
            w.Font = new Font("Segoe UI", 10.5f);
            if (!string.IsNullOrEmpty(existing))
            {
                Label e = Lab(welcome, 32, 170, 650, 50,
                    "It is already installed in " + existing + ". Going on updates it and keeps your drawings.");
                e.ForeColor = Color.FromArgb(46, 46, 117);
                LinkLabel remove = new LinkLabel();
                remove.Text = "Remove it instead";
                remove.AutoSize = true;
                // not a stop of the Tab key: with the focus on it, Enter would remove the program instead of going on
                remove.TabStop = false;
                remove.Location = new Point(32, 222);
                remove.LinkClicked += delegate
                {
                    string un = Path.Combine(existing, Product.UninstallExe);
                    if (File.Exists(un)) { Process.Start(un); Close(); }
                };
                welcome.Controls.Add(remove);
            }
            Lab(welcome, 32, 300, 650, 40, "Click Next to choose what to install.").ForeColor = Color.FromArgb(90, 90, 110);

            choose = NewPage();
            choose.AutoScroll = true;
            int y = 8;
            foreach (Component c in components)
            {
                CheckBox box = new CheckBox();
                box.Text = c.Title + "   (" + Files.Size(c.Bytes) + ")";
                box.Font = new Font("Segoe UI Semibold", 9.5f);
                box.Checked = c.Checked;
                box.Enabled = !c.Required;
                box.AutoSize = true;
                box.Location = new Point(32, y);
                Component captured = c;
                box.CheckedChanged += delegate
                {
                    if (box.Checked) options.Components.Add(captured.Id); else options.Components.Remove(captured.Id);
                    UpdateSpace();
                };
                choose.Controls.Add(box);
                boxes[c.Id] = box;
                Label detail = Lab(choose, 52, y + 21, 630, 18, c.Detail);
                detail.Font = Small;
                detail.ForeColor = Color.FromArgb(90, 90, 110);
                y += 46;
            }
            Lab(choose, 32, y + 4, 76, 20, "Install to:");
            dirBox = new TextBox();
            dirBox.SetBounds(112, y + 2, 450, 24);
            dirBox.Text = options.Dir;
            dirBox.TextChanged += delegate { options.Dir = dirBox.Text; UpdateSpace(); };
            Button browse = new Button();
            browse.Text = "Browse...";
            browse.FlatStyle = FlatStyle.System;
            browse.SetBounds(572, y, 90, 28);
            browse.Click += delegate
            {
                using (FolderBrowserDialog d = new FolderBrowserDialog())
                {
                    d.Description = "Choose the folder to install into";
                    if (d.ShowDialog(this) == DialogResult.OK) dirBox.Text = Path.Combine(d.SelectedPath, Product.DirName);
                }
            };
            choose.Controls.Add(dirBox);
            choose.Controls.Add(browse);
            desktopBox = new CheckBox();
            desktopBox.Text = "A shortcut on the desktop";
            desktopBox.Checked = true;
            desktopBox.AutoSize = true;
            desktopBox.Location = new Point(32, y + 36);
            desktopBox.CheckedChanged += delegate { options.DesktopShortcut = desktopBox.Checked; };
            menuBox = new CheckBox();
            menuBox.Text = "A shortcut in the Start menu";
            menuBox.Checked = true;
            menuBox.AutoSize = true;
            menuBox.Location = new Point(300, y + 36);
            menuBox.CheckedChanged += delegate { options.StartMenuShortcut = menuBox.Checked; };
            if (Edition.Student)
            {
                // no board, so nothing to put on the desktop; the Start menu keeps the way to remove it
                desktopBox.Checked = false;
                desktopBox.Visible = false;
                options.DesktopShortcut = false;
                menuBox.Text = "An Uninstall shortcut in the Start menu";
                menuBox.Location = new Point(32, y + 36);
            }
            choose.Controls.Add(desktopBox);
            choose.Controls.Add(menuBox);
            spaceLabel = Lab(choose, 32, y + 68, 650, 20, "");
            spaceLabel.Font = Small;

            ready = NewPage();
            Lab(ready, 32, 14, 650, 24, "Ready to install. This is what will be done:").Font = new Font("Segoe UI Semibold", 10f);
            summary = Lab(ready, 32, 46, 650, 250, "");
            if (Payload.Online)
            {
                keepBox = new CheckBox();
                keepBox.Text = "Keep the downloaded files, to install on another computer with no internet";
                keepBox.AutoSize = true;
                keepBox.Location = new Point(32, 310);
                keepBox.CheckedChanged += delegate
                {
                    options.KeepFolder = keepBox.Checked
                        ? Path.Combine(Path.Combine(Environment.GetEnvironmentVariable("USERPROFILE") ?? "", "Downloads"), Product.Folder + " files")
                        : null;
                    summary.Text = string.Join("\r\n", Engine.DescribePlan(options, components).ToArray());
                };
                ready.Controls.Add(keepBox);
            }

            installing = NewPage();
            status = Lab(installing, 32, 18, 650, 22, "Starting...");
            bar = new ProgressBar();
            bar.SetBounds(32, 48, 650, 22);
            bar.Maximum = 1000;
            installing.Controls.Add(bar);
            log = new TextBox();
            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Vertical;
            log.Font = new Font("Consolas", 8.5f);
            log.BackColor = Color.FromArgb(250, 250, 252);
            log.SetBounds(32, 86, 650, 250);
            installing.Controls.Add(log);

            finished = NewPage();
            finishText = Lab(finished, 32, 22, 650, 160, "");
            finishText.Font = new Font("Segoe UI", 10.5f);
            openNow = new CheckBox();
            openNow.Text = "Open " + Product.Name + " now";
            openNow.Checked = true;
            openNow.AutoSize = true;
            openNow.Location = new Point(32, 220);
            finished.Controls.Add(openNow);
            UpdateSpace();
        }

        private Panel NewPage()
        {
            Panel p = new Panel();
            p.Dock = DockStyle.Fill;
            p.BackColor = Color.White;
            p.Visible = false;
            body.Controls.Add(p);
            return p;
        }

        private static Label Lab(Panel parent, int x, int y, int w, int h, string text)
        {
            Label l = new Label();
            l.SetBounds(x, y, w, h);
            l.Text = text;
            parent.Controls.Add(l);
            return l;
        }

        private void UpdateSpace()
        {
            long need = 0;
            foreach (Component c in components) if (options.Components.Contains(c.Id)) need += c.Bytes * 2;
            long free = Engine.FreeSpace(string.IsNullOrEmpty(options.Dir) ? Product.DefaultDir() : options.Dir);
            bool ok = free >= need;
            spaceLabel.Text = "Needs about " + Files.Size(need) + " while installing" +
                (free == long.MaxValue ? "." : "; " + Files.Size(free) + " is free on that disk.");
            spaceLabel.ForeColor = ok ? Color.FromArgb(90, 90, 110) : Color.Firebrick;
            if (page == Page.Choose) next.Enabled = ok && !string.IsNullOrEmpty(options.Dir);
        }

        // ---------------------------------------------------------------------------------- moving about

        private void Go(Page to)
        {
            page = to;
            welcome.Visible = to == Page.Welcome;
            choose.Visible = to == Page.Choose;
            ready.Visible = to == Page.Ready;
            installing.Visible = to == Page.Installing;
            finished.Visible = to == Page.Finished;
            back.Visible = to == Page.Choose || to == Page.Ready;
            cancel.Visible = to != Page.Finished;
            cancel.Enabled = to != Page.Installing;
            next.Enabled = true;
            next.Text = to == Page.Ready ? "Install" : to == Page.Finished ? "Finish" : "Next >";

            switch (to)
            {
                case Page.Welcome:
                    headTitle.Text = "Welcome";
                    headSub.Text = "Setup for " + Product.Name + " " + Product.Version();
                    break;
                case Page.Choose:
                    headTitle.Text = "What to install";
                    headSub.Text = Edition.Student
                        ? "Choose the tools the class needs. They are for you alone."
                        : "The board is always installed. The tools are for the lessons, and they are optional.";
                    UpdateSpace();
                    break;
                case Page.Ready:
                    headTitle.Text = "Ready";
                    headSub.Text = "Nothing is changed until you press Install.";
                    summary.Text = string.Join("\r\n", Engine.DescribePlan(options, components).ToArray());
                    break;
                case Page.Installing:
                    headTitle.Text = "Installing";
                    headSub.Text = "This takes a few minutes. Please keep the window open.";
                    next.Enabled = false;
                    break;
                case Page.Finished:
                    headTitle.Text = installOk ? "All set" : "Setup did not finish";
                    headSub.Text = installOk ? Product.Name + " is installed." : "Nothing was left half-installed.";
                    finishText.Text = installOk
                        ? "Open it from the desktop shortcut or the Start menu. A small icon by the clock shows that it is running; right-click it and choose Quit to stop it.\r\n\r\nTo take it away again, use Uninstall in the Start menu, or Apps in Windows settings."
                        : (failure ?? "Something went wrong.") + "\r\n\r\nThe log is on the previous page.";
                    if (installOk && restartNeeded)
                    {
                        headTitle.Text = "Restart Windows to finish";
                        headSub.Text = "A Windows update was put in.";
                        finishText.Text = "Restart Windows now, then run this setup again: it puts in Python, which needs the update." + (string.IsNullOrEmpty(missing) ? "" : "\r\n\r\nNot installed yet: " + missing + ".");
                    }
                    else if (installOk && !string.IsNullOrEmpty(missing))
                    {
                        headTitle.Text = "Installed, but not everything";
                        headSub.Text = "Some tools could not be put in.";
                        finishText.Text = "These were not installed: " + missing + ".\r\n\r\nThe log (on the previous page) says why. Run the setup again to try those; what is already in place stays.";
                    }
                    openNow.Visible = installOk;
                    break;
            }
        }

        private void OnNext()
        {
            switch (page)
            {
                case Page.Welcome: Go(Page.Choose); break;
                case Page.Choose:
                    options.Dir = dirBox.Text.Trim();
                    if (options.Dir.Length == 0) return;
                    Go(Page.Ready);
                    break;
                case Page.Ready: StartInstall(); break;
                case Page.Finished:
                    if (installOk && openNow.Checked)
                    {
                        try { Process.Start(Path.Combine(options.Dir, Product.LauncherExe)); } catch { }
                    }
                    Close();
                    break;
            }
        }

        private void OnCancel()
        {
            if (page == Page.Installing) return;
            Close();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (page == Page.Installing && worker != null && worker.IsAlive)
            {
                e.Cancel = true;
                MessageBox.Show(this, "The install is still running. Please wait for it to finish.", Product.Name);
                return;
            }
            base.OnFormClosing(e);
        }

        // ---------------------------------------------------------------------------------- the work

        private void StartInstall()
        {
            Go(Page.Installing);
            Engine engine = new Engine();
            engine.Log = delegate (string line) { Ui(delegate { log.AppendText(line + "\r\n"); }); };
            engine.Progress = delegate (double fraction, string words)
            {
                Ui(delegate
                {
                    bar.Value = Math.Max(0, Math.Min(1000, (int)(fraction * 1000)));
                    if (words != null) status.Text = words + "...";
                });
            };
            worker = new Thread(delegate ()
            {
                try
                {
                    engine.Install(options, null);
                    installOk = true;
                    if (engine.NotInstalled.Count > 0) missing = string.Join(", ", engine.NotInstalled.ToArray());
                    restartNeeded = engine.RestartNeeded;
                }
                catch (Exception e)
                {
                    installOk = false;
                    failure = e.Message;
                    engine.Log("! " + e.Message);
                }
                Ui(delegate { Go(Page.Finished); });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void Ui(Action action)
        {
            if (IsHandleCreated && !IsDisposed) BeginInvoke(action);
        }

        // ---------------------------------------------------------------------------------- pictures of the pages

        /// <summary>Draws each page to a picture, to look at (and to keep in the docs).</summary>
        public void Pictures(string folder)
        {
            Directory.CreateDirectory(folder);
            CreateControl();
            Show();
            Page[] pages = new Page[] { Page.Welcome, Page.Choose, Page.Ready, Page.Installing, Page.Finished };
            installOk = true;
            summary.Text = "";
            foreach (Page p in pages)
            {
                Go(p);
                if (p == Page.Installing)
                {
                    bar.Value = 420;
                    status.Text = "Installing Python...";
                    log.Text = "Putting the program in place\r\nUnpacking the board\r\nInstalling Java (Temurin)\r\nInstalling Python";
                }
                Application.DoEvents();
                using (Bitmap bmp = new Bitmap(Width, Height))
                {
                    DrawToBitmap(bmp, new Rectangle(0, 0, Width, Height));
                    bmp.Save(Path.Combine(folder, (int)p + 1 + "-" + p.ToString().ToLowerInvariant() + ".png"), System.Drawing.Imaging.ImageFormat.Png);
                }
            }
            Hide();
        }
    }
}
