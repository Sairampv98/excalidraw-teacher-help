/**
 * AC-555 - the engines the app carries: the list, the fetch and the check by hash.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkFile, fetchEngines, readList, sha256 } from "../engines.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "engines-"));

describe("AC-555 the engines the app carries", () => {
  it("AC-555 every file of the list has an address, a hash and a size, and the three engines are there", () => {
    const list = readList();

    for (const entry of list) {
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(1000);
    }

    const folders = new Set(list.map((entry) => entry.path.split("/")[0]));

    expect([...folders].sort()).toEqual(["pdfjs", "pyodide", "tesseract"]);

    // Python needs its core, the standard library and the list of packages; the reader needs a language
    const paths = list.map((entry) => entry.path);

    for (const needed of [
      "pyodide/pyodide.asm.wasm",
      "pyodide/python_stdlib.zip",
      "pyodide/pyodide-lock.json",
      "tesseract/lang/eng.traineddata.gz",
      "pdfjs/pdf.worker.min.mjs",
    ]) {
      expect(paths).toContain(needed);
    }
  });

  it("AC-555 a missing file is fetched and checked against its hash, and one that is there is not fetched again", async () => {
    const dir = tmp();
    const bytes = Buffer.from("an engine");
    const list = [
      {
        path: "x/engine.js",
        url: "https://e.test/engine.js",
        sha256: sha256(bytes),
        bytes: bytes.length,
      },
    ];
    const asked = [];
    const fetchBytes = async (url) => {
      asked.push(url);

      return bytes;
    };

    const first = await fetchEngines(list, { dir, fetchBytes });

    expect(first.fetched).toEqual(["x/engine.js"]);
    expect(checkFile(dir, list[0])).toBe("ok");

    const second = await fetchEngines(list, { dir, fetchBytes });

    expect(second.ok).toEqual(["x/engine.js"]);
    expect(asked).toHaveLength(1);
  });

  it("AC-555 a file that is not the one listed is refused and not kept, and a changed file is fetched again", async () => {
    const dir = tmp();
    const list = [
      {
        path: "x/engine.js",
        url: "https://e.test/engine.js",
        sha256: sha256(Buffer.from("the right one")),
        bytes: 13,
      },
    ];
    const refused = await fetchEngines(list, {
      dir,
      fetchBytes: async () => Buffer.from("something else"),
    });

    expect(refused.failed).toHaveLength(1);
    expect(refused.failed[0].reason).toContain("not the one listed");
    expect(checkFile(dir, list[0])).toBe("missing");

    fs.mkdirSync(path.join(dir, "x"), { recursive: true });
    fs.writeFileSync(path.join(dir, "x/engine.js"), "damaged");
    expect(checkFile(dir, list[0])).toBe("wrong");

    const repaired = await fetchEngines(list, {
      dir,
      fetchBytes: async () => Buffer.from("the right one"),
    });

    expect(repaired.fetched).toEqual(["x/engine.js"]);
    expect(checkFile(dir, list[0])).toBe("ok");
  });

  it("AC-555 a fetch that fails is said, and does not stop the others", async () => {
    const dir = tmp();
    const good = Buffer.from("good");
    const list = [
      {
        path: "a.js",
        url: "https://e.test/a.js",
        sha256: sha256(good),
        bytes: 4,
      },
      {
        path: "b.js",
        url: "https://e.test/b.js",
        sha256: sha256(good),
        bytes: 4,
      },
    ];
    const result = await fetchEngines(list, {
      dir,
      fetchBytes: async (url) => {
        if (url.endsWith("a.js")) {
          throw new Error("no connection");
        }

        return good;
      },
    });

    expect(result.failed.map((f) => f.path)).toEqual(["a.js"]);
    expect(result.fetched).toEqual(["b.js"]);
  });
});
