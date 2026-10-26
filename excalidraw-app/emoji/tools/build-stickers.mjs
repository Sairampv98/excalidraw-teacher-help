/**
 * Builds the bundled emoji and GIF stickers (D-157).
 *
 *   node excalidraw-app/emoji/tools/build-stickers.mjs
 *
 * Everything here is original artwork, drawn from a handful of geometric
 * primitives in a 100 x 100 box. One drawing gives two files: a static SVG (the
 * emoji) and, with an animation attached, an animated GIF. Nothing is
 * downloaded and nothing is a dependency - the GIF encoder is in this file, and
 * it decodes its own output as a check before anything is written.
 *
 * It writes:
 *   excalidraw-app/emoji/assets/<id>.svg | <id>.gif
 *   excalidraw-app/emoji/catalog.ts       (the one catalog, D-158)
 *   docs/STICKERS.md                      (the provenance, D-157)
 *
 * The output is deterministic: running it twice changes nothing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_EMOJI = path.resolve(HERE, "..");
const ASSETS = path.join(APP_EMOJI, "assets");
const DOCS = path.resolve(APP_EMOJI, "..", "..", "docs");

const DRAWN_ON = "2026-10-27";
const GIF_SIZE = 200;
const SVG_SIZE = 256;

/* ------------------------------------------------------------------ palette */

/** index 0 is reserved for "transparent" in every GIF */
const PALETTE = {
  yellow: "#FFCB3D",
  yellowDark: "#E0A21B",
  orange: "#FF8A1F",
  red: "#E8363D",
  redDark: "#B3202A",
  white: "#FFFFFF",
  black: "#1A1A1A",
  gray: "#8A8F98",
  grayLight: "#D5D9DE",
  grayDark: "#5C626B",
  blue: "#3B8CF0",
  blueLight: "#9ACFFF",
  green: "#2FB563",
  greenDark: "#1F8A48",
  pink: "#FF7AA8",
  pinkDark: "#E0517F",
  purple: "#8B5CF6",
  brown: "#8A5A2B",
  brownLight: "#C98F55",
  gold: "#FFD84D",
  goldDark: "#E0A800",
  teal: "#19B8B8",
};
const COLOR_NAMES = Object.keys(PALETTE);
const colorIndex = (name) => {
  const i = COLOR_NAMES.indexOf(name);
  if (i < 0) {
    throw new Error(`unknown colour ${name}`);
  }
  return i + 1; // 0 is transparent
};

/* --------------------------------------------------------------- primitives */

const C = (cx, cy, r, f, o = {}) => ({ k: "c", cx, cy, r, f, ...o });
const E = (cx, cy, rx, ry, f, o = {}) => ({ k: "e", cx, cy, rx, ry, f, ...o });
const R = (x, y, w, h, f, rad = 0, o = {}) => ({
  k: "r",
  x,
  y,
  w,
  h,
  rad,
  f,
  ...o,
});
const P = (pts, f, o = {}) => ({ k: "p", pts, f, ...o });
const L = (pts, f, w = 4, o = {}) => ({ k: "l", pts, f, w, ...o });

const rad = (deg) => (deg * Math.PI) / 180;

/** points along an arc, in degrees, y pointing down (so 90 is the bottom) */
const arc = (cx, cy, r, a0, a1, n = 16, ry = r) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = rad(a0 + ((a1 - a0) * i) / n);
    return [cx + r * Math.cos(a), cy + ry * Math.sin(a)];
  });

const heartPts = (cx, cy, s) =>
  Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    return [cx + x * s, cy - y * s];
  });

const starPts = (cx, cy, R1, R2, n = 5, rot = -90) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = rad(rot + (i * 180) / n);
    const r = i % 2 === 0 ? R1 : R2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

const sparkle = (cx, cy, r, f, o = {}) =>
  P(
    [
      [cx, cy - r],
      [cx + r * 0.24, cy - r * 0.24],
      [cx + r, cy],
      [cx + r * 0.24, cy + r * 0.24],
      [cx, cy + r],
      [cx - r * 0.24, cy + r * 0.24],
      [cx - r, cy],
      [cx - r * 0.24, cy - r * 0.24],
    ],
    f,
    o,
  );

const scalePts = (pts, s, cx, cy, dy = 0) =>
  pts.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s + dy]);

/** the round yellow face every face emoji starts from */
const face = (base = "yellow", rim = "yellowDark") => [
  C(50, 50, 44, rim),
  C(50, 50, 40, base),
];
const eyes = (y = 42, r = 5, dx = 15) => [
  C(50 - dx, y, r, "black"),
  C(50 + dx, y, r, "black"),
];
const smile = (w = 5) => L(arc(50, 52, 22, 25, 155), "black", w);
const happyEye = (cx, cy) => L(arc(cx, cy + 4, 9, 200, 340, 10), "black", 4.5);

/* ------------------------------------------------------------------ drawings */

const FLAME = [
  [50, 4],
  [62, 24],
  [78, 44],
  [84, 64],
  [74, 86],
  [50, 96],
  [26, 86],
  [16, 64],
  [24, 44],
  [38, 28],
];

