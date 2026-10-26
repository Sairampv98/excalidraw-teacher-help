/**
 * AC-191 - the bundled emoji and GIFs are complete, valid, small and offline
 * (D-157).
 *
 * The test reads the **files**: the catalog, the assets, the code that loads
 * them and the provenance record. It does not render anything.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STICKERS } from "../emoji/catalog";

const EMOJI_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../emoji",
);
const ASSETS = path.join(EMOJI_DIR, "assets");
const PROVENANCE = path.resolve(EMOJI_DIR, "../../docs/STICKERS.md");

const MAX_FILE_BYTES = 60 * 1024;
const MAX_TOTAL_BYTES = 1.5 * 1024 * 1024;

const read = (file: string) => fs.readFileSync(path.join(ASSETS, file));

/** the number of image frames in a GIF, and whether it declares a loop */
const inspectGif = (bytes: Buffer) => {
  const header = bytes.subarray(0, 6).toString("latin1");
  let pos = 6;
  const packed = bytes[pos + 4];
  pos += 7;
  if (packed & 0x80) {
    pos += 3 * (1 << ((packed & 7) + 1));
  }

  const skipSubBlocks = () => {
    while (bytes[pos] !== 0) {
      pos += 1 + bytes[pos];
    }
    pos += 1;
  };

  let frames = 0;
  let loops = false;

  while (pos < bytes.length && bytes[pos] !== 0x3b) {
    if (bytes[pos] === 0x21) {
      const isLoop =
        bytes[pos + 1] === 0xff &&
        bytes.subarray(pos + 3, pos + 14).toString("latin1") === "NETSCAPE2.0";
      loops = loops || isLoop;
      pos += 2;
      skipSubBlocks();
    } else if (bytes[pos] === 0x2c) {
      frames++;
      const local = bytes[pos + 9];
      pos += 10;
      if (local & 0x80) {
        pos += 3 * (1 << ((local & 7) + 1));
      }
      pos += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new Error(`unexpected block 0x${bytes[pos].toString(16)}`);
    }
  }

  return { header, frames, loops, ends: bytes[pos] === 0x3b };
};

describe("the bundled stickers (AC-191)", () => {
  it("AC-191 every catalog row has its file", () => {
    const ids = STICKERS.map((s) => s.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      STICKERS.filter((s) => s.kind === "emoji").length,
    ).toBeGreaterThanOrEqual(40);
    expect(
      STICKERS.filter((s) => s.kind === "gif").length,
    ).toBeGreaterThanOrEqual(12);

    for (const sticker of STICKERS) {
      expect(sticker.tags.length, `${sticker.id} has tags`).toBeGreaterThan(0);
      expect(
        fs.existsSync(path.join(ASSETS, sticker.file)),
        `${sticker.id} -> ${sticker.file}`,
      ).toBe(true);
      expect(
        sticker.file.endsWith(sticker.kind === "gif" ? ".gif" : ".svg"),
      ).toBe(true);
    }

    // and no file is in the folder without a row
    const rows = new Set(STICKERS.map((s) => s.file));
    for (const file of fs.readdirSync(ASSETS)) {
      expect(rows.has(file), `${file} is in the catalog`).toBe(true);
    }
  });

  it("AC-191 every gif is animated", () => {
    for (const sticker of STICKERS.filter((s) => s.kind === "gif")) {
      const gif = inspectGif(read(sticker.file));

      expect(gif.header, sticker.id).toBe("GIF89a");
      expect(gif.frames, `${sticker.id} frames`).toBeGreaterThan(1);
      expect(gif.loops, `${sticker.id} loops`).toBe(true);
      expect(gif.ends, `${sticker.id} is terminated`).toBe(true);
    }
  });

  it("AC-191 every emoji is a well-formed svg", () => {
    for (const sticker of STICKERS.filter((s) => s.kind === "emoji")) {
      const svg = read(sticker.file).toString("utf8");

      expect(svg.startsWith("<svg "), sticker.id).toBe(true);
      expect(svg.trimEnd().endsWith("</svg>"), sticker.id).toBe(true);
      expect(svg).toContain('viewBox="0 0 100 100"');
      expect(svg).not.toMatch(/<script|onload=|<image|<foreignObject/i);
    }
  });

  it("AC-191 nothing names a remote url", () => {
    const checked = [
      ...fs.readdirSync(ASSETS).map((f) => path.join(ASSETS, f)),
      path.join(EMOJI_DIR, "catalog.ts"),
      path.join(EMOJI_DIR, "assets.ts"),
      path.join(EMOJI_DIR, "insertSticker.ts"),
      path.join(EMOJI_DIR, "search.ts"),
      path.join(EMOJI_DIR, "StickerBar.tsx"),
    ];

    for (const file of checked) {
      // the SVG namespace is an identifier, not a request
      const text = fs
        .readFileSync(file)
        .toString("latin1")
        .replace("http://www.w3.org/2000/svg", "");

      expect(text, path.basename(file)).not.toMatch(/https?:\/\//i);
      expect(text, path.basename(file)).not.toMatch(/giphy|tenor|api[_-]?key/i);
    }
  });

  it("AC-191 the set is within its size bounds", () => {
    let total = 0;

    for (const file of fs.readdirSync(ASSETS)) {
      const size = fs.statSync(path.join(ASSETS, file)).size;

      expect(size, file).toBeGreaterThan(0);
      expect(size, file).toBeLessThanOrEqual(MAX_FILE_BYTES);
      total += size;
    }

    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it("AC-191 the provenance names every file", () => {
    const record = fs.readFileSync(PROVENANCE, "utf8");

    expect(record).toMatch(/CC0/);
    expect(record).toMatch(/build-stickers\.mjs/);

    for (const sticker of STICKERS) {
      expect(record, sticker.file).toContain(`\`${sticker.file}\``);
    }
  });
});
