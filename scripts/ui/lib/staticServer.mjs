// A small web server for the built app, for the UI gate: serves a folder on 127.0.0.1 and nothing else.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

/** the file a request path means, inside `root`, or null when it would leave it */
export const resolveInside = (root, requestPath) => {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);

  return file === root || file.startsWith(root + path.sep) ? file : null;
};

/**
 * Serves `root` and resolves with `{ url, port, close }`. An address that is not
 * a file is the page itself (the app is one page). A request for a file outside
 * `root` is refused.
 */
export const serveFolder = (root, { port = 0 } = {}) =>
  new Promise((resolve, reject) => {
    const base = path.resolve(root);
    const server = http.createServer((req, res) => {
      const file = resolveInside(base, req.url ?? "/");

      if (!file) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }

      let target = file;

      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        target = path.join(base, "index.html");
      }

      res.writeHead(200, {
        "content-type":
          TYPES[path.extname(target).toLowerCase()] ??
          "application/octet-stream",
        "cache-control": "no-cache",
      });
      fs.createReadStream(target).pipe(res);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address();

      resolve({
        url: `http://127.0.0.1:${actual}/`,
        port: actual,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
