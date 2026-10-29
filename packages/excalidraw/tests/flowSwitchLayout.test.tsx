/**
 * AC-263 - switching layout keeps the words (D-233).
 *
 * Scripts are converted by the real converter and read back by the real parser;
 * the editor is used the way a teacher uses it.
 */

import React from "react";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import {
  closeFlowScriptEditor,
  openFlowScriptEditor,
} from "../components/FlowScriptEditorState";
import { Excalidraw } from "../index";
import { convertScript } from "../scene/flowConvert";
import { readChartRecord } from "../scene/flowChart";
import { FLOW_PRESETS, buildFlowPreset } from "../scene/flowPresets";
import { ALL_FLOW_PRESET_IDS, parseFlowScript } from "../scene/flowScript";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

import type { FlowPresetId } from "../scene/flowScript";

const { h } = window;

const exampleOf = (id: FlowPresetId) =>
  FLOW_PRESETS.find((p) => p.id === id)!.example;

const read = (preset: FlowPresetId, script: string) => {
  const parsed = parseFlowScript(preset, script);

  if (!parsed.ok) {
    throw new Error(`${preset}: ${parsed.error}`);
  }

  return parsed;
};

const labels = (preset: FlowPresetId, script: string) =>
  read(preset, script).nodes.map((n) => n.label);

