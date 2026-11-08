// The online setup's downloads: each file has a list of addresses (the maker's, then mirrors), a size and a SHA-256.
// A file is taken from the first address that gives bytes whose hash is the recorded one; a part that came in is
// kept and carried on from where it stopped; a file whose hash is wrong is thrown away and never used.
//
// C# 5 (the compiler that ships with Windows).

using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace ExcalidrawClassroom
{
    internal static class Downloader
    {
        /// <summary>A folder the downloaded files are also copied to (and looked in first), or null.</summary>
        public static string KeepFolder;

        /// <summary>Where the text goes while it works (the setup's log).</summary>
        public static Action<string> Log;

        /// <summary>How long to wait between tries, in milliseconds (the tests make it small).</summary>
        public static int PauseMs = 2000;

        public const int TriesPerAddress = 3;

        private static void Say(string text)
        {
            if (Log != null) Log(text);
        }

        private static void Secure()
        {
            // TLS 1.2 (3072) and 1.1 (768): .NET 4 on Windows 10 does not offer 1.2 unless it is asked
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)(3072 | 768); }
            catch { }
        }

        /// <summary>Takes one file to <paramref name="folder"/>; returns its path. Throws when no address gives the file.</summary>
        public static string Fetch(PayloadFile file, string folder, Action<long> progress)
        {
            Directory.CreateDirectory(folder);
            string target = Path.Combine(folder, file.Name);

            if (File.Exists(target) && new FileInfo(target).Length == file.Size && Same(target, file))
            {
                if (progress != null) progress(file.Size);
                return target;
            }

            // a copy kept from an earlier time (also how a folder made for another computer is used)
            if (!string.IsNullOrEmpty(KeepFolder))
            {
                string kept = Path.Combine(KeepFolder, file.Name);
                if (File.Exists(kept) && new FileInfo(kept).Length == file.Size && Same(kept, file))
                {
                    File.Copy(kept, target, true);
                    Say("  " + file.Name + ": taken from the kept files");
                    if (progress != null) progress(file.Size);
                    return target;
                }
            }

            Secure();
            List<string> why = new List<string>();
            foreach (string url in file.Urls)
            {
                for (int attempt = 1; attempt <= TriesPerAddress; attempt++)
                {
                    try
                    {
                        Say("  " + file.Name + ": from " + Host(url) + (attempt > 1 ? " (try " + attempt + ")" : ""));
                        Get(url, file, target, progress);
                        Keep(target, file);
                        return target;
                    }
                    catch (InvalidDataException e)
                    {
                        // the bytes were not the recorded ones: this address is not to be trusted, go to the next
                        why.Add(Host(url) + ": " + e.Message);
                        Say("  ! " + Host(url) + ": " + e.Message);
                        break;
                    }
                    catch (WebException e)
                    {
                        HttpWebResponse r = e.Response as HttpWebResponse;
                        string reason = r != null ? ((int)r.StatusCode + " " + r.StatusDescription) : e.Status + " " + e.Message;
                        why.Add(Host(url) + ": " + reason);
                        Say("  ! " + Host(url) + ": " + reason);
                        // not there / not allowed: another try of the same address will not change that
                        if (r != null && (int)r.StatusCode >= 400 && (int)r.StatusCode < 500 && (int)r.StatusCode != 408 && (int)r.StatusCode != 429) break;
                        if (attempt < TriesPerAddress) Thread.Sleep(PauseMs * attempt);
                    }
                    catch (IOException e)
                    {
                        why.Add(Host(url) + ": " + e.Message);
                        Say("  ! " + Host(url) + ": " + e.Message);
                        if (attempt < TriesPerAddress) Thread.Sleep(PauseMs * attempt);
                    }
                }
            }
            throw new IOException("could not download " + file.Name + " from any address:\r\n  " + string.Join("\r\n  ", why.ToArray()) +
                                  "\r\nCheck the internet connection and run the setup again: what came in is kept and carried on.");
        }

        private static void Get(string url, PayloadFile file, string target, Action<long> progress)
        {
            string part = target + ".part";
            long have = File.Exists(part) ? new FileInfo(part).Length : 0;
            if (have > file.Size) { File.Delete(part); have = 0; }

            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.UserAgent = "ClassroomSetup/" + Product.Version();
            request.Timeout = 30000;
            request.ReadWriteTimeout = 30000;
            request.AllowAutoRedirect = true;
            #if NET35
            if (have > 0) request.AddRange((int)have);
#else
            if (have > 0) request.AddRange(have);
#endif

            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                bool carried = have > 0 && response.StatusCode == HttpStatusCode.PartialContent;
                if (!carried) have = 0;
                if (progress != null && have > 0) progress(have);

                using (Stream input = response.GetResponseStream())
                using (FileStream output = new FileStream(part, carried ? FileMode.Append : FileMode.Create, FileAccess.Write))
                {
                    byte[] buffer = new byte[256 * 1024];
                    int n;
                    while ((n = input.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        output.Write(buffer, 0, n);
                        if (progress != null) progress(n);
                    }
                }
            }

            FileInfo got = new FileInfo(part);
            if (got.Length != file.Size)
            {
                // short: keep what came in, so the next try carries on from here
                throw new IOException("the file came in short (" + got.Length + " of " + file.Size + " bytes)");
            }
            if (!Same(part, file))
            {
                File.Delete(part);
                throw new InvalidDataException("the file is not the one recorded (its hash is different)");
            }
            if (File.Exists(target)) File.Delete(target);
            File.Move(part, target);
        }

        private static bool Same(string path, PayloadFile file)
        {
            return string.Equals(Files.Sha256(path), file.Sha256, StringComparison.OrdinalIgnoreCase);
        }

        private static void Keep(string path, PayloadFile file)
        {
            if (string.IsNullOrEmpty(KeepFolder)) return;
            try
            {
                Directory.CreateDirectory(KeepFolder);
                File.Copy(path, Path.Combine(KeepFolder, file.Name), true);
            }
            catch (Exception e) { Say("  ! the file could not be kept: " + e.Message); }
        }

        private static string Host(string url)
        {
            try { return new Uri(url).Host; } catch { return url; }
        }
    }
}
