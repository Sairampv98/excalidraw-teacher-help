/**
 * AC-257 - a chart can be drawn without arrows (D-231).
 *
 * Every kind of chart is built twice, with the arrows and without, and what is
 * drawn is compared.
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { applyFlowScript } from "../scene/flowApply";
import { readChartRecord } from "../scene/flowChart";
import { buildSettingsOfCustom } from "../scene/flowCustomPresets";
import { FLOW_PRESETS, buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import type { FlowCustomPreset } from "../scene/flowCustomPresets";

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

const roleOf = (element: ExcalidrawElement) =>
  element.customData?.flow?.role as string | undefined;

/** what is drawn between the shapes: arrows, connectors and their labels (D-231) */
const joins = (elements: readonly ExcalidrawElement[]) =>
  elements.filter(
    (element) => roleOf(element) === "edge" || roleOf(element) === "edge-label",
  );

const shapes = (elements: readonly ExcalidrawElement[]) =>
  elements.filter(
    (element) =>
      !element.isDeleted &&
      element.type !== "arrow" &&
      element.type !== "text" &&
      roleOf(element) === "node",
  );

const words = (elements: readonly ExcalidrawElement[]) =>
  elements
    .filter((element) => element.type === "text" && roleOf(element) === "label")
    .map((element) => (element as { originalText: string }).originalText)
    .sort();

const build = (
  preset: typeof FLOW_PRESETS[number],
  arrows?: "own" | "none",
  extra: Partial<Parameters<typeof buildFlowPreset>[2]> = {},
) => {
  const built = buildFlowPreset(preset.id, preset.example, {
    seed: 4,
    page: PAGE,
    arrows,
    ...extra,
  });

  if (!built.ok) {
    throw new Error(`${preset.id}: ${built.error}`);
  }

  return built.elements;
};

describe("AC-257 a chart can be drawn without arrows", () => {
  it("AC-257 none draws no arrows for any preset", () => {
    expect(FLOW_PRESETS.length).toBe(16);

    for (const preset of FLOW_PRESETS) {
      const plain = build(preset, "own");
      const none = build(preset, "none");

      // no arrow, no connector and no yes or no label ...
      expect(joins(none), preset.id).toHaveLength(0);
      // ... and the same shapes with the same words
      expect(shapes(none), preset.id).toHaveLength(shapes(plain).length);
      expect(words(none), preset.id).toEqual(words(plain));
    }

    // the kinds that draw joins have something to take away
    const decision = FLOW_PRESETS.find((p) => p.id === "decision")!;

    expect(joins(build(decision, "own")).length).toBeGreaterThan(0);

    // a timeline keeps its line: it is not a join between shapes
    const timeline = FLOW_PRESETS.find((p) => p.id === "timeline")!;

    expect(
      build(timeline, "none").some((e) => roleOf(e) === "timeline-line"),
    ).toBe(true);
  });

  it("AC-257 the default is as the preset draws", () => {
    for (const preset of FLOW_PRESETS) {
      const asked = build(preset, "own");
      const left = build(preset, undefined);

      expect(left, preset.id).toEqual(asked);
    }
  });

  it("AC-257 the setting is remembered on the chart", () => {
    const process = FLOW_PRESETS.find((p) => p.id === "process")!;

    for (const arrows of ["own", "none"] as const) {
      const elements = build(process, arrows, { chartId: "chart-arrows" });
      const record = elements
        .map((e) => readChartRecord(e))
        .find((r) => r !== null)!;

      expect(record.arrows).toBe(arrows);
    }

    // a custom preset can set it for the charts made from it
    const custom: FlowCustomPreset = {
      id: "custom-no-arrows",
      name: "No arrows",
      description: "",
      example: "A\nB\nC",
      layout: "top-down",
      colours: { fills: ["#a5d8ff"], outline: "#1e1e1e" },
      shape: "own",
      arrows: "none",
    };
    const { builtIn, options } = buildSettingsOfCustom(custom);

    expect(options.arrows).toBe("none");

    const built = buildFlowPreset(builtIn, custom.example, {
      seed: 4,
      page: PAGE,
      chartId: "chart-custom",
      custom,
      ...options,
    });

    expect(built.ok && joins(built.elements)).toHaveLength(0);
    expect(
      built.ok &&
        built.elements.map((e) => readChartRecord(e)).find((r) => r)?.arrows,
    ).toBe("none");
  });

  it("AC-257 changing it rebuilds in place", () => {
    const process = FLOW_PRESETS.find((p) => p.id === "process")!;
    const before = build(process, "own", { chartId: "chart-switch" });

    expect(joins(before).length).toBeGreaterThan(0);

    const apply = (
      elements: readonly ExcalidrawElement[],
      arrows: "own" | "none",
    ) => {
      const result = applyFlowScript({
        elements,
        chartId: "chart-switch",
        preset: "process",
        script: process.example,
        fit: "page",
        shape: "own",
        arrows,
        page: PAGE,
        seed: 9,
      });

      if (!result.ok) {
        throw new Error(result.error);
      }

      return result;
    };

    const none = apply(before, "none");

    expect(none.rebuilt).toBe(true);
    expect(joins(none.elements.filter((e) => !e.isDeleted))).toHaveLength(0);
    expect(shapes(none.elements)).toHaveLength(shapes(before).length);

    // and back
    const back = apply(none.elements, "own");

    expect(back.rebuilt).toBe(true);
    expect(joins(back.elements.filter((e) => !e.isDeleted)).length).toBe(
      joins(before).length,
    );

    // the same setting is an ordinary in-place change
    const same = apply(before, "own");

    expect(same.rebuilt).toBe(false);
  });

  it("AC-257 the steps are in reading order", () => {
    const list = FLOW_PRESETS.find((p) => p.id === "list")!;
    const process = FLOW_PRESETS.find((p) => p.id === "process")!;

    for (const preset of [list, process]) {
      // a chart of the studio: its id is what ties its shapes into one flow
      const elements = build(preset, "none", { chartId: "chart-order" });
      const map = new Map(elements.map((e) => [e.id, e]));
      const graph = flowOfSelection(
        Object.fromEntries(elements.map((e) => [e.id, true])),
        elements,
        map,
      )!;

      // nothing joins the shapes, and they are walked as they are read
      expect(graph.edges, preset.id).toHaveLength(0);

      const order = graph.steps.map((step) => {
        const shape = map.get(step.containerId)!;
        const text = elements.find(
          (e) => e.type === "text" && e.containerId === shape.id,
        ) as { originalText: string };

        return text.originalText;
      });

      expect(order, preset.id).toEqual(preset.example.split("\n"));
    }
  });
});