describe("AC-263 switching layout keeps the words", () => {
  afterEach(() => {
    act(() => {
      closeFlowScriptEditor();
    });
  });

  it("AC-263 the words come across in order for every pair of kinds", () => {
    for (const from of ALL_FLOW_PRESET_IDS) {
      const script = exampleOf(from);
      const words = labels(from, script);

      for (const to of ALL_FLOW_PRESET_IDS) {
        const converted = convertScript(from, script, to);
        const after = labels(to, converted);

        // every word, once; in the same order - but a network puts a node where it
        // is first met, and a tree made into rows reads level by level
        const byLevel =
          from === "hierarchy" && ["tiers", "grid", "matrix"].includes(to);

        if (to === "network" || byLevel) {
          expect([...after].sort(), `${from} to ${to}`).toEqual(
            [...words].sort(),
          );
        } else {
          expect(after, `${from} to ${to}`).toEqual(words);
        }
      }
    }
  });

  it("AC-263 shape keywords come across", () => {
    const script = "@circle Plan\nTeach\n<Review>";

    for (const to of ALL_FLOW_PRESET_IDS) {
      const converted = convertScript("process", script, to);
      const nodes = read(to, converted).nodes;
      const shapeOf = (label: string) =>
        nodes.find((n) => n.label === label)?.shape;

      expect(shapeOf("Plan"), to).toBe("circle");
      expect(shapeOf("Teach"), to).toBeUndefined();
      expect(shapeOf("Review"), to).toBe("diamond");
    }
  });

  it("AC-263 rows and tiers become rows", () => {
    // tiers to a grid, and the other way
    expect(convertScript("tiers", "a | b\nc", "grid")).toBe("a | b\nc");
    expect(convertScript("grid", "a | b\nc", "tiers")).toBe("a | b\nc");

    // a grid with a header keeps it as a header when it stays a grid or a matrix
    // is made, and loses the mark when it becomes tiers
    expect(convertScript("grid", "# H1 | H2\nx | y", "tiers")).toBe(
      "H1 | H2\nx | y",
    );

    // a matrix is two columns: a wider row is cut into rows of two
    expect(convertScript("grid", "a | b | c\nd | e", "matrix")).toBe(
      "a | b\nc\nd | e",
    );

    // a list is made into rows of three for a grid, two for a matrix
    expect(convertScript("list", "1\n2\n3\n4\n5", "grid")).toBe(
      "1 | 2 | 3\n4 | 5",
    );
    expect(convertScript("list", "1\n2\n3\n4\n5", "matrix")).toBe(
      "1 | 2\n3 | 4\n5",
    );

    // a hierarchy's levels are its rows
    expect(convertScript("hierarchy", "R\n  A\n  B\n    C", "tiers")).toBe(
      "R\nA | B\nC",
    );
  });

  it("AC-263 arrows are kept for a network", () => {
    // a run of steps: each joined to the next
    expect(convertScript("process", "A\nB\nC", "network")).toBe(
      "A -> B\nB -> C",
    );

    // a loop comes round
    expect(convertScript("cycle", "A\nB\nC", "network")).toBe(
      "A -> B\nB -> C\nC -> A",
    );

    // a decision keeps every arrow it had
    const decision = exampleOf("decision");
    const was = read("decision", decision);
    const network = read(
      "network",
      convertScript("decision", decision, "network"),
    );

    expect(network.edges).toHaveLength(was.edges.length);

    // a network goes on being the same network when it is made a list and back
    const net = "A -> B\nB -> C\nC -> A";

    expect(
      labels(
        "network",
        convertScript("list", convertScript("network", net, "list"), "network"),
      ),
    ).toEqual(["A", "B", "C"]);
  });

  it("AC-263 a list and a hierarchy", () => {
    // a list is the first level of a hierarchy, under its first line
    expect(convertScript("list", "Head\nA\nB", "hierarchy")).toBe(
      "Head\n  A\n  B",
    );
    expect(read("hierarchy", "Head\n  A\n  B").edges).toHaveLength(2);

    // a hierarchy is a list in reading order
    expect(convertScript("hierarchy", "R\n  A\n    A1\n  B", "list")).toBe(
      "R\nA\nA1\nB",
    );

    // and a hierarchy stays as it was
    const tree = exampleOf("hierarchy");

    expect(convertScript("hierarchy", tree, "hierarchy")).toBe(tree);
  });

  it("AC-263 the converted script always builds", () => {
    for (const from of ALL_FLOW_PRESET_IDS) {
      for (const to of ALL_FLOW_PRESET_IDS) {
        const converted = convertScript(from, exampleOf(from), to);
        // a converted script can have more rings or sets than a target or a venn
        // takes, and more than one page holds: it is built to be as large as it is
        const built = buildFlowPreset(to, converted, {
          seed: 2,
          fit: "larger",
        });

        expect(built.ok, `${from} to ${to}`).toBe(true);
      }
    }

    // a script that cannot be read is given back as it was
    expect(convertScript("process", "   \n", "grid")).toBe("   \n");
  });

  it("AC-263 the editor switches the kind and keeps the words", async () => {
    const SCRIPT = "Plan the lesson\nTeach it\nCheck the work";
    const built = buildFlowPreset("process", SCRIPT, {
      seed: 4,
      chartId: "chart-switch-editor",
    });

    if (!built.ok) {
      throw new Error(built.error);
    }

    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        initialData={{ elements: built.elements as never }}
      />,
    );

    act(() => {
      h.setState({ width: 1400, height: 900 });
    });

    const live = () => h.elements.filter((e) => !e.isDeleted);
    const shapes = () =>
      live().filter(
        (e) =>
          e.type !== "arrow" &&
          e.type !== "text" &&
          e.customData?.flow?.role === "node",
      );
    const wordsOnThePage = () =>
      live()
        .filter(
          (e): e is ExcalidrawTextElement =>
            e.type === "text" && e.customData?.flow?.role === "label",
        )
        .map((e) => e.originalText);

    act(() => {
      API.setSelectedElements([shapes()[0]]);
    });
    act(() => {
      openFlowScriptEditor(shapes()[0].id);
    });

    // to a pyramid: the words come across, written for it
    act(() => {
      fireEvent.change(screen.getByLabelText("Kind of chart"), {
        target: { value: "pyramid" },
      });
    });

    expect((screen.getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      SCRIPT,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    // the chart is made again, in the new kind, with the same words
    expect(wordsOnThePage()).toEqual(SCRIPT.split("\n"));
    expect(screen.getByRole("status").textContent).toMatch(/made again/);

    const record = live()
      .map((e: ExcalidrawElement) => readChartRecord(e))
      .find((r) => r !== null);

    expect(record?.preset).toBe("pyramid");
    // a pyramid draws no arrows
    expect(live().filter((e) => e.type === "arrow")).toHaveLength(0);

    // to a grid: the lines become the cells of rows
    act(() => {
      fireEvent.change(screen.getByLabelText("Kind of chart"), {
        target: { value: "grid" },
      });
    });

    expect((screen.getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      "Plan the lesson | Teach it | Check the work",
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(wordsOnThePage()).toEqual(SCRIPT.split("\n"));
  });
});