const DRAW = {
  skull: () => [
    C(50, 44, 37, "grayLight"),
    R(30, 62, 40, 28, "grayLight", 9),
    C(50, 44, 33, "white"),
    R(33, 62, 34, 25, "white", 8),
    E(37, 46, 9, 11, "black"),
    E(63, 46, 9, 11, "black"),
    P(
      [
        [50, 56],
        [44, 68],
        [56, 68],
      ],
      "black",
    ),
    L(
      [
        [40, 76],
        [40, 86],
      ],
      "gray",
      3,
    ),
    L(
      [
        [50, 76],
        [50, 86],
      ],
      "gray",
      3,
    ),
    L(
      [
        [60, 76],
        [60, 86],
      ],
      "gray",
      3,
    ),
  ],
  sob: () => [
    ...face(),
    R(26, 52, 8, 34, "blueLight", 4, { part: "tear" }),
    R(66, 52, 8, 34, "blueLight", 4, { part: "tear" }),
    L(
      [
        [24, 33],
        [38, 42],
        [24, 51],
      ],
      "black",
      5,
    ),
    L(
      [
        [76, 33],
        [62, 42],
        [76, 51],
      ],
      "black",
      5,
    ),
    E(50, 70, 14, 12, "black"),
    E(50, 76, 8, 5, "red"),
  ],
  joy: () => [
    ...face(),
    E(16, 52, 6, 9, "blueLight", { part: "tear" }),
    E(84, 52, 6, 9, "blueLight", { part: "tear" }),
    L(
      [
        [24, 34],
        [38, 42],
        [24, 50],
      ],
      "black",
      5,
    ),
    L(
      [
        [76, 34],
        [62, 42],
        [76, 50],
      ],
      "black",
      5,
    ),
    P([[26, 58], ...arc(50, 58, 24, 0, 180, 14, 28), [74, 58]], "black"),
    E(50, 77, 11, 6, "red"),
  ],
  fire: () => [
    P(FLAME, "red", { part: "outer" }),
    P(scalePts(FLAME, 0.74, 50, 90), "orange", { part: "mid" }),
    P(scalePts(FLAME, 0.42, 50, 92), "gold", { part: "inner" }),
  ],
  hundred: () => [
    L(
      [
        [18, 38],
        [27, 29],
        [27, 71],
      ],
      "red",
      8,
    ),
    L(arc(50, 50, 11, 0, 360, 24, 21), "red", 8),
    L(arc(77, 50, 11, 0, 360, 24, 21), "red", 8),
    L(
      [
        [16, 84],
        [84, 84],
      ],
      "red",
      5,
    ),
    L(
      [
        [24, 93],
        [76, 93],
      ],
      "red",
      5,
    ),
  ],
  sparkles: () => [
    sparkle(40, 58, 34, "gold", { part: "a" }),
    sparkle(76, 24, 18, "yellow", { part: "b" }),
    sparkle(80, 76, 14, "gold", { part: "c" }),
  ],
  eyes: () => [
    E(33, 50, 21, 28, "gray"),
    E(67, 50, 21, 28, "gray"),
    E(33, 50, 18, 25, "white"),
    E(67, 50, 18, 25, "white"),
    C(38, 56, 8, "black", { part: "pupil" }),
    C(72, 56, 8, "black", { part: "pupil" }),
  ],
  heart: () => [
    P(heartPts(50, 50, 2.55), "redDark"),
    P(heartPts(50, 48, 2.3), "red"),
  ],
  brokenheart: () => [
    P(heartPts(50, 50, 2.55), "redDark"),
    P(heartPts(50, 48, 2.3), "red"),
    L(
      [
        [54, 14],
        [44, 34],
        [58, 48],
        [44, 64],
        [54, 88],
      ],
      "white",
      5,
    ),
  ],
  pleading: () => [
    ...face(),
    L(
      [
        [22, 28],
        [38, 24],
      ],
      "yellowDark",
      3.5,
    ),
    L(
      [
        [78, 28],
        [62, 24],
      ],
      "yellowDark",
      3.5,
    ),
    C(35, 46, 11, "black"),
    C(65, 46, 11, "black"),
    C(31, 41, 4.5, "white"),
    C(61, 41, 4.5, "white"),
    C(38, 52, 2.2, "white"),
    C(68, 52, 2.2, "white"),
    L(arc(50, 78, 9, 200, 340, 8), "black", 4),
  ],
  moai: () => [
    P(
      [
        [28, 8],
        [72, 8],
        [80, 20],
        [76, 58],
        [70, 94],
        [32, 94],
        [26, 58],
        [20, 20],
      ],
      "gray",
    ),
    P(
      [
        [28, 8],
        [38, 8],
        [36, 94],
        [32, 94],
        [26, 58],
        [20, 20],
      ],
      "grayLight",
    ),
    R(28, 34, 46, 8, "grayDark", 3),
    E(41, 50, 6, 4, "black"),
    E(63, 50, 6, 4, "black"),
    P(
      [
        [52, 44],
        [43, 68],
        [60, 68],
      ],
      "grayDark",
    ),
    R(38, 78, 28, 6, "grayDark", 2),
  ],
  cool: () => [
    ...face(),
    R(14, 32, 33, 22, "black", 9),
    R(53, 32, 33, 22, "black", 9),
    R(44, 36, 12, 6, "black"),
    L(
      [
        [21, 39],
        [31, 39],
      ],
      "gray",
      3,
    ),
    L(
      [
        [60, 39],
        [70, 39],
      ],
      "gray",
      3,
    ),
    smile(),
  ],
  clown: () => [
    C(14, 42, 13, "red"),
    C(86, 42, 13, "red"),
    C(50, 52, 40, "grayLight"),
    C(50, 52, 37, "white"),
    C(35, 42, 6, "black"),
    C(65, 42, 6, "black"),
    L(
      [
        [26, 30],
        [40, 28],
      ],
      "blue",
      4,
    ),
    L(
      [
        [74, 30],
        [60, 28],
      ],
      "blue",
      4,
    ),
    C(50, 56, 10, "red"),
    L(arc(50, 64, 24, 35, 145), "red", 5),
  ],
  thumbsup: () => [
    R(10, 44, 20, 46, "blue", 4),
    R(34, 42, 52, 46, "yellow", 14),
    R(42, 12, 18, 40, "yellow", 9),
    L(
      [
        [52, 58],
        [82, 58],
      ],
      "yellowDark",
      3,
    ),
    L(
      [
        [52, 68],
        [82, 68],
      ],
      "yellowDark",
      3,
    ),
    L(
      [
        [52, 78],
        [80, 78],
      ],
      "yellowDark",
      3,
    ),
  ],
  rocket: () => [
    P(
      [
        [38, 52],
        [20, 76],
        [38, 70],
      ],
      "red",
    ),
    P(
      [
        [62, 52],
        [80, 76],
        [62, 70],
      ],
      "red",
    ),
    P(
      [
        [50, 1],
        [67, 23],
        [69, 69],
        [31, 69],
        [33, 23],
      ],
      "grayLight",
    ),
    P(
      [
        [50, 4],
        [64, 24],
        [66, 66],
        [34, 66],
        [36, 24],
      ],
      "white",
    ),
    P(
      [
        [50, 4],
        [64, 24],
        [36, 24],
      ],
      "red",
    ),
    C(50, 42, 8, "blue"),
    P(
      [
        [40, 68],
        [50, 96],
        [60, 68],
      ],
      "orange",
      { part: "flame" },
    ),
    P(
      [
        [45, 68],
        [50, 86],
        [55, 68],
      ],
      "gold",
      { part: "flame" },
    ),
  ],
  popper: () => [
    P(
      [
        [10, 92],
        [24, 44],
        [58, 78],
      ],
      "gold",
    ),
    L(
      [
        [17, 70],
        [36, 80],
      ],
      "orange",
      4,
    ),
    L(
      [
        [21, 56],
        [46, 70],
      ],
      "orange",
      4,
    ),
    C(60, 30, 4, "red", { part: "c1" }),
    R(76, 26, 8, 8, "blue", 2, { part: "c2" }),
    C(74, 52, 4, "green", { part: "c3" }),
    R(46, 14, 8, 8, "pink", 2, { part: "c1" }),
    C(88, 40, 3.5, "purple", { part: "c2" }),
    R(84, 60, 7, 7, "red", 2, { part: "c3" }),
    L(
      [
        [38, 42],
        [48, 30],
      ],
      "teal",
      3.5,
      { part: "c2" },
    ),
  ],
  check: () => [
    C(50, 50, 44, "greenDark"),
    C(50, 50, 40, "green"),
    L(
      [
        [28, 52],
        [44, 68],
        [74, 34],
      ],
      "white",
      10,
    ),
  ],
  cross: () => [
    C(50, 50, 44, "redDark"),
    C(50, 50, 40, "red"),
    L(
      [
        [33, 33],
        [67, 67],
      ],
      "white",
      10,
    ),
    L(
      [
        [67, 33],
        [33, 67],
      ],
      "white",
      10,
    ),
  ],
  star: () => [
    P(starPts(50, 54, 46, 20), "goldDark"),
    P(starPts(50, 54, 40, 17), "gold"),
  ],
  bulb: () => [
    L(
      [
        [50, 2],
        [50, 10],
      ],
      "gold",
      4,
      { part: "rays" },
    ),
    L(
      [
        [12, 18],
        [20, 26],
      ],
      "gold",
      4,
      { part: "rays" },
    ),
    L(
      [
        [88, 18],
        [80, 26],
      ],
      "gold",
      4,
      { part: "rays" },
    ),
    L(
      [
        [4, 46],
        [12, 46],
      ],
      "gold",
      4,
      { part: "rays" },
    ),
    L(
      [
        [96, 46],
        [88, 46],
      ],
      "gold",
      4,
      { part: "rays" },
    ),
    C(50, 42, 28, "gold"),
    P(
      [
        [32, 56],
        [68, 56],
        [60, 74],
        [40, 74],
      ],
      "gold",
    ),
    R(38, 74, 24, 8, "grayLight", 3),
    R(41, 84, 18, 8, "gray", 3),
    L(
      [
        [40, 38],
        [46, 54],
        [50, 40],
        [54, 54],
        [60, 38],
      ],
      "goldDark",
      3,
    ),
  ],
  brain: () => [
    C(36, 40, 22, "pink"),
    C(64, 40, 22, "pink"),
    C(50, 62, 24, "pink"),
    L(arc(36, 42, 10, 150, 330, 8), "pinkDark", 3),
    L(arc(64, 42, 10, 210, 30, 8), "pinkDark", 3),
    L(
      [
        [50, 24],
        [48, 44],
        [52, 58],
        [50, 82],
      ],
      "pinkDark",
      3,
    ),
  ],
  bolt: () => [
    P(
      [
        [58, 4],
        [20, 56],
        [44, 56],
        [34, 96],
        [80, 38],
        [54, 38],
      ],
      "gold",
    ),
  ],
  sun: () => [
    ...Array.from({ length: 8 }, (_, i) => {
      const a = rad(i * 45);
      return L(
        [
          [50 + 34 * Math.cos(a), 50 + 34 * Math.sin(a)],
          [50 + 46 * Math.cos(a), 50 + 46 * Math.sin(a)],
        ],
        "orange",
        6,
        { part: "rays" },
      );
    }),
    C(50, 50, 26, "goldDark"),
    C(50, 50, 23, "gold"),
  ],
  trophy: () => [
    L(arc(24, 34, 12, 90, 270, 8), "goldDark", 5),
    L(arc(76, 34, 12, 270, 450, 8), "goldDark", 5),
    P(
      [
        [26, 10],
        [74, 10],
        [70, 46],
        [58, 62],
        [42, 62],
        [30, 46],
      ],
      "gold",
    ),
    R(45, 62, 10, 16, "goldDark", 2),
    R(30, 78, 40, 12, "goldDark", 4),
    P(starPts(50, 34, 10, 4), "white"),
  ],
  gem: () => [
    P(
      [
        [26, 14],
        [74, 14],
        [94, 38],
        [50, 92],
        [6, 38],
      ],
      "blue",
    ),
    P(
      [
        [26, 14],
        [74, 14],
        [62, 38],
        [38, 38],
      ],
      "blueLight",
    ),
    P(
      [
        [6, 38],
        [38, 38],
        [50, 92],
      ],
      "teal",
    ),
    P(
      [
        [94, 38],
        [62, 38],
        [50, 92],
      ],
      "purple",
    ),
  ],
  crown: () => [
    P(
      [
        [10, 78],
        [6, 26],
        [30, 50],
        [50, 18],
        [70, 50],
        [94, 26],
        [90, 78],
      ],
      "gold",
    ),
    R(10, 72, 80, 14, "goldDark", 4),
    C(6, 24, 6, "red"),
    C(50, 14, 6, "red"),
    C(94, 24, 6, "red"),
    C(50, 58, 6, "blue"),
  ],
  pizza: () => [
    P(
      [
        [50, 94],
        [6, 22],
        [94, 22],
      ],
      "gold",
    ),
    L(
      [
        [6, 20],
        [94, 20],
      ],
      "brownLight",
      12,
    ),
    C(36, 38, 7, "red"),
    C(62, 40, 7, "red"),
    C(50, 62, 7, "red"),
    C(46, 40, 2.5, "greenDark"),
    C(54, 76, 2.5, "greenDark"),
  ],
  coffee: () => [
    L(arc(74, 56, 14, -90, 90, 10), "blue", 7),
    R(16, 36, 60, 52, "blue", 10),
    R(16, 36, 60, 12, "brown", 5),
    L(
      [
        [32, 28],
        [28, 18],
        [34, 8],
      ],
      "gray",
      4,
      { part: "steam" },
    ),
    L(
      [
        [50, 28],
        [46, 18],
        [52, 8],
      ],
      "gray",
      4,
      { part: "steam" },
    ),
  ],
  cat: () => [
    P(
      [
        [14, 40],
        [14, 6],
        [44, 24],
      ],
      "orange",
    ),
    P(
      [
        [86, 40],
        [86, 6],
        [56, 24],
      ],
      "orange",
    ),
    C(50, 56, 38, "orange"),
    C(36, 50, 5, "black"),
    C(64, 50, 5, "black"),
    P(
      [
        [44, 62],
        [56, 62],
        [50, 69],
      ],
      "pinkDark",
    ),
    L(
      [
        [50, 69],
        [42, 78],
      ],
      "black",
      2.5,
    ),
    L(
      [
        [50, 69],
        [58, 78],
      ],
      "black",
      2.5,
    ),
    L(
      [
        [4, 62],
        [26, 66],
      ],
      "white",
      2.5,
    ),
    L(
      [
        [96, 62],
        [74, 66],
      ],
      "white",
      2.5,
    ),
  ],
  angry: () => [
    C(50, 50, 44, "redDark"),
    C(50, 50, 40, "red"),
    L(
      [
        [22, 28],
        [42, 40],
      ],
      "black",
      5,
    ),
    L(
      [
        [78, 28],
        [58, 40],
      ],
      "black",
      5,
    ),
    ...eyes(48, 5),
    L(arc(50, 80, 16, 200, 340, 10), "black", 5),
  ],
  scream: () => [
    ...face(),
    C(35, 40, 11, "white"),
    C(65, 40, 11, "white"),
    C(35, 42, 5, "black"),
    C(65, 42, 5, "black"),
    L(
      [
        [22, 22],
        [36, 18],
      ],
      "yellowDark",
      3.5,
    ),
    L(
      [
        [78, 22],
        [64, 18],
      ],
      "yellowDark",
      3.5,
    ),
    E(50, 74, 12, 15, "black"),
  ],
  nerd: () => [
    ...face(),
    C(34, 42, 5, "black"),
    C(66, 42, 5, "black"),
    L(arc(34, 42, 13, 0, 360, 20), "black", 4),
    L(arc(66, 42, 13, 0, 360, 20), "black", 4),
    L(
      [
        [47, 42],
        [53, 42],
      ],
      "black",
      4,
    ),
    L(arc(50, 58, 20, 25, 155), "black", 4.5),
    R(42, 70, 7, 8, "white", 1),
    R(51, 70, 7, 8, "white", 1),
  ],
  wink: () => [
    ...face(),
    C(33, 42, 5.5, "black"),
    L(
      [
        [56, 44],
        [74, 38],
      ],
      "black",
      5,
    ),
    L(arc(50, 54, 22, 25, 155), "black", 5),
    E(50, 79, 9, 6, "pink"),
  ],
  hearteyes: () => [
    ...face(),
    P(heartPts(33, 42, 0.95), "red"),
    P(heartPts(67, 42, 0.95), "red"),
    L(arc(50, 54, 22, 25, 155), "black", 5),
  ],
  partying: () => [
    ...face(),
    P(
      [
        [12, 38],
        [28, 2],
        [50, 24],
      ],
      "blue",
    ),
    C(28, 4, 4, "red"),
    L(
      [
        [18, 28],
        [34, 24],
      ],
      "gold",
      3,
    ),
    happyEye(34, 46),
    happyEye(66, 46),
    L(arc(50, 58, 18, 25, 155), "black", 5),
    C(78, 20, 3, "pink"),
    R(86, 40, 6, 6, "green", 1),
    C(14, 60, 3, "purple"),
  ],
  sleepy: () => [
    ...face(),
    L(
      [
        [24, 44],
        [42, 44],
      ],
      "black",
      5,
    ),
    L(
      [
        [58, 44],
        [76, 44],
      ],
      "black",
      5,
    ),
    E(50, 70, 8, 6, "black"),
    L(
      [
        [70, 18],
        [82, 18],
        [70, 30],
        [82, 30],
      ],
      "blue",
      4,
      { part: "zzz" },
    ),
  ],
  smirk: () => [
    ...face(),
    ...eyes(44, 5),
    L(
      [
        [22, 30],
        [42, 34],
      ],
      "yellowDark",
      3.5,
    ),
    L(
      [
        [34, 70],
        [58, 68],
        [72, 58],
      ],
      "black",
      5,
    ),
  ],
  bruh: () => [
    ...face(),
    L(
      [
        [24, 42],
        [42, 42],
      ],
      "black",
      5,
    ),
    L(
      [
        [58, 42],
        [76, 42],
      ],
      "black",
      5,
    ),
    L(
      [
        [34, 70],
        [66, 70],
      ],
      "black",
      5,
    ),
  ],
  thinking: () => [
    C(86, 14, 4, "grayDark"),
    C(78, 26, 6, "grayDark"),
    ...face(),
    ...eyes(46, 5),
    L(
      [
        [22, 30],
        [40, 34],
      ],
      "yellowDark",
      3.5,
    ),
    L(
      [
        [60, 32],
        [78, 28],
      ],
      "yellowDark",
      3.5,
    ),
    L(
      [
        [38, 72],
        [64, 70],
      ],
      "black",
      5,
    ),
  ],
  ghost: () => [
    C(50, 40, 35, "grayLight"),
    R(15, 40, 70, 49, "grayLight", 0),
    C(26, 87, 11, "grayLight"),
    C(50, 89, 11, "grayLight"),
    C(74, 87, 11, "grayLight"),
    C(50, 40, 32, "white"),
    R(18, 40, 64, 46, "white", 0),
    C(26, 86, 8, "white"),
    C(50, 88, 8, "white"),
    C(74, 86, 8, "white"),
    E(38, 40, 5, 8, "black"),
    E(62, 40, 5, 8, "black"),
    E(50, 58, 6, 8, "black"),
  ],
  alien: () => [
    E(50, 50, 38, 44, "green"),
    E(34, 46, 11, 7, "black"),
    E(66, 46, 11, 7, "black"),
    L(
      [
        [40, 74],
        [60, 74],
      ],
      "greenDark",
      4,
    ),
  ],
  rainbow: () => [
    L(arc(50, 84, 40, 180, 360, 20), "red", 9),
    L(arc(50, 84, 31, 180, 360, 20), "gold", 9),
    L(arc(50, 84, 22, 180, 360, 20), "green", 9),
    L(arc(50, 84, 13, 180, 360, 20), "blue", 9),
  ],
  balloon: () => [
    E(50, 38, 28, 34, "redDark"),
    E(50, 36, 26, 32, "red"),
    P(
      [
        [46, 72],
        [54, 72],
        [50, 78],
      ],
      "redDark",
    ),
    L(
      [
        [50, 78],
        [44, 90],
        [54, 96],
      ],
      "gray",
      2.5,
      { part: "string" },
    ),
    E(40, 24, 6, 9, "pink"),
  ],
  gift: () => [
    R(12, 40, 76, 52, "red", 4),
    R(8, 30, 84, 16, "redDark", 4),
    R(44, 30, 12, 62, "gold"),
    C(40, 22, 11, "gold", { part: "bow" }),
    C(60, 22, 11, "gold", { part: "bow" }),
    C(50, 26, 5, "goldDark"),
  ],
  flower: () => [
    ...Array.from({ length: 5 }, (_, i) => {
      const a = rad(-90 + i * 72);
      return C(50 + 24 * Math.cos(a), 50 + 24 * Math.sin(a), 17, "pink");
    }),
    C(50, 50, 14, "gold"),
  ],
  bomb: () => [
    C(46, 58, 34, "black"),
    C(36, 46, 8, "grayDark"),
    R(58, 22, 10, 12, "gray", 2),
    L(
      [
        [66, 22],
        [74, 10],
        [84, 12],
      ],
      "brown",
      3,
    ),
    P(starPts(86, 12, 10, 4, 6), "gold", { part: "spark" }),
  ],
  pumpkin: () => [
    E(50, 58, 42, 34, "orange"),
    E(30, 58, 20, 32, "orange"),
    E(70, 58, 20, 32, "orange"),
    R(46, 14, 8, 14, "greenDark", 3),
    P(
      [
        [28, 48],
        [42, 48],
        [35, 36],
      ],
      "black",
    ),
    P(
      [
        [58, 48],
        [72, 48],
        [65, 36],
      ],
      "black",
    ),
    P(
      [
        [28, 68],
        [40, 74],
        [50, 68],
        [60, 74],
        [72, 68],
        [66, 82],
        [50, 78],
        [34, 82],
      ],
      "black",
    ),
  ],
};

