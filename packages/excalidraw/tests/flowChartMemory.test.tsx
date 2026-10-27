/**
 * AC-247 - a chart remembers its script (D-221).
 *
 * The chart is built by the real builder and read back as elements, through a
 * real save and load of the document.
 */

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";
import {
  chartElementsOf,
  chartRecordOf,
  readChartId,
  readChartRecord,
  rebuildFlowScript,
} from "../scene/flowChart";
import { buildFlowPreset } from "../scene/flowPresets";
import { flowOfSelection } from "../scene/flowSelection";

import type { FlowPresetId } from "../scene/flowScript";

const build = (
  preset: FlowPresetId,
  script: string,
  options: Parameters<typeof buildFlowPreset>[2] = {},
) => {
  const built = buildFlowPreset(preset, script, { seed: 4, ...options });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements;
};

const SCRIPT = "Plan the lesson\nTeach it\nSet the task";

const flowElements = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((element) => element.customData?.flow);

describe("AC-247 a chart remembers its script", () => {
  it("AC-247 an inserted chart carries its script and settings", () => {
    const elements = build("process", SCRIPT, {
      chartId: "chart-1",
      fit: "spread",
      shape: "circle",
    });

    // every element of the chart is tied to it
    for (const element of flowElements(elements)) {
      expect(readChartId(element)).toBe("chart-1");
    }

    // and one shape holds the record
    const records = elements
      .map((element) => readChartRecord(element))
      .filter(Boolean);

    expect(records).toEqual([
      {
        id: "chart-1",
        preset: "process",
        script: SCRIPT,
        fit: "spread",
        shape: "circle",
      },
    ]);

    // it is the chart's first shape
    const first = elements.find(
      (element) => element.type !== "arrow" && element.type !== "text",
    )!;

    expect(readChartRecord(first)).not.toBeNull();

    // and the record is found from any element of the chart
    for (const element of flowElements(elements)) {
      expect(chartRecordOf(element, elements)?.script).toBe(SCRIPT);
    }

    expect(chartElementsOf("chart-1", elements)).toHaveLength(
      flowElements(elements).length,
    );
    expect(chartElementsOf("another", elements)).toHaveLength(0);
  });

  it("AC-247 they survive saving and loading", () => {
    const elements = build("decision", "? Ready?\nGo\nWait", {
      chartId: "chart-2",
      shape: "diamond",
    });

    const saved = JSON.stringify(elements);
    const loaded = restoreElements(JSON.parse(saved), null);

    const record = chartRecordOf(loaded[0], loaded);

    expect(record).toEqual({
      id: "chart-2",
      preset: "decision",
      script: "? Ready?\nGo\nWait",
      fit: "page",
      shape: "diamond",
    });
  });

  it("AC-247 the elements are still ordinary", () => {
    const plain = build("process", SCRIPT);
    const remembered = build("process", SCRIPT, { chartId: "chart-3" });

    expect(remembered).toHaveLength(plain.length);

    // every element is the same but for what the chart remembers
    const strip = (element: ExcalidrawElement) => {
      const { customData, ...rest } = element;
      const { chartId, chart, ...flow } = (customData?.flow ?? {}) as Record<
        string,
        unknown
      >;

      return { ...rest, flow };
    };

    expect(remembered.map(strip)).toEqual(plain.map(strip));

    // and only the kinds of element a drawing is made of
    for (const element of remembered) {
      expect(["rectangle", "ellipse", "diamond", "text", "arrow"]).toContain(
        element.type,
      );
    }

    // a chart built with no id remembers nothing
    expect(plain.some((element) => readChartId(element))).toBe(false);
  });

  it("AC-247 an older chart's script is rebuilt from the page", () => {
    const rebuilt = (preset: FlowPresetId, script: string) => {
      const elements = build(preset, script);
      const map = new Map(elements.map((element) => [element.id, element]));
      const graph = flowOfSelection(
        Object.fromEntries(elements.map((element) => [element.id, true])),
        elements,
        map,
      )!;

      return rebuildFlowScript(graph, map);
    };

    // a run of steps is a process
    expect(rebuilt("process", SCRIPT)).toEqual({
      preset: "process",
      script: SCRIPT,
    });

    // one that returns to its first step is a cycle
    expect(rebuilt("cycle", SCRIPT)).toEqual({
      preset: "cycle",
      script: SCRIPT,
    });

    // anything else is its arrows, as A -> B lines
    const network = rebuilt("network", "A -> B\nA -> C\nB -> C");

    expect(network.preset).toBe("network");
    expect(network.script.split("\n").sort()).toEqual([
      "A -> B",
      "A -> C",
      "B -> C",
    ]);

    // a branching chart too
    expect(rebuilt("decision", "? Ready?\nGo\nWait").preset).toBe("network");
  });
});
