/**
 * AC-248 - the script editor opens beside the chart (D-222).
 *
 * The panel is used the way a teacher uses it: the bar's button is pressed, the
 * script is typed in, the grip is dragged, and the scene is read afterwards.
 */

import React from "react";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  closeFlowScriptEditor,
  openFlowScriptEditor,
} from "../components/FlowScriptEditorState";
import { Excalidraw } from "../index";
import {
  FLOW_EDITOR_PLACE_KEY,
  FLOW_EDITOR_SIZE,
  flowEditorCoversChart,
  flowEditorPosition,
} from "../scene/flowEditorPlace";
import { buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen } from "./test-utils";

const { h } = window;

const SCRIPT = "Plan the lesson\nTeach it\nCheck the work";

const chart = () => {
  const built = buildFlowPreset("process", SCRIPT, {
    seed: 4,
    chartId: "chart-editor",
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements as ExcalidrawElement[];
};

const live = () => h.elements.filter((element) => !element.isDeleted);

const shapes = () =>
  live().filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      element.customData?.flow?.role === "node",
  );

const mount = async () => {
  await render(
    <Excalidraw
      handleKeyboardGlobally={true}
      initialData={{ elements: chart() as never }}
    />,
  );

  act(() => {
    h.setState({ width: 1400, height: 900 });
  });
  act(() => {
    API.setSelectedElements([shapes()[0]]);
  });
};

const panel = () => screen.queryByRole("dialog", { name: "Edit chart" });

const script = () => screen.getByLabelText("Script") as HTMLTextAreaElement;

beforeEach(() => {
  window.localStorage.removeItem(FLOW_EDITOR_PLACE_KEY);
});

afterEach(() => {
  closeFlowScriptEditor();
  window.localStorage.removeItem(FLOW_EDITOR_PLACE_KEY);
});

/** one pointer event, as the browser would send it */
const pointer = (
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });

  Object.assign(event, { pointerId: 1 });

  act(() => {
    target.dispatchEvent(event);
  });
};