/* ---------------------------------------------------------------- the catalog
 * Order here IS the popularity order (D-158): what people reach for most comes
 * first. `tags` are the words a person would type.
 */

const EMOJI = [
  ["skull", "Skull", "dead dying lol bruh funny im dead"],
  ["sob", "Loudly crying", "crying cry sad tears sobbing"],
  ["joy", "Tears of joy", "laugh lol lmao funny haha"],
  ["fire", "Fire", "lit hot flame hype"],
  ["hundred", "One hundred", "100 perfect facts keep it real"],
  ["sparkles", "Sparkles", "shine magic glitter new slay"],
  ["eyes", "Eyes", "look watching see tea sus"],
  ["heart", "Heart", "love like red"],
  ["pleading", "Pleading face", "please puppy eyes begging sad cute"],
  ["moai", "Moai", "stone face statue vibes chad"],
  ["cool", "Sunglasses", "cool sunglasses chill smooth"],
  ["clown", "Clown", "joke fool clown silly"],
  ["thumbsup", "Thumbs up", "yes ok good like approve"],
  ["rocket", "Rocket", "launch fast space go startup"],
  ["popper", "Party popper", "party celebrate congrats tada"],
  ["check", "Check mark", "yes done correct right tick"],
  ["cross", "Cross mark", "no wrong incorrect cancel"],
  ["star", "Star", "favourite favorite rating best"],
  ["bulb", "Light bulb", "idea think bright tip"],
  ["brain", "Brain", "smart think mind big brain"],
  ["bolt", "Lightning", "fast power energy zap electric"],
  ["hearteyes", "Heart eyes", "love adore crush wow"],
  ["partying", "Partying face", "party birthday celebrate"],
  ["wink", "Wink", "joke flirt hint playful"],
  ["nerd", "Nerd", "smart study geek glasses actually"],
  ["smirk", "Smirk", "sly smug cheeky"],
  ["bruh", "Unamused", "bruh meh flat deadpan really"],
  ["thinking", "Thinking", "hmm think wonder question"],
  ["angry", "Angry", "mad rage upset"],
  ["scream", "Screaming", "scared shock omg afraid"],
  ["sleepy", "Sleepy", "tired sleep zzz boring"],
  ["trophy", "Trophy", "win winner champion first prize"],
  ["crown", "Crown", "king queen royal best slay"],
  ["gem", "Gem", "diamond rare value precious"],
  ["sun", "Sun", "sunny day bright warm"],
  ["rainbow", "Rainbow", "colours colors pride happy"],
  ["balloon", "Balloon", "party birthday celebrate"],
  ["gift", "Gift", "present birthday surprise reward"],
  ["flower", "Flower", "blossom nice spring"],
  ["cat", "Cat", "kitty pet meow"],
  ["ghost", "Ghost", "boo spooky halloween"],
  ["alien", "Alien", "ufo space weird"],
  ["pizza", "Pizza", "food snack lunch"],
  ["coffee", "Coffee", "tea break morning drink"],
  ["brokenheart", "Broken heart", "sad heartbreak breakup"],
  ["bomb", "Bomb", "boom explode"],
  ["pumpkin", "Pumpkin", "halloween spooky"],
];

