// A small web server for the app's folder, on this computer only (127.0.0.1).
//
// It is made on a plain TcpListener, not on HttpListener: HttpListener on 127.0.0.1 asks Windows 7 for a
// reservation that a user without administrator rights cannot make, and the launcher must start for anyone.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace ExcalidrawClassroom
{
    internal sealed class StaticServer
    {
        private readonly string root;
        private TcpListener listener;
        private volatile bool stopping;

        public int Port { get; private set; }

        public StaticServer(string root)
        {
            this.root = Path.GetFullPath(root);
        }

        /// <summary>Starts on the wanted port, or the next free ones. Returns the port it got.</summary>
        public int Start(int wanted, int tries)
        {
            for (int i = 0; i < tries; i++)
            {
                try
                {
                    listener = new TcpListener(IPAddress.Loopback, wanted + i);
                    listener.Start(64);
                    Port = wanted + i;
                    Thread t = new Thread(AcceptLoop);
                    t.IsBackground = true;
                    t.Start();
                    return Port;
                }
                catch (SocketException) { listener = null; }
            }
            throw new IOException("no free port near " + wanted);
        }

        public void Stop()
        {
            stopping = true;
            try { if (listener != null) listener.Stop(); } catch { }
        }

        private void AcceptLoop()
        {
            while (!stopping)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { return; }
                ThreadPool.QueueUserWorkItem(delegate { Serve(client); });
            }
        }

        // ---------------------------------------------------------------------------------- one request

        private void Serve(TcpClient client)
        {
            try
            {
                client.ReceiveTimeout = 15000;
                client.SendTimeout = 60000;
                using (client)
                using (NetworkStream stream = client.GetStream())
                {
                    string requestLine;
                    Dictionary<string, string> headers = ReadHead(stream, out requestLine);
                    if (requestLine == null) return;
                    string[] parts = requestLine.Split(' ');
                    if (parts.Length < 2) { Reply(stream, 400, "Bad Request", "text/plain", Encoding.UTF8.GetBytes("bad request"), false); return; }
                    bool head = parts[0] == "HEAD";
                    if (parts[0] != "GET" && !head)
                    {
                        Reply(stream, 405, "Method Not Allowed", "text/plain", Encoding.UTF8.GetBytes("only GET"), false);
                        return;
                    }
                    SendFile(stream, parts[1], headers, head);
                }
            }
            catch { }
        }

        private static Dictionary<string, string> ReadHead(Stream stream, out string requestLine)
        {
            requestLine = null;
            Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            StringBuilder line = new StringBuilder();
            int previous = -1;
            int total = 0;
            bool first = true;
            while (total++ < 16384)
            {
                int b = stream.ReadByte();
                if (b < 0) return headers;
                if (b == '\n')
                {
                    string text = line.ToString().TrimEnd('\r');
                    line.Length = 0;
                    if (first) { requestLine = text; first = false; }
                    else if (text.Length == 0) return headers;
                    else
                    {
                        int colon = text.IndexOf(':');
                        if (colon > 0) headers[text.Substring(0, colon).Trim()] = text.Substring(colon + 1).Trim();
                    }
                }
                else line.Append((char)b);
                previous = b;
            }
            return headers;
        }

        /// <summary>The file a request path means, inside the folder, or null when it would leave it.</summary>
        public string Resolve(string requestPath)
        {
            string path = requestPath;
            int q = path.IndexOfAny(new char[] { '?', '#' });
            if (q >= 0) path = path.Substring(0, q);
            path = Uri.UnescapeDataString(path).Replace('/', '\\').TrimStart('\\');
            if (path.Length == 0) path = "index.html";
            string full;
            try { full = Path.GetFullPath(Path.Combine(root, path)); }
            catch { return null; }
            if (!Files.IsInside(root, full) && !string.Equals(full, root, StringComparison.OrdinalIgnoreCase)) return null;
            return full;
        }

        private void SendFile(Stream stream, string requestPath, Dictionary<string, string> headers, bool head)
        {
            if (requestPath.StartsWith("/__classroom"))
            {
                Reply(stream, 200, "OK", "text/plain", Encoding.UTF8.GetBytes("excalidraw-classroom"), head);
                return;
            }
            string file = Resolve(requestPath);
            if (file == null) { Reply(stream, 403, "Forbidden", "text/plain", Encoding.UTF8.GetBytes("forbidden"), head); return; }
            if (!File.Exists(file))
            {
                // an address of the app (a link, a room) is answered with the app itself; a missing file is a 404
                if (Path.HasExtension(file)) { Reply(stream, 404, "Not Found", "text/plain", Encoding.UTF8.GetBytes("not found"), head); return; }
                file = Path.Combine(root, "index.html");
                if (!File.Exists(file)) { Reply(stream, 404, "Not Found", "text/plain", Encoding.UTF8.GetBytes("not found"), head); return; }
            }

            FileInfo info = new FileInfo(file);
            long length = info.Length;
            long start = 0, end = length - 1;
            bool partial = false;
            string range;
            if (headers.TryGetValue("Range", out range) && range.StartsWith("bytes="))
            {
                // a video seeks with ranges: one range, from-to, from-, or the last n bytes
                string[] r = range.Substring(6).Split('-');
                long a, b;
                if (r.Length == 2)
                {
                    if (r[0].Length == 0 && long.TryParse(r[1], out b)) { start = Math.Max(0, length - b); end = length - 1; partial = true; }
                    else if (long.TryParse(r[0], out a))
                    {
                        start = a;
                        end = r[1].Length > 0 && long.TryParse(r[1], out b) ? Math.Min(b, length - 1) : length - 1;
                        partial = true;
                    }
                }
                if (partial && (start > end || start >= length))
                {
                    WriteHead(stream, 416, "Range Not Satisfiable", "text/plain", 0, new string[] { "Content-Range: bytes */" + length });
                    return;
                }
            }

            string type = ContentType(file);
            bool isIndex = string.Equals(Path.GetFileName(file), "index.html", StringComparison.OrdinalIgnoreCase);
            List<string> extra = new List<string>();
            extra.Add("Accept-Ranges: bytes");
            extra.Add(isIndex ? "Cache-Control: no-cache" : "Cache-Control: public, max-age=3600");
            if (partial) extra.Add("Content-Range: bytes " + start + "-" + end + "/" + length);
            long count = end - start + 1;
            WriteHead(stream, partial ? 206 : 200, partial ? "Partial Content" : "OK", type, count, extra.ToArray());
            if (head) return;

            using (FileStream f = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                f.Seek(start, SeekOrigin.Begin);
                byte[] buffer = new byte[64 * 1024];
                long left = count;
                while (left > 0)
                {
                    int n = f.Read(buffer, 0, (int)Math.Min(buffer.Length, left));
                    if (n <= 0) break;
                    stream.Write(buffer, 0, n);
                    left -= n;
                }
            }
        }

        private static void Reply(Stream stream, int code, string reason, string type, byte[] body, bool head)
        {
            WriteHead(stream, code, reason, type, body.Length, new string[0]);
            if (!head) stream.Write(body, 0, body.Length);
        }

        private static void WriteHead(Stream stream, int code, string reason, string type, long length, string[] extra)
        {
            StringBuilder h = new StringBuilder();
            h.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\r\n");
            h.Append("Content-Type: ").Append(type).Append("\r\n");
            h.Append("Content-Length: ").Append(length).Append("\r\n");
            foreach (string e in extra) h.Append(e).Append("\r\n");
            h.Append("Connection: close\r\n\r\n");
            byte[] bytes = Encoding.ASCII.GetBytes(h.ToString());
            stream.Write(bytes, 0, bytes.Length);
        }

        public static string ContentType(string file)
        {
            switch (Path.GetExtension(file).ToLowerInvariant())
            {
                case ".html": case ".htm": return "text/html; charset=utf-8";
                case ".js": case ".mjs": return "text/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json";
                case ".webmanifest": return "application/manifest+json";
                case ".wasm": return "application/wasm";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".jpg": case ".jpeg": return "image/jpeg";
                case ".gif": return "image/gif";
                case ".ico": return "image/x-icon";
                case ".webp": return "image/webp";
                case ".woff2": return "font/woff2";
                case ".woff": return "font/woff";
                case ".ttf": return "font/ttf";
                case ".txt": return "text/plain; charset=utf-8";
                case ".mp4": return "video/mp4";
                case ".webm": return "video/webm";
                case ".pdf": return "application/pdf";
                case ".zip": return "application/zip";
                default: return "application/octet-stream";
            }
        }
    }
}
