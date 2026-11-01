/**
 * Pictures that come from outside the whiteboard (D-409, D-410): what the bytes
 * of a picture say about it, a file that comes in pieces, putting it on a page,
 * cropping it, and where it came from.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";
import { imageSizeOf, sniffType } from "../mcp/imageSize";
import { runMcpTool } from "../mcp/runner";
import {
  UPLOAD_KEEP_MS,
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_TOTAL_BYTES,
  addUploadPiece,
  clearUploads,
  dropUpload,
  takeUpload,
  uploadsKept,
} from "../mcp/uploads";

import { Keyboard } from "./helpers/ui";
import { act, render } from "./test-utils";

import type { McpRunContext } from "../mcp/runner";

const { h } = window;

const CONTEXT: McpRunContext = {
  allowChanges: true,
  app: "test",
  features: [],
};

const run = async (name: string, args: unknown = {}, context = CONTEXT) => {
  let outcome: Awaited<ReturnType<typeof runMcpTool>> | undefined;

  await act(async () => {
    outcome = await runMcpTool(h.app, name, args, context);
  });

  return outcome!;
};

const ok = async (name: string, args: unknown = {}) => {
  const outcome = await run(name, args);

  if (!outcome.ok) {
    throw new Error(`${name}: ${outcome.error.code}: ${outcome.error.message}`);
  }

  return outcome.result as any;
};

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

const live = () => h.elements.filter((element) => !element.isDeleted);

/** the bytes of a PNG that says it is this wide and this tall */
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33);

  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);

  return bytes;
};

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** a file sent to the page in pieces, as the server sends it */
const send = async (
  id: string,
  bytes: Uint8Array,
  name = "pic.png",
  pieces = 1,
) => {
  const size = Math.ceil(bytes.length / pieces);

  for (let index = 0; index < pieces; index++) {
    await ok("upload_chunk", {
      id,
      index,
      total: pieces,
      name,
      mimeType: "image/png",
      data: b64(bytes.slice(index * size, (index + 1) * size)),
    });
  }
};

beforeEach(async () => {
  clearUploads();
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true} />,
  );
});