const tick = (n, t, k = 1) => Math.sin(t * Math.PI * 2 * k + n);
const pulse = (t) => 1 + 0.12 * Math.sin(t * Math.PI * 2);
const bounce = (t, h = 10) => ({
  dy: -Math.abs(Math.sin(t * Math.PI * 2)) * h,
});

/** the GIFs: id, the drawing it animates, label, tags, and the motion */
const GIFS = [
  [
    "skull-shake",
    "skull",
    "Dead (shaking)",
    "dead lol dying bruh funny im dead",
    { whole: (t) => ({ dx: tick(0, t, 3) * 5, rot: tick(0, t, 3) * 4 }) },
  ],
  [
    "sob-tears",
    "sob",
    "Crying tears",
    "crying sad tears sobbing cry",
    {
      whole: (t) => ({ dy: tick(0, t, 2) * 1.5 }),
      parts: {
        tear: (t) => ({ dy: (t % 1) * 6, s: 1 + tick(0, t, 2) * 0.05 }),
      },
    },
  ],
  [
    "joy-bounce",
    "joy",
    "Laughing",
    "laugh lol lmao funny haha",
    { whole: (t) => ({ ...bounce(t, 8), rot: tick(0, t, 2) * 6 }) },
  ],
  [
    "fire-flicker",
    "fire",
    "Fire flicker",
    "lit hot flame hype",
    {
      parts: {
        outer: (t) => ({ s: 1 + tick(0, t, 2) * 0.06, dy: 0, oy: 96 }),
        mid: (t) => ({ s: 1 + tick(1, t, 3) * 0.08, oy: 96 }),
        inner: (t) => ({ s: 1 + tick(2, t, 4) * 0.1, oy: 96 }),
      },
    },
  ],
  [
    "hundred-pulse",
    "hundred",
    "100 pulse",
    "100 perfect facts",
    { whole: (t) => ({ s: pulse(t) }) },
  ],
  [
    "sparkles-twinkle",
    "sparkles",
    "Twinkle",
    "shine magic glitter slay",
    {
      parts: {
        a: (t) => ({
          s: 0.75 + 0.25 * Math.abs(tick(0, t, 1)),
          rot: t * 90,
          ox: 40,
          oy: 58,
        }),
        b: (t) => ({
          s: 0.6 + 0.4 * Math.abs(tick(1.5, t, 1)),
          rot: -t * 90,
          ox: 76,
          oy: 24,
        }),
        c: (t) => ({
          s: 0.6 + 0.4 * Math.abs(tick(3, t, 1)),
          rot: t * 90,
          ox: 80,
          oy: 76,
        }),
      },
    },
  ],
  [
    "eyes-look",
    "eyes",
    "Looking around",
    "look watching see tea sus",
    {
      parts: {
        pupil: (t) => ({ dx: tick(0, t, 1) * 9, dy: tick(1, t, 2) * 3 }),
      },
    },
  ],
  [
    "heart-beat",
    "heart",
    "Heartbeat",
    "love like red",
    {
      whole: (t) => ({
        s:
          1 +
          0.14 * Math.max(0, Math.sin(t * Math.PI * 4)) * (t < 0.5 ? 1 : 0.7),
      }),
    },
  ],
  [
    "clown-wobble",
    "clown",
    "Clown wobble",
    "joke fool clown silly",
    { whole: (t) => ({ rot: tick(0, t, 1) * 12, oy: 90 }) },
  ],
  [
    "popper-burst",
    "popper",
    "Party popper",
    "party celebrate congrats tada",
    {
      parts: {
        c1: (t) => ({
          dx: (t % 1) * -6,
          dy: -(t % 1) * 14,
          s: 1 - 0.5 * t,
          rot: t * 360,
          ox: 55,
          oy: 25,
        }),
        c2: (t) => ({
          dx: (t % 1) * 10,
          dy: -(t % 1) * 10,
          s: 1 - 0.5 * t,
          rot: t * 300,
          ox: 80,
          oy: 40,
        }),
        c3: (t) => ({
          dx: (t % 1) * 8,
          dy: (t % 1) * 8,
          s: 1 - 0.5 * t,
          rot: t * 240,
          ox: 78,
          oy: 56,
        }),
      },
    },
  ],
  [
    "rocket-launch",
    "rocket",
    "Rocket launch",
    "launch fast space go startup",
    {
      whole: (t) => ({ dx: tick(0, t, 6) * 1.2, dy: tick(1, t, 4) * 2 }),
      parts: {
        flame: (t) => ({
          s: 0.8 + 0.4 * Math.abs(tick(0, t, 3)),
          ox: 50,
          oy: 68,
        }),
      },
    },
  ],
  [
    "check-pop",
    "check",
    "Check pop",
    "yes done correct right tick",
    {
      whole: (t) => ({
        s:
          t < 0.35
            ? 0.5 + (t / 0.35) * 0.65
            : 1.15 - Math.min(0.15, (t - 0.35) * 0.4),
      }),
    },
  ],
  [
    "star-spin",
    "star",
    "Star spin",
    "favourite rating best",
    { whole: (t) => ({ rot: t * 360, ox: 50, oy: 54 }) },
  ],
  [
    "bulb-flash",
    "bulb",
    "Idea flash",
    "idea think bright tip",
    {
      parts: {
        rays: (t) => ({ s: Math.sin(t * Math.PI * 2) > -0.2 ? 1 : 0.001 }),
      },
    },
  ],
  [
    "thumbs-bounce",
    "thumbsup",
    "Thumbs up bounce",
    "yes ok good like approve",
    { whole: (t) => ({ ...bounce(t, 9), rot: tick(0, t, 1) * 4 }) },
  ],
  [
    "ghost-float",
    "ghost",
    "Ghost float",
    "boo spooky halloween",
    { whole: (t) => ({ dy: tick(0, t, 1) * 6, dx: tick(1, t, 1) * 3 }) },
  ],
  [
    "cool-nod",
    "cool",
    "Cool nod",
    "cool sunglasses chill smooth",
    {
      whole: (t) => ({
        dy: Math.max(0, tick(0, t, 2)) * 5,
        rot: tick(0, t, 1) * 5,
      }),
    },
  ],
  [
    "bomb-spark",
    "bomb",
    "Bomb fuse",
    "boom explode",
    {
      parts: {
        spark: (t) => ({
          s: 0.6 + 0.6 * Math.abs(tick(0, t, 3)),
          rot: t * 180,
          ox: 86,
          oy: 12,
        }),
      },
    },
  ],
  [
    "coffee-steam",
    "coffee",
    "Coffee steam",
    "tea break morning drink",
    {
      parts: {
        steam: (t) => ({ dy: -tick(0, t, 1) * 3, dx: tick(1, t, 1) * 2 }),
      },
    },
  ],
  [
    "sleepy-zzz",
    "sleepy",
    "Sleepy",
    "tired sleep zzz boring",
    {
      parts: {
        zzz: (t) => ({
          dy: -(t % 1) * 10,
          s: 1 + (t % 1) * 0.3,
          ox: 76,
          oy: 24,
        }),
      },
    },
  ],
];

