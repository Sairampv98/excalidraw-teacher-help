// The parts of the installer, checked by the installer itself: `ClassroomSetup.exe /selftest`.
// It prints "ok - ..." or "not ok - ..." for each, and its exit code is the number that failed.
// Nothing of the real machine is changed: the registry work is done in a test key, the files in a temp folder.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using Microsoft.Win32;

namespace ExcalidrawClassroom
{
    internal static class SelfTest
    {
        private static int failed;

        private static void Check(string name, bool condition)
        {
            Console.WriteLine((condition ? "ok - " : "not ok - ") + name);
            if (!condition) failed++;
        }

        private static string Get(int port, string path, string range, out int status, out long length, out string type)
        {
            HttpWebRequest r = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
            if (range != null) r.AddRange(int.Parse(range.Split('-')[0]), int.Parse(range.Split('-')[1]));
            try
            {
                using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    status = (int)resp.StatusCode;
                    length = resp.ContentLength;
                    type = resp.ContentType;
                    return reader.ReadToEnd();
                }
            }
            catch (WebException e)
            {
                HttpWebResponse resp = e.Response as HttpWebResponse;
                status = resp == null ? 0 : (int)resp.StatusCode;
                length = 0;
                type = "";
                return "";
            }
        }

        public static int Run()
        {
            string temp = Path.Combine(Path.GetTempPath(), "classroom-selftest-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(temp);
            string testKey = @"Software\ExcalidrawClassroomSelfTest\Environment";
            try
            {
                // ---- the user's PATH and variables
                UserEnvironment env = new UserEnvironment(testKey);
                env.SetVariable("Path", "C:\\Existing");
                Check("the PATH gets a folder added", env.AddToPath("C:\\Tools\\A") && env.GetPath() == "C:\\Existing;C:\\Tools\\A");
                Check("the same folder is not added twice, whatever its case or trailing slash", !env.AddToPath("c:\\tools\\a\\") && env.GetPath() == "C:\\Existing;C:\\Tools\\A");
                Check("a folder that is not there is not removed", !env.RemoveFromPath("C:\\Nope"));
                Check("the folder is taken out, and the rest stays", env.RemoveFromPath("C:\\TOOLS\\A") && env.GetPath() == "C:\\Existing");
                env.SetVariable("JAVA_HOME", "C:\\jdk");
                Check("a variable is set", env.GetVariable("JAVA_HOME") == "C:\\jdk");
                env.RemoveVariable("JAVA_HOME");
                Check("a variable is removed", env.GetVariable("JAVA_HOME") == null);
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\ExcalidrawClassroomSelfTest", false);

                // ---- archives
                string zipPath = Path.Combine(temp, "tool.zip");
                using (ZipArchive zip = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    AddEntry(zip, "jdk-21/bin/java.exe", "java");
                    AddEntry(zip, "jdk-21/lib/x.txt", "x");
                }
                string target = Path.Combine(temp, "jdk");
                Files.ExtractZip(zipPath, target, null);
                Check("an archive with one top folder is unpacked without it", File.Exists(Path.Combine(target, "bin", "java.exe")) && !Directory.Exists(Path.Combine(target, "jdk-21")));

                string evil = Path.Combine(temp, "evil.zip");
                using (ZipArchive zip = ZipFile.Open(evil, ZipArchiveMode.Create)) AddEntry(zip, "../outside.txt", "no");
                bool refused = false;
                try { Files.ExtractZip(evil, Path.Combine(temp, "safe"), null); } catch (InvalidDataException) { refused = true; }
                Check("an archive that points outside its folder is refused", refused && !File.Exists(Path.Combine(temp, "outside.txt")));

                Check("a path is inside a folder, and a sibling that starts the same is not", Files.IsInside("C:\\a\\b", "C:\\a\\b\\c") && !Files.IsInside("C:\\a\\b", "C:\\a\\bc\\d"));
                Check("sizes are said in words", Files.Size(2L * 1073741824) == "2.0 GB" && Files.Size(700L * 1048576) == "700 MB");

                // ---- the web server of the launcher
                string root = Path.Combine(temp, "app");
                Directory.CreateDirectory(Path.Combine(root, "clips"));
                File.WriteAllText(Path.Combine(root, "index.html"), "<html>the app</html>");
                File.WriteAllText(Path.Combine(root, "clips", "a.webm"), "0123456789");
                StaticServer server = new StaticServer(root);
                int port = server.Start(47900, 20);
                int status; long length; string type;
                string body = Get(port, "/", null, out status, out length, out type);
                Check("the server gives the app at its address", status == 200 && body.Contains("the app") && type.StartsWith("text/html"));
                body = Get(port, "/some/link/without/extension", null, out status, out length, out type);
                Check("an address of the app (a link) is answered with the app", status == 200 && body.Contains("the app"));
                Get(port, "/missing.js", null, out status, out length, out type);
                Check("a missing file is a 404", status == 404);
                Get(port, "/..%2f..%2fWindows%2fwin.ini", null, out status, out length, out type);
                Check("a path that leaves the folder is refused", status == 403 || status == 404);
                body = Get(port, "/clips/a.webm", "2-5", out status, out length, out type);
                Check("a range is answered with just those bytes (so a video can seek)", status == 206 && body == "2345" && type == "video/webm");
                body = Get(port, "/__classroom", null, out status, out length, out type);
                Check("the server says what it is", body == "excalidraw-classroom");
                server.Stop();
                Check("content types: wasm, mjs and gz", StaticServer.ContentType("a.wasm") == "application/wasm" && StaticServer.ContentType("a.mjs").StartsWith("text/javascript") && StaticServer.ContentType("a.traineddata.gz") == "application/octet-stream");

                // ---- the record of an install
                InstallRecord record = new InstallRecord();
                record.Dir = Path.Combine(temp, "install");
                record.Version = "1.2.3";
                record.Components.Add("app");
                record.PathEntries.Add("C:\\x\\bin");
                record.Variables.Add("JAVA_HOME");
                record.Shortcuts.Add("C:\\x.lnk");
                record.Uninstallers.Add("C:\\u.exe|/quiet");
                record.Save();
                InstallRecord back = InstallRecord.Load(record.Dir);
                Check("what an install did is kept, and read back whole",
                    back.Version == "1.2.3" && back.Components[0] == "app" && back.PathEntries[0] == "C:\\x\\bin" &&
                    back.Variables[0] == "JAVA_HOME" && back.Shortcuts[0] == "C:\\x.lnk" && back.Uninstallers[0] == "C:\\u.exe|/quiet");

                // ---- the choices
                List<PayloadFile> files = new List<PayloadFile>();
                files.Add(Fake("app.zip", "app", 100));
                files.Add(Fake("py.exe", "python", 50));
                files.Add(Fake("e.vsix", "extension", 10));
                files.Add(Fake("code.exe", "vscode", 200));
                List<Component> all = Components.All(files);
                Check("the choices are made from what the setup carries", all.Count == 3 && all[0].Id == "app" && all[0].Required && all[1].Id == "editor" && all[2].Id == "python");
                Check("the editor's size includes the connection to the board (except in the student setup, which has none)", all[1].Bytes == (Edition.Student ? 200 : 210));

                // the Indra reader is a choice only when both its parts are carried, it is not chosen by default
                // and its size is the models and the libraries together
                files.Add(Fake("models.zip", "indra-models", 90));
                files.Add(Fake("wheels.zip", "indra-wheels", 80));
                List<Component> withOcr = Components.All(files);
                Component ocr = withOcr.Find(delegate (Component c) { return c.Id == "ocr"; });
                Check("the Indra reader is offered, off by default, with the size of both its parts", ocr != null && !ocr.Checked && ocr.Bytes == 170);
                Check("the board is the one required choice", withOcr.FindAll(delegate (Component c) { return c.Required; }).Count == 1);
                Check("this build is the classroom setup unless it says otherwise", Edition.Student == (Product.Name == "Class Tools"));

                // ---- shortcuts
                string lnk = Path.Combine(temp, "x.lnk");
                Shortcuts.Create(lnk, Path.Combine(Environment.SystemDirectory, "notepad.exe"), "", temp, "", "test");
                Check("a shortcut is made", File.Exists(lnk));

                Check("the version has three numbers", Product.Version().Split('.').Length == 3);
            }
            catch (Exception e)
            {
                Check("the self test ran to its end (" + e.GetType().Name + ": " + e.Message + ")", false);
            }
            finally
            {
                try { Files.DeleteFolder(temp); } catch { }
                try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\ExcalidrawClassroomSelfTest", false); } catch { }
            }
            Console.WriteLine(failed == 0 ? "all ok" : failed + " failed");
            return failed;
        }

        private static void AddEntry(ZipArchive zip, string name, string text)
        {
            ZipArchiveEntry e = zip.CreateEntry(name);
            using (StreamWriter w = new StreamWriter(e.Open())) w.Write(text);
        }

        private static PayloadFile Fake(string name, string role, long size)
        {
            PayloadFile f = new PayloadFile();
            f.Name = name;
            f.Role = role;
            f.Size = size;
            return f;
        }
    }
}
