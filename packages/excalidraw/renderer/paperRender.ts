/**
 * Draws a page's paper on the canvas (D-243).
 *
 * The paper is drawn under the content, inside the page's own rect: the sheet,
 * the warmth and the dark edges of age, the rules and dots, the fibres, and the
 * film grain over it all. Everything that looks random comes from the page's
 * own seed, so the paper is the same every time it is drawn and in every export.
 */

import { fibreCount } from "../scene/paper";

import type { PagePaperDraw } from "../scene/paper";

const GRAIN_TILE = 128;

const grainTiles = new Map<string, HTMLCanvasElement>();

/** a small, quick and well-spread random number generator: the same seed, the same numbers */
export const paperRandom = (seed: number) => {
  let a = seed >>> 0 || 1;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** the strength of the grain (0 to 1) as the opacity of its specks */
export const grainStrength = (grain: number) => (grain / 100) * 0.22;

const grainTile = (seed: number, dark: boolean) => {
  const key = `${seed % 8}/${dark}`;
  const kept = grainTiles.get(key);

  if (kept) {
    return kept;
  }

  const tile = document.createElement("canvas");

  tile.width = GRAIN_TILE;
  tile.height = GRAIN_TILE;

  const context = tile.getContext("2d");

  if (context) {
    const image = context.createImageData(GRAIN_TILE, GRAIN_TILE);
    const next = paperRandom((seed % 8) + 1);

    for (let i = 0; i < GRAIN_TILE * GRAIN_TILE; i++) {
      const light = next() > 0.5;
      // a speck is light or dark on a dark paper, and dark on a light one
      const value = dark ? (light ? 255 : 0) : 0;

      image.data[i * 4] = value;
      image.data[i * 4 + 1] = value;
      image.data[i * 4 + 2] = value;
      image.data[i * 4 + 3] = Math.round(next() * 255);
    }

    context.putImageData(image, 0, 0);
  }

  grainTiles.set(key, tile);

  return tile;
};

/** the fibres of an old paper: short, thin, curved strokes, as data */
export const paperFibres = (draw: PagePaperDraw) => {
  const next = paperRandom(draw.seed ^ 0x51ed);
  const { x, y, width, height } = draw.rect;
  const fibres: {
    x1: number;
    y1: number;
    cx: number;
    cy: number;
    x2: number;
    y2: number;
  }[] = [];

  for (let i = 0; i < fibreCount(draw); i++) {
    const x1 = x + next() * width;
    const y1 = y + next() * height;
    const angle = next() * Math.PI * 2;
    const length = 20 + next() * 50;
    const bend = (next() - 0.5) * length * 0.6;

    fibres.push({
      x1,
      y1,
      cx: x1 + Math.cos(angle) * (length / 2) - Math.sin(angle) * bend,
      cy: y1 + Math.sin(angle) * (length / 2) + Math.cos(angle) * bend,
      x2: x1 + Math.cos(angle) * length,
      y2: y1 + Math.sin(angle) * length,
    });
  }

  return fibres;
};

/** the colour of the warmth over a light paper and of the smudge over a dark one */
export const ageTint = (draw: PagePaperDraw) => {
  const share = draw.paper.age / 100;

  return draw.dark
    ? `rgba(255,255,255,${(0.06 * share).toFixed(3)})`
    : `rgba(176,116,40,${(0.28 * share).toFixed(3)})`;
};

export const ageEdge = (draw: PagePaperDraw) => {
  const share = draw.paper.age / 100;

  return draw.dark
    ? `rgba(0,0,0,${(0.5 * share).toFixed(3)})`
    : `rgba(90,52,18,${(0.5 * share).toFixed(3)})`;
};

/**
 * Draws the paper in place. The context is already scaled to the zoom, so the
 * rect is moved by the scroll only.
 */
export const drawPagePaper = (
  context: CanvasRenderingContext2D,
  draw: PagePaperDraw,
  scrollX: number,
  scrollY: number,
) => {
  const x = draw.rect.x + scrollX;
  const y = draw.rect.y + scrollY;
  const { width, height } = draw.rect;
  const age = draw.paper.age;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();

  if (draw.color) {
    context.fillStyle = draw.color;
    context.fillRect(x, y, width, height);
  }

  if (age > 0) {
    context.fillStyle = ageTint(draw);
    context.fillRect(x, y, width, height);
  }

  // the rules and the dots
  if (draw.marks.length) {
    context.strokeStyle = draw.ruleColor;
    context.fillStyle = draw.ruleColor;

    for (const heavy of [false, true]) {
      context.lineWidth = draw.ruleWidth * (heavy ? 1.8 : 1);
      context.beginPath();

      for (const mark of draw.marks) {
        if (mark.kind === "line" && mark.heavy === heavy) {
          context.moveTo(mark.x1 + scrollX, mark.y1 + scrollY);
          context.lineTo(mark.x2 + scrollX, mark.y2 + scrollY);
        }
      }

      context.stroke();
    }

    const radius = draw.ruleWidth * 1.1;

    context.beginPath();

    for (const mark of draw.marks) {
      if (mark.kind === "dot") {
        context.moveTo(mark.x + scrollX + radius, mark.y + scrollY);
        context.arc(mark.x + scrollX, mark.y + scrollY, radius, 0, Math.PI * 2);
      }
    }

    context.fill();
  }

  if (age > 0) {
    // fibres
    context.strokeStyle = draw.dark
      ? "rgba(255,255,255,0.14)"
      : "rgba(110,76,36,0.28)";
    context.lineWidth = 1;
    context.beginPath();

    for (const fibre of paperFibres(draw)) {
      context.moveTo(fibre.x1 + scrollX, fibre.y1 + scrollY);
      context.quadraticCurveTo(
        fibre.cx + scrollX,
        fibre.cy + scrollY,
        fibre.x2 + scrollX,
        fibre.y2 + scrollY,
      );
    }

    context.stroke();

    // darker edges
    const radius = Math.hypot(width, height) / 2;
    const gradient = context.createRadialGradient(
      x + width / 2,
      y + height / 2,
      radius * 0.55,
      x + width / 2,
      y + height / 2,
      radius,
    );

    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, ageEdge(draw));
    context.fillStyle = gradient;
    context.fillRect(x, y, width, height);
  }

  if (draw.paper.grain > 0) {
    const pattern = context.createPattern(
      grainTile(draw.seed, draw.dark),
      "repeat",
    );

    if (pattern) {
      pattern.setTransform?.(new DOMMatrix().translate(x, y));
      context.globalAlpha = grainStrength(draw.paper.grain);
      context.fillStyle = pattern;
      context.fillRect(x, y, width, height);
    }
  }

  context.restore();
};
