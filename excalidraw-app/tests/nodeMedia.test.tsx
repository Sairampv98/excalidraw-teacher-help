/**
 * AC-280 - a picture, GIF or video goes into a node (D-246).
 *
 * The real editor and the real panel: a file is put in a node, and what is on
 * the scene afterwards is read back from the scene - the media element, its
 * crop and its cut, the group that ties it to its node, and the words that stay
 * under it.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { coverCrop, mediaOf } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { NodeMediaDrop, NodeMediaPanel } from "../sidebar/NodeMediaPanel";
import {
  addMediaToNode,
  mediaElementsOfNode,
  nodeAtPoint,
  nodeContainsPoint,
  removeMediaFromNode,
} from "../sidebar/nodeMedia";

// the video of a node goes through the video panel's own insert, which needs a
// browser to read the file: it is put on the scene as the real one does
vi.mock("../sidebar/videoPanel", async () => {
  const { API: testApi } = await import(
    "@excalidraw/excalidraw/tests/helpers/api"
  );

  return {
    insertVideoPanel: async (api: ExcalidrawImperativeAPI) => {
      const panel = testApi.createElement({
        type: "panel",
        x: 5000,
        y: 5000,
        width: 480,
        height: 270,
        panelKind: "video",
      } as never);

      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), panel],
      });

      return { panel, caption: null, track: null };
    },
  };
});

const { h } = window;

/** the size every picture decodes to: wider than a node, so that it is cut */
const NATURAL = { width: 400, height: 200 };

class FakeImage {
  naturalWidth = NATURAL.width;

  naturalHeight = NATURAL.height;

  onload: null | (() => void) = null;

