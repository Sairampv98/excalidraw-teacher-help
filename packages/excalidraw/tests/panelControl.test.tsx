/**
 * The **control** of the mirrored editor window: the three modes, the way a
 * point of the view becomes a point of the window, the switch, the mouse and
 * the keyboard (D-322 to D-328).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render as renderComponent } from "@testing-library/react";

import type {
  ExcalidrawPanelElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { usePanelControlSurface } from "../components/usePanelControlSurface";
import {
  codePanelContent,
  emptyCodePanelState,
  withPanelMirror,
  withPanelView,
} from "../scene/panelContent";
import {
  DEFAULT_FOLLOW_REGION,
  getAnyPanelMirrorPicker,
  closePanelMirrorPicker,
  panelMirrorMode,
  panelPointInView,
  panelPointToWindow,
  withPanelMirrorMode,
} from "../scene/panelMirror";
import {
  CONTROL_RELEASE_CHORD,
  PANEL_MOVE_INTERVAL_MS,
  PANEL_TEXT_MAX,
  isMachineChord,
  panelKeyEvent,
  panelTextEvents,
  panelWheelNotches,
} from "../scene/panelControl";
import { clearAllPanelCaptures, setPanelCapture } from "../scene/panelFrames";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { CodePanelState } from "../scene/panelContent";
import type { PanelInputEvent } from "../scene/panelControl";
import type { PanelMirror, PanelMirrorRegion } from "../scene/panelMirror";

const connectedState = (): CodePanelState => ({
  ...emptyCodePanelState(),
  connection: "connected",
  statusMessage: "Connected to the Excalidraw Bridge.",
  editor: {
    uri: "file:///demo/main.py",
    language: "python",
    text: "print('hello')",
    selection: { start: 0, end: 0 },
    version: 3,
  },
});

/** A code panel in the live view, with a mirror. */
const livePanel = (mirror?: PanelMirror): ExcalidrawPanelElement => {
  const content = withPanelView(
    codePanelContent(connectedState(), "session-1"),
    "live",
  );

  return API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: mirror ? withPanelMirror(content, mirror) : content,
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;
};

const asElement = (panel: ExcalidrawPanelElement) =>
  panel as unknown as NonDeletedExcalidrawElement;

const STREAM = "http://127.0.0.1:47511/s/a-capability/frame";

const REGION: PanelMirrorRegion = { x: 0.25, y: 0.1, width: 0.5, height: 0.4 };

const BACKGROUND = {
  enabled: false,
  route: "background" as const,
  reason: "input goes to the editor's window without taking the focus",
};

afterEach(() => {
  act(() => {
    clearAllPanelCaptures();
  });

  const picker = getAnyPanelMirrorPicker();

  if (picker) {
    closePanelMirrorPicker(picker.panelId);
  }
});

/** The box of a view: where the pointer is read against. */
const giveBox = (
  element: HTMLElement,
  box: { left: number; top: number; width: number; height: number },
) => {
  element.getBoundingClientRect = () => ({ ...box } as DOMRect);
};