describe("what the bytes of a picture say", () => {
  it("AC-488 reads the size of a PNG, a GIF, a JPEG, a WebP of each kind, a BMP, an AVIF and an SVG, and says null of what it does not know", () => {
    expect(imageSizeOf(png(640, 480))).toEqual({ width: 640, height: 480 });

    const gif = new Uint8Array(13);

    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 90, 1, 45, 0]);
    expect(imageSizeOf(gif)).toEqual({ width: 346, height: 45 });

    // a JPEG: the start, a table that is skipped, then the frame with the size
    const jpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x01, 0x2c, 0x02, 0x58, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    expect(imageSizeOf(jpeg)).toEqual({ width: 600, height: 300 });

    const riff = (chunk: string, body: number[]) => {
      const bytes = new Uint8Array(40);

      bytes.set([
        ...`RIFF\0\0\0\0WEBP${chunk}`.split("").map((c) => c.charCodeAt(0)),
      ]);
      bytes.set(body, 20);

      return bytes;
    };

    // lossy: the size is at 26 and 28 - after a 6 byte gap of the frame header
    const lossy = riff("VP8 ", []);

    lossy.set([0x2c, 0x01, 0x90, 0x01], 26);
    expect(imageSizeOf(lossy)).toEqual({ width: 300, height: 400 });

    // lossless: 14 bits of width and 14 of height, each less one
    const lossless = riff("VP8L", []);
    const bits = (200 - 1) | ((100 - 1) << 14);

    lossless.set(
      [
        0x2f,
        bits & 255,
        (bits >> 8) & 255,
        (bits >> 16) & 255,
        (bits >> 24) & 255,
      ],
      20,
    );
    expect(imageSizeOf(lossless)).toEqual({ width: 200, height: 100 });

    // extended: 24 bits each, less one
    const extended = riff("VP8X", []);

    extended.set([0, 0, 0, 0, 0xf3, 0x01, 0x00, 0x57, 0x01, 0x00], 20);
    expect(imageSizeOf(extended)).toEqual({ width: 500, height: 344 });

    const bmp = new Uint8Array(30);

    bmp.set([0x42, 0x4d], 0);
    new DataView(bmp.buffer).setInt32(18, 32, true);
    new DataView(bmp.buffer).setInt32(22, -16, true);
    expect(imageSizeOf(bmp)).toEqual({ width: 32, height: 16 });

    const avif = new Uint8Array(64);

    avif.set([..."\0\0\0\x1cftypavif".split("").map((c) => c.charCodeAt(0))]);
    avif.set([..."ispe".split("").map((c) => c.charCodeAt(0))], 40);
    new DataView(avif.buffer).setUint32(48, 800);
    new DataView(avif.buffer).setUint32(52, 600);
    expect(imageSizeOf(avif)).toEqual({ width: 800, height: 600 });

    const text = (source: string) => new TextEncoder().encode(source);

    expect(
      imageSizeOf(text('<svg xmlns="x" width="120px" height="60"></svg>')),
    ).toEqual({ width: 120, height: 60 });
    expect(
      imageSizeOf(text('<?xml version="1.0"?><svg viewBox="0 0 24 12"></svg>')),
    ).toEqual({ width: 24, height: 12 });
    expect(imageSizeOf(text("<svg></svg>"))).toBeNull();
    expect(imageSizeOf(text("just words, not a picture"))).toBeNull();
    expect(imageSizeOf(png(0, 10))).toBeNull();
    expect(imageSizeOf(new Uint8Array(3))).toBeNull();
  });

  it("AC-488 says what the bytes are, whatever the name or the header says", () => {
    const text = (source: string) => new TextEncoder().encode(source);

    expect(sniffType(png(1, 1))).toBe("image/png");
    expect(sniffType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe(
      "image/jpeg",
    );
    expect(sniffType(text("GIF89a...."))).toBe("image/gif");
    expect(sniffType(text("%PDF-1.7\n..."))).toBe("application/pdf");
    expect(
      sniffType(Uint8Array.from([0, 0, 0, 0x18, ...text("ftypmp42")])),
    ).toBe("video/mp4");
    expect(
      sniffType(Uint8Array.from([0, 0, 0, 0x1c, ...text("ftypavif")])),
    ).toBe("image/avif");
    expect(sniffType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe(
      "video/webm",
    );
    expect(sniffType(text('<?xml version="1.0"?>\n<svg width="1">'))).toBe(
      "image/svg+xml",
    );
    expect(sniffType(text("  <!DOCTYPE html><html>"))).toBe("text/html");
    expect(sniffType(text("# a note\nwith words"))).toBe("text/plain");
    expect(sniffType(Uint8Array.from([0, 1, 2, 3, 4, 5]))).toBeNull();
    expect(sniffType(new Uint8Array(2))).toBeNull();
  });
});

