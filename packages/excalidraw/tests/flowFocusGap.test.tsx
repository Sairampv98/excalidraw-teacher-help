/**
 * AC-246 - the focus stands out by a margin, not by a share (D-220).
 */

import { describe, expect, it } from "vitest";

import {
  FLOW_FOCUS_MARGIN,
  flowFocusScale,
  flowFocusTransform,
} from "../scene/flowAnimation";

const box = (width: number, height: number) => ({
  x: 100,
  y: 50,
  width,
  height,
});

/** how far the scaled box reaches past the box, on the left and on the top */
const reach = (b: ReturnType<typeof box>) => {
  const { x, y } = flowFocusScale(b);

  return { left: (b.width * (x - 1)) / 2, top: (b.height * (y - 1)) / 2 };
};

describe("AC-246 the focus gap is a margin", () => {
  it("AC-246 the gap is the same on a small and a wide node", () => {
    for (const b of [box(80, 40), box(250, 70), box(600, 200)]) {
      const r = reach(b);

      expect(r.left).toBeCloseTo(FLOW_FOCUS_MARGIN, 5);
      expect(r.top).toBeCloseTo(FLOW_FOCUS_MARGIN, 5);
    }
  });

  it("AC-246 the margin is small", () => {
    expect(FLOW_FOCUS_MARGIN).toBeGreaterThan(0);
    expect(FLOW_FOCUS_MARGIN).toBeLessThanOrEqual(6);

    // a 250 wide node reached 15 each side at 12%; now it is the margin
    expect(reach(box(250, 70)).left).toBeLessThan(15 / 2);
  });

  it("AC-246 the focus transform uses it, and a given scale is kept", () => {
    const b = box(250, 70);
    const { x, y } = flowFocusScale(b);
    const probe = document.createElement("div");

    probe.style.transform = flowFocusTransform(b, b);

    expect(probe.style.transform).toContain(`scale(${x}, ${y})`);

    // the other styles pass 1: no growth at all
    probe.style.transform = flowFocusTransform(b, b, 1);

    expect(probe.style.transform).toContain("scale(1)");
  });
});