describe("the three modes of the mirror (D-322)", () => {
  it("AC-365 a mode is read from the mirror and written back", () => {
    // no region is the whole window, a region is a part, a region that follows
    // is a follow
    expect(panelMirrorMode({ region: null, follow: false })).toBe("whole");
    expect(panelMirrorMode({ region: REGION, follow: false })).toBe("part");
    expect(panelMirrorMode({ region: REGION, follow: true })).toBe("follow");

    // a follow with no region is not a follow: there is nothing to move
    expect(panelMirrorMode({ region: null, follow: true })).toBe("whole");

    // whole forgets the region and the follow
    expect(
      withPanelMirrorMode({ region: REGION, follow: true }, "whole"),
    ).toEqual({ region: null, follow: false });

    // part keeps the region and stops following
    expect(
      withPanelMirrorMode({ region: REGION, follow: true }, "part"),
    ).toEqual({ region: REGION, follow: false });

    // and with no region there is nothing to keep: it stays whole
    expect(
      withPanelMirrorMode({ region: null, follow: false }, "part"),
    ).toEqual({ region: null, follow: false });

    // follow keeps the region and follows
    expect(
      withPanelMirrorMode({ region: REGION, follow: false }, "follow"),
    ).toEqual({ region: REGION, follow: true });
  });

  it("AC-365 a follow with no region starts in the middle", () => {
    const started = withPanelMirrorMode(
      { region: null, follow: false },
      "follow",
    );

    expect(started).toEqual({ region: DEFAULT_FOLLOW_REGION, follow: true });

    // 40% by 40%, centred
    expect(DEFAULT_FOLLOW_REGION.width).toBe(0.4);
    expect(DEFAULT_FOLLOW_REGION.height).toBe(0.4);
    expect(
      DEFAULT_FOLLOW_REGION.x + DEFAULT_FOLLOW_REGION.width / 2,
    ).toBeCloseTo(0.5, 6);
    expect(
      DEFAULT_FOLLOW_REGION.y + DEFAULT_FOLLOW_REGION.height / 2,
    ).toBeCloseTo(0.5, 6);
  });

  it("AC-365 the panel has one control with the three modes", async () => {
    const onChange = vi.fn();
    const panel = livePanel({ region: REGION, follow: false });

    await render(<Excalidraw panelMirror={{ onChange }} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
      });
    });

    const modes = await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-mirror-modes"]',
      );

      expect(found).not.toBeNull();

      return found as HTMLElement;
    });

    // one control, three choices - and nothing else of the mirror beside it
    const buttons = [...modes.querySelectorAll("button")];

    expect(
      buttons.map((button) => button.getAttribute("data-mode-option")),
    ).toEqual(["whole", "part", "follow"]);
    expect(
      document.querySelectorAll(".excalidraw__panel-code-mirror"),
    ).toHaveLength(3);
    expect(modes.getAttribute("data-mode")).toBe("part");

    // the lit choice is the mode
    expect(
      buttons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["false", "true", "false"]);
  });

  it("AC-365 each mode reaches the host and lights its choice", async () => {
    const onChange = vi.fn();
    const panel = livePanel({ region: REGION, follow: false });

    await render(<Excalidraw panelMirror={{ onChange }} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
      });
    });

    const button = async (testId: string) =>
      (await waitFor(() => {
        const found = document.querySelector(`[data-testid="${testId}"]`);

        expect(found).not.toBeNull();

        return found;
      })) as HTMLButtonElement;

    // part -> follow keeps the region
    fireEvent.click(await button("code-panel-mirror-follow"));
    expect(onChange).toHaveBeenLastCalledWith(panel.id, {
      region: REGION,
      follow: true,
    });
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="code-panel-mirror-modes"]')
          ?.getAttribute("data-mode"),
      ).toBe("follow"),
    );

    // follow -> part keeps the region and stops following
    fireEvent.click(await button("code-panel-mirror-region"));
    expect(onChange).toHaveBeenLastCalledWith(panel.id, {
      region: REGION,
      follow: false,
    });
    expect(getAnyPanelMirrorPicker()).toBeNull();
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="code-panel-mirror-modes"]')
          ?.getAttribute("data-mode"),
      ).toBe("part"),
    );

    // part -> whole forgets the region
    fireEvent.click(await button("code-panel-mirror-whole"));
    expect(onChange).toHaveBeenLastCalledWith(panel.id, {
      region: null,
      follow: false,
    });
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="code-panel-mirror-modes"]')
          ?.getAttribute("data-mode"),
      ).toBe("whole"),
    );

    // whole -> follow starts in the middle, with a region of its own
    fireEvent.click(await button("code-panel-mirror-follow"));
    expect(onChange).toHaveBeenLastCalledWith(panel.id, {
      region: DEFAULT_FOLLOW_REGION,
      follow: true,
    });

    // part, when it is the mode already, is the picker: it is how a part is
    // drawn again
    fireEvent.click(await button("code-panel-mirror-region"));
    expect(getAnyPanelMirrorPicker()).toBeNull();
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="code-panel-mirror-modes"]')
          ?.getAttribute("data-mode"),
      ).toBe("part"),
    );
    fireEvent.click(await button("code-panel-mirror-region"));
    expect(getAnyPanelMirrorPicker()?.panelId).toBe(panel.id);
  });
});

