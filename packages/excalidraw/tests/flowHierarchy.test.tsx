/**
 * AC-261 - a hierarchy is a tree with connector lines (D-236).
 */

import { describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { checkFlowScript } from "../scene/flowCheck";
import { buildFlowPreset } from "../scene/flowPresets";
import { parseFlowScript } from "../scene/flowScript";

import { expectNoOverlap, nodesOf } from "./helpers/flowLargeHelpers";

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

const TREE =
  "Principal\n  Maths\n    Teacher A\n    Teacher B\n  Art\n    Teacher C";

const nodes = (script: string) => {
  const parsed = parseFlowScript("hierarchy", script);

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  return parsed;
};

const build = (script: string) => {
  const built = buildFlowPreset("hierarchy", script, { seed: 3, page: PAGE });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built;
};

const cell = (elements: readonly ExcalidrawElement[], label: string) =>
  nodesOf(elements).find(
    (n) =>
      (
        elements.find(
          (e): e is ExcalidrawTextElement =>
            e.type === "text" && e.containerId === n.id,
        ) as ExcalidrawTextElement
      ).originalText === label,
  )!;

describe("AC-261 a hierarchy is a tree with connector lines", () => {
  it("AC-261 indentation makes the levels", () => {
    const parsed = nodes(TREE);

    expect(parsed.nodes.map((n) => [n.label, n.depth])).toEqual([
      ["Principal", 0],
      ["Maths", 1],
      ["Teacher A", 2],
      ["Teacher B", 2],
      ["Art", 1],
      ["Teacher C", 2],
    ]);

    // a node is joined to the nearest line above it with one level less
    const label = (id: string) => parsed.nodes.find((n) => n.id === id)!.label;

    expect(
      parsed.edges.map((e) => `${label(e.from)} > ${label(e.to)}`),
    ).toEqual([
      "Principal > Maths",
      "Maths > Teacher A",
      "Maths > Teacher B",
      "Principal > Art",
      "Art > Teacher C",
    ]);

    // a tab is a level, and two spaces are a level
    expect(nodes("Root\n\tA\n\t\tB\n  C").nodes.map((n) => n.depth)).toEqual([
      0, 1, 2, 1,
    ]);
  });

  it("AC-261 children are under their parent in order", () => {
    const { elements } = build(TREE);
    const a = cell(elements, "Teacher A");
    const b = cell(elements, "Teacher B");
    const c = cell(elements, "Teacher C");
    const maths = cell(elements, "Maths");
    const art = cell(elements, "Art");
    const root = cell(elements, "Principal");

    // a parent is over its children
    for (const [parent, child] of [
      [root, maths],
      [root, art],
      [maths, a],
      [maths, b],
      [art, c],
    ]) {
      expect(child.y).toBeGreaterThanOrEqual(parent.y + parent.height);
    }

    // the children of a node are in the order of the script, left to right
    expect(a.x).toBeLessThan(b.x);
    expect(maths.x).toBeLessThan(art.x);

    // and the levels are rows
    expect(Math.round(a.y)).toBe(Math.round(b.y));
    expect(Math.round(maths.y)).toBe(Math.round(art.y));

    expectNoOverlap(elements);
  });

  it("AC-261 connectors have no arrowhead and are bound at both ends", () => {
    const { elements } = build(TREE);
    const connectors = elements.filter(
      (e) => e.type === "arrow" && e.customData?.flow?.role === "edge",
    );
    const byId = new Map(elements.map((e) => [e.id, e]));

    expect(connectors).toHaveLength(5);

    for (const connector of connectors) {
      if (connector.type !== "arrow") {
        continue;
      }

      expect(connector.startArrowhead).toBeNull();
      expect(connector.endArrowhead).toBeNull();

      for (const binding of [connector.startBinding, connector.endBinding]) {
        const shape = byId.get(binding!.elementId)!;

        expect(shape).toBeTruthy();
        // and the shape names the connector back, so it follows a moved shape
        expect(shape.boundElements?.some((b) => b.id === connector.id)).toBe(
          true,
        );
      }
    }
  });

  it("AC-261 a jump of levels and an indented first line are problems", () => {
    expect(checkFlowScript("hierarchy", "Root\n    Deep").problems).toEqual([
      expect.objectContaining({ line: 2 }),
    ]);
    expect(checkFlowScript("hierarchy", "  Root\nChild").problems).toEqual([
      expect.objectContaining({ line: 1 }),
    ]);

    // the lines are still read: the jump is one level under its parent, the
    // indented first line is the root
    expect(nodes("Root\n    Deep").nodes.map((n) => n.depth)).toEqual([0, 1]);
    expect(nodes("  Root\nChild").nodes.map((n) => n.depth)).toEqual([0, 0]);

    // a clean tree has none
    expect(checkFlowScript("hierarchy", TREE).problems).toEqual([]);
    expect(checkFlowScript("hierarchy", TREE).ok).toBe(true);
  });

  it("AC-261 the tree fits the page", () => {
    // a root with twelve children
    const lines = ["The whole school"];

    for (let i = 1; i <= 12; i++) {
      lines.push(`  Class ${i}`);
    }

    const built = build(lines.join("\n"));

    expect(nodesOf(built.elements)).toHaveLength(13);
    expect(built.bounds.x).toBeGreaterThanOrEqual(PAGE.x);
    expect(built.bounds.x + built.bounds.width).toBeLessThanOrEqual(PAGE.width);
    expect(built.bounds.y + built.bounds.height).toBeLessThanOrEqual(
      PAGE.height,
    );
    // not below the floor
    expect(built.fontSize).toBeGreaterThanOrEqual(14);
    expectNoOverlap(built.elements);
  });
});
