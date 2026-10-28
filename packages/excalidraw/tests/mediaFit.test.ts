/**
 * AC-283 - the four fits of the media of a node, and the crop box (D-247).
 *
 * The fits are read as data: the view each one chooses, and where the picture
 * lands in the node's box when it is shown. The corners of a picture are checked
 * against the outline of the shape they have to be inside.
 */

import { describe, expect, it } from "vitest";

import {
  MEDIA_FITS,
  clampView,
  coverCrop,
  customDataWithMedia,
  extentOf,
  mediaOf,
  moveView,
  readMediaView,
  resizeView,
  viewAsCrop,
  viewForFit,
  viewPlacement,
  viewWithBoxShape,
} from "@excalidraw/element";

import type { MediaShape } from "@excalidraw/element";

const BOX = { width: 200, height: 100 };

const PICTURES = [
  { width: 800, height: 200 },
  { width: 400, height: 200 },
  { width: 200, height: 400 },
  { width: 333, height: 777 },
];

/** where the corners of the whole picture land in the box, from the middle of the box */
const corners = (
  view: ReturnType<typeof viewForFit>,
  natural: { width: number; height: number },
) => {
  const placed = viewPlacement(view, BOX, natural);

  return [
    [placed.x, placed.y],
    [placed.x + placed.width, placed.y],
    [placed.x + placed.width, placed.y + placed.height],
    [placed.x, placed.y + placed.height],
  ].map(([x, y]) => [x - BOX.width / 2, y - BOX.height / 2]);
};

