/**
 * A GIF encoder of our own (D-377): no dependency, one global palette of up to
 * 256 colours, one bit of transparency, and a loop that never ends.
 *
 * A chart is flat colour, so a palette taken from a few of its pictures serves
 * every frame; each frame is then written as soon as it is made, and the
 * encoder never holds more than one picture. The pieces are pure functions over
 * bytes, so a test can decode what they write.
 */

/** the quantisation of a colour for the palette's work: 5 bits a channel */
const key555 = (r: number, g: number, b: number) =>
  ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

type Entry = { r: number; g: number; b: number; count: number };

/**
 * A palette from the pictures it is for: the colours of every opaque pixel,
 * reduced to at most `maxColors` by median cut. A fully transparent pixel has
 * no colour. Returns r, g, b of each colour in turn.
 */
export const buildPalette = (
  pictures: readonly Uint8ClampedArray[],
  maxColors: number,
): Uint8Array => {
  const seen = new Map<number, Entry>();

  for (const rgba of pictures) {
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) {
        continue;
      }

      const key = key555(rgba[i], rgba[i + 1], rgba[i + 2]);
      const entry = seen.get(key);

      if (entry) {
        entry.count += 1;
      } else {
        seen.set(key, {
          r: rgba[i],
          g: rgba[i + 1],
          b: rgba[i + 2],
          count: 1,
        });
      }
    }
  }

  const entries = [...seen.values()];

  if (entries.length === 0) {
    // nothing opaque at all: one colour keeps the file valid
    return new Uint8Array([0, 0, 0]);
  }

  const boxes: Entry[][] = [entries];
  const spread = (box: Entry[]) => {
    let rMin = 255;
    let rMax = 0;
    let gMin = 255;
    let gMax = 0;
    let bMin = 255;
    let bMax = 0;

    for (const e of box) {
      rMin = Math.min(rMin, e.r);
      rMax = Math.max(rMax, e.r);
      gMin = Math.min(gMin, e.g);
      gMax = Math.max(gMax, e.g);
      bMin = Math.min(bMin, e.b);
      bMax = Math.max(bMax, e.b);
    }

    const ranges = [rMax - rMin, gMax - gMin, bMax - bMin];
    const channel = ranges.indexOf(Math.max(...ranges)) as 0 | 1 | 2;

    return { channel, range: ranges[channel] };
  };

  while (boxes.length < maxColors) {
    // split the box whose colours are the most spread, if any can be split
    let pick = -1;
    let widest = 0;

    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].length < 2) {
        continue;
      }

      const { range } = spread(boxes[i]);

      if (range > widest) {
        widest = range;
        pick = i;
      }
    }

    if (pick < 0) {
      break;
    }

    const box = boxes[pick];
    const { channel } = spread(box);
    const name = (["r", "g", "b"] as const)[channel];

    box.sort((a, b) => a[name] - b[name]);

    // cut where half of the pixels are on each side
    const total = box.reduce((sum, e) => sum + e.count, 0);
    let run = 0;
    let cut = 1;

    for (let i = 0; i < box.length - 1; i++) {
      run += box[i].count;
      cut = i + 1;

      if (run >= total / 2) {
        break;
      }
    }

    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }

  const palette = new Uint8Array(boxes.length * 3);

  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let total = 0;

    for (const e of box) {
      r += e.r * e.count;
      g += e.g * e.count;
      b += e.b * e.count;
      total += e.count;
    }

    palette[i * 3] = Math.round(r / total);
    palette[i * 3 + 1] = Math.round(g / total);
    palette[i * 3 + 2] = Math.round(b / total);
  });

  return palette;
};

/**
 * One picture as palette indexes. A pixel that is mostly transparent is the
 * transparent index; any other is the nearest colour of the palette.
 */
export const indexPicture = (
  rgba: Uint8ClampedArray,
  palette: Uint8Array,
  transparentIndex: number | null,
): Uint8Array => {
  const count = rgba.length / 4;
  const out = new Uint8Array(count);
  const cache = new Int16Array(32768).fill(-1);
  const colors = palette.length / 3;

  for (let p = 0; p < count; p++) {
    const i = p * 4;

    if (rgba[i + 3] < 128) {
      out[p] = transparentIndex ?? 0;
      continue;
    }

    const key = key555(rgba[i], rgba[i + 1], rgba[i + 2]);
    let index = cache[key];

    if (index < 0) {
      let best = Infinity;

      index = 0;

      for (let c = 0; c < colors; c++) {
        const dr = rgba[i] - palette[c * 3];
        const dg = rgba[i + 1] - palette[c * 3 + 1];
        const db = rgba[i + 2] - palette[c * 3 + 2];
        const distance = dr * dr + dg * dg + db * db;

        if (distance < best) {
          best = distance;
          index = c;
        }
      }

      cache[key] = index;
    }

    out[p] = index;
  }

  return out;
};

/** a growing byte buffer */
class Bytes {
  private data = new Uint8Array(1 << 16);

  length = 0;

  push(byte: number) {
    if (this.length === this.data.length) {
      const next = new Uint8Array(this.data.length * 2);

      next.set(this.data);
      this.data = next;
    }

    this.data[this.length++] = byte & 255;
  }

  word(value: number) {
    this.push(value);
    this.push(value >> 8);
  }

  bytes(values: ArrayLike<number>) {
    for (let i = 0; i < values.length; i++) {
      this.push(values[i]);
    }
  }

  ascii(text: string) {
    for (let i = 0; i < text.length; i++) {
      this.push(text.charCodeAt(i));
    }
  }

