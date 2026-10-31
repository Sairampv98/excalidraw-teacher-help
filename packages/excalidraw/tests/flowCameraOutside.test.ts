/**
 * The camera flight to a step that is not on the page (D-394): the flight is
 * kept on the page (D-170), but a step that lies across the page's edge, or
 * outside it, is centred - the clamp must not leave it to one side.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import { FLOW_CAMERA_PADDING, flightTarget } from "../scene/flowCamera";

const VIEWPORT = { width: 1200, height: 800 };
const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

/** where the middle of the box is on the screen, for a camera */
const screenCentre = (
  camera: { scrollX: number; scrollY: number; zoom: number },
  box: { x: number; y: number; width: number; height: number },
) => ({
  x: (box.x + box.width / 2 + camera.scrollX) * camera.zoom,
  y: (box.y + box.height / 2 + camera.scrollY) * camera.zoom,
});

describe("the camera flight to a step off the page", () => {
  it("AC-455 a step below the page is in the middle of the view, not left to the page", () => {
    const box = { x: 600, y: 1200, width: 400, height: 200 };
    const target = flightTarget({ box, viewport: VIEWPORT, pageRect: PAGE });
    const at = screenCentre(target, box);

    expect(at.x).toBeCloseTo(VIEWPORT.width / 2, 3);
    expect(at.y).toBeCloseTo(VIEWPORT.height / 2, 3);
  });

  it("AC-455 a step across the page's edge is centred on the axis it crosses and kept on the page on the other", () => {
    // across the right edge: horizontally centred; vertically inside the page, as before
    const box = { x: 1700, y: 100, width: 500, height: 120 };
    const target = flightTarget({ box, viewport: VIEWPORT, pageRect: PAGE });
    const at = screenCentre(target, box);

    expect(at.x).toBeCloseTo(VIEWPORT.width / 2, 3);

    // the page's top edge is not scrolled past the view's top
    const top = (PAGE.y + target.scrollY) * target.zoom;

    expect(top).toBeLessThanOrEqual(0.5);
  });

  it("AC-455 a step inside the page is kept on the page as before, even when the padding reaches past it", () => {
    const corner = { x: 1820, y: 1000, width: 100, height: 60 };
    const target = flightTarget({
      box: corner,
      viewport: VIEWPORT,
      pageRect: PAGE,
    });
    const at = screenCentre(target, corner);

    // it cannot be in the middle: the page's far edge is at the view's far edge
    expect(at.x).toBeGreaterThan(VIEWPORT.width / 2);
    expect((PAGE.x + PAGE.width + target.scrollX) * target.zoom).toBeCloseTo(
      VIEWPORT.width,
      3,
    );
    expect(FLOW_CAMERA_PADDING).toBe(75);
  });
});
