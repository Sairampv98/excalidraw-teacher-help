/**
 * Paints an ink look on the canvas of an element (D-241).
 *
 * The canvas holds the element drawn as Normal. The steps of the look (`inkPlan`)
 * are then followed on it: the ink is spread, given its gaps, and painted over a
 * halo, so the cached canvas of the element is what the scene draws and what a
 * PNG export draws.
 */

import { inkPlan } from "./ink";

import type { Ink, InkStep } from "./ink";

const TILE = 128;

/** how a canvas to work on is made: a seam, so that what is done to each one can be read */
export type MakeCanvas = () => HTMLCanvasElement;

const makeCanvas: MakeCanvas = () => document.createElement("canvas");

const tiles = new Map<string, HTMLCanvasElement>();

/** a small, quick and well-spread random number generator: the same seed, the same numbers */
const random = (seed: number) => {
  let a = seed >>> 0 || 1;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** a tile of gaps: opaque where the ink is to be taken away */
const holesTile = (seed: number, density: number) => {
  const key = `${seed}/${density}`;
  const kept = tiles.get(key);

  if (kept) {
    return kept;
  }

  const tile = document.createElement("canvas");

  tile.width = TILE;
  tile.height = TILE;

  const context = tile.getContext("2d");

  if (context) {
    const image = context.createImageData(TILE, TILE);
    const next = random(seed);

    for (let i = 0; i < TILE * TILE; i++) {
      image.data[i * 4 + 3] = next() < density ? 255 : 0;
    }

    context.putImageData(image, 0, 0);
  }

  tiles.set(key, tile);

  return tile;
};

const copyOf = (canvas: HTMLCanvasElement, make: MakeCanvas) => {
  const copy = make();

  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d")?.drawImage(canvas, 0, 0);

  return copy;
};

/** the ink in one flat colour */
const tinted = (ink: HTMLCanvasElement, color: string, make: MakeCanvas) => {
  const out = copyOf(ink, make);
  const context = out.getContext("2d");

  if (context) {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, out.width, out.height);
  }

  return out;
};

/**
 * Follows the plan of a look on `canvas`, in place. `px` is how many pixels a
 * scene unit is on this canvas, so a halo or a grain is the same size on the
 * screen and in an export.
 */
export const applyInkLook = (
  canvas: HTMLCanvasElement,
  ink: Ink,
  color: string,
  seed: number,
  px: number,
  make: MakeCanvas = makeCanvas,
) => {
  const steps = inkPlan(ink, color, seed);

  if (steps.length === 0 || !canvas.width || !canvas.height) {
    return;
  }

  const target = canvas.getContext("2d");

  if (!target) {
    return;
  }

  let painted = copyOf(canvas, make);
  let alpha = 1;
  const halos: Extract<InkStep, { op: "halo" }>[] = [];
  let core: string | null = null;

  for (const step of steps) {
    switch (step.op) {
      case "thicken": {
        const spread = make();

        spread.width = painted.width;
        spread.height = painted.height;

        const context = spread.getContext("2d")!;
        const r = step.radius * px;

        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4;

          context.drawImage(painted, Math.cos(angle) * r, Math.sin(angle) * r);
        }

        context.drawImage(painted, 0, 0);
        painted = spread;
        break;
      }
      case "holes": {
        const next = copyOf(painted, make);
        const context = next.getContext("2d")!;
        const pattern = context.createPattern(
          holesTile(step.seed, step.density),
          "repeat",
        );

        if (pattern) {
          // the grain is a size in scene units, so the pattern is scaled to it
          pattern.setTransform?.(new DOMMatrix().scale(step.cell * px));
          context.globalCompositeOperation = "destination-out";
          context.fillStyle = pattern;
          context.fillRect(0, 0, next.width, next.height);
        }

        painted = next;
        break;
      }
      case "alpha":
        alpha = step.value;
        break;
      case "halo":
        halos.push(step);
        break;
      case "core":
        core = step.color;
        break;
    }
  }

  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, canvas.width, canvas.height);
  target.globalAlpha = alpha;

  for (const halo of halos) {
    target.save();
    target.shadowColor = halo.color;
    target.shadowBlur = halo.blur * px;
    target.globalAlpha = alpha * halo.alpha;
    target.drawImage(painted, 0, 0);
    target.restore();
  }

  target.drawImage(painted, 0, 0);

  if (core) {
    target.drawImage(tinted(painted, core, make), 0, 0);
  }

  target.restore();
};
