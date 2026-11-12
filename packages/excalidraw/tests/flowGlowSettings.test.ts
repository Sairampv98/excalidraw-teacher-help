import { describe, expect, it } from "vitest";

import {
  FLOW_GLOW_PARTS,
  FLOW_LOOK_DEFAULTS,
  flowLookVars,
  glowLevelOf,
  glowStrengthKey,
  glowWidthFactorOf,
  glowWidthKey,
  readFlowLook,
} from "../scene/flowLook";
import { flowMarksFor } from "../scene/flowStyles";
import { parseFlowScript } from "../scene/flowScript";

const path = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
];

describe("AC-602 the neon glow strength and width, for each part", () => {
  it("defaults to the old look for every part: strength 50, normal width", () => {
    for (const part of FLOW_GLOW_PARTS) {
      expect(FLOW_LOOK_DEFAULTS[glowStrengthKey(part)]).toBe(50);
      expect(FLOW_LOOK_DEFAULTS[glowWidthKey(part)]).toBe("normal");
      expect(glowLevelOf(FLOW_LOOK_DEFAULTS, part)).toEqual({
        reach: 1,
        widthK: 1,
      });
    }
    const vars = flowLookVars(FLOW_LOOK_DEFAULTS);
    expect(vars["--flow-glow-k-shape"]).toBe("1");
    expect(vars["--flow-neon-w-arrow"]).toBe("1");
  });

  it("reads old files as before and clamps what is out of range", () => {
    expect(readFlowLook({}).glowShapeStrength).toBe(50);
    expect(readFlowLook({ glowTextStrength: 0 }).glowTextStrength).toBe(1);
    expect(readFlowLook({ glowTextStrength: 900 }).glowTextStrength).toBe(100);
    expect(readFlowLook({ glowMarkStrength: "x" }).glowMarkStrength).toBe(50);
    expect(readFlowLook({ glowArrowWidth: "huge" }).glowArrowWidth).toBe(
      "normal",
    );
    expect(readFlowLook({ glowArrowWidth: "large" }).glowArrowWidth).toBe(
      "large",
    );
  });

  it("each part has its own: changing the text leaves the shape alone", () => {
    const look = readFlowLook({
      glowTextStrength: 100,
      glowTextWidth: "large",
      glowShapeStrength: 10,
    });
    const vars = flowLookVars(look);
    expect(vars["--flow-glow-k-text"]).toBe("2");
    expect(vars["--flow-glow-k-shape"]).toBe("0.2");
    expect(vars["--flow-glow-k-mark"]).toBe("1");
    expect(vars["--flow-neon-w-text"]).toBe(String(glowWidthFactorOf("large")));
    expect(vars["--flow-neon-w-shape"]).toBe("1");
  });

  it("small, normal and large are clearly different", () => {
    expect(
      glowWidthFactorOf("large") / glowWidthFactorOf("small"),
    ).toBeGreaterThan(3);
  });

  it("makes the marks thinner or thicker, and leaves them alone at 1", () => {
    const width = (widthK?: number) =>
      flowMarksFor("beam", path, 100, { widthK }).strokes.find(
        (stroke) => stroke.role === "beam",
      )!.width;
    expect(width()).toBe(width(1));
    expect(width(2.5)).toBeCloseTo(width() * 2.5);
    expect(width(0.4)).toBeCloseTo(width() * 0.4);
    const radius = (widthK?: number) =>
      flowMarksFor("token", path, 100, { widthK }).dots[0].radius;
    expect(radius(2.5)).toBeCloseTo(radius() * 2.5);
  });

  it("has script words for each part, and reports a bad value with its line", () => {
    const ok = parseFlowScript(
      "network",
      "glow-shape-strength: 80\nglow-text-width: large\nglow-arrow-strength: 5\nA -> B",
    );
    expect(ok.ok && ok.problems).toEqual([]);
    expect(ok.ok && ok.settings).toMatchObject({
      glowShapeStrength: 80,
      glowTextWidth: "large",
      glowArrowStrength: 5,
    });
    for (const bad of [
      "glow-shape-strength: 0",
      "glow-mark-strength: 101",
      "glow-text-strength: 2.5",
      "glow-arrow-width: huge",
    ]) {
      const result = parseFlowScript("network", `${bad}\nA -> B`);
      expect(result.ok && result.problems).toEqual(
        expect.arrayContaining([expect.objectContaining({ line: 1 })]),
      );
    }
  });
});

