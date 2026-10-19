import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  acceptsDrop,
  armImageDragOnCanvas,
  cancelImageDrag,
  DRAG_MIME,
  pendingImageDrag,
} from "../sidebar/insertIntoScene";

/** 0,0 -> 800,600 in viewport coordinates */
const RECT = { left: 0, top: 0, right: 800, bottom: 600 };

/**
 * Enough of the imperative API for the drop path: the release point is read
 * synchronously, before the (async) insert starts.
 */
const API = {
  getAppState: () => ({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
} as unknown as ExcalidrawImperativeAPI;

const file = (name = "photo.png") =>
  new File(["x"], name, { type: "image/png" });

/**
 * jsdom has no DragEvent and no DataTransfer, so the event is a plain cancelable
 * Event with the handful of drag properties the handler reads.
 */
const dragEvent = (
  type: "dragover" | "drop",
  { clientX, clientY }: { clientX: number; clientY: number },
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "dataTransfer", {
    value: { dropEffect: "none", setData: vi.fn() },
  });

  return event;
};

const mountCanvas = () => {
  const canvas = document.createElement("canvas");
  canvas.className = "excalidraw__canvas";
  canvas.getBoundingClientRect = () =>
    ({ ...RECT, width: RECT.right, height: RECT.bottom } as DOMRect);

  document.body.appendChild(canvas);

  return canvas;
};

describe("acceptsDrop", () => {
  it("takes a point inside the canvas", () => {
    expect(
      acceptsDrop({
        clientX: 400,
        clientY: 300,
        rect: RECT,
        overSidebar: false,
      }),
    ).toBe(true);
  });

  it("includes the edges", () => {
    expect(
      acceptsDrop({ clientX: 0, clientY: 0, rect: RECT, overSidebar: false }),
    ).toBe(true);
    expect(
      acceptsDrop({
        clientX: 800,
        clientY: 600,
        rect: RECT,
        overSidebar: false,
      }),
    ).toBe(true);
  });

  it("rejects a point outside the canvas", () => {
    expect(
      acceptsDrop({
        clientX: -1,
        clientY: 300,
        rect: RECT,
        overSidebar: false,
      }),
    ).toBe(false);
    expect(
      acceptsDrop({
        clientX: 400,
        clientY: 601,
        rect: RECT,
        overSidebar: false,
      }),
    ).toBe(false);
  });

  it("rejects the sidebar even though it overlaps the canvas", () => {
    // the sidebar is an absolute overlay, so this point is inside the canvas
    // rect *and* on top of it
    expect(
      acceptsDrop({
        clientX: 700,
        clientY: 300,
        rect: RECT,
        overSidebar: true,
      }),
    ).toBe(false);
  });
});

describe("armImageDragOnCanvas", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cancelImageDrag();
    document.body.innerHTML = "";
  });

  it("uses a private mime type so no real file is published", () => {
    expect(DRAG_MIME).toBe("application/x-excalidraw-app-sidebar-file");
    expect(DRAG_MIME).not.toContain("text/plain");
  });

  it("stashes the file and accepts a drop over the canvas", () => {
    mountCanvas();

    armImageDragOnCanvas(API, file());
    expect(pendingImageDrag()?.name).toBe("photo.png");

    const event = dragEvent("dragover", { clientX: 400, clientY: 300 });
    window.dispatchEvent(event);

    // preventDefault is what allows the drop at all
    expect(event.defaultPrevented).toBe(true);
    expect((event as any).dataTransfer.dropEffect).toBe("copy");
  });

  it("leaves the drop unaccepted off the canvas", () => {
    mountCanvas();

    armImageDragOnCanvas(API, file());

    const event = dragEvent("dragover", { clientX: 400, clientY: 900 });
    window.dispatchEvent(event);

    // no preventDefault means the browser ends the drag here on its own
    expect(event.defaultPrevented).toBe(false);
    expect(pendingImageDrag()?.name).toBe("photo.png");
  });

  it("does nothing once there is no armed file", () => {
    mountCanvas();

    const event = dragEvent("dragover", { clientX: 400, clientY: 300 });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("spends the stash on the drop and tells the caller", () => {
    mountCanvas();

    const onConsumed = vi.fn();
    armImageDragOnCanvas(API, file(), onConsumed);

    const event = dragEvent("drop", { clientX: 400, clientY: 300 });
    window.dispatchEvent(event);

    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(pendingImageDrag()).toBe(null);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps the stash when the release lands off the canvas", () => {
    mountCanvas();

    const onConsumed = vi.fn();
    armImageDragOnCanvas(API, file(), onConsumed);

    const event = dragEvent("drop", { clientX: 900, clientY: 300 });
    window.dispatchEvent(event);

    expect(onConsumed).not.toHaveBeenCalled();
    expect(pendingImageDrag()?.name).toBe("photo.png");
    expect(event.defaultPrevented).toBe(false);
  });

  it("inserts once per drag even if a second drop arrives", () => {
    mountCanvas();

    const onConsumed = vi.fn();
    armImageDragOnCanvas(API, file(), onConsumed);

    window.dispatchEvent(dragEvent("drop", { clientX: 400, clientY: 300 }));
    const second = dragEvent("drop", { clientX: 400, clientY: 300 });
    window.dispatchEvent(second);

    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it("detaches its listeners when cancelled", () => {
    mountCanvas();

    const cancel = armImageDragOnCanvas(API, file());
    cancel();

    const event = dragEvent("dragover", { clientX: 400, clientY: 300 });
    window.dispatchEvent(event);

    expect(pendingImageDrag()).toBe(null);
    expect(event.defaultPrevented).toBe(false);
  });

  it("re-arming replaces the previous drag and detaches its listeners", () => {
    mountCanvas();

    armImageDragOnCanvas(API, file("first.png"));
    armImageDragOnCanvas(API, file("second.png"));

    expect(pendingImageDrag()?.name).toBe("second.png");

    const event = dragEvent("dragover", { clientX: 400, clientY: 300 });
    window.dispatchEvent(event);

    // exactly one listener is live, so the event is handled once
    expect(event.defaultPrevented).toBe(true);
  });

  it("stays unarmed when there is no canvas to drop onto", () => {
    armImageDragOnCanvas(API, file());

    expect(pendingImageDrag()).toBe(null);
  });
});