/* ----------------------------------------------------------------- SVG output */

const f2 = (n) => String(Math.round(n * 100) / 100);

const shapeToSvg = (s) => {
  const fill = PALETTE[s.f];
  switch (s.k) {
    case "c":
      return `<circle cx="${f2(s.cx)}" cy="${f2(s.cy)}" r="${f2(
        s.r,
      )}" fill="${fill}"/>`;
    case "e":
      return `<ellipse cx="${f2(s.cx)}" cy="${f2(s.cy)}" rx="${f2(
        s.rx,
      )}" ry="${f2(s.ry)}" fill="${fill}"/>`;
    case "r":
      return `<rect x="${f2(s.x)}" y="${f2(s.y)}" width="${f2(
        s.w,
      )}" height="${f2(s.h)}" rx="${f2(s.rad)}" fill="${fill}"/>`;
    case "p":
      return `<polygon points="${s.pts
        .map(([x, y]) => `${f2(x)},${f2(y)}`)
        .join(" ")}" fill="${fill}"/>`;
    case "l":
      return `<polyline points="${s.pts
        .map(([x, y]) => `${f2(x)},${f2(y)}`)
        .join(" ")}" fill="none" stroke="${fill}" stroke-width="${f2(
        s.w,
      )}" stroke-linecap="round" stroke-linejoin="round"/>`;
    default:
      throw new Error(`unknown shape ${s.k}`);
  }
};