describe("the export's neon is the screen's chain of drop-shadows", () => {
  it("is the same filter, in picture pixels, with the part's reach", async () => {
    const { neonFilter } = await import("../scene/flowExport/compose");
    expect(neonFilter("#f0f", 1, [2, 6, 14, 28])).toBe(
      "drop-shadow(0 0 2.00px #f0f) drop-shadow(0 0 6.00px #f0f) drop-shadow(0 0 14.00px #f0f) drop-shadow(0 0 28.00px #f0f)",
    );
    // a picture at half size, and a glow of 100 (twice the usual reach)
    expect(neonFilter("#f0f", 0.5, [2, 6], 2)).toBe(
      "drop-shadow(0 0 2.00px #f0f) drop-shadow(0 0 6.00px #f0f)",
    );
  });
});

describe("the neon of an arrow goes along its head", () => {
  it("lays the two wings back from the tip, 25 long at 20 degrees, and none for a plain end", async () => {
    const { newArrowElement } = await import("@excalidraw/element");
    const { pointFrom } = await import("@excalidraw/math");
    const { arrowheadsOf, getArrowPath } = await import("../scene/flowStyles");
    const arrow = newArrowElement({
      type: "arrow",
      x: 100,
      y: 100,
      points: [pointFrom(0, 0), pointFrom(0, 200)] as never,
      endArrowhead: "arrow",
      startArrowhead: null,
    });
    const heads = arrowheadsOf(arrow, getArrowPath(arrow));
    expect(heads).toHaveLength(1);
    const [one, tip, other] = heads[0];
    const [left, right] = one.x < other.x ? [one, other] : [other, one];
    expect(tip).toEqual({ x: 100, y: 300 });
    expect(Math.hypot(left.x - tip.x, left.y - tip.y)).toBeCloseTo(25);
    expect(Math.hypot(right.x - tip.x, right.y - tip.y)).toBeCloseTo(25);
    expect(left.y).toBeLessThan(tip.y);
    expect(right.y).toBeLessThan(tip.y);
    expect(left.x).toBeLessThan(tip.x);
    expect(right.x).toBeGreaterThan(tip.x);
    expect(
      arrowheadsOf(
        newArrowElement({
          type: "arrow",
          x: 0,
          y: 0,
          points: [pointFrom(0, 0), pointFrom(0, 50)] as never,
          endArrowhead: null,
          startArrowhead: null,
        }),
        [
          { x: 0, y: 0 },
          { x: 0, y: 50 },
        ],
      ),
    ).toEqual([]);
  });
});

describe("the neon core choice", () => {
  it("is soft (the lightened colour), white, or the colour itself, for each part", async () => {
    const { glowCoreColor, flowLookVars, readFlowLook, neonCore } =
      await import("../scene/flowLook");
    expect(glowCoreColor("#ff0000", undefined)).toBe(neonCore("#ff0000"));
    expect(glowCoreColor("#ff0000", "soft")).toBe(neonCore("#ff0000"));
    expect(glowCoreColor("#ff0000", "white")).toBe("#ffffff");
    expect(glowCoreColor("#ff0000", "colour")).toBe("#ff0000");
    // on a light page the soft core is the colour, as it was
    expect(glowCoreColor("#ff0000", "soft", true)).toBe("#ff0000");
    expect(glowCoreColor("#ff0000", "white", true)).toBe("#ffffff");
    expect(readFlowLook({ glowTextCore: "nonsense" }).glowTextCore).toBe(
      "soft",
    );
    const vars = flowLookVars(
      readFlowLook({
        nodeColor: "#ff0000",
        glowShapeCore: "white",
        glowTextCore: "colour",
        textColor: "#00ff00",
      }),
    );
    expect(vars["--flow-node-core"]).toBe("#ffffff");
    expect(vars["--flow-text-core"]).toBe("#00ff00");
    // what is not chosen is as before
    expect(vars["--flow-mark-core"]).toBeUndefined();
  });

  it("has script words", () => {
    const ok = parseFlowScript(
      "network",
      "glow-shape-core: white\nglow-arrow-core: colour\nA -> B",
    );
    expect(ok.ok && ok.problems).toEqual([]);
    const bad = parseFlowScript("network", "glow-text-core: pink\nA -> B");
    expect(bad.ok && bad.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: 1 })]),
    );
  });
});
