/**
 * The **VS Code mirror** panel: its states, the tools in its own header, and
 * where the bridge's field and the screenshot and the read live (D-331, D-332).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  ExcalidrawPanelElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { codePanelContent, emptyCodePanelState } from "../scene/panelContent";
import { mirrorPanelView } from "../scene/mirrorPanelView";
import {
  clearPendingScreenshot,
  getPendingScreenshot,
  setPendingScreenshot,
} from "../scene/panelScreenshot";
import {
  closePanelMirrorPicker,
  getAnyPanelMirrorPicker,
  setPanelMirrorPickerRegion,
} from "../scene/panelMirror";
import {
  FOLLOW_REST_ZONE,
  FOLLOW_STEP_MAX,
  panelMirrorRegionNudge,
} from "../scene/panelMirror";
import { clearAllPanelCaptures, setPanelCapture } from "../scene/panelFrames";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { PanelCapture } from "../scene/panelFrames";
import type { MirrorBridgePhase } from "../scene/mirrorPanelView";

const STREAM = "http://127.0.0.1:47511/s/a-capability/frame";

/** A VS Code mirror: a code panel of the bridge's kind (D-331). */
const mirror = (): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(emptyCodePanelState(), "session-1"),
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;

const asElement = (panel: ExcalidrawPanelElement) =>
  panel as unknown as NonDeletedExcalidrawElement;

const bridge = (
  status: "not-connected" | "connected" | "rejected",
  phase: MirrorBridgePhase,
) => ({
  status,
  phase,
  message: `state: ${phase}`,
  token: "",
});

const live: PanelCapture = { status: "live", streamUrl: STREAM };

describe("the VS Code mirror's states", () => {
  it("AC-383 the mirror is in exactly one state, and the state is a rule", () => {
    const rule = (
      bridgeInput: Parameters<typeof mirrorPanelView>[0]["bridge"],
      capture: PanelCapture | null,
      readOnly = false,
    ) => mirrorPanelView({ readOnly, bridge: bridgeInput, capture });

    // not connected: what the page is doing says the state
    expect(rule(bridge("not-connected", "connecting"), null)).toBe(
      "connecting",
    );
    expect(rule(bridge("rejected", "reconnecting"), null)).toBe("looking");
    expect(rule(bridge("rejected", "refused"), null)).toBe("refused");
    expect(rule(bridge("not-connected", "idle"), null)).toBe("token");
    expect(rule(bridge("not-connected", "closed"), null)).toBe("token");

    // a host that does not name the phase: a try that did not work is
    // "looking", a connection never tried is "token"
    expect(rule({ status: "rejected" }, null)).toBe("looking");
    expect(rule({ status: "not-connected" }, null)).toBe("token");

    // connected: the editor's own say
    expect(rule(bridge("connected", "connected"), null)).toBe("waiting");
    expect(rule(bridge("connected", "connected"), live)).toBe("live");
    expect(
      rule(bridge("connected", "connected"), {
        status: "unavailable",
        reason: "no window",
      }),
    ).toBe("unavailable");

    // the presenter and a host with no bridge have no connection to say
    // anything about: the registry's picture is what there is
    expect(rule(undefined, live)).toBe("live");
    expect(rule(undefined, null)).toBe("waiting");
    expect(rule(bridge("not-connected", "idle"), live, true)).toBe("live");
    expect(rule(bridge("not-connected", "idle"), null, true)).toBe("waiting");
  });

  it("AC-384 the mirror moves between its states: a spinner, an error, the live window", async () => {
    const panel = mirror();

    const { rerender } = await render(
      <Excalidraw panelBridge={bridge("not-connected", "connecting")} />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    const view = () =>
      document
        .querySelector('[data-testid="mirror-panel-status"]')
        ?.getAttribute("data-view");

    // opening the connection: a wheel and a sentence under it
    expect(view()).toBe("connecting");
    expect(
      document.querySelector('[data-testid="mirror-panel-spinner"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="mirror-panel-message"]')!
        .textContent,
    ).not.toBe("");

    // the extension did not accept the token: an error icon and a sentence
    rerender(<Excalidraw panelBridge={bridge("rejected", "refused")} />);

    await waitFor(() => expect(view()).toBe("refused"));
    expect(
      document.querySelector('[data-testid="mirror-panel-spinner"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="mirror-panel-error-icon"]'),
    ).not.toBeNull();

    // connected, and the window has not come yet: the wheel again
    rerender(<Excalidraw panelBridge={bridge("connected", "connected")} />);

    await waitFor(() => expect(view()).toBe("waiting"));
    expect(
      document.querySelector('[data-testid="mirror-panel-spinner"]'),
    ).not.toBeNull();

    // the window arrives: the picture, and nothing else in the body
    act(() => {
      setPanelCapture(panel.id, live);
    });

    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="code-panel"]')
          ?.getAttribute("data-view"),
      ).toBe("live"),
    );
    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="mirror-panel-status"]'),
    ).toBeNull();

    // the connection drops: the picture goes and the state says why
    rerender(<Excalidraw panelBridge={bridge("rejected", "reconnecting")} />);

    await waitFor(() => expect(view()).toBe("looking"));
    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).toBeNull();

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-384 the mirror has no run bar and no output console", async () => {
    const panel = mirror();

    await render(<Excalidraw panelBridge={bridge("connected", "connected")} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, live);
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-frame"]'),
      ).not.toBeNull(),
    );

    for (const testId of [
      "code-panel-run",
      "code-panel-output",
      "code-panel-console",
      "code-panel-consolebox",
      "code-panel-divider",
      "code-panel-view-toggle",
    ]) {
      expect(document.querySelector(`[data-testid="${testId}"]`)).toBeNull();
    }

    act(() => {
      clearAllPanelCaptures();
    });
  });
});

