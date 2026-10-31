/**
 * An MP4 file of our own (D-377, D-378): the browser's video encoder gives the
 * H.264 pictures, and this writes them into the container - `ftyp`, then
 * `moov` with the tables, then `mdat` - so the file plays at once from its
 * start. No dependency; the pieces are pure functions over bytes.
 */

const ascii = (name: string) => [...name].map((c) => c.charCodeAt(0));

const be16 = (value: number) => [(value >> 8) & 255, value & 255];
const be32 = (value: number) => [
  (value >>> 24) & 255,
  (value >> 16) & 255,
  (value >> 8) & 255,
  value & 255,
];

const concat = (parts: readonly ArrayLike<number>[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
};

/** a box: its size, its name and its contents */
const box = (name: string, ...contents: ArrayLike<number>[]): Uint8Array => {
  const body = concat(contents);

  return concat([be32(8 + body.length), ascii(name), body]);
};

/** a full box: a box that starts with a version and 24 bits of flags */
const fullBox = (
  name: string,
  version: number,
  flags: number,
  ...contents: ArrayLike<number>[]
): Uint8Array =>
  box(
    name,
    [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255],
    ...contents,
  );

/** the transformation matrix that leaves a picture as it is */
const IDENTITY_MATRIX = [
  ...be32(0x00010000),
  ...be32(0),
  ...be32(0),
  ...be32(0),
  ...be32(0x00010000),
  ...be32(0),
  ...be32(0),
  ...be32(0),
  ...be32(0x40000000),
];

export type Mp4Sample = {
  /** the encoded picture, with each unit led by its length (not by a start code) */
  data: Uint8Array;
  /** how long it is shown, in ticks of the media's timescale */
  duration: number;
  /** whether it can be decoded with no picture before it */
  key: boolean;
};

export type Mp4Options = {
  width: number;
  height: number;
  /** ticks in a second for the pictures' durations */
  timescale: number;
  samples: readonly Mp4Sample[];
  /** the decoder's configuration record, as the encoder wrote it */
  avcC: Uint8Array;
};

/** the file, as bytes */
export const muxMp4 = (options: Mp4Options): Uint8Array => {
  const { width, height, timescale, samples, avcC } = options;

  if (samples.length === 0) {
    throw new Error("a video needs a picture");
  }

  const mediaDuration = samples.reduce(
    (sum, sample) => sum + sample.duration,
    0,
  );
  // the movie counts in thousandths of a second
  const movieTimescale = 1000;
  const movieDuration = Math.round(
    (mediaDuration * movieTimescale) / timescale,
  );

  const ftyp = box(
    "ftyp",
    ascii("isom"),
    be32(0x200),
    ascii("isom"),
    ascii("iso2"),
    ascii("avc1"),
    ascii("mp41"),
  );

  // the runs of equal durations, as the time-to-sample table wants them
  const runs: { count: number; delta: number }[] = [];

  for (const sample of samples) {
    const last = runs[runs.length - 1];

    if (last && last.delta === sample.duration) {
      last.count += 1;
    } else {
      runs.push({ count: 1, delta: sample.duration });
    }
  }

  const keyNumbers = samples
    .map((sample, i) => (sample.key ? i + 1 : 0))
    .filter(Boolean);

  const buildMoov = (dataOffset: number) =>
    box(
      "moov",
      fullBox(
        "mvhd",
        0,
        0,
        be32(0),
        be32(0),
        be32(movieTimescale),
        be32(movieDuration),
        be32(0x00010000),
        be16(0x0100),
        new Array(10).fill(0),
        IDENTITY_MATRIX,
        new Array(24).fill(0),
        be32(2),
      ),
      box(
        "trak",
        fullBox(
          "tkhd",
          0,
          3,
          be32(0),
          be32(0),
          be32(1),
          be32(0),
          be32(movieDuration),
          new Array(8).fill(0),
          be16(0),
          be16(0),
          be16(0),
          be16(0),
          IDENTITY_MATRIX,
          be32(width * 0x10000),
          be32(height * 0x10000),
        ),
        box(
          "mdia",
          fullBox(
            "mdhd",
            0,
            0,
            be32(0),
            be32(0),
            be32(timescale),
            be32(mediaDuration),
            be16(0x55c4),
            be16(0),
          ),
          fullBox("hdlr", 0, 0, be32(0), ascii("vide"), new Array(12).fill(0), [
            ...ascii("VideoHandler"),
            0,
          ]),
          box(
            "minf",
            fullBox("vmhd", 0, 1, be16(0), be16(0), be16(0), be16(0)),
            box("dinf", fullBox("dref", 0, 0, be32(1), fullBox("url ", 0, 1))),
            box(
              "stbl",
              fullBox(
                "stsd",
                0,
                0,
                be32(1),
                box(
                  "avc1",
                  new Array(6).fill(0),
                  be16(1),
                  be16(0),
                  be16(0),
                  new Array(12).fill(0),
                  be16(width),
                  be16(height),
                  be32(0x00480000),
                  be32(0x00480000),
                  be32(0),
                  be16(1),
                  new Array(32).fill(0),
                  be16(0x0018),
                  be16(0xffff),
                  box("avcC", avcC),
                ),
              ),
              fullBox(
                "stts",
                0,
                0,
                be32(runs.length),
                ...runs.map((run) =>
                  concat([be32(run.count), be32(run.delta)]),
                ),
              ),
              ...(keyNumbers.length === samples.length
                ? []
                : [
                    fullBox(
                      "stss",
                      0,
                      0,
                      be32(keyNumbers.length),
                      ...keyNumbers.map((n) => be32(n)),
                    ),
                  ]),
              // every picture is in one chunk
              fullBox(
                "stsc",
                0,
                0,
                be32(1),
                be32(1),
                be32(samples.length),
                be32(1),
              ),
              fullBox(
                "stsz",
                0,
                0,
                be32(0),
                be32(samples.length),
                ...samples.map((sample) => be32(sample.data.length)),
              ),
              fullBox("stco", 0, 0, be32(1), be32(dataOffset)),
            ),
          ),
        ),
      ),
    );

  // the tables hold where the pictures are, and the pictures follow the tables
  const moovSize = buildMoov(0).length;
  const dataOffset = ftyp.length + moovSize + 8;
  const moov = buildMoov(dataOffset);
  const mdat = box("mdat", ...samples.map((sample) => sample.data));

  return concat([ftyp, moov, mdat]);
};

/* ----------------------------------------------------------- the codec string */

/**
 * The H.264 profile and level a picture size and rate need, as the codec string
 * the video encoder takes (D-378). The level limits how many macroblocks a
 * picture and a second may hold.
 */
export const avcCodecFor = (
  width: number,
  height: number,
  fps: number,
): string => {
  const frameMacroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const perSecond = frameMacroblocks * fps;

  // level, its limit on a picture, its limit on a second (H.264 table A-1)
  const levels: [number, number, number][] = [
    [0x1e, 1620, 40500],
    [0x1f, 3600, 108000],
    [0x28, 8192, 245760],
    [0x2a, 8704, 522240],
    [0x32, 22080, 589824],
    [0x33, 36864, 983040],
    [0x34, 36864, 2073600],
  ];

  const level =
    levels.find(
      ([, frame, rate]) => frameMacroblocks <= frame && perSecond <= rate,
    ) ?? levels[levels.length - 1];

  // the High profile (0x64) with no constraints, at that level
  return `avc1.6400${level[0].toString(16).padStart(2, "0").toUpperCase()}`;
};
