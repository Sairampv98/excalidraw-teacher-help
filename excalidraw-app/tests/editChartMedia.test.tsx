/**
 * AC-285 - the picture of a node is edited in the Edit chart panel (D-247).
 *
 * The Edit script button is Edit chart now, and its panel has the picture of the
 * selected node: Add, Replace, Remove and Crop. The Flow tab has none of them.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  closeFlowScriptEditor,
  openFlowScriptEditor,
} from "@excalidraw/excalidraw/components/FlowScriptEditorState";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { mediaOf } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { closeMediaCrop, mediaCropNode } from "../sidebar/mediaCropState";
import { NodeMediaDrop } from "../sidebar/NodeMediaPanel";
import { FlowTab } from "../sidebar/FlowTab";
import { addMediaToNode, mediaElementsOfNode } from "../sidebar/nodeMedia";

class FakeImage {
  naturalWidth = 400;

  naturalHeight = 200;

  onload: null | (() => void) = null;

  onerror: null | (() => void) = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let api: ExcalidrawImperativeAPI;

const chart = () => {
  const built = buildFlowPreset("process", "Start\nWork\nFinish", { seed: 5 });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements as ExcalidrawElement[];
};

const live = () => api.getSceneElements();

const firstNode = () =>
  live().find(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !mediaOf(element) &&
      element.customData?.flow?.role === "node",
  )!;

const mount = async (children: React.ReactNode) => {
  await render(
    <Excalidraw
      onExcalidrawAPI={(value) => {
        api = value!;
      }}
      initialData={{ elements: chart() }}
    >
      <NodeMediaDrop />
      {children}
    </Excalidraw>,
  );
  API.setAppState({ width: 1000, height: 1000 });
};

describe("AC-285 the picture of a node is edited in the Edit chart panel", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    act(() => {
      closeFlowScriptEditor();
      closeMediaCrop();
    });
    vi.unstubAllGlobals();
  });

  it("AC-285 the panel is Edit chart and has the picture of the selected node", async () => {
    await mount(null);

    const node = firstNode();

    act(() => {
      API.setSelectedElements([node]);
      openFlowScriptEditor(node.id);
    });

    const panel = await screen.findByRole("dialog", { name: "Edit chart" });

    expect(panel.textContent).toContain("Edit chart");
    expect(screen.queryByRole("dialog", { name: "Edit script" })).toBeNull();

    // the node has no picture: it can have one
    expect(await screen.findByTestId("node-media-add")).toHaveTextContent(
      "Add picture or video",
    );
    expect(screen.queryByTestId("node-media-remove")).toBeNull();
    expect(screen.queryByTestId("node-media-crop")).toBeNull();
    expect(panel.contains(screen.getByTestId("node-media"))).toBe(true);

    // a picture is put in: Replace, Crop and Remove
    await act(async () => {
      await addMediaToNode(
        api,
        node.id,
        new File(["x"], "a.png", { type: "image/png" }),
      );
    });

    expect(await screen.findByTestId("node-media-add")).toHaveTextContent(
      "Replace picture or video",
    );
    expect(screen.getByTestId("node-media-crop")).not.toBeNull();
    expect(screen.getByTestId("node-media-remove")).not.toBeNull();

    // Crop opens the crop screen on the node's picture
    fireEvent.click(screen.getByTestId("node-media-crop"));
    expect(mediaCropNode()).toBe(node.id);
    act(() => closeMediaCrop());

    // Remove takes it out, and the node has Add again
    fireEvent.click(screen.getByTestId("node-media-remove"));
    expect(mediaElementsOfNode(live(), node.id)).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByTestId("node-media-add")).toHaveTextContent(
        "Add picture or video",
      ),
    );
  });

  it("AC-285 the Flow tab has the Edit chart button and no picture buttons", async () => {
    await mount(<FlowTab />);

    const node = firstNode();

    act(() => {
      API.setSelectedElements([node]);
    });

    // the button is Edit chart, and there is no Edit script
    expect(document.querySelector(".flow-tab__edit")?.textContent).toBe(
      "Edit chart",
    );
    expect(screen.queryByRole("button", { name: "Edit script" })).toBeNull();

    // with a node selected the Flow tab has none of the picture buttons
    await act(async () => {});
    expect(screen.queryByTestId("node-media")).toBeNull();
    expect(screen.queryByTestId("node-media-add")).toBeNull();
  });

  it("AC-285 the panel of a node with a picture opens from the picture too", async () => {
    await mount(null);

    const node = firstNode();

    await act(async () => {
      await addMediaToNode(
        api,
        node.id,
        new File(["x"], "a.png", { type: "image/png" }),
      );
    });

    // the picture is what is selected, as it is after it is put in
    const [picture] = mediaElementsOfNode(live(), node.id);

    act(() => {
      API.setSelectedElements([picture]);
      openFlowScriptEditor(picture.id);
    });

    await screen.findByRole("dialog", { name: "Edit chart" });
    expect(await screen.findByTestId("node-media-crop")).not.toBeNull();
  });
});