  result(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

/** the pixels of one frame, LZW-compressed as GIF wants them, in sub-blocks */
const lzwBlocks = (
  out: Bytes,
  pixels: Uint8Array,
  minCodeSize: number,
): void => {
  const clear = 1 << minCodeSize;
  const end = clear + 1;

  out.push(minCodeSize);

  // the codes are packed from the low bit of each byte, and cut into blocks
  let block: number[] = [];
  let bitBuffer = 0;
  let bitCount = 0;

  const flushBlock = () => {
    if (block.length) {
      out.push(block.length);
      out.bytes(block);
      block = [];
    }
  };

  const emit = (code: number, size: number) => {
    bitBuffer |= code << bitCount;
    bitCount += size;

    while (bitCount >= 8) {
      block.push(bitBuffer & 255);
      bitBuffer >>>= 8;
      bitCount -= 8;

      if (block.length === 255) {
        flushBlock();
      }
    }
  };

  // the dictionary: (prefix code, next byte) -> code, an open-addressing table
  const SIZE = 1 << 14;
  const keys = new Int32Array(SIZE);
  const values = new Int16Array(SIZE);
  const reset = () => keys.fill(-1);
  const find = (key: number): number => {
    let slot = (key * 2654435761) >>> 18;

    while (keys[slot] !== -1) {
      if (keys[slot] === key) {
        return values[slot];
      }

      slot = (slot + 1) & (SIZE - 1);
    }

    return -1;
  };
  const add = (key: number, code: number) => {
    let slot = (key * 2654435761) >>> 18;

    while (keys[slot] !== -1) {
      slot = (slot + 1) & (SIZE - 1);
    }

    keys[slot] = key;
    values[slot] = code;
  };

  reset();

  let codeSize = minCodeSize + 1;
  let next = end + 1;

  emit(clear, codeSize);

  if (pixels.length > 0) {
    let current = pixels[0];

    for (let i = 1; i < pixels.length; i++) {
      const byte = pixels[i];
      const key = (current << 8) | byte;
      const found = find(key);

      if (found >= 0) {
        current = found;
        continue;
      }

      emit(current, codeSize);

      if (next === 4096) {
        // the table is full: say so, and start it again
        emit(clear, codeSize);
        reset();
        next = end + 1;
        codeSize = minCodeSize + 1;
      } else {
        if (next >= 1 << codeSize) {
          codeSize += 1;
        }

        add(key, next);
        next += 1;
      }

      current = byte;
    }

    emit(current, codeSize);
  }

  emit(end, codeSize);

  if (bitCount > 0) {
    block.push(bitBuffer & 255);
  }

  flushBlock();
  out.push(0);
};

export type GifEncoder = {
  /** one picture, as palette indexes, shown for `delayCs` hundredths of a second */
  addFrame: (indexes: Uint8Array, delayCs: number) => void;
  /** the whole file */
  finish: () => Uint8Array;
  /** how many bytes the file is, so far */
  size: () => number;
};

/**
 * A GIF that loops for ever. `palette` is r, g, b of up to 256 colours; the
 * transparent index (or null) is one of them that no opaque pixel uses.
 */
export const createGifEncoder = (options: {
  width: number;
  height: number;
  palette: Uint8Array;
  transparentIndex: number | null;
}): GifEncoder => {
  const { width, height, palette, transparentIndex } = options;
  const out = new Bytes();
  const colors = palette.length / 3;

  // the table has a power of two of entries, and each index needs that many bits
  let bits = 1;

  while (1 << bits < colors) {
    bits += 1;
  }

  const tableSize = 1 << bits;
  const minCodeSize = Math.max(2, bits);

  out.ascii("GIF89a");
  out.word(width);
  out.word(height);
  // a global colour table, 8 bits of colour resolution, its size
  out.push(0x80 | 0x70 | (bits - 1));
  out.push(0); // the background index
  out.push(0); // the pixel aspect ratio

  for (let i = 0; i < tableSize * 3; i++) {
    out.push(i < palette.length ? palette[i] : 0);
  }

  // the loop: for ever
  out.bytes([0x21, 0xff, 0x0b]);
  out.ascii("NETSCAPE2.0");
  out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  return {
    addFrame: (indexes, delayCs) => {
      if (indexes.length !== width * height) {
        throw new Error(
          `a frame of ${indexes.length} pixels in a ${width}x${height} GIF`,
        );
      }

      // the graphic control: a transparent frame is cleared before the next
      out.bytes([0x21, 0xf9, 0x04]);
      out.push(transparentIndex === null ? 0x04 : 0x08 | 0x01);
      out.word(Math.max(0, Math.round(delayCs)));
      out.push(transparentIndex ?? 0);
      out.push(0);

      out.push(0x2c);
      out.word(0);
      out.word(0);
      out.word(width);
      out.word(height);
      out.push(0);

      lzwBlocks(out, indexes, minCodeSize);
    },
    finish: () => {
      out.push(0x3b);

      return out.result();
    },
    size: () => out.length,
  };
};

/**
 * The palette with one more entry, which no opaque pixel uses, for the pixels
 * that are transparent. A GIF has one bit of transparency: a pixel is either
 * that entry or one of the colours.
 */
export const addTransparentEntry = (
  palette: Uint8Array,
): { palette: Uint8Array; transparentIndex: number } => {
  const next = new Uint8Array(palette.length + 3);

  next.set(palette);

  return { palette: next, transparentIndex: palette.length / 3 };
};
