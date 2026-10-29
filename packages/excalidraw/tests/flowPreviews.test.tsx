/**
 * AC-266 - the kind of chart is chosen from a picture gallery (D-239).
 *
 * The picture is read as data, and as the SVG that the component draws; the
 * editor's picture is read in the real editor panel. The Flow tab's pictures
 * are read in `excalidraw-app/tests/flowGalleryTab.test.tsx`.
 */

import React from "react";

import { render as plainRender } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FlowPreview } from "../components/FlowPreview";
import {
  closeFlowScriptEditor,
  openFlowScriptEditor,
} from "../components/FlowScriptEditorState";
import { Excalidraw } from "../index";
import { FLOW_PREVIEW_SIZE, flowKindPreview } from "../scene/flowPreview";
import { FLOW_PRESETS, buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

import type { FlowPreview as FlowPreviewData } from "../scene/flowPreview";

const { h } = window;

const exampleOf = (id: string) =>
  FLOW_PRESETS.find((p) => p.id === id)!.example;

const kindsOf = (preview: FlowPreviewData) => [
  ...new Set(preview.items.map((item) => item.kind)),
];

const countOf = (preview: FlowPreviewData, kind: string) =>
  preview.items.filter((item) => item.kind === kind).length;

describe("AC-266 the kind of chart is chosen from a picture gallery", () => {
  afterEach(() => {
    act(() => {
      closeFlowScriptEditor();
    });
  });

  it("AC-266 every kind has a picture", () => {
    expect(FLOW_PRESETS).toHaveLength(16);

    for (const preset of FLOW_PRESETS) {
      const preview = flowKindPreview(preset.id, preset.example);

      expect(preview, preset.id).not.toBeNull();
      expect(preview!.width).toBe(FLOW_PREVIEW_SIZE.width);
      expect(preview!.height).toBe(FLOW_PREVIEW_SIZE.height);
      expect(preview!.items.length, preset.id).toBeGreaterThan(0);

      // all of it is inside its box
      for (const item of preview!.items) {
        const points =
          item.kind === "rect"
            ? [
                [item.x, item.y],
                [item.x + item.width, item.y + item.height],
              ]
            : item.kind === "ellipse"
            ? [
                [item.cx - item.rx, item.cy - item.ry],
                [item.cx + item.rx, item.cy + item.ry],
              ]
            : (item.kind === "diamond" ? item.points : item.points)
                .split(" ")
                .map((p) => p.split(",").map(Number));

        for (const [x, y] of points) {
          expect(x, preset.id).toBeGreaterThanOrEqual(-0.01);
          expect(y, preset.id).toBeGreaterThanOrEqual(-0.01);
          expect(x, preset.id).toBeLessThanOrEqual(preview!.width + 0.01);
          expect(y, preset.id).toBeLessThanOrEqual(preview!.height + 0.01);
        }
      }
    }

    // a kind that cannot be built has no picture, and no error
    expect(flowKindPreview("process", "   ")).toBeNull();
  });

  it("AC-266 the picture is the chart's own shapes and fills", () => {
    // what the builder makes of the example is what the picture draws
    for (const preset of FLOW_PRESETS) {
      const built = buildFlowPreset(preset.id, preset.example, {
        seed: 1,
        fit: "larger",
      });

      if (!built.ok) {
        throw new Error(preset.id);
      }

      const picture = flowKindPreview(preset.id, preset.example)!;
      const shapes = built.elements.filter(
        (e) => e.type !== "text" && e.type !== "arrow" && e.type !== "line",
      );
      const drawn = picture.items.filter((item) => item.kind !== "line");

      expect(drawn, preset.id).toHaveLength(shapes.length);

      // the fills are the shapes' fills
      expect(
        drawn.map((item) => (item as { fill: string }).fill).sort(),
        preset.id,
      ).toEqual(
        shapes
          .map((e) =>
            e.backgroundColor && e.backgroundColor !== "transparent"
              ? e.backgroundColor
              : "none",
          )
          .sort(),
      );
    }

    // and the layouts look like themselves
    expect(
      countOf(flowKindPreview("decision", exampleOf("decision"))!, "diamond"),
    ).toBe(1);
    expect(
      countOf(flowKindPreview("venn", exampleOf("venn"))!, "ellipse"),
    ).toBe(3);
    expect(countOf(flowKindPreview("grid", exampleOf("grid"))!, "rect")).toBe(
      12,
    );
    expect(kindsOf(flowKindPreview("list", exampleOf("list"))!)).toEqual([
      "rect",
    ]);

    // a chart that joins its shapes has lines, and one that does not has none
    expect(
      countOf(flowKindPreview("process", exampleOf("process"))!, "line"),
    ).toBe(3);
    expect(countOf(flowKindPreview("list", exampleOf("list"))!, "line")).toBe(
      0,
    );
    // with arrowheads on the arrows and none on a hierarchy's connectors
    const process = flowKindPreview("process", exampleOf("process"))!;
    const tree = flowKindPreview("hierarchy", exampleOf("hierarchy"))!;

    expect(
      process.items.every((i) => i.kind !== "line" || i.head !== undefined),
    ).toBe(true);
    expect(
      tree.items.every((i) => i.kind !== "line" || i.head === undefined),
    ).toBe(true);
  });

  it("AC-266 the picture has no words and is the same each time", () => {
    for (const preset of FLOW_PRESETS) {
      const preview = flowKindPreview(preset.id, preset.example)!;

      // only shapes and lines
      for (const kind of kindsOf(preview)) {
        expect(["rect", "ellipse", "diamond", "line"]).toContain(kind);
      }

      // the same each time, and kept
      expect(flowKindPreview(preset.id, preset.example)).toBe(preview);
    }

    // drawn, it is an SVG with shapes and no text
    const { container } = plainRender(
      <FlowPreview
        preview={flowKindPreview("pyramid", exampleOf("pyramid"))}
      />,
    );

    expect(container.querySelector("svg[data-flow-preview]")).not.toBeNull();
    expect(container.querySelectorAll("rect")).toHaveLength(6);
    expect(container.querySelector("text")).toBeNull();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("AC-266 a custom preset's picture is in its colours", () => {
    const palette = {
      fills: ["#ffe3e3", "#d3f9d8"],
      outline: "#862e9c",
    };

    const picture = flowKindPreview("process", "A\nB\nC", {
      palette,
      shape: "ellipse",
    })!;

    // its shape, its fills and its outline
    expect(countOf(picture, "ellipse")).toBe(3);
    expect(countOf(picture, "rect")).toBe(0);

    for (const item of picture.items) {
      expect(item.stroke).toBe("#862e9c");

      if (item.kind === "ellipse") {
        expect(item.fill).toBe("#ffe3e3");
      }
    }

    // and the picture of the same kind without them is not this one
    expect(flowKindPreview("process", "A\nB\nC")).not.toBe(picture);

    // arrows set to none are not drawn
    const none = flowKindPreview("process", "A\nB\nC", { arrows: "none" })!;

    expect(countOf(none, "line")).toBe(0);
    expect(countOf(none, "rect")).toBe(3);
  });

  it("AC-266 the editor shows the picture of the kind", async () => {
    const built = buildFlowPreset("process", "Plan\nTeach\nCheck", {
      seed: 4,
      chartId: "chart-picture",
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

    const first = h.elements.find(
      (e) => e.type !== "arrow" && e.type !== "text",
    )!;

    act(() => {
      API.setSelectedElements([first]);
    });
    act(() => {
      openFlowScriptEditor(first.id);
    });

    const picture = () => screen.getByTestId("flow-editor-kind-picture");

    // a process: the boxes of its example, and the arrows between them
    expect(
      picture().querySelectorAll("svg[data-flow-preview] rect"),
    ).toHaveLength(4);
    expect(picture().querySelectorAll("polyline").length).toBeGreaterThan(0);

    // choosing another kind changes the picture
    act(() => {
      fireEvent.change(screen.getByLabelText("Kind of chart"), {
        target: { value: "venn" },
      });
    });

    expect(picture().querySelectorAll("ellipse")).toHaveLength(3);
    expect(picture().querySelectorAll("rect")).toHaveLength(0);
  });
});