describe("the tools of the VS Code mirror", () => {
  it("AC-385 the screenshot and the read are in the mirror's own header, with no selection", async () => {
    const panel = mirror();
    const onCapture = vi.fn();
    const onOcr = vi.fn();

    await render(
      <Excalidraw
        panelBridge={bridge("connected", "connected")}
        panelScreenshot={{ onCapture }}
        panelOcr={{ message: "Read the window's text.", onOcr }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // nothing is selected, and the tools are not there while there is no
    // picture to take or to read
    expect(
      document.querySelector('[data-testid="mirror-panel-screenshot"]'),
    ).toBeNull();

    act(() => {
      setPanelCapture(panel.id, live);
    });

    const header = await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="mirror-panel-header"]',
      );

      expect(found).not.toBeNull();

      return found!;
    });

    const camera = header.querySelector(
      '[data-testid="mirror-panel-screenshot"]',
    ) as HTMLButtonElement | null;
    const read = header.querySelector(
      '[data-testid="mirror-panel-read"]',
    ) as HTMLButtonElement | null;

    expect(camera).not.toBeNull();
    expect(read).not.toBeNull();

    // and they work: the camera opens the crop window (the picture is taken
    // when the teacher has chosen, AC-392) and the host is asked for the read
    fireEvent.click(camera!);

    await waitFor(() =>
      expect(getAnyPanelMirrorPicker()?.purpose).toBe("screenshot"),
    );
    expect(onCapture).not.toHaveBeenCalled();
    closePanelMirrorPicker(panel.id);

    fireEvent.click(read!);

    expect(onOcr).toHaveBeenCalledWith(panel.id);

    // the header also carries the mode, the control, the park and the full
    // screen of the mirror
    for (const testId of ["code-panel-mirror-modes", "code-panel-fullscreen"]) {
      expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    }

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-386 the properties panel keeps the screenshot and the read, and the bridge field is not in it", async () => {
    const panel = mirror();

    const { container } = await render(
      <Excalidraw
        panelBridge={bridge("connected", "connected")}
        panelScreenshot={{ onCapture: () => undefined }}
        panelOcr={{ message: "Read.", onOcr: () => undefined }}
      />,
    );

    API.setAppState({
      width: 1000,
      height: 1000,
      selectedElementIds: { [panel.id]: true },
    });
    API.setElements([asElement(panel)]);

    const actions = await waitFor(() => {
      const found = container.querySelector(
        '[data-testid="panel-actions"]',
      ) as HTMLElement | null;

      expect(found).not.toBeNull();

      return found!;
    });

    // the backup: the camera and the read are in the properties too
    expect(
      actions.querySelector('[data-testid="panel-screenshot-button"]'),
    ).not.toBeNull();
    expect(
      actions.querySelector('[data-testid="panel-ocr-button"]'),
    ).not.toBeNull();

    // and the token's field is not: it is in the mirror, where it is needed
    expect(actions.querySelector('[data-testid="panel-bridge"]')).toBeNull();
    expect(
      actions.querySelector('[data-testid="panel-bridge-token"]'),
    ).toBeNull();
  });
});

