/**
 * A zip reader, written by hand.
 *
 * The `.vsix` is written by `scripts/build-vsix.mjs`, and this reader is
 * deliberately NOT the writer's own code: an artefact checked by the code that
 * produced it proves nothing. This one parses the central directory the way
 * any unzip tool does, and verifies every entry's CRC.
 */

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

export const crc32 = (buffer: Buffer): number => {
  let crc = -1;
  for (let index = 0; index < buffer.length; index++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Read every entry of a zip. Throws when the file is not a zip. */
export function readZip(buffer: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0; index--) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error("not a zip: no end of central directory record");
  }

  const total = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buffer.length) {
    throw new Error("not a zip: the central directory is out of range");
  }

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;

  for (let index = 0; index < total; index++) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error("not a zip: a central directory record is missing");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString("utf8");

    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`not a zip: ${name} has no local file header`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    if (crc32(data) !== crc) {
      throw new Error(`not a zip: ${name} does not match its CRC`);
    }
    if (data.length !== uncompressedSize) {
      throw new Error(`not a zip: ${name} has the wrong size`);
    }

    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      data,
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