describe("AC-248 the script editor opens beside the chart", () => {
  it("AC-248 the bar and the Flow tab open the panel for the selected chart", async () => {
    await mount();

    expect(panel()).toBeNull();

    // the bar's button
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Edit chart" }));
    });

    expect(panel()).not.toBeNull();
    expect(script().value).toBe(SCRIPT);

    // the Flow tab asks for it the same way: by an element of the chart, and
    // any shape or arrow of it will do (D-180)
    act(() => {
      closeFlowScriptEditor();
    });
    expect(panel()).toBeNull();

    const arrow = live().find((element) => element.type === "arrow")!;

    act(() => {
      openFlowScriptEditor(arrow.id);
    });

    expect(panel()).not.toBeNull();
    expect(script().value).toBe(SCRIPT);
  });

  it("AC-248 the panel has a grip and a close button and remembers its place", async () => {
    await mount();
    act(() => {
      openFlowScriptEditor(shapes()[0].id);
    });

    const grip = screen.getByLabelText("Move the script editor");
    const before = {
      left: parseFloat(panel()!.style.left),
      top: parseFloat(panel()!.style.top),
    };

    // dragged: pressed, moved, let go
    pointer(grip, "pointerdown", 500, 300);
    pointer(window, "pointermove", 560, 270);
    pointer(window, "pointerup", 560, 270);

    const after = {
      left: parseFloat(panel()!.style.left),
      top: parseFloat(panel()!.style.top),
    };

    expect(after.left).toBeCloseTo(before.left + 60, 0);
    expect(after.top).toBeCloseTo(before.top - 30, 0);
    expect(panel()!.hasAttribute("data-flow-editor-placed")).toBe(true);

    // the place is kept in the window's storage
    expect(
      JSON.parse(window.localStorage.getItem(FLOW_EDITOR_PLACE_KEY)!),
    ).toEqual({ x: after.left, y: after.top });

    // the close button closes it
    act(() => {
      fireEvent.click(screen.getByLabelText("Close the script editor"));
    });

    expect(panel()).toBeNull();

    // and when it is opened again it is where it was left
    act(() => {
      openFlowScriptEditor(shapes()[0].id);
    });

    expect(parseFloat(panel()!.style.left)).toBeCloseTo(after.left, 0);
    expect(parseFloat(panel()!.style.top)).toBeCloseTo(after.top, 0);
  });

  it("AC-248 the panel holds the script, the choices and Apply", async () => {
    await mount();
    act(() => {
      openFlowScriptEditor(shapes()[0].id);
    });

    // the script, the preset, the fit mode and the shape
    expect(script().value).toBe(SCRIPT);
    expect(
      (screen.getByLabelText("Kind of chart") as HTMLSelectElement).value,
    ).toBe("process");
    expect((screen.getByLabelText("Fit mode") as HTMLSelectElement).value).toBe(
      "page",
    );
    expect(
      (screen.getByLabelText("Node shape") as HTMLSelectElement).value,
    ).toBe("own");

    // the check
    expect(screen.getByTestId("flow-editor-counts").textContent).toMatch(
      /3 nodes, 2 arrows/,
    );

    // and Apply, which puts the edited script on the page
    act(() => {
      fireEvent.change(script(), { target: { value: `${SCRIPT}\nPractise` } });
    });

    expect(screen.getByTestId("flow-editor-counts").textContent).toMatch(
      /4 nodes, 3 arrows/,
    );

    const before = shapes().map((s) => s.id);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(shapes()).toHaveLength(4);
    // the three that were there are the same shapes
    expect(
      shapes()
        .map((s) => s.id)
        .slice(0, 3),
    ).toEqual(before);
    expect(screen.getByRole("status").textContent).toMatch(/1 added/);

    // a script with a problem cannot be applied, and says why
    act(() => {
      fireEvent.change(script(), { target: { value: "Plan\n[Teach" } });
    });

    expect(
      (screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole("list", { name: "Problems" }).textContent).toMatch(
      /Line 2/,
    );
  });

  it("AC-248 typing does not reach the canvas's shortcuts", async () => {
    await mount();
    act(() => {
      openFlowScriptEditor(shapes()[0].id);
    });

    expect(h.state.activeTool.type).toBe("selection");

    // the key goes no further than the box: nothing on the document hears it
    const heard: string[] = [];
    const listen = (event: KeyboardEvent) => heard.push(event.key);

    document.addEventListener("keydown", listen);
    act(() => {
      fireEvent.keyDown(script(), { key: "q" });
    });
    document.removeEventListener("keydown", listen);
    expect(heard).toEqual([]);

    // "r" is the rectangle tool on the canvas; typed in the box it is a letter
    act(() => {
      fireEvent.keyDown(script(), { key: "r" });
    });
    act(() => {
      fireEvent.keyDown(script(), { key: "Delete" });
    });

    expect(h.state.activeTool.type).toBe("selection");
    // the chart is still there: Delete did not delete the selected shape
    expect(shapes()).toHaveLength(3);
  });

  it("AC-248 closing keeps the text for that chart", async () => {
    await mount();
    act(() => {
      openFlowScriptEditor(shapes()[0].id);
    });

    act(() => {
      fireEvent.change(script(), { target: { value: "half written" } });
    });
    act(() => {
      fireEvent.click(screen.getByLabelText("Close the script editor"));
    });

    // nothing was asked, and nothing was changed on the page
    expect(panel()).toBeNull();
    expect(shapes()).toHaveLength(3);

    // opened again on the same chart: the text is as it was left
    act(() => {
      openFlowScriptEditor(shapes()[1].id);
    });

    expect(script().value).toBe("half written");
  });

  it("AC-248 it opens beside the chart and not over it when there is room", () => {
    const camera = {
      zoom: { value: 1 as never },
      scrollX: 0,
      scrollY: 0,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const viewport = { width: 1400, height: 900 };
    const box = { x: 100, y: 200, width: 400, height: 150 };

    const place = flowEditorPosition({ box, camera, viewport });

    expect(flowEditorCoversChart({ place, box, camera })).toBe(false);
    // to the right of it
    expect(place.x).toBeGreaterThanOrEqual(box.x + box.width);

    // a chart on the right of the window: the panel goes to its left
    const right = { x: 1000, y: 200, width: 300, height: 150 };
    const left = flowEditorPosition({ box: right, camera, viewport });

    expect(flowEditorCoversChart({ place: left, box: right, camera })).toBe(
      false,
    );
    expect(left.x + FLOW_EDITOR_SIZE.width).toBeLessThanOrEqual(right.x);

    // and the panel in the editor takes the place the position gives
    // (the real panel is read in the first tests)
  });
});
