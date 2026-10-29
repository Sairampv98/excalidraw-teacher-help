/**
 * AC-255 - the shape of a node can be changed, and a node grows to hold its
 * text (D-229).
 *
 * The chart is built by the real builder and read as elements: the type and the
 * size of each shape, and where its text lies in it.
 */

import { describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { applyFlowScript } from "../scene/flowApply";
import { highlightShapeOf } from "../scene/flowHighlight";
import { buildFlowPreset } from "../scene/flowPresets";
import {
  FLOW_NODE_SHAPES,
  FLOW_PRESET_IDS,
  parseFlowScript,
} from "../scene/flowScript";

import type { FlowChartShape, FlowPresetId } from "../scene/flowPresets";

const build = (
  preset: FlowPresetId,
  script: string,
  shape?: FlowChartShape,
) => {
  const built = buildFlowPreset(preset, script, { seed: 3, shape });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements;
};

const nodesOf = (elements: readonly ExcalidrawElement[]) =>
  elements.filter(
    (element) =>
      !element.isDeleted &&
      element.type !== "arrow" &&
      element.type !== "text" &&
      element.customData?.flow?.role === "node",
  );

const textOf = (
  elements: readonly ExcalidrawElement[],
  shape: ExcalidrawElement,
) =>
  elements.find(
    (element): element is ExcalidrawTextElement =>
      element.type === "text" && element.containerId === shape.id,
  )!;

/** the element a node of this label was drawn as */
const byLabel = (elements: readonly ExcalidrawElement[], label: string) =>
  nodesOf(elements).find(
    (shape) => textOf(elements, shape).originalText === label,
  )!;

/** how the drawn shape is told apart: its type, and whether it is rounded */
const kindOf = (shape: ExcalidrawElement) =>
  shape.type === "rectangle"
    ? shape.roundness
      ? "rounded"
      : "rectangle"
    : shape.type === "ellipse" && shape.width === shape.height
    ? "circle"
    : shape.type;

const SCRIPT = "Plan the lesson\nTeach it\nSet the task\nCheck the work";

describe("AC-255 the shape of a node can be changed", () => {
  it("AC-255 the chart-wide shape applies to every node", () => {
    const expected = {
      rectangle: "rectangle",
      rounded: "rounded",
      ellipse: "ellipse",
      circle: "circle",
      diamond: "diamond",
    } as const;

    expect([...FLOW_NODE_SHAPES]).toEqual(Object.keys(expected));

    for (const shape of FLOW_NODE_SHAPES) {
      const nodes = nodesOf(build("process", SCRIPT, shape));

      expect(nodes).toHaveLength(4);

      for (const node of nodes) {
        // a circle is an ellipse that is as wide as it is high
        expect(kindOf(node), shape).toBe(expected[shape]);
      }
    }

    // the preset's own is what each preset draws: a question is a diamond
    const own = build("decision", "? Ready?\nGo\nWait", "own");

    expect(kindOf(byLabel(own, "Ready?"))).toBe("diamond");
    expect(kindOf(byLabel(own, "Go"))).toBe("rounded");
  });

  it("AC-255 a circle has equal width and height", () => {
    for (const preset of FLOW_PRESET_IDS) {
      const script =
        preset === "tiers"
          ? "A | B | C\nD | E"
          : preset === "network"
          ? "A -> B\nB -> C\nC -> A"
          : "Alpha\nBeta\nGamma\nDelta";

      for (const node of nodesOf(build(preset, script, "circle"))) {
        expect(node.width, `${preset} ${node.id}`).toBeCloseTo(node.height, 5);
        expect(node.type).toBe("ellipse");
      }
    }
  });

  it("AC-255 the marks set one node's shape and win over the chart's", () => {
    const elements = build(
      "process",
      "[Plan]\n(Teach)\n((Review))\n{Practise}\n<Check>\nPlain",
      "diamond",
    );

    expect(kindOf(byLabel(elements, "Plan"))).toBe("rectangle");
    expect(kindOf(byLabel(elements, "Teach"))).toBe("rounded");
    expect(kindOf(byLabel(elements, "Review"))).toBe("ellipse");
    expect(kindOf(byLabel(elements, "Practise"))).toBe("circle");
    expect(kindOf(byLabel(elements, "Check"))).toBe("diamond");
    // a line with no mark takes the chart's shape
    expect(kindOf(byLabel(elements, "Plain"))).toBe("diamond");

    // the mark is not part of the words
    expect(textOf(elements, byLabel(elements, "Plan")).text).toBe("Plan");
  });

  it("AC-255 the marks work with the rest of the script", () => {
    // a question, its branches
    const decision = build("decision", "? (Ready?)\n[Go]\n{Wait}");

    expect(kindOf(byLabel(decision, "Ready?"))).toBe("rounded");
    expect(kindOf(byLabel(decision, "Go"))).toBe("rectangle");
    expect(kindOf(byLabel(decision, "Wait"))).toBe("circle");

    const parsed = parseFlowScript("decision", "? (Ready?)\n[Go]\n{Wait}");

    expect(parsed.ok && parsed.edges.map((e) => e.label)).toEqual([
      "yes",
      "no",
    ]);

    // an edge: a node takes the mark the first time its label is seen
    const network = parseFlowScript("network", "[A] -> {B}\nA -> C\n(B) -> C");

    expect(network.ok).toBe(true);

    if (network.ok) {
      expect(network.nodes.map((n) => [n.label, n.shape])).toEqual([
        ["A", "rectangle"],
        ["B", "circle"],
        ["C", undefined],
      ]);
      expect(network.edges).toHaveLength(3);
    }

    // the items of a tier
    const tiers = parseFlowScript("tiers", "[a] | (b)\nc");

    expect(tiers.ok && tiers.nodes.map((n) => n.shape)).toEqual([
      "rectangle",
      "rounded",
      undefined,
    ]);

    // the hub
    const hub = build("integration", "{Hub}\nA\nB");

    expect(kindOf(byLabel(hub, "Hub"))).toBe("circle");
    expect(kindOf(byLabel(hub, "A"))).toBe("rounded");
  });

  it("AC-255 an unclosed mark is a problem with its line", () => {
    const parsed = parseFlowScript("process", "Plan\n[Teach\n\nReview");

    expect(parsed.ok).toBe(true);

    if (parsed.ok) {
      // the second line of the text, blank lines counted
      expect(parsed.problems).toEqual([
        { line: 2, message: expect.stringContaining("not closed") },
      ]);
      // the words are kept as they were written
      expect(parsed.nodes[1].label).toBe("[Teach");
    }

    // a label that only starts with a bracket is plain text
    const plain = parseFlowScript("process", "(draft) plan\nShip");

    expect(plain.ok && plain.problems).toEqual([]);
    expect(plain.ok && plain.nodes[0].label).toBe("(draft) plan");
  });

  it("AC-255 a node grows so that its text lies inside every shape", () => {
    const LABELS = "Short\nA rather longer label than the others\nTwo words";

    for (const shape of FLOW_NODE_SHAPES) {
      const elements = build("process", LABELS, shape);

      for (const node of nodesOf(elements)) {
        const text = textOf(elements, node);
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;

        // every corner of the text's own box, measured from the centre
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const dx = Math.abs(
              text.x + text.width / 2 + (sx * text.width) / 2 - cx,
            );
            const dy = Math.abs(
              text.y + text.height / 2 + (sy * text.height) / 2 - cy,
            );
            const rx = dx / (node.width / 2);
            const ry = dy / (node.height / 2);

            const inside =
              shape === "diamond"
                ? rx + ry
                : shape === "ellipse" || shape === "circle"
                ? Math.hypot(rx, ry)
                : Math.max(rx, ry);

            // inside, with a margin: not on the edge
            expect(inside, `${shape} ${text.text}`).toBeLessThan(0.95);
          }
        }
      }
    }
  });

  it("AC-255 a circle grows to the larger of the two sizes", () => {
    const wide = build(
      "process",
      "A label that is wide and not high",
      "circle",
    );
    const circle = nodesOf(wide)[0];
    const text = textOf(wide, circle);

    // sides are equal, and the diagonal of the text's box fits in the diameter
    expect(circle.width).toBeCloseTo(circle.height, 5);
    expect(circle.width).toBeGreaterThan(
      Math.hypot(text.width, text.height) - 1e-6,
    );
    // far larger than the text is high: it grew to the wide side
    expect(circle.height).toBeGreaterThan(text.height * 2);
  });

  it("AC-255 highlights and arrows follow the new shapes", () => {
    const elements = build("process", SCRIPT, "circle");

    for (const node of nodesOf(elements)) {
      expect(highlightShapeOf(node).kind).toBe("ellipse");
    }

    const diamonds = build("process", SCRIPT, "diamond");

    for (const node of nodesOf(diamonds)) {
      expect(highlightShapeOf(node).kind).toBe("diamond");
    }

    // an arrow is bound at both ends to the shapes it joins, whatever they are
    for (const chart of [elements, diamonds]) {
      const ids = new Set(nodesOf(chart).map((n) => n.id));
      const arrows = chart.filter((e) => e.type === "arrow");

      expect(arrows).toHaveLength(3);

      for (const arrow of arrows) {
        if (arrow.type !== "arrow") {
          continue;
        }

        expect(ids.has(arrow.startBinding!.elementId)).toBe(true);
        expect(ids.has(arrow.endBinding!.elementId)).toBe(true);
      }
    }
  });

  it("AC-255 shapes survive apply unless changed", () => {
    const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };
    const make = (script: string, shape: FlowChartShape = "own") => {
      const built = buildFlowPreset("process", script, {
        seed: 3,
        page: PAGE,
        chartId: "chart-shapes",
        shape,
      });

      if (!built.ok) {
        throw new Error(built.error);
      }

      return built.elements;
    };
    const apply = (
      elements: readonly ExcalidrawElement[],
      script: string,
      shape: FlowChartShape = "own",
    ) => {
      const result = applyFlowScript({
        elements,
        chartId: "chart-shapes",
        preset: "process",
        script,
        fit: "page",
        shape,
        page: PAGE,
        seed: 8,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      return result;
    };

    const before = make("[Plan]\n(Teach)\nReview");
    // the teacher recoloured a shape
    const marked = before.map((element) =>
      element.id === byLabel(before, "Plan").id
        ? ({ ...element, backgroundColor: "#ff6b6b" } as ExcalidrawElement)
        : element,
    );

    // nothing about the shapes changed: they are the same elements
    const same = apply(marked, "[Plan]\n(Teach)\nReview\nMore");

    for (const label of ["Plan", "Teach", "Review"]) {
      const was = byLabel(before, label);
      const is = byLabel(same.elements, label);

      expect(is.id).toBe(was.id);
      expect(is.type).toBe(was.type);
      expect(is.width).toBe(was.width);
    }

    expect(byLabel(same.elements, "Plan").backgroundColor).toBe("#ff6b6b");

    // its mark was changed: that node is the new shape, and keeps its id and colour
    const changed = apply(marked, "((Plan))\n(Teach)\nReview");
    const plan = byLabel(changed.elements, "Plan");

    expect(plan.id).toBe(byLabel(before, "Plan").id);
    expect(kindOf(plan)).toBe("ellipse");
    expect(plan.backgroundColor).toBe("#ff6b6b");
    // the others are as they were
    expect(byLabel(changed.elements, "Teach").id).toBe(
      byLabel(before, "Teach").id,
    );
    expect(kindOf(byLabel(changed.elements, "Teach"))).toBe("rounded");

    // its text is still inside it
    const text = textOf(changed.elements, plan);

    expect(text.x).toBeGreaterThanOrEqual(plan.x);
    expect(text.x + text.width).toBeLessThanOrEqual(plan.x + plan.width);

    // the chart-wide shape was changed: the chart is rebuilt in that shape
    const wide = apply(marked, "[Plan]\n(Teach)\nReview", "circle");

    expect(wide.rebuilt).toBe(true);
    // the marks still win over the chart's
    expect(kindOf(byLabel(wide.elements, "Plan"))).toBe("rectangle");
    expect(kindOf(byLabel(wide.elements, "Review"))).toBe("circle");
  });
});
