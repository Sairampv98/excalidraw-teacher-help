/**
 * A small decoder of the GIF format, written as the oracle for the tests of the
 * encoder: what the encoder writes is read back by this and compared.
 */

import { expect } from "vitest";

export type DecodedGif = {
  width: number;
  height: number;
  palette: Uint8Array;
  loops: number | null;
  frames: {
    pixels: Uint8Array;
    delayCs: number;
    transparentIndex: number | null;
    disposal: number;
  }[];
};

const lzwDecode = (minCodeSize: number, data: Uint8Array): number[] => {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];

  let table: number[][] = [];
  let codeSize = minCodeSize + 1;
  let previous: number[] | null = null;
  let bitBuffer = 0;
  let bitCount = 0;
  let at = 0;

  const reset = () => {
    table = [];

    for (let i = 0; i < clear; i++) {
      table.push([i]);
    }

    table.push([], []);
    codeSize = minCodeSize + 1;
    previous = null;
  };

  reset();

  for (;;) {
    while (bitCount < codeSize && at < data.length) {
      bitBuffer |= data[at++] << bitCount;
      bitCount += 8;
    }

    if (bitCount < codeSize) {
      throw new Error("the data ended before the end code");
    }

    const code = bitBuffer & ((1 << codeSize) - 1);

    bitBuffer >>>= codeSize;
    bitCount -= codeSize;

    if (code === clear) {
      reset();
      continue;
    }

    if (code === end) {
      return out;
    }

    let entry: number[];

    if (code < table.length) {
      entry = table[code];
    } else if (code === table.length && previous) {
      entry = [...previous, previous[0]];
    } else {
      throw new Error(`a code that is not in the table: ${code}`);
    }

    out.push(...entry);

    if (previous && table.length < 4096) {
      table.push([...previous, entry[0]]);
    }

    if (table.length === 1 << codeSize && codeSize < 12) {
      codeSize += 1;
    }

    previous = entry;
  }
};

export const decodeGif = (bytes: Uint8Array): DecodedGif => {
  const text = (from: number, to: number) =>
    String.fromCharCode(...bytes.slice(from, to));
  const word = (at: number) => bytes[at] | (bytes[at + 1] << 8);

  expect(text(0, 6)).toBe("GIF89a");

  const width = word(6);
  const height = word(8);
  const flags = bytes[10];

  expect(flags & 0x80).toBe(0x80);

  const tableSize = 1 << ((flags & 7) + 1);
  const palette = bytes.slice(13, 13 + tableSize * 3);

  let at = 13 + tableSize * 3;
  let loops: number | null = null;
  let gce: {
    delayCs: number;
    transparentIndex: number | null;
    disposal: number;
  } = { delayCs: 0, transparentIndex: null, disposal: 0 };
  const frames: DecodedGif["frames"] = [];

  for (;;) {
    const marker = bytes[at++];

    if (marker === 0x3b) {
      break;
    }

    if (marker === 0x21) {
      const label = bytes[at++];
      const size = bytes[at];

      if (label === 0xf9) {
        const packed = bytes[at + 1];

        gce = {
          delayCs: word(at + 2),
          transparentIndex: packed & 1 ? bytes[at + 4] : null,
          disposal: (packed >> 2) & 7,
        };
      } else if (label === 0xff && text(at + 1, at + 12) === "NETSCAPE2.0") {
        loops = word(at + 14);
      }

      // skip the sub-blocks
      let block = size;

      while (block !== 0) {
        at += block + 1;
        block = bytes[at];
      }

      at += 1;
      continue;
    }

    if (marker === 0x2c) {
      const frameWidth = word(at + 4);
      const frameHeight = word(at + 6);

      expect(word(at)).toBe(0);
      expect(word(at + 2)).toBe(0);
      expect(frameWidth).toBe(width);
      expect(frameHeight).toBe(height);

      at += 9;

      const minCodeSize = bytes[at++];
      const data: number[] = [];

      for (let size = bytes[at]; size !== 0; size = bytes[at]) {
        data.push(...bytes.slice(at + 1, at + 1 + size));
        at += size + 1;
      }

      at += 1;

      frames.push({
        pixels: Uint8Array.from(lzwDecode(minCodeSize, Uint8Array.from(data))),
        ...gce,
      });
      continue;
    }

    throw new Error(`a byte that starts nothing: ${marker} at ${at - 1}`);
  }

  return { width, height, palette, loops, frames };
};