describe("a file in pieces", () => {
  it("AC-489 is kept until it is used, whole and once, and in any order of its pieces", () => {
    const whole = Uint8Array.from([1, 2, 3, 4, 5, 6]);

    addUploadPiece({
      id: "file-one",
      index: 1,
      total: 2,
      data: b64(whole.slice(3)),
      name: "a.bin",
      mimeType: "x/y",
    });
    expect(() => takeUpload("file-one")).toThrow(/not all come yet/);
    expect(
      addUploadPiece({
        id: "file-one",
        index: 0,
        total: 2,
        data: b64(whole.slice(0, 3)),
      }),
    ).toMatchObject({ received: 2, total: 2, bytes: 6 });

    const file = takeUpload("file-one");

    expect(file.name).toBe("a.bin");
    expect(file.type).toBe("x/y");
    expect(file.size).toBe(6);
    // once: it is gone
    expect(() => takeUpload("file-one")).toThrow(/no file file-one/);
    expect(uploadsKept()).toEqual({ files: 0, bytes: 0 });
  });

  it("AC-489 a piece that comes twice is the same piece, and pieces that do not agree are refused", () => {
    addUploadPiece({
      id: "twice",
      index: 0,
      total: 2,
      data: b64(Uint8Array.from([1, 2])),
    });
    addUploadPiece({
      id: "twice",
      index: 0,
      total: 2,
      data: b64(Uint8Array.from([1, 2])),
    });
    expect(uploadsKept().bytes).toBe(2);
    expect(() =>
      addUploadPiece({
        id: "twice",
        index: 1,
        total: 3,
        data: b64(Uint8Array.from([3])),
      }),
    ).toThrow(/how many/);

    for (const bad of [
      { id: "x", index: 0, total: 1, data: "AA==" },
      { id: "ok-id", index: 5, total: 2, data: "AA==" },
      { id: "ok-id", index: 0, total: 0, data: "AA==" },
      { id: "ok-id", index: 0, total: 99999, data: "AA==" },
      { id: "bad id!", index: 0, total: 1, data: "AA==" },
    ]) {
      expect(() => addUploadPiece(bad)).toThrow(/not one/);
    }
  });

  it("AC-489 is forgotten when it is too large, and when it is not used in time", () => {
    const piece = b64(new Uint8Array(1024));

    // a file that says it comes in a lot of pieces is stopped when what came is too much
    expect(UPLOAD_MAX_BYTES).toBe(450 * 1024 * 1024);
    expect(UPLOAD_MAX_TOTAL_BYTES).toBe(600 * 1024 * 1024);

    const fileOnly = { file: 2500, total: 1e9 };
    const totalOnly = { file: 1e9, total: 3000 };

    addUploadPiece(
      { id: "big1", index: 0, total: 9, data: piece },
      5,
      fileOnly,
    );
    addUploadPiece(
      { id: "big1", index: 1, total: 9, data: piece },
      5,
      fileOnly,
    );
    // one file past its own limit is forgotten with its pieces
    expect(() =>
      addUploadPiece(
        { id: "big1", index: 2, total: 9, data: piece },
        5,
        fileOnly,
      ),
    ).toThrow(/larger than the page keeps/);
    expect(uploadsKept().files).toBe(0);

    // two files each within its limit, together past the total
    addUploadPiece(
      { id: "tot1", index: 0, total: 9, data: piece },
      5,
      totalOnly,
    );
    addUploadPiece(
      { id: "tot1", index: 1, total: 9, data: piece },
      5,
      totalOnly,
    );
    expect(() =>
      addUploadPiece(
        { id: "tot2", index: 0, total: 9, data: piece },
        5,
        totalOnly,
      ),
    ).toThrow(/larger than the page keeps/);
    expect(uploadsKept().files).toBe(1);
    dropUpload("tot1");

    addUploadPiece({ id: "late", index: 0, total: 2, data: piece }, 1000);
    expect(uploadsKept().files).toBe(1);
    // another file comes long after: the one that was not used is swept
    addUploadPiece(
      { id: "later", index: 0, total: 1, data: piece },
      1000 + UPLOAD_KEEP_MS + 1,
    );
    expect(uploadsKept()).toEqual({ files: 1, bytes: 1024 });
    expect(() => takeUpload("late")).toThrow(/no file late/);
  });

  it("AC-489 answers in the protocol's words, and a drop forgets a file", async () => {
    expect(
      await run("upload_chunk", { id: "x", index: 0, total: 1, data: "AA==" }),
    ).toMatchObject({ error: { code: "bad-arguments" } });

    await ok("upload_chunk", {
      id: "keep-me",
      index: 0,
      total: 1,
      data: "AAAA",
    });
    expect(uploadsKept().files).toBe(1);
    expect(await ok("upload_drop", { id: "keep-me" })).toEqual({
      dropped: true,
    });
    expect(uploadsKept().files).toBe(0);
    expect(await run("place_image", { upload: "keep-me" })).toMatchObject({
      error: { code: "not-found" },
    });
  });
});