  onerror: null | (() => void) = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const png = (name = "a.png") => new File(["x"], name, { type: "image/png" });

let api: ExcalidrawImperativeAPI;

/** a chart of three labelled nodes, as the Flow tab makes it, with its first node changed */
const chart = (change: (node: ExcalidrawElement) => ExcalidrawElement) => {
  const built = buildFlowPreset("process", "Start\nWork\nFinish", { seed: 5 });

  if (!built.ok) {
    throw new Error(built.error);
  }

  let changed = false;

  return built.elements.map((element) => {
    if (!changed && element.type !== "arrow" && element.type !== "text") {
      changed = true;

      return change(element as ExcalidrawElement);
    }

    return element;
  }) as ExcalidrawElement[];
};

const mount = async (
  elements: ExcalidrawElement[],
  children: React.ReactNode = null,
) => {
  await render(
    <Excalidraw
      onExcalidrawAPI={(value) => {
        api = value!;
      }}
      initialData={{ elements }}
    >
      {children}
    </Excalidraw>,
  );

  // jsdom has no layout, so the editor's own viewport is 0x0
  API.setAppState({ width: 1000, height: 1000 });
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

const textOf = (node: ExcalidrawElement) =>
  live().find(
    (element) => element.type === "text" && element.containerId === node.id,
  );

describe("AC-280 a picture goes into a node", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("AC-280 the picture fills the node, cut and not shrunk", async () => {
    await mount(chart((node) => ({ ...node, type: "ellipse" } as never)));

    const node = firstNode();

    expect(await addMediaToNode(api, node.id, png())).toBe("image");

    const [picture] = mediaElementsOfNode(live(), node.id);

    expect(picture.type).toBe("image");
    // the same box as the node
    expect(picture).toMatchObject({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });
    // and the picture is cut to the box's shape, not shrunk to fit it
    expect((picture as { crop: unknown }).crop).toEqual(
      coverCrop(node, NATURAL),
    );
    // cut to the shape of the node
    expect(mediaOf(picture)).toMatchObject({ of: node.id, shape: "ellipse" });
  });

  it("AC-280 each shape of node has its own cut", async () => {
    for (const [type, roundness, shape] of [
      ["rectangle", null, "rectangle"],
      ["rectangle", { type: 3 }, "rounded"],
      ["ellipse", null, "ellipse"],
      ["diamond", null, "diamond"],
    ] as const) {
      await mount(chart((node) => ({ ...node, type, roundness } as never)));

      const node = firstNode();

      await addMediaToNode(api, node.id, png());

      const [picture] = mediaElementsOfNode(live(), node.id);

      expect(mediaOf(picture)?.shape, `${type} ${shape}`).toBe(shape);

      if (shape === "rounded") {
        expect(mediaOf(picture)!.radius).toBeGreaterThan(0);
      }

      document.body.innerHTML = "";
    }
  });

  it("AC-280 the media, the node and its words are one group, and the words stay", async () => {
    await mount(chart((node) => node));

    const node = firstNode();
    const words = textOf(node)!;

    expect(words).toBeDefined();

    await addMediaToNode(api, node.id, png());

    const [picture] = mediaElementsOfNode(live(), node.id);
    const gid = picture.groupIds[0];

    expect(gid).toBeTruthy();
    expect(firstNodeById(node.id).groupIds).toContain(gid);
    expect(textById(words.id).groupIds).toContain(gid);

    // the words are still there, under the picture, and still say what they said
    expect((textById(words.id) as { text: string }).text).toBe(
      (words as { text: string }).text,
    );
    expect(textById(words.id).isDeleted).toBe(false);
  });

  it("AC-280 a node has one picture: a new one replaces it", async () => {
    await mount(chart((node) => node));

    const node = firstNode();

    await addMediaToNode(api, node.id, png("a.png"));
    const [first] = mediaElementsOfNode(live(), node.id);

    await addMediaToNode(
      api,
      node.id,
      new File(["y"], "b.png", { type: "image/png" }),
    );

    const media = mediaElementsOfNode(live(), node.id);

    expect(media).toHaveLength(1);
    expect(media[0].id).not.toBe(first.id);
  });

  it("AC-280 taking the picture out brings the words back", async () => {
    await mount(chart((node) => node));

    const node = firstNode();
    const words = textOf(node)!;

    await addMediaToNode(api, node.id, png());

    const gid = mediaElementsOfNode(live(), node.id)[0].groupIds[0];

    expect(removeMediaFromNode(api, node.id)).toBe(true);

    expect(mediaElementsOfNode(live(), node.id)).toHaveLength(0);
    // the group that tied them is gone, and the node and its words are as they were
    expect(firstNodeById(node.id).groupIds).not.toContain(gid);
    expect(textById(words.id).groupIds).not.toContain(gid);
    expect(textById(words.id).isDeleted).toBe(false);
    expect(firstNodeById(node.id).isDeleted).toBe(false);

    // and there is nothing more to take out
    expect(removeMediaFromNode(api, node.id)).toBe(false);
  });

  it("AC-280 a file that is not a picture or a video is not taken", async () => {
    await mount(chart((node) => node));

    const node = firstNode();
    const before = api.getSceneElementsIncludingDeleted().length;

    expect(
      await addMediaToNode(
        api,
        node.id,
        new File(["x"], "a.txt", { type: "text/plain" }),
      ),
    ).toBeNull();
    expect(api.getSceneElementsIncludingDeleted()).toHaveLength(before);
  });

  it("AC-280 a video is a panel that fills the node", async () => {
    await mount(chart((node) => ({ ...node, type: "ellipse" } as never)));

    const node = firstNode();

    expect(
      await addMediaToNode(
        api,
        node.id,
        new File(["v"], "a.mp4", { type: "video/mp4" }),
      ),
    ).toBe("video");

    const panels = mediaElementsOfNode(live(), node.id).filter(
      (element) => element.type === "panel",
    );

    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });
    expect(mediaOf(panels[0])?.shape).toBe("ellipse");
    expect(panels[0].groupIds[0]).toBe(firstNodeById(node.id).groupIds[0]);

    // taking it out takes out all of it
    removeMediaFromNode(api, node.id);

    expect(mediaElementsOfNode(live(), node.id)).toHaveLength(0);
  });