describe("a point of the view is a point of the window (D-324)", () => {
  it("AC-366 the whole window maps a point to itself", () => {
    expect(panelPointToWindow(null, { x: 0.3, y: 0.7 })).toEqual({
      x: 0.3,
      y: 0.7,
    });
    expect(panelPointToWindow(null, { x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
  });

  it("AC-366 a region maps its corners to the region's own corners", () => {
    expect(panelPointToWindow(REGION, { x: 0, y: 0 })).toEqual({
      x: 0.25,
      y: 0.1,
    });
    expect(panelPointToWindow(REGION, { x: 1, y: 1 })).toEqual({
      x: 0.75,
      y: 0.5,
    });
    expect(panelPointToWindow(REGION, { x: 0.5, y: 0.5 })).toEqual({
      x: 0.5,
      y: 0.3,
    });
    expect(panelPointToWindow(REGION, { x: 1, y: 0 })).toEqual({
      x: 0.75,
      y: 0.1,
    });
  });

  it("AC-366 a point outside the view is held on its edge", () => {
    const box = { left: 100, top: 50, width: 200, height: 100 };

    expect(panelPointInView(box, { x: 200, y: 100 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(panelPointInView(box, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(panelPointInView(box, { x: 5000, y: 5000 })).toEqual({ x: 1, y: 1 });
    expect(panelPointInView(box, { x: 100, y: 150 })).toEqual({ x: 0, y: 1 });

    // a box with no size has no places: its middle is the answer
    expect(
      panelPointInView(
        { left: 0, top: 0, width: 0, height: 0 },
        { x: 9, y: 9 },
      ),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it("AC-366 the point does not depend on the size or the zoom of the view", async () => {
    const events: PanelInputEvent[] = [];
    const Harness = ({
      box,
    }: {
      box: { left: number; top: number; width: number; height: number };
    }) => {
      const ref = useRef<HTMLDivElement | null>(null);
      const surface = usePanelControlSurface({
        panelId: "p",
        enabled: true,
        region: REGION,
        boxRef: ref,
        onInput: (_panelId, event) => events.push(event),
      });

      return (
        <div
          data-testid="surface"
          ref={(element) => {
            ref.current = element;

            if (element) {
              giveBox(element, box);
            }
          }}
          {...surface.handlers}
        />
      );
    };

    // the same place - a quarter across, three quarters down - in a view at
    // the canvas's zoom of one, and in the same view at three times the zoom
    // and somewhere else on the screen
    for (const box of [
      { left: 10, top: 20, width: 400, height: 200 },
      { left: 300, top: 500, width: 1200, height: 600 },
    ]) {
      events.length = 0;

      const { getByTestId, unmount } = renderComponent(<Harness box={box} />);

      fireEvent.pointerDown(getByTestId("surface"), {
        clientX: box.left + box.width * 0.25,
        clientY: box.top + box.height * 0.75,
        button: 0,
        pointerId: 1,
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "pointer",
        action: "down",
        // a quarter across the region, three quarters down it
        x: 0.375,
        y: 0.4,
      });

      unmount();
    }
  });

  it("AC-366 a follow stands still while a button is down", async () => {
    const onChange = vi.fn();
    const panel = livePanel({ region: REGION, follow: true });

    await render(
      <Excalidraw
        panelMirror={{ onChange }}
        panelControl={{
          onToggle: vi.fn(),
          onInput: vi.fn(),
          onWindow: vi.fn(),
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
        control: { ...BACKGROUND, enabled: true },
      });
    });

    const view = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-live-window"]',
      );

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    giveBox(view, { left: 0, top: 0, width: 400, height: 200 });

    // a button is down: the pointer moves, and the region does not run away
    fireEvent.pointerDown(view, {
      clientX: 100,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(view, { clientX: 300, clientY: 100, pointerId: 1 });

    expect(onChange).not.toHaveBeenCalled();

    // the button is let go: the region follows again
    fireEvent.pointerUp(view, {
      clientX: 300,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(view, { clientX: 300, clientY: 100, pointerId: 1 });

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("Control is the teacher's switch, and the mouse goes through it (D-323)", () => {
  const mountSurface = (options: {
    enabled: boolean;
    region?: PanelMirrorRegion | null;
    picture?: { width: number; height: number } | null;
    box?: { left: number; top: number; width: number; height: number };
  }) => {
    const events: PanelInputEvent[] = [];
    const released = vi.fn();
    const keys = vi.fn();
    const Harness = ({ enabled }: { enabled: boolean }) => {
      const ref = useRef<HTMLDivElement | null>(null);
      const surface = usePanelControlSurface({
        panelId: "panel-1",
        enabled,
        region: options.region ?? null,
        picture: options.picture ?? null,
        boxRef: ref,
        onInput: (_panelId, event) => events.push(event),
        onRelease: released,
      });

      return (
        <div onKeyDown={keys}>
          <div
            data-testid="surface"
            ref={(element) => {
              ref.current = element;

              if (element) {
                giveBox(
                  element,
                  options.box ?? {
                    left: 100,
                    top: 50,
                    width: 400,
                    height: 200,
                  },
                );
              }
            }}
            tabIndex={enabled ? 0 : undefined}
            {...surface.handlers}
          />
        </div>
      );
    };

    const result = renderComponent(<Harness enabled={options.enabled} />);

    return {
      ...result,
      events,
      released,
      keys,
      surface: result.container.querySelector(
        '[data-testid="surface"]',
      ) as HTMLElement,
      rerender: (enabled: boolean) =>
        result.rerender(<Harness enabled={enabled} />),
    };
  };

  it("AC-367 Control is off in a new panel and nothing is sent", async () => {
    const onToggle = vi.fn();
    const onInput = vi.fn();
    const panel = livePanel();

    await render(
      <Excalidraw
        panelControl={{ onToggle, onInput, onWindow: vi.fn() }}
        panelMirror={{ onChange: vi.fn() }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // the extension says Control is off
    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
        control: BACKGROUND,
      });
    });

    const view = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-live-window"]',
      );

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    giveBox(view, { left: 0, top: 0, width: 400, height: 200 });

    const control = document.querySelector(
      '[data-testid="code-panel-control"]',
    ) as HTMLElement;

    expect(control.getAttribute("data-control")).toBe("off");
    expect(control.getAttribute("aria-pressed")).toBe("false");
    expect(view.getAttribute("data-control")).toBe("off");
    // the view cannot take the keyboard while Control is off
    expect(view.getAttribute("tabindex")).toBeNull();

    // the mouse over the view sends nothing, and asks for nothing
    fireEvent.pointerDown(view, {
      clientX: 100,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(view, { clientX: 120, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(view, {
      clientX: 120,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    fireEvent.wheel(view, { clientX: 100, clientY: 100, deltaY: 100 });

    expect(onInput).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("AC-367 turning Control on tells the host and lights the switch", async () => {
    const onToggle = vi.fn();
    const panel = livePanel();

    await render(
      <Excalidraw
        panelControl={{ onToggle, onInput: vi.fn(), onWindow: vi.fn() }}
        panelMirror={{ onChange: vi.fn() }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
        control: BACKGROUND,
      });
    });

    const control = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-control"]',
      );

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    // pressing it asks the host - the switch is the extension's word, so it is
    // not lit until the extension says so
    fireEvent.click(control);

    expect(onToggle).toHaveBeenCalledWith(panel.id, true);
    expect(control.getAttribute("data-control")).toBe("off");

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
        control: { ...BACKGROUND, enabled: true },
      });
    });

    await waitFor(() =>
      expect(control.getAttribute("data-control")).toBe("on"),
    );
    expect(control.getAttribute("aria-pressed")).toBe("true");

    // the view is the editor's, and it can take the keyboard
    const view = document.querySelector(
      '[data-testid="code-panel-live-window"]',
    ) as HTMLElement;

    expect(view.getAttribute("data-control")).toBe("on");
    expect(view.getAttribute("tabindex")).toBe("0");

    // the way the input goes in is said, with its reason
    const route = document.querySelector(
      '[data-testid="code-panel-control-route"]',
    ) as HTMLElement;

    expect(route.getAttribute("data-route")).toBe("background");
    expect(route.getAttribute("title")).toBe(BACKGROUND.reason);

    // and the title of the switch names the chord that gives the keyboard back
    expect(control.getAttribute("title")).toContain(CONTROL_RELEASE_CHORD);

    // pressing it again turns it off
    fireEvent.click(control);
    expect(onToggle).toHaveBeenLastCalledWith(panel.id, false);

    // a descriptor with no control (an extension that predates it) offers none
    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
      });
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-control"]'),
      ).toBeNull(),
    );
  });

  it("AC-367 the mouse reaches the host as events with the window's places", () => {
    const { events, surface } = mountSurface({
      enabled: true,
      picture: { width: 1000, height: 500 },
    });

    // the view's box is 400 by 200 at 100,50: a place a quarter across and
    // three quarters down
    const at = { clientX: 200, clientY: 200, pointerId: 1 };

    fireEvent.pointerDown(surface, { ...at, button: 0 });
    fireEvent.pointerUp(surface, { ...at, button: 0 });
    fireEvent.pointerDown(surface, { ...at, button: 2, ctrlKey: true });
    fireEvent.pointerUp(surface, { ...at, button: 2, ctrlKey: true });
    fireEvent.pointerDown(surface, {
      ...at,
      button: 1,
      shiftKey: true,
      altKey: true,
    });
    fireEvent.pointerUp(surface, {
      ...at,
      button: 1,
      shiftKey: true,
      altKey: true,
    });

    expect(events).toEqual([
      {
        kind: "pointer",
        action: "down",
        x: 0.25,
        y: 0.75,
        button: "left",
        mods: 0,
      },
      {
        kind: "pointer",
        action: "up",
        x: 0.25,
        y: 0.75,
        button: "left",
        mods: 0,
      },
      {
        kind: "pointer",
        action: "down",
        x: 0.25,
        y: 0.75,
        button: "right",
        mods: 1,
      },
      {
        kind: "pointer",
        action: "up",
        x: 0.25,
        y: 0.75,
        button: "right",
        mods: 1,
      },
      {
        kind: "pointer",
        action: "down",
        x: 0.25,
        y: 0.75,
        button: "middle",
        mods: 6,
      },
      {
        kind: "pointer",
        action: "up",
        x: 0.25,
        y: 0.75,
        button: "middle",
        mods: 6,
      },
    ]);

    // a double click is two presses, and there is no event of its own for it
    events.length = 0;

    for (let press = 0; press < 2; press++) {
      fireEvent.pointerDown(surface, { ...at, button: 0 });
      fireEvent.pointerUp(surface, { ...at, button: 0 });
    }
    fireEvent.doubleClick(surface, { clientX: 200, clientY: 200 });

    expect(
      events.map((event) =>
        event.kind === "pointer" ? event.action : event.kind,
      ),
    ).toEqual(["down", "up", "down", "up"]);

    // the wheel: down is positive, in notches, with the place
    events.length = 0;

    const kept = fireEvent.wheel(surface, {
      clientX: 200,
      clientY: 200,
      deltaY: 250,
      deltaX: -100,
    });

    expect(events).toEqual([
      { kind: "wheel", x: 0.25, y: 0.75, dx: -1, dy: 2.5, mods: 0 },
    ]);
    // and neither the page nor the canvas scrolls or zooms for it
    expect(kept).toBe(false);

    // a press in a region's view goes through the region
    const region = mountSurface({
      enabled: true,
      region: REGION,
      box: { left: 0, top: 0, width: 500, height: 200 },
    });

    fireEvent.pointerDown(region.surface, {
      clientX: 250,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });

    expect(region.events).toEqual([
      {
        kind: "pointer",
        action: "down",
        x: 0.5,
        y: 0.3,
        button: "left",
        mods: 0,
      },
    ]);

    // the whole window is fitted into the view without being stretched: a
    // picture that is square in a view that is wide has bars, and a press in
    // a bar is not a press in the editor
    const bars = mountSurface({
      enabled: true,
      picture: { width: 1000, height: 1000 },
      box: { left: 0, top: 0, width: 400, height: 200 },
    });

    fireEvent.pointerDown(bars.surface, {
      clientX: 20,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });
    fireEvent.wheel(bars.surface, { clientX: 20, clientY: 100, deltaY: 100 });

    expect(bars.events).toEqual([]);

    // ... and the picture itself is the 200 by 200 in the middle
    fireEvent.pointerDown(bars.surface, {
      clientX: 200,
      clientY: 100,
      button: 0,
      pointerId: 1,
    });

    expect(bars.events).toEqual([
      {
        kind: "pointer",
        action: "down",
        x: 0.5,
        y: 0.5,
        button: "left",
        mods: 0,
      },
    ]);
  });

  it("AC-367 a move is not sent more often than the limit", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(1_000_000);

      const { events, surface } = mountSurface({ enabled: true });

      // ten moves in the same millisecond
      for (let index = 0; index < 10; index++) {
        fireEvent.pointerMove(surface, {
          clientX: 100 + index * 10,
          clientY: 100,
          pointerId: 1,
        });
      }

      // the first goes at once, and the rest wait for the interval
      expect(events).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(PANEL_MOVE_INTERVAL_MS);
      });

      // and the LAST always arrives, so the editor ends where the pointer is
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        kind: "pointer",
        action: "move",
        x: (100 + 9 * 10 - 100) / 400,
      });

      // a press carries its own place: a move that was waiting is dropped
      fireEvent.pointerMove(surface, {
        clientX: 150,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerMove(surface, {
        clientX: 160,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerDown(surface, {
        clientX: 170,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      const kinds = events
        .slice(2)
        .map((event) => (event.kind === "pointer" ? event.action : event.kind));

      expect(kinds).toEqual(["down"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("AC-367 nothing is sent once Control is off", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(2_000_000);

      const { events, surface, rerender } = mountSurface({ enabled: true });

      fireEvent.pointerMove(surface, {
        clientX: 150,
        clientY: 100,
        pointerId: 1,
      });
      fireEvent.pointerMove(surface, {
        clientX: 160,
        clientY: 100,
        pointerId: 1,
      });
      expect(events).toHaveLength(1);

      // Control goes off with a move waiting: it never arrives
      rerender(false);

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(events).toHaveLength(1);

      fireEvent.pointerDown(surface, {
        clientX: 150,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.pointerUp(surface, {
        clientX: 150,
        clientY: 100,
        button: 0,
        pointerId: 1,
      });
      fireEvent.wheel(surface, { clientX: 150, clientY: 100, deltaY: 100 });
      fireEvent.keyDown(surface, { code: "KeyA", key: "a" });

      expect(events).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the keyboard goes only to the view that has it (D-323)", () => {
  /** A view with the keyboard, inside a stand-in for the canvas. */
  const mountView = () => {
    const events: PanelInputEvent[] = [];
    const released = vi.fn();
    const canvasKeys = vi.fn();
    const Harness = () => {
      const ref = useRef<HTMLDivElement | null>(null);
      const surface = usePanelControlSurface({
        panelId: "panel-1",
        enabled: true,
        region: null,
        boxRef: ref,
        onInput: (_panelId, event) => events.push(event),
        onRelease: released,
      });

      return (
        <div>
          <div
            data-testid="surface"
            ref={(element) => {
              ref.current = element;

              if (element) {
                giveBox(element, { left: 0, top: 0, width: 400, height: 200 });
              }
            }}
            tabIndex={0}
            {...surface.handlers}
          />
        </div>
      );
    };

    document.addEventListener("keydown", canvasKeys);

    const result = renderComponent(<Harness />);

    return {
      events,
      released,
      canvasKeys,
      surface: result.getByTestId("surface"),
      done: () => {
        document.removeEventListener("keydown", canvasKeys);
        result.unmount();
      },
    };
  };

  it("AC-368 a key reaches the host and not the canvas when the view has the keyboard", () => {
    const { events, surface, canvasKeys, done } = mountView();

    // the teacher clicks the view: it takes the keyboard
    fireEvent.pointerDown(surface, {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerId: 1,
    });
    expect(document.activeElement).toBe(surface);
    events.length = 0;

    // a shortcut: the key with the modifier, and it types nothing
    fireEvent.keyDown(surface, { code: "KeyS", key: "s", ctrlKey: true });
    // a printed character, and the same one held with Shift
    fireEvent.keyDown(surface, { code: "KeyA", key: "a" });
    fireEvent.keyDown(surface, { code: "KeyA", key: "A", shiftKey: true });
    // keys that are not characters
    fireEvent.keyDown(surface, { code: "Enter", key: "Enter" });
    fireEvent.keyUp(surface, { code: "Enter", key: "Enter" });
    // AltGr types a character, and it is not a Ctrl+Alt shortcut
    fireEvent.keyDown(surface, {
      code: "KeyQ",
      key: "@",
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });

    expect(events).toEqual([
      { kind: "key", action: "down", code: "KeyS", mods: 1 },
      { kind: "key", action: "down", code: "KeyA", char: "a", mods: 0 },
      { kind: "key", action: "down", code: "KeyA", char: "A", mods: 2 },
      { kind: "key", action: "down", code: "Enter", mods: 0 },
      { kind: "key", action: "up", code: "Enter", mods: 0 },
      { kind: "key", action: "down", code: "KeyQ", char: "@", mods: 0 },
    ]);

    // the canvas heard none of it: its shortcuts are not taken, and they are
    // not run
    expect(canvasKeys).not.toHaveBeenCalled();

    done();
  });

  it("AC-368 the keys stay with the canvas until the view is clicked", () => {
    const { events, surface, canvasKeys, done } = mountView();

    // the view is not clicked: a key goes where the focus is - the canvas
    fireEvent.keyDown(document.body, { code: "KeyA", key: "a" });

    expect(canvasKeys).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);

    // the view has no keyboard of its own until the teacher clicks it
    expect(document.activeElement).not.toBe(surface);

    done();
  });

  it("AC-368 the chord gives the keyboard back and is not sent", () => {
    const { events, surface, released, done } = mountView();

    fireEvent.pointerDown(surface, {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerId: 1,
    });
    expect(document.activeElement).toBe(surface);
    events.length = 0;

    fireEvent.keyDown(surface, {
      code: "Home",
      key: "Home",
      ctrlKey: true,
      altKey: true,
    });
    fireEvent.keyUp(surface, {
      code: "Home",
      key: "Home",
      ctrlKey: true,
      altKey: true,
    });

    // the keyboard is the canvas's again, and the chord was not sent
    expect(released).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(surface);
    expect(events).toEqual([]);
    expect(CONTROL_RELEASE_CHORD).toBe("Ctrl+Alt+Home");

    // the key is Home on its own, and with other modifiers, still a key
    fireEvent.pointerDown(surface, {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerId: 1,
    });
    fireEvent.keyDown(surface, { code: "Home", key: "Home" });
    fireEvent.keyDown(surface, { code: "Home", key: "Home", ctrlKey: true });

    expect(events.filter((event) => event.kind === "key")).toHaveLength(2);

    done();
  });

  it("AC-368 the keys the machine keeps are not sent", () => {
    const { events, surface, done } = mountView();

    fireEvent.pointerDown(surface, {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerId: 1,
    });
    events.length = 0;

    // the Windows key, alone and with a key
    fireEvent.keyDown(surface, {
      code: "MetaLeft",
      key: "Meta",
      metaKey: true,
    });
    fireEvent.keyDown(surface, { code: "KeyD", key: "d", metaKey: true });
    // the modifiers on their own are masks, not keys
    fireEvent.keyDown(surface, {
      code: "ControlLeft",
      key: "Control",
      ctrlKey: true,
    });
    fireEvent.keyDown(surface, {
      code: "ShiftLeft",
      key: "Shift",
      shiftKey: true,
    });
    fireEvent.keyDown(surface, { code: "AltLeft", key: "Alt", altKey: true });
    // the chords of the machine
    fireEvent.keyDown(surface, { code: "F4", key: "F4", altKey: true });
    fireEvent.keyDown(surface, { code: "Tab", key: "Tab", altKey: true });
    fireEvent.keyDown(surface, {
      code: "Escape",
      key: "Escape",
      ctrlKey: true,
    });
    fireEvent.keyDown(surface, {
      code: "Delete",
      key: "Delete",
      ctrlKey: true,
      altKey: true,
    });

    expect(events).toEqual([]);

    // the pure rule says the same
    for (const chord of [
      { code: "F4", altKey: true },
      { code: "Tab", altKey: true },
      { code: "Escape", altKey: true },
      { code: "Escape", ctrlKey: true },
      { code: "Delete", ctrlKey: true, altKey: true },
    ]) {
      expect(
        isMachineChord({
          key: "",
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
          ...chord,
        }),
      ).toBe(true);
    }

    expect(
      panelKeyEvent(
        {
          code: "F4",
          key: "F4",
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        },
        "down",
      ),
    ).not.toBeNull();

    // a key with nothing in the table is not a key
    expect(
      panelKeyEvent(
        {
          code: "IntlBackslash",
          key: "<",
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        },
        "down",
      ),
    ).toBeNull();

    done();
  });

  it("AC-368 a text an input method committed goes as bounded text events", () => {
    const { events, surface, done } = mountView();

    fireEvent.pointerDown(surface, {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerId: 1,
    });
    events.length = 0;

    // what an input method committed: a text of 600 characters, and one with a
    // character that cannot be typed
    fireEvent.compositionEnd(surface, { data: "あ".repeat(600) });
    fireEvent.compositionEnd(surface, { data: "ab\u0007cd" });

    const sizes = events.map((event) =>
      event.kind === "text" ? event.text.length : -1,
    );

    expect(sizes).toEqual([PANEL_TEXT_MAX, PANEL_TEXT_MAX, 88, 4]);
    expect((events[3] as { text: string }).text).toBe("abcd");

    // a text is never cut in the middle of a pair of code units
    const pairs = panelTextEvents("😀".repeat(200));

    expect(pairs.length).toBeGreaterThan(1);

    for (const piece of pairs) {
      expect(piece.kind === "text" && piece.text.length <= PANEL_TEXT_MAX).toBe(
        true,
      );
      expect(piece.kind === "text" && [...piece.text].join("")).toBe(
        (piece as { text: string }).text,
      );
      expect((piece as { text: string }).text.length % 2).toBe(0);
    }

    // a wheel is turned into notches and held to the most there is
    expect(panelWheelNotches({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toEqual(
      {
        dx: 0,
        dy: 1,
      },
    );
    expect(panelWheelNotches({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({
      dx: 0,
      dy: 1,
    });
    expect(panelWheelNotches({ deltaX: 0, deltaY: 1, deltaMode: 2 })).toEqual({
      dx: 0,
      dy: 10,
    });
    expect(
      panelWheelNotches({ deltaX: 0, deltaY: 99999, deltaMode: 0 }).dy,
    ).toBe(20);
    expect(
      panelWheelNotches({ deltaX: Number.NaN, deltaY: 0, deltaMode: 0 }).dx,
    ).toBe(0);

    done();
  });
});

describe("the panel parks the editor's window (D-328)", () => {
  it("AC-376 the bar's button parks and brings back and shows which", async () => {
    const onWindow = vi.fn();
    const panel = livePanel();

    await render(
      <Excalidraw
        panelControl={{ onToggle: vi.fn(), onInput: vi.fn(), onWindow }}
        panelMirror={{ onChange: vi.fn() }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
        control: BACKGROUND,
      });
    });

    const button = (await waitFor(() => {
      const found = document.querySelector('[data-testid="code-panel-park"]');

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    // the window is on a display: the button parks it
    expect(button.getAttribute("data-parked")).toBe("no");
    expect(button.textContent).toBe("Park");

    fireEvent.click(button);
    expect(onWindow).toHaveBeenLastCalledWith(panel.id, "park");

    // the extension says it is parked: the button brings it back
    act(() => {
      setPanelCapture(panel.id, {
        status: "live",
        streamUrl: STREAM,
        width: 1000,
        height: 500,
        control: BACKGROUND,
        parked: true,
      });
    });

    await waitFor(() => expect(button.getAttribute("data-parked")).toBe("yes"));
    expect(button.textContent).toBe("Bring back");

    fireEvent.click(button);
    expect(onWindow).toHaveBeenLastCalledWith(panel.id, "bring-back");
  });
});