describe("a picture on a page", () => {
  it("AC-490 puts the file on the page as a picture of its own size, at most 600 on its long side, in the middle, in one undo step, and keeps the file", async () => {
    await send("pic-aaaa", png(1200, 600), "wide.png", 2);

    const result = await ok("place_image", { upload: "pic-aaaa" });

    expect(result).toMatchObject({
      page: 1,
      type: "image/png",
      natural: { width: 1200, height: 600 },
    });

    const image = live().find((element) => element.type === "image") as any;

    expect(image).toMatchObject({
      width: 600,
      height: 300,
      status: "saved",
      pageId: h.state.currentPageId,
    });
    expect(image.x + image.width / 2).toBeCloseTo(1920 / 2, 0);
    expect(image.y + image.height / 2).toBeCloseTo(1080 / 2, 0);
    expect(h.app.files[image.fileId]).toMatchObject({ mimeType: "image/png" });
    expect(h.app.files[image.fileId].dataURL).toMatch(
      /^data:image\/png;base64,/,
    );
    // the file was used: the page keeps none
    expect(uploadsKept().files).toBe(0);

    undo();
    expect(live().filter((element) => element.type === "image")).toHaveLength(
      0,
    );
  });

  it("AC-490 puts it where it is told, at the size it is told, on the page it is told, and a small picture is not made larger unless asked", async () => {
    await ok("add_page", {});
    await send("pic-bbbb", png(100, 50));
    await ok("place_image", { upload: "pic-bbbb", page: 2, x: 300, y: 200 });

    const small = live().find((element) => element.type === "image") as any;

    expect(small).toMatchObject({
      width: 100,
      height: 50,
      pageId: h.state.pages[1].id,
    });
    expect((await ok("get_element", { id: small.id })).pageRelative).toEqual({
      x: 300,
      y: 200,
    });

    await send("pic-cccc", png(100, 50));
    await ok("place_image", { upload: "pic-cccc", size: 400, x: 0, y: 0 });

    const big = live().filter((element) => element.type === "image")[1] as any;

    expect(big).toMatchObject({ width: 400, height: 200 });
  });

  it("AC-490 keeps where a picture came from on it, and list_sources tells it", async () => {
    await send("pic-dddd", png(10, 10));
    await ok("place_image", {
      upload: "pic-dddd",
      source: {
        url: "https://example.com/a.png",
        licence: "CC BY",
        attribution: "A. Person",
        ignored: "x",
      },
    });
    await send("pic-eeee", png(10, 10));
    await ok("place_image", { upload: "pic-eeee" });

    const { sources } = await ok("list_sources");

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      page: 1,
      url: "https://example.com/a.png",
      licence: "CC BY",
      attribution: "A. Person",
    });
    expect(sources[0]).not.toHaveProperty("ignored");
    expect(typeof sources[0].fetchedAt).toBe("number");
  });

  it("AC-490 refuses what is not a picture whatever it is called, a size that cannot be read, and a size out of range - and keeps nothing", async () => {
    await send(
      "not-pic1",
      new TextEncoder().encode("<html>a page</html>"),
      "x.png",
    );
    expect(await run("place_image", { upload: "not-pic1" })).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/not a picture/),
      },
    });

    await send("not-pic2", new TextEncoder().encode("<svg></svg>"), "x.svg");
    expect(await run("place_image", { upload: "not-pic2" })).toMatchObject({
      error: { message: expect.stringMatching(/cannot be read/) },
    });

    await send("pic-ffff", png(10, 10));
    expect(
      await run("place_image", { upload: "pic-ffff", size: 5 }),
    ).toMatchObject({ error: { code: "bad-arguments" } });
    expect(live()).toHaveLength(0);
  });

  it("AC-490 is refused while Allow changes is off, and the file is not used", async () => {
    await send("pic-gggg", png(10, 10));

    expect(
      await run(
        "place_image",
        { upload: "pic-gggg" },
        { ...CONTEXT, allowChanges: false },
      ),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(uploadsKept().files).toBe(1);
  });
});

