import * as zlib from "node:zlib";

/**
 * CRC-32 of some bytes, on any Node that VS Code ships (D-448).
 *
 * `zlib.crc32` is a Node 20.15 builtin. VS Code 1.70 - the version on an old
 * classroom computer - runs Node 16, which has no such function, and the capture's
 * change detection would throw on the first frame. So the builtin is used when it
 * is there, and a table of our own when it is not. Both give the standard CRC-32
 * (the one of zip and PNG), so the same bytes give the same number either way.
 */

type NativeCrc32 = (data: Uint8Array, value?: number) => number;

const native = (zlib as unknown as { crc32?: NativeCrc32 }).crc32;

const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n++) {
    let c = n;

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

/** the table's CRC-32, always: the builtin's twin, and what Node 16 runs */
export const crc32Table = (bytes: Uint8Array): number => {
  let c = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
};

/** the builtin when this Node has it, the table when it has not */
export const crc32: (bytes: Uint8Array) => number =
  typeof native === "function" ? (bytes) => native(bytes) : crc32Table;
