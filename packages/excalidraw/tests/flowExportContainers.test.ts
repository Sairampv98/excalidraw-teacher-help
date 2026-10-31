/**
 * Exporting an animation as a WebP or an MP4 (D-377, D-378): the containers the
 * code writes are read back by small parsers written here, and must hold the
 * same pictures, in the same order, for the same time.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import { avcCodecFor, muxMp4 } from "../scene/flowExport/mp4";
import { assembleAnimatedWebp, readStillWebp } from "../scene/flowExport/webp";

/* ------------------------------------------------------------------ webp */

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [
  n & 255,
  (n >> 8) & 255,
  (n >> 16) & 255,
  (n >>> 24) & 255,
];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

const chunk = (name: string, body: number[]) => [
  ...ascii(name),
  ...le32(body.length),
  ...body,
  ...(body.length & 1 ? [0] : []),
];

const riff = (chunks: number[][]) => {
  const body = [...ascii("WEBP"), ...chunks.flat()];

  return Uint8Array.from([...ascii("RIFF"), ...le32(body.length), ...body]);
};

/** a lossless still: VP8L, whose header holds the size and the alpha bit */
const losslessStill = (
  width: number,
  height: number,
  alpha: boolean,
  fill: number,
) =>
  riff([
    chunk("VP8L", [
      0x2f,
      ...le32((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)),
      fill,
      fill,
      fill,
    ]),
  ]);

/** a lossy still with alpha, as the browser writes it: VP8X, ALPH and VP8 */
const lossyAlphaStill = (width: number, height: number, fill: number) =>
  riff([
    chunk("VP8X", [0x10, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]),
    chunk("ALPH", [0, fill, fill]),
    chunk("VP8 ", [
      0x10,
      0,
      0,
      0x9d,
      0x01,
      0x2a,
      width & 255,
      width >> 8,
      height & 255,
      height >> 8,
      fill,
      fill,
      fill,
    ]),
  ]);

type Parsed = { name: string; body: Uint8Array };

const chunksOf = (bytes: Uint8Array, from: number, to: number): Parsed[] => {
  const out: Parsed[] = [];
  let at = from;

  while (at + 8 <= to) {
    const name = String.fromCharCode(...bytes.slice(at, at + 4));
    const size =
      (bytes[at + 4] |
        (bytes[at + 5] << 8) |
        (bytes[at + 6] << 16) |
        (bytes[at + 7] << 24)) >>>
      0;

    out.push({ name, body: bytes.slice(at + 8, at + 8 + size) });
    at += 8 + size + (size & 1);
  }

  expect(at).toBe(to);

  return out;
};

