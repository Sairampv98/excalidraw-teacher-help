/**
 * An animated WebP of our own (D-377): the browser writes each picture as a
 * still WebP, and this puts them into the animation container - the RIFF file
 * with a `VP8X` header, an `ANIM` chunk and one `ANMF` chunk for each frame.
 * No dependency; the pieces are pure functions over bytes.
 */

const text = (bytes: Uint8Array, at: number, length = 4) =>
  String.fromCharCode(...bytes.slice(at, at + length));

const u32 = (bytes: Uint8Array, at: number) =>
  (bytes[at] |
    (bytes[at + 1] << 8) |
    (bytes[at + 2] << 16) |
    (bytes[at + 3] << 24)) >>>
  0;

export type StillWebp = {
  /** the frame's own chunks (ALPH, VP8, VP8L), each with its header and padding */
  chunks: Uint8Array;
  width: number;
  height: number;
  /** whether the picture has transparency in it */
  hasAlpha: boolean;
};

/** the size and the transparency of a still WebP, read out of its bitstream */
const readStill = (
  bytes: Uint8Array,
): { width: number; height: number; hasAlpha: boolean } => {
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let at = 12;

  while (at + 8 <= bytes.length) {
    const kind = text(bytes, at);
    const size = u32(bytes, at + 4);
    const body = at + 8;

    if (kind === "VP8X") {
      hasAlpha = (bytes[body] & 0x10) !== 0;
      width =
        1 +
        (bytes[body + 4] | (bytes[body + 5] << 8) | (bytes[body + 6] << 16));
      height =
        1 +
        (bytes[body + 7] | (bytes[body + 8] << 8) | (bytes[body + 9] << 16));
    } else if (kind === "VP8L" && bytes[body] === 0x2f) {
      const bits = u32(bytes, body + 1);

      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
      hasAlpha = hasAlpha || ((bits >>> 28) & 1) === 1;
    } else if (kind === "VP8 ") {
      // a key frame: a 3-byte tag, the start code, then two 14-bit sizes
      if (
        bytes[body + 3] === 0x9d &&
        bytes[body + 4] === 0x01 &&
        bytes[body + 5] === 0x2a
      ) {
        width = width || (bytes[body + 6] | (bytes[body + 7] << 8)) & 0x3fff;
        height = height || (bytes[body + 8] | (bytes[body + 9] << 8)) & 0x3fff;
      }
    } else if (kind === "ALPH") {
      hasAlpha = true;
    }

    at = body + size + (size & 1);
  }

  return { width, height, hasAlpha };
};

/** the chunks of one still WebP that make a frame, and what the picture is */
export const readStillWebp = (bytes: Uint8Array): StillWebp => {
  if (
    bytes.length < 20 ||
    text(bytes, 0) !== "RIFF" ||
    text(bytes, 8) !== "WEBP"
  ) {
    throw new Error("not a WebP file");
  }

  const parts: Uint8Array[] = [];
  let at = 12;

  while (at + 8 <= bytes.length) {
    const kind = text(bytes, at);
    const size = u32(bytes, at + 4);
    const end = at + 8 + size + (size & 1);

    if (kind === "ALPH" || kind === "VP8 " || kind === "VP8L") {
      parts.push(bytes.slice(at, Math.min(end, bytes.length)));
    }

    at = end;
  }

  if (!parts.some((part) => text(part, 0) !== "ALPH")) {
    throw new Error("a WebP with no picture in it");
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const chunks = new Uint8Array(total);
  let place = 0;

  for (const part of parts) {
    chunks.set(part, place);
    place += part.length;
  }

  return { chunks, ...readStill(bytes) };
};

const le24 = (value: number) => [
  value & 255,
  (value >> 8) & 255,
  (value >> 16) & 255,
];
const le32 = (value: number) => [
  value & 255,
  (value >> 8) & 255,
  (value >> 16) & 255,
  (value >>> 24) & 255,
];

const ascii = (name: string) => [...name].map((c) => c.charCodeAt(0));

/** one chunk: its name, its size, its bytes, and a pad byte when the size is odd */
const chunk = (name: string, body: ArrayLike<number>): Uint8Array => {
  const size = body.length;
  const out = new Uint8Array(8 + size + (size & 1));

  out.set(ascii(name), 0);
  out.set(le32(size), 4);
  out.set(body as ArrayLike<number>, 8);

  return out;
};

export type WebpFrame = {
  /** a still WebP, as the browser wrote it */
  bytes: Uint8Array;
  /** how long it is shown, in milliseconds */
  durationMs: number;
};

/**
 * The frames as one animated WebP that loops for ever. Every frame is the whole
 * picture; a picture with transparency is cleared before the next so the old
 * one does not show through.
 */
export const assembleAnimatedWebp = (
  frames: readonly WebpFrame[],
  size: { width: number; height: number },
): Uint8Array => {
  if (frames.length === 0) {
    throw new Error("an animation needs a frame");
  }

  const stills = frames.map((frame) => readStillWebp(frame.bytes));
  const anyAlpha = stills.some((still) => still.hasAlpha);

  const header = chunk("VP8X", [
    0x02 | (anyAlpha ? 0x10 : 0),
    0,
    0,
    0,
    ...le24(size.width - 1),
    ...le24(size.height - 1),
  ]);

  // a transparent background colour, and a loop count of zero: for ever
  const animation = chunk("ANIM", [0, 0, 0, 0, 0, 0]);

  const parts: Uint8Array[] = [header, animation];

  stills.forEach((still, i) => {
    const head = [
      ...le24(0),
      ...le24(0),
      ...le24((still.width || size.width) - 1),
      ...le24((still.height || size.height) - 1),
      ...le24(Math.max(1, Math.round(frames[i].durationMs))),
      // dispose to the background for a transparent picture; blend with alpha
      still.hasAlpha ? 0x01 : 0x00,
    ];
    const body = new Uint8Array(head.length + still.chunks.length);

    body.set(head, 0);
    body.set(still.chunks, head.length);
    parts.push(chunk("ANMF", body));
  });

  const total = parts.reduce((sum, part) => sum + part.length, 4);
  const out = new Uint8Array(8 + total);

  out.set(ascii("RIFF"), 0);
  out.set(le32(total), 4);
  out.set(ascii("WEBP"), 8);

  let at = 12;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};
