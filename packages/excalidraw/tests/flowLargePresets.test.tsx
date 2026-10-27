/**
 * AC-253 - all seven presets build very large charts (D-227).
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { MIN_FLOW_FONT_SIZE, buildFlowPreset } from "../scene/flowPresets";
import { FLOW_PRESET_IDS } from "../scene/flowScript";
import { flowOfSelection } from "../scene/flowSelection";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../types";

import {
  expectArrowsBound,
  expectNoOverlap,
  nodeCountOf,
  nodesOf,
  pageIndexOf,
  scriptOfSize,
} from "./helpers/flowLargeHelpers";

import type { FlowFitMode } from "../scene/flowChart";
import type { FlowPageRect } from "../scene/flowPresets";
import type { FlowPresetId } from "../scene/flowScript";

const PAGE: FlowPageRect = {
  x: 0,
  y: 0,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
};

const COUNT = 150;

const build = (preset: FlowPresetId, count: number, fit: FlowFitMode) =>
  buildFlowPreset(preset, scriptOfSize(preset, count, true), {
    seed: 6,
    page: PAGE,
    fit,
  });

describe("AC-253 all seven presets build very large charts", () => {
  it("AC-253 each preset builds 150 nodes in each fit mode", () => {
    for (const preset of FLOW_PRESET_IDS) {
      for (const fit of ["spread", "larger"] as const) {
        // the best of three: a busy machine slows a run, and the question is
        // how long the build takes, not how busy the machine was
        let took = Infinity;
        let built = build(preset, COUNT, fit);

        for (let run = 0; run < 3; run++) {
          const started = performance.now();

          built = build(preset, COUNT, fit);
          took = Math.min(took, performance.now() - started);
        }

        expect(built.ok, `${preset} ${fit}`).toBe(true);

        if (!built.ok) {
          continue;
        }

        const nodes = nodesOf(built.elements);

        expect(nodes, `${preset} ${fit}`).toHaveLength(
          nodeCountOf(preset, COUNT),
        );

        // no two shapes overlap, the text is at or above the floor, every arrow
        // between shapes is bound at both ends
        expectNoOverlap(built.elements);
        expect(built.fontSize).toBeGreaterThanOrEqual(MIN_FLOW_FONT_SIZE);
        expectArrowsBound(built.elements);

        // and it does not take long
        expect(
          took,
          `${preset} ${fit} took ${Math.round(took)} ms`,
        ).toBeLessThan(1000);
      }
    }
  });

  it("AC-253 a long process wraps into rows", () => {
    // a chain too long for one line goes back and forth, and stays on its page
    const built = build("process", 40, "page");

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }

    const nodes = nodesOf(built.elements);
    const rows = new Set(nodes.map((node) => Math.round(node.y)));
    const columns = new Set(nodes.map((node) => Math.round(node.x)));

    expect(rows.size).toBeGreaterThan(1);
    expect(columns.size).toBeGreaterThan(1);
    expect(built.bounds.width).toBeLessThanOrEqual(PAGE.width);
    expect(built.bounds.height).toBeLessThanOrEqual(PAGE.height);

    // the rows run the other way in turn: the first step of the second row is
    // under the last step of the first
    const sorted = [...nodes].sort(
      (a, b) =>
        Number(a.customData!.flow.nodeId.slice(1)) -
        Number(b.customData!.flow.nodeId.slice(1)),
    );
    const firstRow = sorted.filter(
      (n) => Math.round(n.y) === Math.round(sorted[0].y),
    );
    const last = firstRow[firstRow.length - 1];
    const next = sorted[firstRow.length];

    expect(
      Math.abs(next.x + next.width / 2 - (last.x + last.width / 2)),
    ).toBeLessThan(1);

    // a short chain is still in a line
    const short = build("process", 4, "page");

    expect(short.ok).toBe(true);

    if (short.ok) {
      const ys = new Set(nodesOf(short.elements).map((n) => Math.round(n.y)));
      const xs = new Set(nodesOf(short.elements).map((n) => Math.round(n.x)));

      expect(ys.size === 1 || xs.size === 1).toBe(true);
    }
  });

  it("AC-253 a long cycle stays a ring", () => {
    const built = build("cycle", 60, "larger");

    expect(built.ok).toBe(true);

    if (!built.ok) {
      return;
    }

    const nodes = nodesOf(built.elements);
    const cx =
      nodes.reduce((sum, n) => sum + n.x + n.width / 2, 0) / nodes.length;
    const cy =
      nodes.reduce((sum, n) => sum + n.y + n.height / 2, 0) / nodes.length;

    // every step is at the same distance from the middle, on an ellipse wider than high
    const distances = nodes.map((n) =>
      Math.hypot((n.x + n.width / 2 - cx) / 1.5, n.y + n.height / 2 - cy),
    );
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;

    for (const distance of distances) {
      expect(Math.abs(distance - mean) / mean).toBeLessThan(0.05);
    }

    // and the loop comes back: the last step leads to the first
    const arrows = built.elements.filter((e) => e.type === "arrow");

    expect(arrows).toHaveLength(60);
  });

  it("AC-253 the step order follows the chart across rows and pages", () => {
    const labelsInOrder = (elements: readonly ExcalidrawElement[]) => {
      const map = new Map(elements.map((e) => [e.id, e]));
      const graph = flowOfSelection(
        Object.fromEntries(elements.map((e) => [e.id, true])),
        elements,
        map,
      )!;

      return graph.steps.map((step) => {
        const shape = map.get(step.containerId)!;
        const text = elements.find(
          (e) => e.type === "text" && e.containerId === shape.id,
        );

        return text && text.type === "text" ? text.originalText : "";
      });
    };

    const expected = (count: number) =>
      Array.from(
        { length: count },
        (_, i) => `Item ${i + 1} of the long lesson plan`,
      );

    // across rows
    const wrapped = build("process", 40, "page");

    expect(wrapped.ok && labelsInOrder(wrapped.elements)).toEqual(expected(40));

    // across pages: the animation walks one page and then the next
    const spread = build("process", COUNT, "spread");

    expect(spread.ok).toBe(true);

    if (spread.ok) {
      expect(spread.pages).toBeGreaterThan(1);
      expect(nodesOf(spread.elements).map(pageIndexOf)).toEqual(
        [...nodesOf(spread.elements).map(pageIndexOf)].sort((a, b) => a - b),
      );
      expect(labelsInOrder(spread.elements).slice(0, 5)).toEqual(expected(5));
    }
  });
});