describe("the animated WebP", () => {
  it("AC-439 a still is read for its picture chunks, its size and its transparency", () => {
    const lossless = readStillWebp(losslessStill(30, 20, true, 5));

    expect(lossless).toMatchObject({ width: 30, height: 20, hasAlpha: true });
    expect(String.fromCharCode(...lossless.chunks.slice(0, 4))).toBe("VP8L");

    const opaque = readStillWebp(losslessStill(30, 20, false, 5));

    expect(opaque.hasAlpha).toBe(false);

    // the browser's lossy picture with alpha: ALPH and VP8 are kept, VP8X is not
    const lossy = readStillWebp(lossyAlphaStill(64, 48, 9));
    const names = chunksOf(lossy.chunks, 0, lossy.chunks.length).map(
      (c) => c.name,
    );

    expect(names).toEqual(["ALPH", "VP8 "]);
    expect(lossy).toMatchObject({ width: 64, height: 48, hasAlpha: true });

    expect(() => readStillWebp(Uint8Array.from([1, 2, 3]))).toThrow(
      /not a WebP/,
    );
  });

  it("AC-439 the frames are one animation: its header, its loop, and each frame with its time", () => {
    const frames = [
      { bytes: lossyAlphaStill(64, 48, 1), durationMs: 67 },
      { bytes: lossyAlphaStill(64, 48, 2), durationMs: 66 },
      { bytes: lossyAlphaStill(64, 48, 3), durationMs: 67 },
    ];
    const file = assembleAnimatedWebp(frames, { width: 64, height: 48 });

    expect(String.fromCharCode(...file.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...file.slice(8, 12))).toBe("WEBP");

    // the size in the RIFF header is the rest of the file
    const riffSize =
      (file[4] | (file[5] << 8) | (file[6] << 16) | (file[7] << 24)) >>> 0;

    expect(riffSize).toBe(file.length - 8);

    const top = chunksOf(file, 12, file.length);

    expect(top.map((c) => c.name)).toEqual([
      "VP8X",
      "ANIM",
      "ANMF",
      "ANMF",
      "ANMF",
    ]);

    // animation and alpha flags, and the canvas size
    const vp8x = top[0].body;

    expect(vp8x[0] & 0x02).toBe(0x02);
    expect(vp8x[0] & 0x10).toBe(0x10);
    expect(vp8x[4] | (vp8x[5] << 8) | (vp8x[6] << 16)).toBe(63);
    expect(vp8x[7] | (vp8x[8] << 8) | (vp8x[9] << 16)).toBe(47);

    // it loops for ever
    expect([...top[1].body.slice(4, 6)]).toEqual([0, 0]);

    top.slice(2).forEach((anmf, i) => {
      const body = anmf.body;

      // the frame is the whole picture, shown for its time
      expect(body[6] | (body[7] << 8) | (body[8] << 16)).toBe(63);
      expect(body[9] | (body[10] << 8) | (body[11] << 16)).toBe(47);
      expect(body[12] | (body[13] << 8) | (body[14] << 16)).toBe(
        frames[i].durationMs,
      );

      // a picture with transparency is cleared before the next
      expect(body[15] & 1).toBe(1);

      // and it carries its own picture chunks, in order
      const inside = chunksOf(body, 16, body.length);

      expect(inside.map((c) => c.name)).toEqual(["ALPH", "VP8 "]);
      expect(inside[0].body[1]).toBe(i + 1);
    });
  });

  it("AC-439 an animation of opaque pictures has no alpha flag and is not cleared between frames", () => {
    const file = assembleAnimatedWebp(
      [
        { bytes: losslessStill(16, 16, false, 1), durationMs: 100 },
        { bytes: losslessStill(16, 16, false, 2), durationMs: 100 },
      ],
      { width: 16, height: 16 },
    );
    const top = chunksOf(file, 12, file.length);

    expect(top[0].body[0] & 0x10).toBe(0);
    expect(top[2].body[15] & 1).toBe(0);
    expect(() => assembleAnimatedWebp([], { width: 1, height: 1 })).toThrow(
      /needs a frame/,
    );
  });
});

/* ------------------------------------------------------------------- mp4 */

type Box = {
  name: string;
  start: number;
  end: number;
  body: number;
  kids: Box[];
};

/** the boxes that hold other boxes */
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "dinf"]);

const u32at = (bytes: Uint8Array, at: number) =>
  ((bytes[at] << 24) |
    (bytes[at + 1] << 16) |
    (bytes[at + 2] << 8) |
    bytes[at + 3]) >>>
  0;

const readBoxes = (bytes: Uint8Array, from: number, to: number): Box[] => {
  const out: Box[] = [];
  let at = from;

  while (at < to) {
    const size = u32at(bytes, at);
    const name = String.fromCharCode(...bytes.slice(at + 4, at + 8));

    expect(size).toBeGreaterThanOrEqual(8);

    const box: Box = {
      name,
      start: at,
      end: at + size,
      body: at + 8,
      kids: [],
    };

    if (CONTAINERS.has(name)) {
      box.kids = readBoxes(bytes, box.body, box.end);
    }

    out.push(box);
    at += size;
  }

  // the boxes fill the file exactly: no byte is left over
  expect(at).toBe(to);

  return out;
};

const find = (boxes: Box[], ...path: string[]): Box => {
  let level = boxes;
  let found: Box | undefined;

  for (const name of path) {
    found = level.find((box) => box.name === name);

    if (!found) {
      throw new Error(`no ${name} in ${path.join("/")}`);
    }

    level = found.kids;
  }

  return found!;
};