describe("AC-283 the four fits and the crop box", () => {
  it("AC-283 every fit has the box's own shape", () => {
    expect(MEDIA_FITS).toEqual(["auto", "crop", "best", "inside"]);

    for (const natural of PICTURES) {
      for (const shape of ["rectangle", "ellipse", "diamond"] as MediaShape[]) {
        for (const fit of MEDIA_FITS) {
          const view = viewForFit(fit, BOX, natural, shape);

          expect(view.width / view.height, `${fit} ${shape}`).toBeCloseTo(
            BOX.width / BOX.height,
            6,
          );
          // and it is centred on the picture
          expect(view.x + view.width / 2).toBeCloseTo(natural.width / 2, 6);
          expect(view.y + view.height / 2).toBeCloseTo(natural.height / 2, 6);
        }
      }
    }
  });

  it("AC-283 auto crop fills the shape and cuts the picture", () => {
    for (const natural of PICTURES) {
      const view = viewForFit("auto", BOX, natural, "ellipse");
      const crop = coverCrop(BOX, natural);

      expect(view).toEqual({
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
      });
      // the view is inside the picture: nothing of the box is left empty
      expect(view.x).toBeGreaterThanOrEqual(-1e-9);
      expect(view.y).toBeGreaterThanOrEqual(-1e-9);
      expect(view.x + view.width).toBeLessThanOrEqual(natural.width + 1e-9);
      expect(view.y + view.height).toBeLessThanOrEqual(natural.height + 1e-9);
    }
  });

  it("AC-283 best fit shows all of the picture, as large as the box allows", () => {
    for (const natural of PICTURES) {
      const view = viewForFit("best", BOX, natural, "ellipse");

      // all of the picture is in the view
      expect(view.x).toBeLessThanOrEqual(1e-9);
      expect(view.y).toBeLessThanOrEqual(1e-9);
      expect(view.x + view.width).toBeGreaterThanOrEqual(natural.width - 1e-9);
      expect(view.y + view.height).toBeGreaterThanOrEqual(
        natural.height - 1e-9,
      );

      // and it touches the box on one side at least: it is as large as it can be
      const placed = viewPlacement(view, BOX, natural);

      expect(
        Math.abs(placed.width - BOX.width) < 1e-6 ||
          Math.abs(placed.height - BOX.height) < 1e-6,
      ).toBe(true);
      expect(placed.width).toBeLessThanOrEqual(BOX.width + 1e-6);
      expect(placed.height).toBeLessThanOrEqual(BOX.height + 1e-6);
    }
  });

  it("AC-283 fit inside puts all four corners of the picture inside the outline, touching it", () => {
    for (const natural of PICTURES) {
      // an ellipse: the corners are on it
      for (const [x, y] of corners(
        viewForFit("inside", BOX, natural, "ellipse"),
        natural,
      )) {
        expect(
          (x / (BOX.width / 2)) ** 2 + (y / (BOX.height / 2)) ** 2,
        ).toBeCloseTo(1, 6);
      }

      // a diamond: the corners are on it
      for (const [x, y] of corners(
        viewForFit("inside", BOX, natural, "diamond"),
        natural,
      )) {
        expect(
          Math.abs(x) / (BOX.width / 2) + Math.abs(y) / (BOX.height / 2),
        ).toBeCloseTo(1, 6);
      }

      // a rectangle: as large as the box lets it be, which is what best fit is
      expect(viewForFit("inside", BOX, natural, "rectangle")).toEqual(
        viewForFit("best", BOX, natural, "rectangle"),
      );

      // and it is smaller than best fit in an ellipse: the outline is tighter
      const best = viewPlacement(
        viewForFit("best", BOX, natural, "ellipse"),
        BOX,
        natural,
      );
      const inside = viewPlacement(
        viewForFit("inside", BOX, natural, "ellipse"),
        BOX,
        natural,
      );

      expect(inside.width).toBeLessThan(best.width);
    }
  });

  it("AC-283 a crop keeps the part the teacher chose, in the box's own shape", () => {
    const chosen = { x: 100, y: 50, width: 300, height: 120 };
    const view = viewForFit("crop", BOX, PICTURES[1], "ellipse", chosen);

    // the same middle and width, with the height the box has
    expect(view.width).toBe(300);
    expect(view.height).toBe(150);
    expect(view.x + view.width / 2).toBeCloseTo(250, 6);
    expect(view.y + view.height / 2).toBeCloseTo(110, 6);

    // with nothing chosen it is the auto crop
    expect(viewForFit("crop", BOX, PICTURES[1], "ellipse", null)).toEqual(
      viewForFit("auto", BOX, PICTURES[1], "ellipse"),
    );
    expect(viewWithBoxShape(chosen, BOX).height).toBe(150);
  });

  it("AC-283 the view lands on the box corner to corner", () => {
    const natural = { width: 800, height: 400 };
    const view = { x: 100, y: 50, width: 400, height: 200 };
    const placed = viewPlacement(view, BOX, natural);

    // the view's corners are the box's corners
    expect(placed.x + view.x * placed.scale).toBeCloseTo(0, 6);
    expect(placed.y + view.y * placed.scale).toBeCloseTo(0, 6);
    expect(placed.x + (view.x + view.width) * placed.scale).toBeCloseTo(
      BOX.width,
      6,
    );
    expect(placed.y + (view.y + view.height) * placed.scale).toBeCloseTo(
      BOX.height,
      6,
    );
    // and the whole picture is the size that scale makes it
    expect(placed.width).toBeCloseTo(natural.width * placed.scale, 6);

    // a view in the picture is a crop; one that reaches past it is not
    expect(viewAsCrop(view, natural)).toMatchObject({
      x: 100,
      y: 50,
      width: 400,
      height: 200,
      naturalWidth: 800,
      naturalHeight: 400,
    });
    expect(
      viewAsCrop({ x: -10, y: 0, width: 400, height: 200 }, natural),
    ).toBeNull();
  });

  it("AC-283 dragging a handle of the crop box keeps its shape and the other side where it was", () => {
    const view = { x: 100, y: 100, width: 200, height: 100 };

    // the corner across from the dragged one stays
    const se = resizeView(view, "se", { x: 500, y: 300 }, BOX);

    expect(se).toMatchObject({ x: 100, y: 100 });
    expect(se.width / se.height).toBeCloseTo(2, 6);

    const nw = resizeView(view, "nw", { x: 0, y: 50 }, BOX);

    expect(nw.x + nw.width).toBeCloseTo(300, 6);
    expect(nw.y + nw.height).toBeCloseTo(200, 6);
    expect(nw.width / nw.height).toBeCloseTo(2, 6);

    // a side grows the box about the middle of the opposite side
    const east = resizeView(view, "e", { x: 500, y: 150 }, BOX);

    expect(east.x).toBe(100);
    expect(east.width).toBe(400);
    expect(east.y + east.height / 2).toBeCloseTo(150, 6);

    const north = resizeView(view, "n", { x: 200, y: 0 }, BOX);

    expect(north.y + north.height).toBeCloseTo(200, 6);
    expect(north.x + north.width / 2).toBeCloseTo(200, 6);

    // it never collapses
    expect(
      resizeView(view, "se", { x: 100, y: 100 }, BOX).width,
    ).toBeGreaterThan(0);

    // moving it keeps its size
    expect(moveView(view, 30, -10)).toEqual({
      x: 130,
      y: 90,
      width: 200,
      height: 100,
    });

    // and it is kept sane: not a speck and not enormous
    const speck = clampView(
      { x: 0, y: 0, width: 0.01, height: 0.005 },
      BOX,
      PICTURES[1],
    );

    expect(speck.width).toBeGreaterThanOrEqual(4);
    expect(
      clampView({ x: 0, y: 0, width: 1e9, height: 5e8 }, BOX, PICTURES[1])
        .width,
    ).toBeLessThan(1e5);
  });

  it("AC-283 the fit and the view are kept with the media", () => {
    const view = { x: 10, y: 20, width: 300, height: 150 };
    const kept = customDataWithMedia(undefined, {
      of: "n",
      shape: "ellipse",
      radius: 0,
      fit: "crop",
      view,
      natural: { width: 400, height: 200 },
    });

    expect(mediaOf({ customData: kept })).toMatchObject({
      fit: "crop",
      view,
      natural: { width: 400, height: 200 },
    });

    // what is not a fit or a view is not read, and media from before has neither
    const odd = mediaOf({
      customData: {
        media: {
          of: "n",
          shape: "ellipse",
          radius: 0,
          fit: "stretch",
          view: { x: 0, y: 0, width: 0, height: 5 },
          natural: { width: 0, height: 10 },
        },
      },
    });

    expect(odd?.fit).toBeUndefined();
    expect(odd?.view).toBeUndefined();
    expect(odd?.natural).toBeUndefined();
    expect(readMediaView({ x: 1, y: 2, width: 3, height: 4 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(readMediaView(null)).toBeNull();
  });

  it("AC-283 the crop screen is laid out to hold the picture and every view", () => {
    const natural = { width: 400, height: 200 };
    const best = viewForFit(
      "best",
      BOX,
      { width: 200, height: 400 },
      "ellipse",
    );
    const extent = extentOf(natural, [
      { x: -50, y: -10, width: 100, height: 50 },
      { x: 350, y: 150, width: 100, height: 100 },
    ]);

    expect(extent).toEqual({ x: -50, y: -10, width: 500, height: 260 });
    // with nothing beyond the picture, it is the picture
    expect(extentOf(natural, [])).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
    expect(best.width).toBeGreaterThan(200);
  });
});