const toSvg = (shapes, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_SIZE}" height="${SVG_SIZE}" viewBox="0 0 100 100" role="img" aria-label="${label}">\n${shapes
    .map((s) => `  ${shapeToSvg(s)}`)
    .join("\n")}\n</svg>\n`;

/* ----------------------------------------------------------------- rasteriser */

const fwd = ({ dx = 0, dy = 0, s = 1, rot = 0, ox = 50, oy = 50 }) => ({
  dx,
  dy,
  s,
  rot: rad(rot),
  ox,
  oy,
});

/** the inverse of a transform applied to a point: where did this pixel come from */
const unmap = (x, y, t) => {
  const qx = x - t.dx - t.ox;
  const qy = y - t.dy - t.oy;
  const c = Math.cos(-t.rot);
  const sn = Math.sin(-t.rot);
  return [(qx * c - qy * sn) / t.s + t.ox, (qx * sn + qy * c) / t.s + t.oy];
};

const inPoly = (pts, x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const distSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const hit = (s, x, y) => {
  switch (s.k) {
    case "c":
      return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
    case "e":
      return ((x - s.cx) / s.rx) ** 2 + ((y - s.cy) / s.ry) ** 2 <= 1;
    case "r": {
      const r = Math.min(s.rad, s.w / 2, s.h / 2);
      const cx = Math.max(s.x + r, Math.min(x, s.x + s.w - r));
      const cy = Math.max(s.y + r, Math.min(y, s.y + s.h - r));
      return (
        x >= s.x &&
        x <= s.x + s.w &&
        y >= s.y &&
        y <= s.y + s.h &&
        (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1e-9
      );
    }
    case "p":
      return inPoly(s.pts, x, y);
    case "l": {
      for (let i = 0; i < s.pts.length - 1; i++) {
        if (distSeg(x, y, s.pts[i], s.pts[i + 1]) <= s.w / 2) {
          return true;
        }
      }
      return false;
    }
    default:
      return false;
  }
};

/** one frame as palette indices (0 = transparent), 3x3 supersampled */
const rasterise = (shapes, motion, t, size) => {
  const whole = fwd(motion?.whole ? motion.whole(t) : {});
  const parts = {};
  for (const [name, fn] of Object.entries(motion?.parts ?? {})) {
    parts[name] = fwd(fn(t));
  }
  const out = new Uint8Array(size * size);
  const SS = 3;
  const k = 100 / size;
  const votes = new Map();

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      votes.clear();
      let solid = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [wx, wy] = unmap(
            (px + (sx + 0.5) / SS) * k,
            (py + (sy + 0.5) / SS) * k,
            whole,
          );
          for (let i = shapes.length - 1; i >= 0; i--) {
            const s = shapes[i];
            let x = wx;
            let y = wy;
            if (s.part && parts[s.part]) {
              [x, y] = unmap(wx, wy, parts[s.part]);
            }
            if (hit(s, x, y)) {
              const ci = colorIndex(s.f);
              votes.set(ci, (votes.get(ci) ?? 0) + 1);
              solid++;
              break;
            }
          }
        }
      }
      if (solid * 2 >= SS * SS) {
        let best = 0;
        let bestN = -1;
        for (const [ci, n] of votes) {
          if (n > bestN) {
            best = ci;
            bestN = n;
          }
        }
        out[py * size + px] = best;
      }
    }
  }
  return out;
};

/* ---------------------------------------------------------------- GIF encoder */

const MIN_CODE = 5; // 32-entry colour table

const lzwEncode = (indices) => {
  const clear = 1 << MIN_CODE;
  const eoi = clear + 1;
  const bytes = [];
  let cur = 0;
  let shift = 0;
  let codeSize = MIN_CODE + 1;
  const emit = (code) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) {
      bytes.push(cur & 255);
      cur >>= 8;
      shift -= 8;
    }
  };

  let dict = new Map();
  let next = eoi + 1;
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found === undefined) {
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        dict = new Map();
        next = eoi + 1;
        codeSize = MIN_CODE + 1;
      } else {
        if (next >= 1 << codeSize) {
          codeSize++;
        }
        dict.set(key, next++);
      }
      prefix = k;
    } else {
      prefix = found;
    }
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) {
    bytes.push(cur & 255);
  }
  return bytes;
};

/** decodes what lzwEncode wrote - used only to check the encoder (below) */
const lzwDecode = (bytes, length) => {
  const clear = 1 << MIN_CODE;
  const eoi = clear + 1;
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  let codeSize = MIN_CODE + 1;
  const read = () => {
    while (bitCnt < codeSize) {
      if (pos >= bytes.length) {
        return eoi;
      }
      bitBuf |= bytes[pos++] << bitCnt;
      bitCnt += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitCnt -= codeSize;
    return code;
  };

  const out = [];
  let table = [];
  const reset = () => {
    table = Array.from({ length: clear + 2 }, (_, i) => (i < clear ? [i] : []));
    codeSize = MIN_CODE + 1;
  };
  reset();
  let prev = null;
  for (;;) {
    const code = read();
    if (code === eoi) {
      break;
    }
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    let entry;
    if (code < table.length) {
      entry = table[code];
    } else if (prev) {
      entry = [...prev, prev[0]];
    } else {
      throw new Error("bad LZW stream");
    }
    out.push(...entry);
    if (prev) {
      table.push([...prev, entry[0]]);
      if (table.length === 1 << codeSize && codeSize < 12) {
        codeSize++;
      }
    }
    prev = entry;
  }
  if (out.length !== length) {
    throw new Error(`LZW round trip: ${out.length} != ${length}`);
  }
  return out;
};

const u16 = (n) => [n & 255, (n >> 8) & 255];

const subBlocks = (bytes) => {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
};

const encodeGif = (frames, size, delayCs) => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const table = [[0, 0, 0], ...COLOR_NAMES.map((n) => hex(PALETTE[n]))];
  while (table.length < 32) {
    table.push([0, 0, 0]);
  }
  const out = [...Buffer.from("GIF89a")];
  out.push(...u16(size), ...u16(size), 0xf4, 0, 0);
  for (const rgb of table) {
    out.push(...rgb);
  }
  // loop forever
  out.push(0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0);
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, (2 << 2) | 1, ...u16(delayCs), 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(size), ...u16(size), 0);
    const packed = lzwEncode(frame);
    // the encoder is checked against its own decoder: a bad stream stops the build
    const back = lzwDecode(packed, frame.length);
    for (let i = 0; i < frame.length; i++) {
      if (back[i] !== frame[i]) {
        throw new Error("GIF encoder round trip mismatch");
      }
    }
    out.push(MIN_CODE, ...subBlocks(packed));
  }
  out.push(0x3b);
  return Buffer.from(out);
};

/* --------------------------------------------------------------------- build */

const FRAMES = 12;
const DELAY_CS = 7;

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

const main = () => {
  fs.rmSync(ASSETS, { recursive: true, force: true });
  const rows = [];
  const files = [];

  for (const [id, label, tags] of EMOJI) {
    if (!DRAW[id]) {
      throw new Error(`no drawing for ${id}`);
    }
    const svg = toSvg(DRAW[id](), label);
    write(path.join(ASSETS, `${id}.svg`), svg);
    rows.push({ id, kind: "emoji", label, tags, file: `${id}.svg` });
    files.push({ file: `${id}.svg`, bytes: Buffer.byteLength(svg) });
  }

  for (const [id, base, label, tags, motion] of GIFS) {
    const shapes = DRAW[base]();
    const frames = Array.from({ length: FRAMES }, (_, i) =>
      rasterise(shapes, motion, i / FRAMES, GIF_SIZE),
    );
    const gif = encodeGif(frames, GIF_SIZE, DELAY_CS);
    write(path.join(ASSETS, `${id}.gif`), gif);
    // a GIF is found by what it animates as well as by its own words: someone
    // looking for the skull GIF types "skull"
    const baseRow = EMOJI.find(([emojiId]) => emojiId === base);
    const gifTags = [
      ...new Set(`${base} ${baseRow[1]} ${tags}`.toLowerCase().split(" ")),
    ].join(" ");
    rows.push({ id, kind: "gif", label, tags: gifTags, file: `${id}.gif` });
    files.push({ file: `${id}.gif`, bytes: gif.length });
  }

  // the catalog: emoji first in their popularity order, then the GIFs in theirs
  const ts = `/**
 * The sticker catalog (D-158) - GENERATED by \`tools/build-stickers.mjs\`.
 * Do not edit by hand: change the tool and run it again.
 *
 * The order of the rows IS the popularity order: it is what the bar shows with
 * an empty search box.
 */

