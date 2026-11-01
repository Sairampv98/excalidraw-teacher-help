/**
 * The zip of a `.vsix`: the STORE method, no compression.
 *
 * A `.vsix` is a zip, and the writer is a few dozen lines, so the repository
 * needs no packaging dependency.
 *
 * The writer lives here on its own because **two** things need it: the build,
 * which writes the extension's package, and the release, which takes that
 * package apart, scrubs what is in it and writes it again.
 *
 *   writeZip([{ name, data }]) -> Buffer
 *   readZip(Buffer)            -> [{ name, data }]
 */

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

const crc32 = (buffer) => {
  let crc = -1;
  for (let index = 0; index < buffer.length; index++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
};

const dosTimestamp = (date) => {
  const time =
    ((date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1)) &
    0xffff;
  const day =
    (((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate()) &
    0xffff;
  return { time, day };
};

/**
 * Writes a zip of the entries, in the order they are given.
 *
 * @param {{name: string, data: Buffer}[]} entries
 * @returns {Buffer}
 */
export const writeZip = (entries) => {
  const { time, day } = dosTimestamp(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: the name is utf-8
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0014, 4); // made by: MS-DOS, zip 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt16LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/**
 * The entries of a zip, read the way any unzip tool reads one: from the
 * central directory, and each entry's data from its own local header.
 *
 * The reader checks every entry's CRC, so a zip that was written wrongly is
 * refused instead of read wrongly.
 *
 * @param {Buffer} buffer
 * @returns {{name: string, data: Buffer}[]}
 */
export const readZip = (buffer) => {
  let eocd = -1;

  for (let index = buffer.length - 22; index >= 0; index--) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }

  if (eocd === -1) {
    throw new Error("not a zip: there is no end of central directory record");
  }

  const total = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  if (centralOffset + centralSize > buffer.length) {
    throw new Error("not a zip: the central directory is out of range");
  }

  const entries = [];
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

    if (method !== 0) {
      throw new Error(
        `not a zip: ${name} is compressed, and this reader knows only the stored ones`,
      );
    }

    entries.push({ name, data });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
};
