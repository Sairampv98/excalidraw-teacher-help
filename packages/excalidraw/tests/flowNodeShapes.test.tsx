/**
 * AC-256 - the shape of one node is changed by a keyword, and from the editor
 * (D-230).
 *
 * The keyword is read by the real parser, the rewrite is checked on the text it
 * gives, and the editor is used the way a teacher uses it: a node selected on the
 * canvas and a shape chosen in the panel.
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
import { applyFlowScript } from "../scene/flowApply";
import { checkFlowScript } from "../scene/flowCheck";
import { buildFlowPreset } from "../scene/flowPresets";
import {
  FLOW_NODE_SHAPES,
  parseFlowScript,
  withNodeShape,
} from "../scene/flowScript";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

import type { FlowChartShape } from "../scene/flowPresets";
import type { FlowNodeShape, FlowPresetId } from "../scene/flowScript";

const { h } = window;

const PAGE = { x: 0, y: 0, width: 1920, height: 1080 };

const nodesOf = (preset: FlowPresetId, script: string) => {
  const parsed = parseFlowScript(preset, script);

  if (!parsed.ok) {
    throw new Error(parsed.error);
  }

  return parsed;
};

const kindOf = (shape: ExcalidrawElement) =>
  shape.type === "rectangle"
    ? shape.roundness
      ? "rounded"
      : "rectangle"
    : shape.type === "ellipse" && shape.width === shape.height
    ? "circle"
    : shape.type;

describe("AC-256 the shape of one node is changed by a keyword", () => {
  afterEach(() => {
    act(() => {
      closeFlowScriptEditor();
    });
  });

  it("AC-256 a keyword gives a node its shape", () => {
    for (const shape of FLOW_NODE_SHAPES) {
      const parsed = nodesOf("process", `Plan\n@${shape} Teach it\nReview`);

      expect(parsed.nodes.map((n) => [n.label, n.shape])).toEqual([
        ["Plan", undefined],
        ["Teach it", shape],
        ["Review", undefined],
      ]);
    }

    // the name is not case-sensitive, and the words keep their spaces
    expect(
      nodesOf("process", "@Circle  Plan the lesson").nodes[0],
    ).toMatchObject({
      label: "Plan the lesson",
      shape: "circle",
    });

    // and it builds: the node is that shape
    const built = buildFlowPreset("process", "@diamond Check\nGo", { seed: 2 });

    expect(built.ok).toBe(true);

    if (built.ok) {
      const first = built.elements.find(
        (e) => e.type !== "arrow" && e.type !== "text",
      )!;

      expect(first.type).toBe("diamond");
    }
  });

  it("AC-256 it works wherever a node's words are written", () => {
    // a question and its answers
    const decision = nodesOf("decision", "? @rounded Ready?\n@circle Go\nWait");

    expect(decision.nodes.map((n) => [n.label, n.kind, n.shape])).toEqual([
      ["Ready?", "question", "rounded"],
      ["Go", "branch", "circle"],
      ["Wait", "branch", undefined],
    ]);

    // either end of an arrow, the first time the node is seen
    const network = nodesOf(
      "network",
      "@circle A -> @diamond B\nA -> C\n@rounded C -> A",
    );

    expect(network.nodes.map((n) => [n.label, n.shape])).toEqual([
      ["A", "circle"],
      ["B", "diamond"],
      ["C", undefined],
    ]);
    expect(network.edges).toHaveLength(3);

    // the items of a tier, and the hub
    expect(
      nodesOf("tiers", "@circle a | b | @diamond c\nd").nodes.map(
        (n) => n.shape,
      ),
    ).toEqual(["circle", undefined, "diamond", undefined]);
    expect(
      nodesOf("integration", "@circle Hub\n@diamond Spoke").nodes.map(
        (n) => n.shape,
      ),
    ).toEqual(["circle", "diamond"]);
  });

  it("AC-256 the keyword wins over a mark", () => {
    expect(nodesOf("process", "@circle [Plan]").nodes[0]).toMatchObject({
      label: "Plan",
      shape: "circle",
    });

    // the marks of D-229 are as they were
    expect(nodesOf("process", "<Plan>").nodes[0].shape).toBe("diamond");
  });

  it("AC-256 an unknown shape and a keyword with no words are problems", () => {
    const check = checkFlowScript(
      "process",
      "Plan\n@hexagon Teach\n@circle\nReview",
    );

    expect(check.ok).toBe(false);
    expect(check.problems.map((p) => p.line)).toEqual([2, 3]);
    expect(check.problems[0].message).toMatch(/not a shape/);
    expect(check.problems[1].message).toMatch(/needs the words/);

    // the script is still read: the lines that are wrong are kept as written
    expect(nodesOf("process", "@hexagon Teach").nodes[0].label).toBe(
      "@hexagon Teach",
    );
  });

  it("AC-256 one node's piece of the script is rewritten and no other", () => {
    const rewrite = (
      preset: FlowPresetId,
      script: string,
      label: string,
      shape: FlowNodeShape | null,
    ) => {
      const node = nodesOf(preset, script).nodes.find(
        (n) => n.label === label,
      )!;

      return withNodeShape(script, node, shape);
    };

    // a run of steps: the line, and nothing else
    expect(rewrite("process", "Plan\nTeach\nReview", "Teach", "circle")).toBe(
      "Plan\n@circle Teach\nReview",
    );

    // a mark that was there is replaced, a keyword that was there is replaced
    expect(
      rewrite("process", "Plan\n[Teach]\nReview", "Teach", "diamond"),
    ).toBe("Plan\n@diamond Teach\nReview");
    expect(rewrite("process", "@circle Plan", "Plan", "rounded")).toBe(
      "@rounded Plan",
    );

    // the chart's own shape takes the keyword off
    expect(
      rewrite("process", "Plan\n@circle Teach\nReview", "Teach", null),
    ).toBe("Plan\nTeach\nReview");
    expect(rewrite("process", "Plan\n{Teach}\nReview", "Teach", null)).toBe(
      "Plan\nTeach\nReview",
    );

    // indentation and the rest of a line are kept
    expect(
      rewrite("process", "  Plan\n    Teach   \nReview", "Teach", "circle"),
    ).toBe("  Plan\n    @circle Teach   \nReview");

    // a question, one end of an arrow, an item of a tier
    expect(rewrite("decision", "? Ready?\nGo\nWait", "Ready?", "rounded")).toBe(
      "? @rounded Ready?\nGo\nWait",
    );
    expect(rewrite("network", "A -> B -> C\nC -> A", "B", "circle")).toBe(
      "A -> @circle B -> C\nC -> A",
    );
    expect(rewrite("tiers", "a | b | c\nd", "b", "diamond")).toBe(
      "a | @diamond b | c\nd",
    );

    // the first time a node of a network is written is the one that is changed
    expect(rewrite("network", "A -> B\nB -> C", "B", "circle")).toBe(
      "A -> @circle B\nB -> C",
    );

    // a node that was not read from a script cannot be rewritten
    expect(
      withNodeShape("x", { id: "n0", label: "x", kind: "step" }, "circle"),
    ).toBeNull();
  });

  it("AC-256 the editor changes the selected nodes in place", async () => {
    const SCRIPT = "Plan\nTeach\nReview";
    const built = buildFlowPreset("process", SCRIPT, {
      seed: 3,
      page: PAGE,
      chartId: "chart-node-shape",
    });

    if (!built.ok) {
      throw new Error(built.error);
    }

    // the teacher recoloured one of the nodes
    const coloured = built.elements.map((element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      built.elements.find(
        (e): e is ExcalidrawTextElement =>
          e.type === "text" && e.containerId === element.id,
      )?.originalText === "Teach"
        ? ({ ...element, backgroundColor: "#ff6b6b" } as ExcalidrawElement)
        : element,
    );

    await render(
      <Excalidraw
        handleKeyboardGlobally={true}
        initialData={{ elements: coloured as never }}
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
    const labelOf = (shape: ExcalidrawElement) =>
      (
        live().find(
          (e): e is ExcalidrawTextElement =>
            e.type === "text" && e.containerId === shape.id,
        ) as ExcalidrawTextElement
      ).originalText;
    const byLabel = (label: string) =>
      shapes().find((shape) => labelOf(shape) === label)!;

    const before = shapes().map((s) => ({ id: s.id, x: s.x, y: s.y }));
    const teach = byLabel("Teach");

    act(() => {
      API.setSelectedElements([teach]);
    });
    act(() => {
      openFlowScriptEditor(teach.id);
    });

    const select = screen.getByLabelText(
      "This node's shape",
    ) as HTMLSelectElement;

    // the node has no shape of its own: the chart's
    expect(select.value).toBe("");

    act(() => {
      fireEvent.change(select, { target: { value: "circle" } });
    });

    // the node is a circle now: the same element, in the same place, in the same colour
    const after = byLabel("Teach");

    expect(after.id).toBe(teach.id);
    expect(kindOf(after)).toBe("circle");
    expect(after.backgroundColor).toBe("#ff6b6b");
    expect(shapes().map((s) => s.id)).toEqual(before.map((b) => b.id));

    // the others are untouched
    for (const label of ["Plan", "Review"]) {
      expect(kindOf(byLabel(label))).toBe("rounded");
    }

    // the script says so, and nothing else about it changed
    expect((screen.getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      "Plan\n@circle Teach\nReview",
    );
    expect(
      (screen.getByLabelText("This node's shape") as HTMLSelectElement).value,
    ).toBe("circle");

    // one undo takes it back
    Keyboard.undo();

    expect(kindOf(byLabel("Teach"))).toBe("rounded");

    // more than one node: all of them, and the chart's shape takes the keyword off
    act(() => {
      API.setSelectedElements([byLabel("Plan"), byLabel("Review")]);
    });

    expect(screen.getByLabelText("This node's shape")).not.toBeNull();

    act(() => {
      fireEvent.change(screen.getByLabelText("This node's shape"), {
        target: { value: "diamond" },
      });
    });

    expect(kindOf(byLabel("Plan"))).toBe("diamond");
    expect(kindOf(byLabel("Review"))).toBe("diamond");

    act(() => {
      fireEvent.change(screen.getByLabelText("This node's shape"), {
        target: { value: "" },
      });
    });

    expect(kindOf(byLabel("Plan"))).toBe("rounded");
    expect(kindOf(byLabel("Review"))).toBe("rounded");

    // a node of a network is found by its words, not its number
    expect(
      parseFlowScript("network", "A -> B\nB -> C").ok &&
        (
          parseFlowScript("network", "A -> B\nB -> C") as {
            ok: true;
            nodes: { label: string }[];
          }
        ).nodes.map((n) => n.label),
    ).toEqual(["A", "B", "C"]);
  });

  it("AC-256 a change of preset keeps the shapes the script names", () => {
    const script = "@circle Plan\nTeach\n<Review>";
    const make = (shape: FlowChartShape) => {
      const built = buildFlowPreset("process", script, {
        seed: 3,
        page: PAGE,
        chartId: "chart-keep",
        shape,
      });

      if (!built.ok) {
        throw new Error(built.error);
      }

      return built.elements;
    };

    const before = make("own");
    const kinds = (elements: readonly ExcalidrawElement[]) => {
      const out: Record<string, string> = {};

      for (const shape of elements.filter(
        (e) => !e.isDeleted && e.type !== "arrow" && e.type !== "text",
      )) {
        const text = elements.find(
          (e): e is ExcalidrawTextElement =>
            e.type === "text" && e.containerId === shape.id,
        )!;

        out[text.originalText] = kindOf(shape);
      }

      return out;
    };

    expect(kinds(before)).toEqual({
      Plan: "circle",
      Teach: "rounded",
      Review: "diamond",
    });

    // the chart-wide shape changes: the rebuild keeps what the script names, and
    // the node that names nothing follows the new shape
    const wide = applyFlowScript({
      elements: before,
      chartId: "chart-keep",
      preset: "process",
      script,
      fit: "page",
      shape: "ellipse",
      page: PAGE,
      seed: 9,
    });

    expect(wide.ok && wide.rebuilt).toBe(true);
    expect(wide.ok && kinds(wide.elements)).toEqual({
      Plan: "circle",
      Teach: "ellipse",
      Review: "diamond",
    });

    // the preset changes: the same
    const cycle = applyFlowScript({
      elements: before,
      chartId: "chart-keep",
      preset: "cycle",
      script,
      fit: "page",
      shape: "own",
      page: PAGE,
      seed: 9,
    });

    expect(cycle.ok && cycle.rebuilt).toBe(true);
    expect(cycle.ok && kinds(cycle.elements)).toEqual({
      Plan: "circle",
      Teach: "rounded",
      Review: "diamond",
    });
  });
});
