/**
 * AC-569 - the online setup downloads with fallbacks: it goes to the next address when one has no file or gives a
 *          file whose hash is not the recorded one, carries on a part that came in, and keeps what it fetched.
 * AC-570 - the list the online setup carries: each file with its addresses (the maker's, mirrors, the project's own
 *          copy), its size and its hash.
 *
 * The first is proved with the real setup program, a list of its own (CLASSROOM_SETUP_ONLINE_MANIFEST) and a web
 * server on this computer that fails in each of the ways a real one does.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findCsc } from "../../gui/build-gui-installer.mjs";
import { addressesOf, makeList, pinned } from "../make-online-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "..", "..", "gui", "build-gui-installer.mjs");
const hasCompiler = Boolean(findCsc()) && process.platform === "win32";
const windowsOnly = hasCompiler ? describe : describe.skip;

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

windowsOnly("AC-569 the online setup downloads with fallbacks", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "online-setup-"));
  const setup = path.join(work, "ClassTools-Setup.exe");
  let zip;
  let goodBytes;
  let server;
  let base;
  let requests = [];
  let drops = 0;

  const serve = (request, response) => {
    requests.push({ url: request.url, range: request.headers.range ?? null });

    if (request.url.startsWith("/missing/")) {
      response.writeHead(404).end("not here");

      return;
    }

    const bytes = request.url.startsWith("/bad/")
      ? Buffer.alloc(goodBytes.length, 7)
      : goodBytes;
    let start = 0;

    if (request.headers.range) {
      start = Number(/bytes=(\d+)-/.exec(request.headers.range)[1]);
    }

    const body = bytes.subarray(start);

    response.writeHead(start > 0 ? 206 : 200, {
      "Content-Length": body.length,
      ...(start > 0
        ? {
            "Content-Range": `bytes ${start}-${bytes.length - 1}/${
              bytes.length
            }`,
          }
        : {}),
    });

    if (request.url.startsWith("/drop/") && drops === 0) {
      drops += 1;
      response.write(body.subarray(0, Math.floor(body.length / 2)));
      setTimeout(() => response.destroy(), 50);

      return;
    }

    response.end(body);
  };

  const list = (...paths) => {
    const file = path.join(work, `list-${crypto.randomUUID()}.json`);

    fs.writeFileSync(
      file,
      JSON.stringify({
        schema: 1,
        files: [
          {
            role: "node",
            name: "node-test.zip",
            version: "v0.0.0",
            size: goodBytes.length,
            sha256: sha(goodBytes),
            urls: paths.map((p) => `${base}${p}/node-test.zip`),
          },
        ],
      }),
    );

    return file;
  };

  const install = async (listFile, extra = []) => {
    const dir = path.join(work, `install-${crypto.randomUUID()}`);
    const log = `${dir}.log`;
    const run = await new Promise((resolve) => {
      const child = spawn(
        setup,
        [
          "/silent",
          `/dir=${dir}`,
          "/components=node",
          "/nostartmenu",
          `/log=${log}`,
          ...extra,
        ],
        {
          env: { ...process.env, CLASSROOM_SETUP_ONLINE_MANIFEST: listFile },
        },
      );
      const timer = setTimeout(() => child.kill(), 120_000);

      child.on("exit", (status) => {
        clearTimeout(timer);
        resolve({ status });
      });
    });
    const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";

    return {
      dir,
      run,
      text,
      installed: fs.existsSync(path.join(dir, "tools", "node", "node.exe")),
    };
  };

  const remove = async (dir) => {
    const un = path.join(dir, "Uninstall.exe");

    if (fs.existsSync(un)) {
      spawnSync(un, ["/silent"], { timeout: 60_000 });
    }
  };

  beforeAll(async () => {
    // a small zip with a node.exe in it (any bytes: only the setup's way with files is tried)
    const folder = path.join(work, "zipsrc");

    fs.mkdirSync(folder);
    fs.writeFileSync(
      path.join(folder, "node.exe"),
      crypto.randomBytes(300_000),
    );
    zip = path.join(work, "node-test.zip");
    execFileSync(
      path.join(process.env.SystemRoot ?? "C:Windows", "System32", "tar.exe"),
      ["-a", "-c", "-f", zip, "-C", folder, "node.exe"],
    );
    goodBytes = fs.readFileSync(zip);

    execFileSync(
      process.execPath,
      [BUILD, "--no-payload", "--edition", "student", "--out", work],
      { timeout: 240_000 },
    );

    server = http.createServer(serve);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }, 300_000);

  afterAll(() => {
    server?.close();
  });

  it("AC-569 an address with no file is passed over once, and the next one is used", async () => {
    requests = [];

    const result = await install(list("/missing", "/ok"));

    expect(result.run.status).toBe(0);
    expect(result.installed).toBe(true);
    expect(requests.filter((r) => r.url.startsWith("/missing/"))).toHaveLength(
      1,
    );
    expect(requests.some((r) => r.url.startsWith("/ok/"))).toBe(true);
    await remove(result.dir);
  }, 180_000);

  it("AC-569 a file whose hash is not the recorded one is refused, and the next address is used", async () => {
    requests = [];

    const result = await install(list("/bad", "/ok"));

    expect(result.run.status).toBe(0);
    expect(result.text).toMatch(/not the one recorded/);
    expect(result.installed).toBe(true);
    expect(requests.filter((r) => r.url.startsWith("/bad/"))).toHaveLength(1);
    await remove(result.dir);
  }, 180_000);

  it("AC-569 when every address gives a wrong file nothing is installed", async () => {
    const result = await install(list("/bad"));

    expect(result.run.status).toBe(4);
    expect(result.installed).toBe(false);
    expect(result.text).toMatch(/could not download node-test\.zip/);
    await remove(result.dir);
  }, 180_000);

  it("AC-569 a download that stops half way is carried on from where it stopped", async () => {
    requests = [];
    drops = 0;

    const result = await install(list("/drop"));

    expect(result.run.status).toBe(0);
    expect(result.installed).toBe(true);

    const second = requests.filter((r) => r.url.startsWith("/drop/"))[1];

    expect(second.range).toMatch(/^bytes=[1-9]\d*-$/);
    await remove(result.dir);
  }, 180_000);

  it("AC-569 the files are kept when asked, and a kept file is used with no server", async () => {
    const keep = path.join(work, "kept");
    const first = await install(list("/ok"), [`/keep=${keep}`]);

    expect(first.run.status).toBe(0);
    expect(fs.existsSync(path.join(keep, "node-test.zip"))).toBe(true);
    await remove(first.dir);

    requests = [];

    const second = await install(list("/missing"), [`/keep=${keep}`]);

    expect(second.run.status).toBe(0);
    expect(second.installed).toBe(true);
    expect(requests).toHaveLength(0);
    await remove(second.dir);
  }, 240_000);
});

describe("AC-570 the list the online setup carries", () => {
  const manifest = {
    files: [
      {
        role: "node",
        name: "node-v26.13.0-win-x64.zip",
        version: "v26.13.0",
        size: 1,
        sha256: "a",
        source: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip",
      },
      {
        role: "vscode",
        name: "vscode-x64-setup.exe",
        version: "1.145.2",
        size: 2,
        sha256: "b",
        source:
          "https://update.code.visualstudio.com/latest/win32-x64-user/stable",
      },
      {
        role: "app",
        name: "app.zip",
        version: "built",
        size: 3,
        sha256: "c",
        source: null,
      },
      {
        role: "gcc",
        name: "winlibs.zip",
        version: "1",
        size: 4,
        sha256: "d",
        source: "https://github.com/x/y/releases/download/t/winlibs.zip",
      },
    ],
  };
  const where = {
    releaseBase: "https://example.test/release/",
    mirrorBase: "https://mirror.test/release/",
  };

  it("AC-570 the editor's address is pinned to its version, never `latest`", () => {
    expect(pinned(manifest.files[1])).toBe(
      "https://update.code.visualstudio.com/1.145.2/win32-x64-user/stable",
    );
  });

  it("AC-570 the maker's address comes first, mirrors after, the project's own copy last", () => {
    const urls = addressesOf(manifest.files[0], where);

    expect(urls[0]).toBe(
      "https://nodejs.org/dist/v26.13.0/node-v26.13.0-win-x64.zip",
    );
    expect(urls[1]).toMatch(/npmmirror\.com\/mirrors\/node\/v26\.13\.0\//);
    expect(urls.at(-1)).toBe(
      "https://example.test/release/node-v26.13.0-win-x64.zip",
    );
  });

  it("AC-570 the project's own files come from the release, then its mirror", () => {
    expect(addressesOf(manifest.files[2], where)).toEqual([
      "https://example.test/release/app.zip",
      "https://mirror.test/release/app.zip",
    ]);
  });

  it("AC-570 every file keeps its size and hash, and the student list holds the tools alone", () => {
    const all = makeList({ manifest, ...where });
    const student = makeList({ manifest, ...where, student: true });

    expect(all.files.map((f) => [f.name, f.size, f.sha256])).toContainEqual([
      "app.zip",
      3,
      "c",
    ]);
    expect(student.files.map((f) => f.role).sort()).toEqual([
      "gcc",
      "node",
      "vscode",
    ]);
  });
});