describe("the MP4 file", () => {
  const avcC = Uint8Array.from([
    1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 1, 2, 3, 1, 0, 2, 0x68, 9,
  ]);
  const samples = [
    { data: Uint8Array.from([0, 0, 0, 3, 1, 2, 3]), duration: 33, key: true },
    {
      data: Uint8Array.from([0, 0, 0, 4, 4, 5, 6, 7]),
      duration: 33,
      key: false,
    },
    { data: Uint8Array.from([0, 0, 0, 1, 8]), duration: 34, key: false },
    {
      data: Uint8Array.from([0, 0, 0, 5, 9, 9, 9, 9, 9]),
      duration: 33,
      key: true,
    },
  ];
  const file = muxMp4({
    width: 640,
    height: 360,
    timescale: 1000,
    samples,
    avcC,
  });
  const top = readBoxes(file, 0, file.length);
  const stbl = find(top, "moov", "trak", "mdia", "minf", "stbl");
  const table = (name: string) => stbl.kids.find((box) => box.name === name);

  it("AC-440 the file starts with its type, then its tables, then its pictures, so it plays from the start", () => {
    expect(top.map((box) => box.name)).toEqual(["ftyp", "moov", "mdat"]);
    expect(String.fromCharCode(...file.slice(8, 12))).toBe("isom");

    // the movie is as long as its pictures
    const mvhd = find(top, "moov", "mvhd");

    expect(u32at(file, mvhd.body + 4 + 8)).toBe(1000);
    expect(u32at(file, mvhd.body + 4 + 12)).toBe(133);

    // and the picture is as large as it was made
    const tkhd = find(top, "moov", "trak", "tkhd");

    expect(u32at(file, tkhd.body + 76)).toBe(640 * 65536);
    expect(u32at(file, tkhd.body + 80)).toBe(360 * 65536);
  });

  it("AC-440 the tables say how long each picture is, how big, and which can start the playing", () => {
    // equal times are one run: two of 33, one of 34, one of 33
    const stts = table("stts")!;

    expect(u32at(file, stts.body + 4)).toBe(3);
    expect(
      [8, 12, 16, 20, 24, 28].map((at) => u32at(file, stts.body + at)),
    ).toEqual([2, 33, 1, 34, 1, 33]);

    // the size of each picture, in the order they were given
    const stsz = table("stsz")!;

    expect(u32at(file, stsz.body + 4)).toBe(0);
    expect(u32at(file, stsz.body + 8)).toBe(4);
    expect([12, 16, 20, 24].map((at) => u32at(file, stsz.body + at))).toEqual(
      samples.map((sample) => sample.data.length),
    );

    // the first and the fourth are key pictures, counted from one
    const stss = table("stss")!;

    expect(u32at(file, stss.body + 4)).toBe(2);
    expect([8, 12].map((at) => u32at(file, stss.body + at))).toEqual([1, 4]);

    // all of them are in one chunk
    const stsc = table("stsc")!;

    expect([4, 8, 12, 16].map((at) => u32at(file, stsc.body + at))).toEqual([
      1, 1, 4, 1,
    ]);
  });

  it("AC-440 the offset points at the pictures, one after another, in the data box", () => {
    const stco = table("stco")!;
    const offset = u32at(file, stco.body + 8);
    const mdat = top.find((box) => box.name === "mdat")!;

    // the data box begins right where the offset says, after its own header
    expect(offset).toBe(mdat.body);

    const whole = samples.flatMap((sample) => [...sample.data]);

    expect([...file.slice(offset, offset + whole.length)]).toEqual(whole);
    expect(mdat.end).toBe(file.length);
  });

  it("AC-440 the decoder's own configuration and the picture's size are in the sample description", () => {
    const stsd = table("stsd")!;
    const inside = [...file.slice(stsd.start, stsd.end)];
    const at = inside.findIndex(
      (_, i) => String.fromCharCode(...inside.slice(i, i + 4)) === "avc1",
    );

    // after the name: 6 + 2 + 2 + 2 + 12 bytes, then the width and the height
    expect((inside[at + 28] << 8) | inside[at + 29]).toBe(640);
    expect((inside[at + 30] << 8) | inside[at + 31]).toBe(360);

    const config = inside.findIndex(
      (_, i) => String.fromCharCode(...inside.slice(i, i + 4)) === "avcC",
    );

    expect(inside.slice(config + 4, config + 4 + avcC.length)).toEqual([
      ...avcC,
    ]);
  });

  it("AC-440 a video of key pictures only has no table of keys, and a video of none is refused", () => {
    const allKeys = muxMp4({
      width: 64,
      height: 64,
      timescale: 1000,
      samples: samples.map((sample) => ({ ...sample, key: true })),
      avcC,
    });
    const boxes = readBoxes(allKeys, 0, allKeys.length);
    const names = find(boxes, "moov", "trak", "mdia", "minf", "stbl").kids.map(
      (box) => box.name,
    );

    expect(names).not.toContain("stss");
    expect(() =>
      muxMp4({ width: 64, height: 64, timescale: 1000, samples: [], avcC }),
    ).toThrow(/needs a picture/);
  });

  it("AC-440 the codec asked of the encoder has the level the picture and the rate need", () => {
    expect(avcCodecFor(480, 270, 15)).toBe("avc1.64001E");
    expect(avcCodecFor(1280, 720, 30)).toBe("avc1.64001F");
    expect(avcCodecFor(1920, 1080, 30)).toBe("avc1.640028");
    expect(avcCodecFor(1080, 1920, 30)).toBe("avc1.640028");
    expect(avcCodecFor(1920, 1080, 60)).toBe("avc1.64002A");
    expect(avcCodecFor(3840, 2160, 30)).toBe("avc1.640033");
  });
});
