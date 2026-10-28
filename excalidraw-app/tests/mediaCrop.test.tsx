/**
 * AC-284 - the crop screen of the media of a node (D-247).
 *
 * The real editor and the real screen: it is opened on a node's picture, the
 * fits and the crop box are used with the pointer and the keyboard, and what is
 * kept is read back from the picture on the scene.
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
import { mediaOf, newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { MediaCropMode } from "../sidebar/MediaCrop";
import {
  closeMediaCrop,
  mediaCropNode,
  openMediaCrop,
} from "../sidebar/mediaCropState";
import { NodeMediaDrop } from "../sidebar/NodeMediaPanel";
import { addMediaToNode, mediaElementsOfNode } from "../sidebar/nodeMedia";

/** the size every picture decodes to */
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

let api: ExcalidrawImperativeAPI;

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

const live = () => api.getSceneElements();

const firstNode = () =>
  live().find(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !mediaOf(element) &&
      element.customData?.flow?.role === "node",
  )!;

/** a node with a picture in it, and the crop screen mounted */
const mountWithPicture = async (
  change: (node: ExcalidrawElement) => ExcalidrawElement = (node) => node,
) => {
  await render(
    <Excalidraw
      onExcalidrawAPI={(value) => {
        api = value!;
      }}
      initialData={{ elements: chart(change) }}
    >
      <NodeMediaDrop />
      <MediaCropMode />
    </Excalidraw>,
  );
  API.setAppState({ width: 1000, height: 1000 });

  const node = firstNode();

  await act(async () => {
    await addMediaToNode(
      api,
      node.id,
      new File(["x"], "a.png", { type: "image/png" }),
    );
  });

  return node;
};

const picture = (nodeId: string) => mediaElementsOfNode(live(), nodeId)[0];

const open = (nodeId: string) => act(() => openMediaCrop(nodeId));

const boxOf = () => {
  const box = screen.getByTestId("media-crop-box");

  return {
    x: Number(box.getAttribute("x")),
    y: Number(box.getAttribute("y")),
    w: Number(box.getAttribute("width")),
    h: Number(box.getAttribute("height")),
  };
};

/** a pointer event at a place: jsdom has no PointerEvent, so it is made by hand */
const pointer = (
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) =>
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      }),
    );
  });

const pressed = () =>
  (["auto", "crop", "best", "inside"] as const).filter(
    (fit) =>
      screen
        .getByTestId(`media-crop-fit-${fit}`)
        .getAttribute("aria-pressed") === "true",
  );