export type StickerKind = "emoji" | "gif";

export type Sticker = {
  id: string;
  kind: StickerKind;
  label: string;
  /** the words a person would type to find it */
  tags: readonly string[];
  /** the file name inside \`./assets\` */
  file: string;
};

export const STICKERS: readonly Sticker[] = ${JSON.stringify(
    rows.map((r) => ({ ...r, tags: r.tags.split(" ") })),
    null,
    2,
  )};
`;
  write(path.join(APP_EMOJI, "catalog.ts"), ts);

  const total = files.reduce((n, f) => n + f.bytes, 0);
  const md = `# The bundled stickers

The emoji and GIFs in the bar are **our own artwork** (D-157). Nothing was downloaded, nothing is
loaded from a third party at run time, and no file here is somebody else's copyright.

- **What drew them:** \`excalidraw-app/emoji/tools/build-stickers.mjs\` - each sticker is a short list of
  circles, ellipses, rectangles, polygons and strokes in a 100 x 100 box.
- **How they were made:** one drawing gives the static SVG (the emoji) and, with a motion attached, an
  animated GIF (${GIF_SIZE} x ${GIF_SIZE}, ${FRAMES} frames, looping). The GIF encoder is in the same file; it decodes its
  own output as a check, so a bad stream stops the build.
- **Drawn on:** ${DRAWN_ON}
- **Licence:** CC0 1.0 - dedicated to the public domain. Use them for anything.
- **Rebuild:** \`node excalidraw-app/emoji/tools/build-stickers.mjs\` (the output is deterministic).
- **Size:** ${files.length} files, ${(total / 1024).toFixed(0)} KB in all.

These are simplified drawings **inspired by the idea of** common emoji and reaction GIFs, not copies of
any emoji font or GIF library. To add one: add a drawing and a catalog line to the tool and run it.

| File | Kind | Bytes |
| --- | --- | --- |
${files
  .map(
    (f) =>
      `| \`${f.file}\` | ${f.file.endsWith(".gif") ? "gif" : "emoji"} | ${
        f.bytes
      } |`,
  )
  .join("\n")}
`;
  write(path.join(DOCS, "STICKERS.md"), md);

  console.log(
    `stickers: ${EMOJI.length} emoji, ${GIFS.length} gifs, ${
      files.length
    } files, ${(total / 1024).toFixed(0)} KB`,
  );
  const biggest = files.slice().sort((a, b) => b.bytes - a.bytes)[0];
  console.log(`largest: ${biggest.file} ${biggest.bytes} bytes`);
};

main();
