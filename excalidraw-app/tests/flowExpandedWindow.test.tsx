import React from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { FlowExpandedWindow } from "@excalidraw/excalidraw/components/flowPanel/FlowExpandedWindow";
import { Excalidraw } from "@excalidraw/excalidraw";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  act,
  render as renderEditor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { flowAnimationStateAtom } from "@excalidraw/excalidraw/components/FlowAnimationState";
import { editorJotaiStore } from "@excalidraw/excalidraw/editor-jotai";
import { arrayToMap } from "@excalidraw/common";
import { FlowChartPreview } from "@excalidraw/excalidraw/components/flowPanel/FlowChartPreview";
import { flowOfSelection } from "@excalidraw/excalidraw/scene/flowSelection";
import * as sceneExport from "@excalidraw/excalidraw/scene/export";
import * as compose from "@excalidraw/excalidraw/scene/flowExport/compose";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("AC-640 the generic window isolates a working copy, applies once and restores focus", () => {
  const initial = { colour: "blue" };
  const apply = vi.fn();
  const close = vi.fn();
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  opener.focus();
  const view = render(
    <FlowExpandedWindow
      title="Animation options"
      initial={initial}
      tabs={[
        {
          id: "nodes",
          label: "Nodes",
          render: (draft, setDraft) => (
            <input
              aria-label="Draft colour"
              value={draft.colour}
              onChange={(event) => setDraft({ colour: event.target.value })}
            />
          ),
        },
        { id: "meta", label: "Meta node", render: () => <p>Parts</p> },
        { id: "arrow", label: "Arrow", render: () => <p>Arrows</p> },
        {
          id: "connect",
          label: "Connect / remove arrows",
          render: () => <p>Connections</p>,
        },
        { id: "background", label: "Background", render: () => <p>Paper</p> },
      ]}
      preview={(draft) => (
        <output aria-label="Chart preview">{draft.colour}</output>
      )}
      onApply={apply}
      onClose={close}
    />,
  );
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Nodes",
    "Meta node",
    "Arrow",
    "Connect / remove arrows",
    "Background",
  ]);
  fireEvent.change(screen.getByLabelText("Draft colour"), {
    target: { value: "red" },
  });
  expect(initial.colour).toBe("blue");
  expect(apply).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Chart preview").textContent).toBe("red");
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({ colour: "red" });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it("AC-640 preview draws all 100 nodes once while idle, loops its own camera, and cancels on close", async () => {
  const built = buildFlowPreset(
    "process",
    Array.from({ length: 100 }, (_, index) => `Node ${index}`).join("\n"),
    { seed: 50, fit: "larger" },
  );
  if (!built.ok) {
    throw new Error(built.error);
  }
  const graph = flowOfSelection(
    { [built.elements[0].id]: true },
    built.elements,
    arrayToMap(built.elements),
  );
  if (!graph) {
    throw new Error("Expected a graph");
  }
  const base = document.createElement("canvas");
  const renderer = vi
    .spyOn(sceneExport, "exportToCanvas")
    .mockResolvedValue(base);
  const frame = vi.spyOn(compose, "drawFlowFrame");
  const animation = {
    ...editorJotaiStore.get(flowAnimationStateAtom),
    nodeStyle: "focus" as const,
    durationMs: 100,
  };
  const state = {
    ...getDefaultAppState(),
    width: 1280,
    height: 720,
    offsetTop: 0,
    offsetLeft: 0,
  };
  const files = {};
  vi.useFakeTimers();
  let view: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <FlowChartPreview
        elements={built.elements}
        graph={graph}
        appState={state}
        files={files}
        animation={animation}
      />,
    );
  });
  expect(renderer).toHaveBeenCalledTimes(1);
  expect(
    renderer.mock.calls[0][0].filter(
      (element) => element.customData?.flow?.role === "node",
    ),
  ).toHaveLength(100);
  expect(frame).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(frame).toHaveBeenCalledTimes(1);
  await act(async () => {
    view!.rerender(
      <FlowChartPreview
        elements={built.elements}
        graph={graph}
        appState={{ ...state, scrollX: 999 }}
        files={files}
        animation={animation}
      />,
    );
  });
  expect(renderer).toHaveBeenCalledTimes(1);
  await act(async () => {
    view!.rerender(
      <FlowChartPreview
        elements={built.elements}
        graph={graph}
        appState={state}
        files={files}
        animation={animation}
        loop
      />,
    );
  });
  act(() => {
    vi.advanceTimersByTime(11000);
  });
  expect(frame.mock.calls.length).toBeGreaterThan(100);
  expect(
    frame.mock.calls
      .slice(1)
      .every((call) => call[2] < graph.steps.length * 100),
  ).toBe(true);
  const last = frame.mock.calls[frame.mock.calls.length - 1];
  expect(last[3]).toEqual(frame.mock.calls[0][3]);
  view!.unmount();
  const draws = frame.mock.calls.length;
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(frame).toHaveBeenCalledTimes(draws);
});

it("AC-640 real chart options stay private until one Apply and can be undone and redone", async () => {
  localStorage.clear();
  const built = buildFlowPreset("process", "Plan\nTeach", {
    seed: 44,
    chartId: "draft-test",
  });
  if (!built.ok) {
    throw new Error(built.error);
  }
  await renderEditor(
    <Excalidraw
      handleKeyboardGlobally
      initialData={{ elements: built.elements as never }}
    />,
  );
  act(() => {
    API.setSelectedElements([window.h.elements[0]]);
  });
  fireEvent.click(screen.getByRole("tab", { name: "Animation" }));
  const before = JSON.stringify(window.h.elements);
  const style = editorJotaiStore.get(flowAnimationStateAtom).nodeStyle;
  fireEvent.click(
    screen.getByRole("button", { name: "More animation options" }),
  );
  fireEvent.change(screen.getByLabelText("Preview node animation"), {
    target: { value: "pulse" },
  });
  expect(JSON.stringify(window.h.elements)).toBe(before);
  expect(editorJotaiStore.get(flowAnimationStateAtom).nodeStyle).toBe(style);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(JSON.stringify(window.h.elements)).toBe(before);
  fireEvent.click(
    screen.getByRole("button", { name: "More animation options" }),
  );
  fireEvent.change(screen.getByLabelText("Preview node animation"), {
    target: { value: "pulse" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(editorJotaiStore.get(flowAnimationStateAtom).nodeStyle).toBe("pulse");
  expect(window.h.elements[0].customData?.flowPanelAnimation).toMatchObject({
    nodeStyle: "pulse",
  });
  Keyboard.undo();
  expect(window.h.elements[0].customData?.flowPanelAnimation).toBeUndefined();
  expect(editorJotaiStore.get(flowAnimationStateAtom).nodeStyle).toBe(style);
  Keyboard.redo();
  expect(window.h.elements[0].customData?.flowPanelAnimation).toMatchObject({
    nodeStyle: "pulse",
  });
});
