import React from "react";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { FlowPanelTabs } from "@excalidraw/excalidraw/components/flowPanel/FlowPanelTabs";
import { Excalidraw } from "@excalidraw/excalidraw";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  render as renderEditor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { FLOW_PANEL_TAB_KEY } from "@excalidraw/excalidraw/components/flowPanel/FlowPanelTabs";
import {
  readFlowPanelTab,
  writeFlowPanelTab,
} from "@excalidraw/excalidraw/components/flowPanel/FlowPanelTabs";
import {
  FLOW_SWATCHES,
  FLOW_COLOR_PRESETS,
} from "@excalidraw/excalidraw/scene/flowPalette";

import { FlowTab } from "../sidebar/FlowTab";

afterEach(() => vi.restoreAllMocks());

it("AC-638 the seven tabs have their own content and keyboard navigation", () => {
  const names = [
    "Look",
    "Animation",
    "Script",
    "Present in class",
    "Save as preset",
    "Camera",
    "Export",
  ];
  const choose = vi.fn();
  render(<FlowPanelTabs value="Look" onChange={choose} />);
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(
    names,
  );
  expect(
    screen.getByRole("tab", { name: "Look" }).getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Look" }), {
    key: "ArrowRight",
  });
  expect(choose).toHaveBeenLastCalledWith("Animation");
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "Animation" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(choose).toHaveBeenLastCalledWith("Export");
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(choose).toHaveBeenLastCalledWith("Look");
});

it("AC-638 the last tab survives reload and unavailable or malformed storage is harmless", () => {
  writeFlowPanelTab("Camera");
  expect(readFlowPanelTab()).toBe("Camera");
  localStorage.setItem(FLOW_PANEL_TAB_KEY, "unknown");
  expect(readFlowPanelTab()).toBe("Animation");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  expect(readFlowPanelTab()).toBe("Animation");
  expect(() => writeFlowPanelTab("Look")).not.toThrow();
});

// AC-638: executable before/after inventory. Conditional Stop, reset, media,
// download and preset-management controls retain their original behavioural suites.
const CONTROL_INVENTORY = [
  ["Animation", "button", "Play"],
  ["Present in class", "button", "Present steps"],
  ["Camera", "button", "Fly: off"],
  ["Look", "button", "Lay this out"],
  ["Look", "button", "Select arrows"],
  ["Look", "button", "Select nodes"],
  ["Animation", "label", "Node animation"],
  ["Animation", "label", "Arrow animation"],
  ["Animation", "label", "Animation speed"],
  ["Animation", "label", "Step duration (ms)"],
  ["Animation", "label", "Loop"],
  ["Camera", "label", "Fly the view to each step"],
  ["Present in class", "label", "Show in class"],
  ["Present in class", "label", "Preview class loop"],
  ["Look", "label", "Highlight target"],
  ["Look", "label", "Hide arrow"],
  ["Look", "label", "Neon shape"],
  ["Look", "label", "Neon text"],
  ["Look", "label", "Neon animation"],
  ["Look", "label", "Neon arrows"],
  ["Script", "label", "Kind of chart"],
  ["Look", "label", "Fit mode"],
  ["Look", "label", "Node shape"],
  ["Look", "label", "This node's shape"],
  ["Look", "label", "Arrows"],
  ["Script", "label", "Script"],
  ["Script", "button", "Apply"],
  ["Script", "button", "Export animation"],
  ["Export", "button", "GIF"],
  ["Export", "button", "WebP"],
  ["Export", "button", "MP4"],
  ["Export", "label", "Nodes"],
  ["Export", "label", "Arrows"],
  ["Export", "label", "Step (ms)"],
  ["Export", "label", "Frames a second"],
  ["Export", "label", "Size"],
  ["Export", "label", "Shape"],
  ["Export", "label", "On the page's background"],
  ["Export", "label", "Fly the camera to each step"],
  ["Export", "button", "Export GIF"],
  ["Export", "button", "Close"],
] as const;