describe("AC-284 the crop screen", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    act(() => closeMediaCrop());
    vi.unstubAllGlobals();
  });

  it("AC-284 it shows the whole picture with a crop box, a grid, handles and the bar", async () => {
    const node = await mountWithPicture();

    expect(screen.queryByTestId("media-crop")).toBeNull();

    open(node.id);

    expect(await screen.findByTestId("media-crop")).not.toBeNull();
    expect(screen.getByTestId("media-crop-image")).not.toBeNull();

    // the four fits, with the one the media has pressed
    for (const fit of ["auto", "crop", "best", "inside"]) {
      expect(screen.getByTestId(`media-crop-fit-${fit}`)).not.toBeNull();
    }
    expect(pressed()).toEqual(["auto"]);

    // Reset, Cancel and Apply
    for (const name of ["reset", "cancel", "apply"]) {
      expect(screen.getByTestId(`media-crop-${name}`)).not.toBeNull();
    }

    // eight handles, and the rule of thirds: two lines each way
    expect(document.querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(screen.getAllByTestId("media-crop-grid")).toHaveLength(2);
    expect(document.querySelectorAll(".media-crop__grid line")).toHaveLength(4);

    // everything outside the shape is dimmed
    expect(screen.getByTestId("media-crop-dim").getAttribute("fill-rule")).toBe(
      "evenodd",
    );

    // the crop box has the node's shape, whole picture behind it
    const box = boxOf();

    expect(box.w / box.h).toBeCloseTo(node.width / node.height, 4);
  });

  it("AC-284 the crop box has the node's shape", async () => {
    const outlineOf = async (
      change: (node: ExcalidrawElement) => ExcalidrawElement,
    ) => {
      const node = await mountWithPicture(change);

      open(node.id);
      await screen.findByTestId("media-crop");

      const d = document
        .querySelector(".media-crop__outline")!
        .getAttribute("d")!;

      act(() => closeMediaCrop());
      document.body.innerHTML = "";

      return d;
    };

    expect(
      await outlineOf(
        (n) => ({ ...n, type: "ellipse", roundness: null } as never),
      ),
    ).toMatch(/\ba /);
    expect(
      await outlineOf(
        (n) => ({ ...n, type: "diamond", roundness: null } as never),
      ),
    ).toMatch(/L/);
    expect(
      await outlineOf(
        (n) => ({ ...n, type: "rectangle", roundness: null } as never),
      ),
    ).not.toMatch(/[AaL]/);
    // a rounded node's has arcs at its corners
    expect(
      await outlineOf(
        (n) => ({ ...n, type: "rectangle", roundness: { type: 3 } } as never),
      ),
    ).toMatch(/A /);
  });

  it("AC-284 each fit shows what it says", async () => {
    const node = await mountWithPicture(
      (n) => ({ ...n, type: "ellipse", roundness: null } as never),
    );

    open(node.id);
    await screen.findByTestId("media-crop");

    const image = screen.getByTestId("media-crop-image");
    const imageBox = () => ({
      w: parseFloat((image as HTMLElement).style.width),
      h: parseFloat((image as HTMLElement).style.height),
    });
    const sameShape = () => {
      const box = boxOf();

      expect(box.w / box.h).toBeCloseTo(node.width / node.height, 4);

      return box;
    };

    // auto crop: the box is inside the picture
    const auto = sameShape();

    expect(auto.w).toBeLessThanOrEqual(imageBox().w + 1e-6);
    expect(auto.h).toBeLessThanOrEqual(imageBox().h + 1e-6);

    // best fit: the box holds the whole picture
    fireEvent.click(screen.getByTestId("media-crop-fit-best"));
    expect(pressed()).toEqual(["best"]);

    const best = sameShape();

    expect(best.w).toBeGreaterThanOrEqual(imageBox().w - 1e-6);
    expect(best.h).toBeGreaterThanOrEqual(imageBox().h - 1e-6);

    // fit into the shape: the box is bigger still, so that the corners are inside the outline
    fireEvent.click(screen.getByTestId("media-crop-fit-inside"));
    expect(pressed()).toEqual(["inside"]);
    expect(sameShape().w).toBeGreaterThan(best.w);

    // Reset is auto crop again
    fireEvent.click(screen.getByTestId("media-crop-reset"));
    expect(pressed()).toEqual(["auto"]);
    expect(boxOf()).toEqual(auto);
  });

  it("AC-284 dragging a handle or the box is a crop in", async () => {
    const node = await mountWithPicture();

    open(node.id);
    await screen.findByTestId("media-crop");

    const before = boxOf();

    // a corner dragged in makes the box smaller, in the same shape, the other corner staying
    const se = screen.getByTestId("media-crop-handle-se");

    pointer(se, "pointerdown", before.x + before.w, before.y + before.h);
    pointer(
      window,
      "pointermove",
      before.x + before.w - 60,
      before.y + before.h - 30,
    );
    pointer(
      window,
      "pointerup",
      before.x + before.w - 60,
      before.y + before.h - 30,
    );

    const smaller = boxOf();

    expect(pressed()).toEqual(["crop"]);
    expect(smaller.w).toBeLessThan(before.w);
    expect(smaller.w / smaller.h).toBeCloseTo(before.w / before.h, 4);
    expect(smaller.x).toBeCloseTo(before.x, 4);
    expect(smaller.y).toBeCloseTo(before.y, 4);

    // the box itself is dragged to move it, keeping its size
    pointer(
      screen.getByTestId("media-crop-box"),
      "pointerdown",
      smaller.x + 10,
      smaller.y + 10,
    );
    pointer(window, "pointermove", smaller.x + 30, smaller.y + 15);
    pointer(window, "pointerup", smaller.x + 30, smaller.y + 15);

    const moved = boxOf();

    expect(moved.w).toBeCloseTo(smaller.w, 4);
    expect(moved.x).toBeCloseTo(smaller.x + 20, 3);
    expect(moved.y).toBeCloseTo(smaller.y + 5, 3);
  });

  it("AC-284 Apply keeps the fit and the crop on the picture, Cancel and Esc keep nothing", async () => {
    // an ellipse: fit into the shape is smaller than the box, so its view is bigger
    const node = await mountWithPicture(
      (n) => ({ ...n, type: "ellipse", roundness: null } as never),
    );
    const kept = () => mediaOf(picture(node.id))!;

    expect(kept().fit).toBe("auto");

    // Cancel
    open(node.id);
    fireEvent.click(await screen.findByTestId("media-crop-fit-best"));
    fireEvent.click(screen.getByTestId("media-crop-cancel"));
    expect(screen.queryByTestId("media-crop")).toBeNull();
    expect(kept().fit).toBe("auto");

    // Esc
    open(node.id);
    fireEvent.click(await screen.findByTestId("media-crop-fit-best"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("media-crop")).toBeNull();
    expect(kept().fit).toBe("auto");

    // Apply of a fit
    open(node.id);
    fireEvent.click(await screen.findByTestId("media-crop-fit-inside"));
    fireEvent.click(screen.getByTestId("media-crop-apply"));
    expect(screen.queryByTestId("media-crop")).toBeNull();
    expect(kept().fit).toBe("inside");
    // the whole picture is in the view, which reaches past it
    expect(kept().view!.width).toBeGreaterThan(NATURAL.width);

    // Apply of a crop of the teacher's own, with Enter
    open(node.id);

    const box = await waitFor(() => boxOf());
    const handle = screen.getByTestId("media-crop-handle-se");

    pointer(handle, "pointerdown", box.x + box.w, box.y + box.h);
    pointer(window, "pointermove", box.x + box.w * 0.5, box.y + box.h * 0.5);
    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.queryByTestId("media-crop")).toBeNull();
    expect(kept().fit).toBe("crop");
    expect(kept().view!.width).toBeLessThan(NATURAL.width);
    // the picture on the scene has the same view, and the picture is still the node's size
    expect(picture(node.id)).toMatchObject({
      width: node.width,
      height: node.height,
    });
  });

  it("AC-284 a crop is kept when the node moves, and the fit is made again when its size changes", async () => {
    const node = await mountWithPicture();

    open(node.id);
    await screen.findByTestId("media-crop");

    const box = boxOf();

    pointer(
      screen.getByTestId("media-crop-handle-se"),
      "pointerdown",
      box.x + box.w,
      box.y + box.h,
    );
    pointer(window, "pointermove", box.x + box.w * 0.6, box.y + box.h * 0.6);
    fireEvent.click(screen.getByTestId("media-crop-apply"));

    const kept = { ...mediaOf(picture(node.id))!.view! };

    const change = (updates: Record<string, unknown>) =>
      act(() => {
        api.updateScene({
          elements: api
            .getSceneElementsIncludingDeleted()
            .map((element) =>
              element.id === node.id
                ? newElementWith(element, updates as never)
                : element,
            ),
        });
      });

    // moved: the crop is the same
    change({ x: node.x + 30, y: node.y + 10 });
    await waitFor(() => expect(picture(node.id).x).toBeCloseTo(node.x + 30));
    expect(mediaOf(picture(node.id))!.view).toEqual(kept);

    // made twice as wide: it is still a crop, and has the box's new shape
    change({ width: node.width * 2 });
    await waitFor(() =>
      expect(picture(node.id).width).toBeCloseTo(node.width * 2),
    );

    const view = mediaOf(picture(node.id))!.view!;

    expect(mediaOf(picture(node.id))!.fit).toBe("crop");
    expect(view.width / view.height).toBeCloseTo(
      (node.width * 2) / node.height,
      4,
    );
  });

  it("AC-284 a double click on the picture opens it", async () => {
    const node = await mountWithPicture();

    expect(mediaCropNode()).toBeNull();

    const { scrollX, scrollY, zoom } = api.getAppState();
    const event = new Event("dblclick", { bubbles: true, cancelable: true });

    Object.assign(event, {
      clientX: (node.x + node.width / 2 + scrollX) * zoom.value,
      clientY: (node.y + node.height / 2 + scrollY) * zoom.value,
    });

    await act(async () => {
      document
        .querySelector("canvas.excalidraw__canvas.interactive")!
        .dispatchEvent(event);
    });

    expect(mediaCropNode()).toBe(node.id);
    expect(await screen.findByTestId("media-crop")).not.toBeNull();

    // away from a picture, a double click is the editor's own
    act(() => closeMediaCrop());

    const away = new Event("dblclick", { bubbles: true, cancelable: true });

    Object.assign(away, { clientX: -4000, clientY: -4000 });

    await act(async () => {
      document
        .querySelector("canvas.excalidraw__canvas.interactive")!
        .dispatchEvent(away);
    });

    expect(mediaCropNode()).toBeNull();
  });

  it("AC-284 the crop screen has Replace and Remove for the picture", async () => {
    const node = await mountWithPicture();
    const first = picture(node.id);
    const words = () =>
      live().find(
        (element) =>
          element.type === "text" && element.customData?.flow?.role === "label",
      );

    // Replace: a new file is the new picture, and the screen is open on it again
    open(node.id);
    await screen.findByTestId("media-crop");
    expect(screen.getByTestId("media-crop-replace")).not.toBeNull();

    await act(async () => {
      fireEvent.change(screen.getByTestId("media-crop-replace-input"), {
        target: {
          files: [new File(["y"], "b.png", { type: "image/png" })],
        },
      });
    });

    await waitFor(() => expect(picture(node.id).id).not.toBe(first.id));
    expect(mediaElementsOfNode(live(), node.id)).toHaveLength(1);
    expect(await screen.findByTestId("media-crop")).not.toBeNull();

    // Remove: the picture goes, the screen closes and the words are back in the node
    fireEvent.click(screen.getByTestId("media-crop-remove"));

    expect(screen.queryByTestId("media-crop")).toBeNull();
    expect(mediaElementsOfNode(live(), node.id)).toHaveLength(0);

    const back = live().find(
      (element) => element.type === "text" && element.containerId === node.id,
    );

    expect(back).toBeDefined();
    expect(words()).toBeDefined();
  });

  it("AC-284 the crop screen has the choice of the words of the node", async () => {
    const node = await mountWithPicture();
    const note = () =>
      live().find(
        (element) =>
          element.type === "text" &&
          (element.containerId === node.id ||
            element.customData?.caption?.of === node.id),
      ) as ExcalidrawTextElement;

    open(node.id);

    const choice = (await screen.findByTestId(
      "media-crop-words",
    )) as HTMLSelectElement;

    // a caption to begin with, and the two choices
    expect(choice.value).toBe("caption");
    expect([...choice.options].map((option) => option.value)).toEqual([
      "caption",
      "hidden",
    ]);
    expect(note().containerId).toBeNull();

    // hidden: at once, whatever is done with the crop after it
    fireEvent.change(choice, { target: { value: "hidden" } });
    expect(note().containerId).toBe(node.id);
    expect(note().opacity).toBe(0);
    expect(note().locked).toBe(true);
    expect(mediaOf(picture(node.id))!.words).toBe("hidden");

    // Cancel does not take it back: it is the node's, and not part of the crop
    fireEvent.click(screen.getByTestId("media-crop-cancel"));
    expect(note().locked).toBe(true);

    // and the screen opens on what it is
    open(node.id);
    expect(
      ((await screen.findByTestId("media-crop-words")) as HTMLSelectElement)
        .value,
    ).toBe("hidden");

    fireEvent.change(screen.getByTestId("media-crop-words"), {
      target: { value: "caption" },
    });
    expect(note().containerId).toBeNull();
    expect(note().locked).toBeFalsy();
  });
});