describe("the following area", () => {
  const region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  const view = (width: number, height: number) => ({
    left: 0,
    top: 0,
    width,
    height,
  });

  it("AC-387 the following area rests while the pointer is near the middle, and moves by a step outside", () => {
    // in the rest zone - the middle half of the window - nothing moves
    expect(
      panelMirrorRegionNudge(region, { x: 200, y: 100 }, view(400, 200)),
    ).toEqual(region);
    expect(
      panelMirrorRegionNudge(region, { x: 300, y: 150 }, view(400, 200)),
    ).toEqual(region);
    // anywhere in it, not only in the middle and on its edge
    for (const x of [130, 170, 230, 270]) {
      expect(
        panelMirrorRegionNudge(region, { x, y: 120 }, view(400, 200)),
      ).toEqual(region);
    }
    expect(FOLLOW_REST_ZONE).toBe(0.5);

    // at the edge of the window the area moves by the biggest step, towards the
    // pointer, and keeps its size
    const right = panelMirrorRegionNudge(
      region,
      { x: 400, y: 100 },
      view(400, 200),
    );

    expect(right.x).toBeCloseTo(region.x + FOLLOW_STEP_MAX * region.width, 3);
    expect(right.y).toBe(region.y);
    expect(right.width).toBe(region.width);
    expect(right.height).toBe(region.height);

    const left = panelMirrorRegionNudge(
      region,
      { x: 0, y: 100 },
      view(400, 200),
    );

    expect(left.x).toBeCloseTo(region.x - FOLLOW_STEP_MAX * region.width, 3);

    // between the rest zone and the edge the step is smaller
    const part = panelMirrorRegionNudge(
      region,
      { x: 350, y: 100 },
      view(400, 200),
    );

    expect(part.x).toBeGreaterThan(region.x);
    expect(part.x).toBeLessThan(right.x);

    // the same movement of the hand does the same in a small window as in a
    // large one: the pointer's distance sets the speed and not its place
    expect(
      panelMirrorRegionNudge(region, { x: 80, y: 40 }, view(80, 40)),
    ).toEqual(
      panelMirrorRegionNudge(region, { x: 1600, y: 800 }, view(1600, 800)),
    );

    // and the area stays inside the window
    const against = panelMirrorRegionNudge(
      { x: 0.49, y: 0.1, width: 0.5, height: 0.4 },
      { x: 400, y: 100 },
      view(400, 200),
    );

    expect(against.x + against.width).toBeLessThanOrEqual(1);
  });

  it("AC-391 turning Control on gives the window the keyboard at once", async () => {
    const panel = mirror();

    await render(
      <Excalidraw
        panelBridge={bridge("connected", "connected")}
        panelControl={{
          onToggle: vi.fn(),
          onInput: vi.fn(),
          onWindow: vi.fn(),
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    const control = {
      enabled: false,
      route: "background" as const,
      reason: "",
    };

    act(() => {
      setPanelCapture(panel.id, { ...live, control });
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-window"]'),
      ).not.toBeNull(),
    );

    const view = document.querySelector(
      '[data-testid="code-panel-live-window"]',
    ) as HTMLElement;

    expect(document.activeElement).not.toBe(view);

    // the extension says Control is on: the window has the keyboard, with no
    // click on it
    act(() => {
      setPanelCapture(panel.id, {
        ...live,
        control: { ...control, enabled: true },
      });
    });

    await waitFor(() => expect(document.activeElement).toBe(view));
    expect(view.getAttribute("data-control")).toBe("engaged");

    act(() => {
      clearAllPanelCaptures();
    });
  });
});

describe("the screenshot of the mirror", () => {
  const SIZE = { width: 1000, height: 500 };

  const liveWindow: PanelCapture = { ...live, ...SIZE };

  /** a host that takes the picture the way the app does, and says what it was asked */
  const host = () => {
    const onCapture = vi.fn(async (panelId: string) => {
      setPendingScreenshot({
        panelId,
        source: "editor",
        dataURL: "data:image/png;base64,AAAA",
        width: SIZE.width,
        height: SIZE.height,
        x: 0,
        y: 0,
        canvasWidth: 400,
        canvasHeight: 200,
      });
    });

    return { onCapture, onChoice: vi.fn(), onPageChoice: vi.fn() };
  };

  const openCropWindow = async (screenshot: ReturnType<typeof host>) => {
    const panel = mirror();

    await render(
      <Excalidraw
        panelBridge={bridge("connected", "connected")}
        panelScreenshot={screenshot}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, liveWindow);
    });

    const camera = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="mirror-panel-screenshot"]',
      );

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    fireEvent.click(camera);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-mirror-picker"]'),
      ).not.toBeNull(),
    );

    return panel;
  };

  const press = (testId: string) =>
    fireEvent.click(document.querySelector(`[data-testid="${testId}"]`)!);

  const finish = (panelId: string) => {
    act(() => {
      closePanelMirrorPicker(panelId);
      clearPendingScreenshot(panelId);
      clearAllPanelCaptures();
    });
  };

  it("AC-392 the camera opens the crop window with the three things to do, and takes no picture yet", async () => {
    const screenshot = host();

    const panel = await openCropWindow(screenshot);

    // the crop window is the part picker's, with the choices of a screenshot
    expect(getAnyPanelMirrorPicker()?.purpose).toBe("screenshot");

    for (const testId of [
      "panel-mirror-picker-insert",
      "panel-mirror-picker-new-page",
      "panel-mirror-picker-read",
      "panel-mirror-picker-cancel",
    ]) {
      expect(
        document.querySelector(`[data-testid="${testId}"]`),
      ).not.toBeNull();
    }

    expect(
      document.querySelector('[data-testid="panel-mirror-picker-insert"]')!
        .textContent,
    ).toBe("Insert into this page");
    expect(
      document.querySelector('[data-testid="panel-mirror-picker-new-page"]')!
        .textContent,
    ).toBe("New page");

    // it is not the part picker: nothing here changes what the panel mirrors
    expect(
      document.querySelector('[data-testid="panel-mirror-picker-apply"]'),
    ).toBeNull();

    // and no picture has been taken: the teacher has not chosen yet
    expect(screenshot.onCapture).not.toHaveBeenCalled();

    // the read says what it will read: the whole window, or the crop
    const read = document.querySelector(
      '[data-testid="panel-mirror-picker-read"]',
    )!;

    expect(read.getAttribute("data-crop")).toBe("whole");
    expect(read.textContent).toBe("Read the text of the whole window");

    act(() => {
      setPanelMirrorPickerRegion(panel.id, {
        x: 0.1,
        y: 0.1,
        width: 0.5,
        height: 0.5,
      });
    });

    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="panel-mirror-picker-read"]')!
          .getAttribute("data-crop"),
      ).toBe("crop"),
    );
    expect(
      document.querySelector('[data-testid="panel-mirror-picker-read"]')!
        .textContent,
    ).toBe("Read the text of the crop");

    finish(panel.id);
  });

  it("AC-393 Insert takes the picture with the crop on it and goes straight to the rectangle", async () => {
    const screenshot = host();
    const panel = await openCropWindow(screenshot);
    const region = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 };

    act(() => {
      setPanelMirrorPickerRegion(panel.id, region);
    });

    press("panel-mirror-picker-insert");

    // the picture is taken, the crop is on it, and the choice is the next step
    await waitFor(() =>
      expect(screenshot.onChoice).toHaveBeenCalledWith(panel.id, "page"),
    );
    expect(screenshot.onCapture).toHaveBeenCalledWith(panel.id);
    expect(getPendingScreenshot(panel.id)?.crop).toEqual(region);

    // no page ribbon: nothing asks which page
    expect(screenshot.onPageChoice).not.toHaveBeenCalled();

    // and the crop window is gone
    expect(getAnyPanelMirrorPicker()).toBeNull();

    finish(panel.id);
  });

  it("AC-393 New page asks for a new page at once, and the read reads the crop", async () => {
    const newPage = host();
    const panel = await openCropWindow(newPage);

    press("panel-mirror-picker-new-page");

    await waitFor(() =>
      expect(newPage.onChoice).toHaveBeenCalledWith(panel.id, "new-page"),
    );
    // a new page needs no ribbon: it is made when the picture is placed
    expect(newPage.onPageChoice).toHaveBeenCalledWith(panel.id, null);

    finish(panel.id);
  });

  it("AC-393 the read is asked for with the crop on the picture", async () => {
    const screenshot = host();
    const panel = await openCropWindow(screenshot);
    const region = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 };

    act(() => {
      setPanelMirrorPickerRegion(panel.id, region);
    });

    press("panel-mirror-picker-read");

    await waitFor(() =>
      expect(screenshot.onChoice).toHaveBeenCalledWith(panel.id, "ocr"),
    );
    expect(getPendingScreenshot(panel.id)?.crop).toEqual(region);

    finish(panel.id);
  });

  it("AC-394 a panel that is full screen is left before the rectangle, because the rectangle is on the canvas", async () => {
    const screenshot = host();
    const exit = vi.fn(async () => undefined);
    const element = document.createElement("div");

    document.body.appendChild(element);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => element,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exit,
    });

    let id = "";

    try {
      const panel = await openCropWindow(screenshot);

      id = panel.id;

      // the crop window is drawn into the full-screen element (D-334)
      await waitFor(() =>
        expect(
          element.querySelector('[data-testid="panel-mirror-picker"]'),
        ).not.toBeNull(),
      );

      press("panel-mirror-picker-insert");

      await waitFor(() =>
        expect(screenshot.onChoice).toHaveBeenCalledWith(panel.id, "page"),
      );

      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit.mock.invocationCallOrder[0]).toBeLessThan(
        screenshot.onChoice.mock.invocationCallOrder[0],
      );
    } finally {
      // @ts-expect-error the test's own stand-ins are taken off again
      delete document.fullscreenElement;
      // @ts-expect-error the test's own stand-ins are taken off again
      delete document.exitFullscreen;
      element.remove();
      finish(id);
    }
  });

  it("AC-395 cancelling a crop window changes nothing", async () => {
    const screenshot = host();
    const onChange = vi.fn();
    const panel = mirror();

    await render(
      <Excalidraw
        panelBridge={bridge("connected", "connected")}
        panelScreenshot={screenshot}
        panelMirror={{ onChange }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, liveWindow);
    });

    // the part picker, and Cancel in it: the panel keeps mirroring what it
    // mirrored - the window is not made whole by it
    const part = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-mirror-region"]',
      );

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    fireEvent.click(part);

    await waitFor(() =>
      expect(getAnyPanelMirrorPicker()?.purpose).toBe("region"),
    );

    press("panel-mirror-picker-cancel");

    expect(getAnyPanelMirrorPicker()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    // and Cancel in a screenshot's crop window takes no picture
    fireEvent.click(
      document.querySelector('[data-testid="mirror-panel-screenshot"]')!,
    );

    await waitFor(() =>
      expect(getAnyPanelMirrorPicker()?.purpose).toBe("screenshot"),
    );

    press("panel-mirror-picker-cancel");

    expect(getAnyPanelMirrorPicker()).toBeNull();
    expect(screenshot.onCapture).not.toHaveBeenCalled();

    finish(panel.id);
  });
});