it("AC-638 inventory: every old bar, editor, export and sidebar control has a reachable home", async () => {
  localStorage.clear();
  await renderEditor(
    <Excalidraw>
      <FlowTab />
    </Excalidraw>,
  );
  const sidebar = within(document.querySelector(".flow-tab") as HTMLElement);
  for (const name of [
    "Guide",
    "New preset",
    "Import",
    "Export",
    "Insert chart",
    "Edit chart",
  ]) {
    expect(sidebar.getByRole("button", { name })).not.toBeNull();
  }
  expect(
    sidebar.getByRole("radiogroup", { name: "Kind of chart" }),
  ).not.toBeNull();
  for (const label of [
    "Import presets",
    "Fit mode",
    "Node shape",
    "Arrows",
    "Script",
  ]) {
    expect(sidebar.getByLabelText(label)).not.toBeNull();
  }
  fireEvent.click(sidebar.getByRole("button", { name: "New preset" }));
  for (const label of [
    "Preset name",
    "Preset description",
    "Preset example",
    "Preset layout",
    "Fill 1",
    "Fill 2",
    "Fill 3",
    "Fill 4",
    "Fill 5",
    "Outline colour",
    "Preset shape",
    "Preset arrows",
  ]) {
    expect(sidebar.getByLabelText(label)).not.toBeNull();
  }
  expect(sidebar.getByRole("button", { name: "Save preset" })).not.toBeNull();
  expect(sidebar.getByRole("button", { name: "Cancel" })).not.toBeNull();
  fireEvent.change(sidebar.getByLabelText("Preset name"), {
    target: { value: "Inventory template" },
  });
  fireEvent.change(sidebar.getByLabelText("Preset example"), {
    target: { value: "One\nTwo" },
  });
  fireEvent.click(sidebar.getByRole("button", { name: "Save preset" }));
  for (const name of ["Edit preset", "Duplicate", "Delete preset"]) {
    expect(sidebar.getByRole("button", { name })).not.toBeNull();
  }
  fireEvent.click(sidebar.getByRole("button", { name: "Guide" }));
  expect(
    sidebar.getAllByRole("button", { name: /^Use this example:/ }).length,
  ).toBeGreaterThan(7);
  expect(
    sidebar.getByRole("button", { name: "Use this animated example" }),
  ).not.toBeNull();
  fireEvent.click(sidebar.getByRole("button", { name: "Back to the chart" }));
  const built = buildFlowPreset("process", "Plan\nTeach\nReview", {
    seed: 8,
    chartId: "inventory-test",
  });
  if (!built.ok) {
    throw new Error(built.error);
  }
  act(() => {
    API.setElements(built.elements);
    API.setSelectedElements([built.elements[0]]);
  });
  const panel = within(screen.getByTestId("flow-bar"));
  for (const [tab, kind, control] of CONTROL_INVENTORY) {
    fireEvent.click(panel.getByRole("tab", { name: tab }));
    expect(
      kind === "button"
        ? panel.getByRole("button", { name: control })
        : panel.getByLabelText(control),
    ).not.toBeNull();
  }
  fireEvent.click(panel.getByRole("tab", { name: "Look" }));
  for (const group of [
    "Shape colour",
    "Text colour",
    "Animation colour",
    "Arrow colour",
  ]) {
    for (const swatch of FLOW_SWATCHES) {
      expect(
        panel.getByRole("radio", { name: `${group}: ${swatch.name}` }),
      ).not.toBeNull();
    }
    expect(panel.getByLabelText(`${group}: custom`)).not.toBeNull();
  }
  for (const preset of FLOW_COLOR_PRESETS) {
    expect(
      panel.getByRole("button", { name: `Colour preset: ${preset.name}` }),
    ).not.toBeNull();
  }
  expect(panel.getByLabelText("Move the animation bar")).not.toBeNull();
  expect(
    panel.getByLabelText("Collapse the animation bar into a pill"),
  ).not.toBeNull();
});

it("AC-638 a real chart has a single panel, useful target/plus, tab contents and a keyboard pill", async () => {
  localStorage.clear();
  await renderEditor(<Excalidraw />);
  const built = buildFlowPreset("process", "Plan\nTeach\nReview", {
    seed: 4,
    chartId: "panel-test",
  });
  if (!built.ok) {
    throw new Error(built.error);
  }
  act(() => {
    API.setElements(built.elements);
    API.setSelectedElements([built.elements[0]]);
  });
  const panel = screen.getByTestId("flow-bar");
  expect(
    screen.getByRole("combobox", { name: "Chart or combo" }).textContent,
  ).toBe("This chart");
  fireEvent.click(
    screen.getByRole("button", { name: "Add a chart to a combo" }),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "it remains independent",
  );
  const expected = {
    Look: "Colour presets",
    Animation: "Node animation",
    Script: "Script",
    "Present in class": "Show in class",
    "Save as preset": "Preset name",
    Camera: "Fly the view to each step",
    Export: "Export the animation",
  };
  for (const [name, label] of Object.entries(expected)) {
    fireEvent.click(screen.getByRole("tab", { name }));
    expect(
      screen.getByRole("tabpanel", { name: `${name} options` }),
    ).not.toBeNull();
    expect(
      panel.querySelector(`[aria-label="${label}"]`) ??
        screen.getByLabelText(label),
    ).not.toBeNull();
  }
  expect(localStorage.getItem(FLOW_PANEL_TAB_KEY)).toBe("Export");
  fireEvent.click(
    screen.getByLabelText("Collapse the animation bar into a pill"),
  );
  const pill = screen.getByTestId("flow-bar-pill");
  fireEvent.keyDown(pill, { key: "Enter" });
  expect(screen.getByTestId("flow-bar")).not.toBeNull();
  act(() => {
    window.h.setState({ viewModeEnabled: true });
  });
  expect(screen.queryByTestId("flow-bar")).toBeNull();
});
