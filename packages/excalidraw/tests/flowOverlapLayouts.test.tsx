/**
 * AC-260 - a target and a venn overlap on purpose (D-235).
 */

import { describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { checkFlowScript } from "../scene/flowCheck";
import { buildFlowPreset } from "../scene/flowPresets";

import { nodesOf } from "./helpers/flowLargeHelpers";

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

const build = (preset: "target" | "venn", script: string) => {
  const built = buildFlowPreset(preset, script, { seed: 3, page: PAGE });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements;
};

/** the words drawn for each ring or circle: free text, grouped with its shape */
const labels = (elements: readonly ExcalidrawElement[]) =>
  elements.filter(
    (e): e is ExcalidrawTextElement =>
      e.type === "text" && e.customData?.flow?.role === "label",
  );

const cx = (e: ExcalidrawElement) => e.x + e.width / 2;
const cy = (e: ExcalidrawElement) => e.y + e.height / 2;

describe("AC-260 a target and a venn overlap on purpose", () => {
  it("AC-260 the rings of a target lie one inside the next", () => {
    const rings = nodesOf(build("target", "Outer\nMiddle\nInner\nCore"));

    expect(rings).toHaveLength(4);

    // the first line is the outermost, and every ring is inside the one before
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i].width).toBeLessThan(rings[i - 1].width);
      expect(rings[i].height).toBeLessThan(rings[i - 1].height);
      expect(rings[i].x).toBeGreaterThan(rings[i - 1].x);
      expect(rings[i].y).toBeGreaterThan(rings[i - 1].y);
      expect(rings[i].x + rings[i].width).toBeLessThan(
        rings[i - 1].x + rings[i - 1].width,
      );
      // on one middle
      expect(cx(rings[i])).toBeCloseTo(cx(rings[0]), 3);
      expect(cy(rings[i])).toBeCloseTo(cy(rings[0]), 3);
    }
  });

  it("AC-260 the circles of a venn cross", () => {
    for (const count of [2, 3, 4]) {
      const script = ["Maths", "Art", "Music", "Drama"]
        .slice(0, count)
        .join("\n");
      const sets = nodesOf(build("venn", script));

      expect(sets).toHaveLength(count);

      for (const set of sets) {
        // circles
        expect(set.width).toBeCloseTo(set.height, 5);
      }

      // every circle crosses the next: the middles are closer than the radii
      for (let i = 1; i < sets.length; i++) {
        const distance = Math.hypot(
          cx(sets[i]) - cx(sets[i - 1]),
          cy(sets[i]) - cy(sets[i - 1]),
        );

        expect(distance).toBeLessThan(
          sets[i].width / 2 + sets[i - 1].width / 2,
        );
        // and neither is inside the other
        expect(distance).toBeGreaterThan(0);
      }
    }
  });

  it("AC-260 the fills let the others show through", () => {
    for (const [preset, script] of [
      ["target", "A\nB\nC"],
      ["venn", "A\nB\nC"],
    ] as const) {
      for (const shape of nodesOf(build(preset, script))) {
        expect(shape.opacity).toBeLessThan(100);
        expect(shape.fillStyle).toBe("solid");
      }
    }

    // a chart that joins shapes is not made see-through
    const process = buildFlowPreset("process", "A\nB", { seed: 1 });

    expect(
      process.ok && nodesOf(process.elements).every((n) => n.opacity === 100),
    ).toBe(true);
  });

  it("AC-260 no two labels overlap", () => {
    for (const [preset, script] of [
      ["target", "Community\nSchool\nClass\nMe"],
      ["target", "A\nB\nC\nD\nE\nF"],
      ["venn", "Maths\nArt\nMusic"],
      ["venn", "Reading\nWriting\nSpeaking\nListening"],
    ] as const) {
      const texts = labels(build(preset, script));

      expect(texts.length).toBeGreaterThan(1);

      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i];
          const b = texts[j];
          const apart =
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y;

          expect(
            apart,
            `${preset} ${a.originalText} and ${b.originalText}`,
          ).toBe(true);
        }
      }
    }

    // each label stays with its shape: they share a group
    const elements = build("venn", "Maths\nArt");

    for (const shape of nodesOf(elements)) {
      const text = labels(elements).find(
        (t) => t.customData!.flow.nodeId === shape.customData!.flow.nodeId,
      )!;

      expect(shape.groupIds.length).toBeGreaterThan(0);
      expect(text.groupIds).toEqual(shape.groupIds);
    }
  });

  it("AC-260 too many rings or sets is a problem", () => {
    const six = checkFlowScript("target", "1\n2\n3\n4\n5\n6");
    const seven = checkFlowScript("target", "1\n2\n3\n4\n5\n6\n7");

    expect(six.problems).toEqual([]);
    expect(seven.problems.map((p) => p.line)).toEqual([7]);
    expect(seven.problems[0].message).toMatch(/6 rings/);

    const four = checkFlowScript("venn", "1\n2\n3\n4");
    const five = checkFlowScript("venn", "1\n2\n3\n4\n5");

    expect(four.problems).toEqual([]);
    expect(five.problems.map((p) => p.line)).toEqual([5]);
    expect(five.problems[0].message).toMatch(/4 sets/);
    expect(five.ok).toBe(false);
  });
});
