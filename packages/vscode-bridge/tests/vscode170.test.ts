/**
 * The extension runs on the VS Code of an old classroom computer (D-448).
 *
 * VS Code 1.70 is the version that a Windows 7 machine can run, and it carries
 * Node 16: no `zlib.crc32` (Node 20.15), no `fetch` (Node 18), no `structuredClone`
 * (Node 17). The extension asked for VS Code 1.91 for no reason it needed, and
 * one of its Node features would have thrown on the first captured frame.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as zlib from "node:zlib";

import { describe, expect, it } from "vitest";

import { crc32, crc32Table } from "../extension/src/crc32";

const root = join(__dirname, "..");

const sources = (dir: string) =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".ts") && name !== "vscode.d.ts")
    .map((name) => ({
      name: `${dir}/${name}`,
      text: readFileSync(join(root, dir, name), "utf8"),
    }));

describe("the extension on VS Code 1.70", () => {
  it("AC-542 asks for VS Code 1.70 and no newer", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "extension", "package.json"), "utf8"),
    );

    expect(manifest.engines.vscode).toBe("^1.70.0");
  });

  it("AC-542 the checksum of the table is the standard CRC-32, and the one the extension uses agrees with it", () => {
    const text = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));

    // the check value of the standard CRC-32 (zip, PNG)
    expect(crc32Table(text("123456789"))).toBe(0xcbf43926);
    expect(crc32Table(text(""))).toBe(0);
    expect(crc32Table(text("a"))).toBe(0xe8b7be43);

    // a different picture is a different number, the same picture the same one
    const a = new Uint8Array(4096).map((_, i) => (i * 31) % 251);
    const b = a.slice();

    b[2048] ^= 1;
    expect(crc32Table(a)).toBe(crc32Table(a.slice()));
    expect(crc32Table(a)).not.toBe(crc32Table(b));

    // and it is the builtin's own number on a Node that has the builtin
    const builtin = (zlib as unknown as { crc32?: (d: Uint8Array) => number })
      .crc32;

    if (builtin) {
      expect(crc32Table(a)).toBe(builtin(a));
      expect(crc32(a)).toBe(builtin(a));
    }

    expect(crc32(text("123456789"))).toBe(0xcbf43926);
  });

  it("AC-542 the extension's code uses nothing that VS Code 1.70's Node 16 lacks", () => {
    const forbidden: [RegExp, string][] = [
      [
        /import\s*\{[^}]*\bcrc32\b[^}]*\}\s*from\s*"node:zlib"/,
        "zlib.crc32 is Node 20.15 (use ./crc32)",
      ],
      [
        /fetchImpl:\s*fetch\b/,
        "the built-in fetch is Node 18 (use globalFetch)",
      ],
      [/\bstructuredClone\(/, "structuredClone is Node 17"],
      [/\bAbortSignal\.timeout\(/, "AbortSignal.timeout is Node 17.3"],
      [/\.findLast(Index)?\(/, "findLast is Node 18"],
      [
        /\.toSorted\(|\.toReversed\(|\.toSpliced\(/,
        "toSorted and its kin are Node 20",
      ],
      [/\bObject\.groupBy\(/, "Object.groupBy is Node 21"],
    ];

    const found: string[] = [];

    for (const file of [
      ...sources("extension/src"),
      ...sources("bridge/src"),
    ]) {
      for (const [pattern, why] of forbidden) {
        if (pattern.test(file.text)) {
          found.push(`${file.name}: ${why}`);
        }
      }
    }

    expect(found).toEqual([]);

    // and the capture really uses the safe checksum
    const capture = readFileSync(
      join(root, "extension", "src", "windowCapture.ts"),
      "utf8",
    );

    expect(capture).toMatch(/from "\.\/crc32"/);
  });
});
