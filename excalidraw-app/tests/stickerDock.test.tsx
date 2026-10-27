/**
 * AC-242 - the emoji and GIF bar is a dock like the toolbar (D-216).
 *
 * The real bar and the real docks are mounted together. The pointer is played
 * by hand, as the browser would send it, and what happened is read from the
 * bar's own element and from the place the docks remember.
 */

import React from "react";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import { EdgeDocks } from "../dock/EdgeDocks";
import { DOCK_STORAGE_KEY } from "../dock/dockTypes";
import StickerBar from "../emoji/StickerBar";

const BAR = { x: 152, y: 640, width: 720, height: 56 };

const mount = () =>
  render(
    <Excalidraw>
      <StickerBar />
      <EdgeDocks />
    </Excalidraw>,
  );

const bar = () =>
  document.querySelector<HTMLElement>(".excalidraw-sticker-bar")!;

/** the bar, taken over by its dock */
const docked = async () => {
  await waitFor(() => {
    expect(screen.getByLabelText("Move Emoji panel")).not.toBeNull();
  });
};

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

/** press the grip, take it by (dx, dy) from where it was grabbed, let go */
const dragGrip = (toX: number, toY: number) => {
  const grip = screen.getByLabelText("Move Emoji panel");

  pointer(grip, "pointerdown", BAR.x + 10, BAR.y + 10);
  pointer(window, "pointermove", toX, toY);
  pointer(window, "pointerup", toX, toY);
};

const remembered = () =>
  JSON.parse(window.localStorage.getItem(DOCK_STORAGE_KEY) ?? "{}");

beforeEach(() => {
  window.localStorage.removeItem(DOCK_STORAGE_KEY);
  mockBoundingClientRect({
    x: BAR.x,
    y: BAR.y,
    left: BAR.x,
    top: BAR.y,
    right: BAR.x + BAR.width,
    bottom: BAR.y + BAR.height,
    width: BAR.width,
    height: BAR.height,
  });
});

afterEach(() => {
  window.localStorage.removeItem(DOCK_STORAGE_KEY);
  restoreOriginalGetBoundingClientRect();
});

describe("AC-242 the emoji bar is a dock", () => {
  it("AC-242 the emoji bar is a dock with a move grip and a close button", async () => {
    await mount();
    await docked();

    expect(screen.getByLabelText("Move Emoji panel")).not.toBeNull();
    expect(screen.getByLabelText("Collapse Emoji panel")).not.toBeNull();

    // the bar is the dock's own now: placed by it, as the toolbar is
    expect(bar().classList.contains("excalidraw-dock-target")).toBe(true);
    expect(bar().style.position).toBe("fixed");
    expect(bar().style.left).not.toBe("");
    expect(bar().style.top).not.toBe("");

    // the page bar is not a dock: it is as it was
    expect(screen.queryByLabelText("Move Pages panel")).toBeNull();
  });

  it("AC-242 dragging the grip moves it and it snaps to an edge", async () => {
    await mount();
    await docked();

    const before = { left: bar().style.left, top: bar().style.top };

    // dropped near the left edge
    dragGrip(30, 300);

    expect(bar().style.left).not.toBe(before.left);
    expect(bar().style.top).not.toBe(before.top);

    // and snapped to that edge, a gap from it
    expect(bar().style.left).toBe("6px");
    expect(remembered().stickers).toMatchObject({
      edge: "left",
      placed: true,
    });
  });

  it("AC-242 close turns it into a pill and the pill brings it back", async () => {
    await mount();
    await docked();

    act(() => {
      fireEvent.click(screen.getByLabelText("Collapse Emoji panel"));
    });

    // a pill is left, and the bar is folded into it
    const pill = screen.getByLabelText("Emoji panel, collapsed");

    expect(pill).not.toBeNull();
    expect(bar().classList.contains("excalidraw-dock-target--pill")).toBe(true);
    expect(screen.queryByLabelText("Move Emoji panel")).toBeNull();

    // pressed and let go, the pill opens the bar again
    pointer(pill, "pointerdown", 400, 700);
    pointer(window, "pointerup", 400, 700);

    expect(screen.queryByLabelText("Emoji panel, collapsed")).toBeNull();
    expect(bar().classList.contains("excalidraw-dock-target--pill")).toBe(
      false,
    );
    expect(screen.getByLabelText("Move Emoji panel")).not.toBeNull();
  });

  it("AC-242 its place is remembered", async () => {
    const first = await mount();
    await docked();

    dragGrip(30, 300);

    const place = { left: bar().style.left, top: bar().style.top };

    expect(remembered().stickers).toBeDefined();

    // another session: the dock puts the bar where it was left
    first.unmount();
    await mount();
    await docked();

    expect({ left: bar().style.left, top: bar().style.top }).toEqual(place);
  });

  it("AC-242 its tabs and its search still work", async () => {
    const { container } = await mount();
    await docked();

    // docked, its own controls are the ones that answer
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "GIF" }));
    });

    expect(
      screen.getByRole("tab", { name: "GIF" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelectorAll('[data-sticker-kind="gif"]').length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll('[data-sticker-kind="emoji"]'),
    ).toHaveLength(0);

    act(() => {
      fireEvent.change(screen.getByLabelText("Search stickers"), {
        target: { value: "rocket" },
      });
    });

    expect(
      [...container.querySelectorAll("[data-sticker-id]")].map(
        (item) => (item as HTMLElement).dataset.stickerId,
      ),
    ).toEqual(["rocket-launch"]);
  });
});