  it("AC-280 a point is in a node by its shape", () => {
    const box = { x: 0, y: 0, width: 200, height: 100 };

    expect(
      nodeContainsPoint({ ...box, type: "rectangle" }, { x: 5, y: 5 }),
    ).toBe(true);
    // the corner of an ellipse's box is outside the ellipse, and a diamond's
    expect(nodeContainsPoint({ ...box, type: "ellipse" }, { x: 5, y: 5 })).toBe(
      false,
    );
    expect(
      nodeContainsPoint({ ...box, type: "diamond" }, { x: 20, y: 10 }),
    ).toBe(false);
    expect(
      nodeContainsPoint({ ...box, type: "diamond" }, { x: 100, y: 50 }),
    ).toBe(true);
    expect(
      nodeContainsPoint({ ...box, type: "rectangle" }, { x: 250, y: 50 }),
    ).toBe(false);
  });

  it("AC-280 a file dropped on a node of a chart goes into it, and one dropped elsewhere does not", async () => {
    await mount(
      chart((node) => node),
      <NodeMediaDrop />,
    );

    const node = firstNode();

    // the node and a place that is on no node
    expect(
      nodeAtPoint(live(), {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2,
      })?.id,
    ).toBe(node.id);
    expect(nodeAtPoint(live(), { x: -5000, y: -5000 })).toBeNull();

    // a shape that is not a node of a chart takes no drop
    const plain = API.createElement({
      type: "rectangle",
      x: 3000,
      y: 3000,
      width: 100,
      height: 100,
    });

    expect(nodeAtPoint([plain], { x: 3050, y: 3050 })).toBeNull();

    // jsdom has no DragEvent, so `fireEvent.drop` would drop `clientX` and
    // `clientY`: the event is made by hand, as the sticker bar's tests do
    const drop = (x: number, y: number) => {
      const event = new Event("drop", { bubbles: true, cancelable: true });

      Object.assign(event, {
        clientX: x,
        clientY: y,
        dataTransfer: { files: [png()], types: ["Files"] },
      });

      return document
        .querySelector("canvas.excalidraw__canvas.interactive")!
        .dispatchEvent(event);
    };

    // the editor's own place of a scene point
    const { scrollX, scrollY, zoom } = api.getAppState();
    const at = (x: number, y: number) => [
      (x + scrollX) * zoom.value,
      (y + scrollY) * zoom.value,
    ];

    await act(async () => {
      drop(...(at(-5000, -5000) as [number, number]));
    });
    expect(mediaElementsOfNode(live(), node.id)).toHaveLength(0);

    await act(async () => {
      drop(
        ...(at(node.x + node.width / 2, node.y + node.height / 2) as [
          number,
          number,
        ]),
      );
    });

    await waitFor(() =>
      expect(mediaElementsOfNode(live(), node.id)).toHaveLength(1),
    );
  });

  it("AC-280 the buttons are there for one selected shape and say what they do", async () => {
    await mount(
      chart((node) => node),
      <NodeMediaPanel />,
    );

    // nothing selected: no buttons
    expect(screen.queryByTestId("node-media")).toBeNull();

    const node = firstNode();

    act(() => {
      API.setSelectedElements([node]);
    });

    expect(await screen.findByTestId("node-media-add")).toHaveTextContent(
      "Add picture or video",
    );
    expect(screen.queryByTestId("node-media-remove")).toBeNull();

    await act(async () => {
      await addMediaToNode(api, node.id, png());
    });

    // the picture is selected when it is added, and counts as its node
    expect(await screen.findByTestId("node-media-add")).toHaveTextContent(
      "Replace picture or video",
    );

    fireEvent.click(screen.getByTestId("node-media-remove"));

    expect(mediaElementsOfNode(live(), node.id)).toHaveLength(0);
    await waitFor(() =>
      expect(screen.queryByTestId("node-media-remove")).toBeNull(),
    );

    // an arrow is not a shape that can hold a picture
    const arrow = live().find((element) => element.type === "arrow")!;

    act(() => {
      API.setSelectedElements([arrow]);
    });
    await waitFor(() => expect(screen.queryByTestId("node-media")).toBeNull());
  });
});

const firstNodeById = (id: string) =>
  api.getSceneElementsIncludingDeleted().find((element) => element.id === id)!;

const textById = firstNodeById;

void h;