describe("cropping a picture", () => {
  const picture = async () => {
    await send("pic-crop1", png(400, 200));
    await ok("place_image", { upload: "pic-crop1", size: 400, x: 100, y: 100 });

    // a copy: the element on the page is changed where it is
    return { ...live().find((element) => element.type === "image") } as any;
  };

  it("AC-491 crops to a part of the picture, which stays where it was on the page, and the part has the size it had", async () => {
    const image = await picture();

    expect(image).toMatchObject({ x: 100, y: 100, width: 400, height: 200 });

    const result = await ok("crop_image", {
      id: image.id,
      left: 0.25,
      top: 0.5,
      width: 0.5,
      height: 0.5,
    });
    const now = live().find((element) => element.id === image.id) as any;

    expect(result).toMatchObject({ id: image.id, cropped: true });
    expect(now.crop).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      naturalWidth: 400,
      naturalHeight: 200,
    });
    // a picture at its own size: a pixel is a unit, so the part is 200 by 100,
    // a quarter of the width and half of the height in from the corner
    expect(now.width).toBe(200);
    expect(now.height).toBe(100);
    expect(now.x).toBe(image.x + 100);
    expect(now.y).toBe(image.y + 100);

    undo();
    expect(
      (live().find((element) => element.id === image.id) as any).crop,
    ).toBeNull();
  });

  it("AC-491 crops again from the whole picture, not from the part, and takes the crop off with reset", async () => {
    const image = await picture();

    await ok("crop_image", {
      id: image.id,
      left: 0,
      top: 0,
      width: 0.5,
      height: 1,
    });
    await ok("crop_image", {
      id: image.id,
      left: 0.5,
      top: 0,
      width: 0.5,
      height: 1,
    });

    const second = live().find((element) => element.id === image.id) as any;

    expect(second.crop).toMatchObject({
      x: 200,
      y: 0,
      width: 200,
      height: 200,
    });
    expect(second.x).toBe(image.x + 200);

    await ok("crop_image", { id: image.id, reset: true });

    const back = live().find((element) => element.id === image.id) as any;

    expect(back).toMatchObject({
      x: image.x,
      y: image.y,
      width: 400,
      height: 200,
      crop: null,
    });
  });

  it("AC-491 follows the size the picture has on the page, not its own", async () => {
    await send("pic-crop2", png(400, 200));
    await ok("place_image", { upload: "pic-crop2", size: 200 });

    const image = live().find((element) => element.type === "image") as any;

    expect(image.width).toBe(200);

    await ok("crop_image", {
      id: image.id,
      left: 0,
      top: 0,
      width: 0.5,
      height: 0.5,
    });

    const now = live().find((element) => element.id === image.id) as any;

    // half of the picture, on a page where it is half its own size
    expect(now).toMatchObject({ width: 100, height: 50 });
    expect(now.crop).toMatchObject({ width: 200, height: 100 });
  });

  it("AC-491 refuses what is not a picture, a part outside the picture, a part with no size, and a picture that is turned", async () => {
    const image = await picture();

    await ok("create_elements", {
      elements: [{ type: "rectangle", id: "box", x: 0, y: 0 }],
    });
    expect(
      await run("crop_image", {
        id: "box",
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      }),
    ).toMatchObject({
      error: { message: expect.stringMatching(/not a picture/) },
    });
    expect(await run("crop_image", { id: "ghost", reset: true })).toMatchObject(
      { error: { code: "not-found" } },
    );

    for (const part of [
      { left: 0.6, top: 0, width: 0.6, height: 1 },
      { left: 0, top: 0, width: 0, height: 1 },
      { left: -0.1, top: 0, width: 0.5, height: 0.5 },
      { left: 0, top: 0 },
    ]) {
      expect(await run("crop_image", { id: image.id, ...part })).toMatchObject({
        error: { code: "bad-arguments" },
      });
    }

    await ok("update_elements", { updates: [{ id: image.id, angle: 0.5 }] });
    expect(
      await run("crop_image", {
        id: image.id,
        left: 0,
        top: 0,
        width: 0.5,
        height: 0.5,
      }),
    ).toMatchObject({
      error: { message: expect.stringMatching(/turned back/) },
    });
    expect(
      await run(
        "crop_image",
        { id: image.id, left: 0, top: 0, width: 0.5, height: 0.5 },
        { ...CONTEXT, allowChanges: false },
      ),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
  });
});
