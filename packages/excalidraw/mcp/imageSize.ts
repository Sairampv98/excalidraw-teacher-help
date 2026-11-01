/**
 * The size of a picture, read from its own bytes (D-409).
 *
 * A picture that arrives from the assistant - from a file or from the internet -
 * has to be put on a page at a size, and the size is its own. Decoding it in the
 * browser would do, but a decode needs an image element and a moment, and says
 * nothing where there is no screen; the headers of the formats say it at once, and
 * the same code runs in a test. Where the bytes do not say (a format that is not
 * read here), the answer is `null` and the caller decodes.
 */

export type ImageSize = { width: number; height: number };

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const i32le = (b: Uint8Array, at: number) =>
  b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);
const ascii = (b: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...b.slice(at, at + length));

const valid = (width: number, height: number): ImageSize | null =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;

const png = (b: Uint8Array) =>
  b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG"
    ? valid(u32be(b, 16), u32be(b, 20))
    : null;

const gif = (b: Uint8Array) =>
  b.length >= 10 && ascii(b, 0, 3) === "GIF"
    ? valid(u16le(b, 6), u16le(b, 8))
    : null;

const bmp = (b: Uint8Array) =>
  b.length >= 26 && ascii(b, 0, 2) === "BM"
    ? valid(Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)))
    : null;

const jpeg = (b: Uint8Array): ImageSize | null => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) {
    return null;
  }

  let at = 2;

  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at += 1;
      continue;
    }

    const marker = b[at + 1];

    // a start of frame: not the tables (C4, CC) and not the jump (C8)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return valid(u16be(b, at + 7), u16be(b, at + 5));
    }

    if (
      marker === 0xd8 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      at += 2;
      continue;
    }

    at += 2 + u16be(b, at + 2);
  }

  return null;
};

const webp = (b: Uint8Array): ImageSize | null => {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") {
    return null;
  }

  const chunk = ascii(b, 12, 4);

  if (chunk === "VP8 ") {
    return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }

  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);

    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }

  if (chunk === "VP8X") {
    const width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    const height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));

    return valid(width, height);
  }

  return null;
};

const avif = (b: Uint8Array): ImageSize | null => {
  if (b.length < 32 || ascii(b, 4, 4) !== "ftyp") {
    return null;
  }

  // the image spatial extents box: 'ispe', a version, then the width and height
  for (let at = 0; at + 20 < Math.min(b.length, 4096); at++) {
    if (ascii(b, at, 4) === "ispe") {
      return valid(u32be(b, at + 8), u32be(b, at + 12));
    }
  }

  return null;
};

const NUMBER = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i;

const svg = (b: Uint8Array): ImageSize | null => {
  const head = new TextDecoder().decode(b.slice(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];

  if (!tag) {
    return null;
  }

  const attribute = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  const width = NUMBER.exec(attribute("width") ?? "");
  const height = NUMBER.exec(attribute("height") ?? "");

  if (width && height) {
    return valid(Number(width[1]), Number(height[1]));
  }

  const box = attribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);

  return box && box.length === 4 ? valid(box[2], box[3]) : null;
};

/** the size a picture says it is, or null when its bytes do not say */
export const imageSizeOf = (bytes: Uint8Array): ImageSize | null =>
  png(bytes) ??
  gif(bytes) ??
  jpeg(bytes) ??
  webp(bytes) ??
  bmp(bytes) ??
  avif(bytes) ??
  svg(bytes);

export type SniffedType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/avif"
  | "image/bmp"
  | "image/svg+xml"
  | "application/pdf"
  | "video/mp4"
  | "video/webm"
  | "text/html"
  | "text/plain";

/**
 * What the bytes are, whatever a file's name or a server's header says (D-410):
 * an extension is a claim, and the first bytes are the fact.
 */
export const sniffType = (bytes: Uint8Array): SniffedType | null => {
  if (bytes.length < 4) {
    return null;
  }

  if (png(bytes)) {
    return "image/png";
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (ascii(bytes, 0, 3) === "GIF") {
    return "image/gif";
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }

  if (ascii(bytes, 0, 2) === "BM" && bytes.length > 26) {
    return "image/bmp";
  }

  if (ascii(bytes, 0, 4) === "%PDF") {
    return "application/pdf";
  }

  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    return ascii(bytes, 8, 4).startsWith("avif") ||
      ascii(bytes, 8, 4).startsWith("avis")
      ? "image/avif"
      : "video/mp4";
  }

  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "video/webm";
  }

  const head = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart();

  if (
    /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?(<!doctype svg[^>]*>\s*)?<svg\b/i.test(
      head,
    )
  ) {
    return "image/svg+xml";
  }

  if (/^<!doctype html|^<html\b/i.test(head)) {
    return "text/html";
  }

  // text: no control characters in what has been read
  // eslint-disable-next-line no-control-regex
  return /^[\u0009\u000a\u000d -￿]*$/.test(head) ? "text/plain" : null;
};
