/**
 * The **crop** of a screenshot: the handles that take it, the picture that
 * shows it, and the z-plane the whole thing lives in (D-139, D-140).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import React from "react";

import type {
  ExcalidrawPanelElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  WHOLE_PICTURE,
  clearAllPendingScreenshots,
  getPendingScreenshot,
  setPendingScreenshot,
  setPendingScreenshotCrop,
} from "../scene/panelScreenshot";
import { codePanelContent, emptyCodePanelState } from "../scene/panelContent";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { CodePanelState } from "../scene/panelContent";

/** the stylesheet the chrome's rules live in (D-108) */
const stylesheet = () =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "css", "styles.scss"),
    "utf8",
  );

/** a number out of the stylesheet's own `:root` block */
const cssVariable = (css: string, name: string) => {
  const root = css.slice(css.indexOf(":root {"));
  const found = root.match(new RegExp(`--${name}:\\s*(\\d+)`));

  return found ? Number(found[1]) : null;
};

/** the picture's own size, in the capture's pixels */
const PICTURE_WIDTH = 1295;
const PICTURE_HEIGHT = 687;

/** the size the focus state shows the picture at, in screen pixels */
const display = (viewport: number) => {
  const fit = Math.min(
    (viewport * 0.9) / PICTURE_WIDTH,
    (viewport * 0.8) / PICTURE_HEIGHT,
  );

  return { width: PICTURE_WIDTH * fit, height: PICTURE_HEIGHT * fit };
};

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
  output: [{ stream: "stdout", text: "hello" }],
  console: [{ level: "info", text: "Run started: python main.py" }],
});

const codePanel = (): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(connectedState(), "session-1"),
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;

const asElement = (panel: ExcalidrawPanelElement) =>
  panel as unknown as NonDeletedExcalidrawElement;

/**
 * jsdom has no Pointer Events API: the capture of a pointer is a browser
 * nicety, and the drag works without it. The stub keeps the component's own
 * call from throwing where there is nothing to call.
 */
afterEach(() => {
  act(() => {
    clearAllPendingScreenshots();
  });
  vi.unstubAllGlobals();
});

/** the editor, with a panel on it and a picture waiting to be placed */
const renderEditor = async (stage?: "crop" | "page" | "place") => {
  const { container } = await render(
    <Excalidraw panelScreenshot={{ onCapture: () => {} }} />,
  );

  const panel = codePanel();

  API.setAppState({ width: 1000, height: 1000 });
  API.setElements([asElement(panel)]);

  await waitFor(() =>
    expect(container.querySelector('[data-testid="panel"]')).not.toBeNull(),
  );

  act(() => {
    setPendingScreenshot({
      panelId: panel.id,
      source: "editor",
      dataURL: "data:image/jpeg;base64,AAAA",
      width: PICTURE_WIDTH,
      height: PICTURE_HEIGHT,
      x: 100,
      y: 100,
      canvasWidth: 460,
      canvasHeight: 244,
      ...(stage ? { stage } : {}),
    });
  });

  await waitFor(() =>
    expect(
      container.querySelector('[data-testid="panel-screenshot-focus"]'),
    ).not.toBeNull(),
  );

  return { container, panel };
};

describe("the crop of a screenshot", () => {
  it("AC-176 dragging a crop handle changes the crop", async () => {
    // The owner saw the handles and could not move them: "i can see the
    // handles to crop the image but not do anything to it" (D-139).
    const { container, panel } = await renderEditor();

    const handle = container.querySelector(
      '[data-testid="panel-screenshot-crop-handle-right"]',
    ) as HTMLElement;

    expect(handle).not.toBeNull();

    const size = display(1000);

    // the teacher drags the right edge inwards
    act(() => {
      fireEvent.pointerDown(handle, {
        pointerId: 1,
        clientX: 500,
        clientY: 300,
      });
      fireEvent.pointerMove(handle, {
        pointerId: 1,
        clientX: 400,
        clientY: 300,
      });
    });

    // and the crop follows the handle
    const crop = getPendingScreenshot(panel.id)!.crop!;

    expect(crop.width).toBeCloseTo(1 - 100 / size.width, 3);
    // only the right edge moved: the other three are where they were
    expect(crop.x).toBe(0);
    expect(crop.y).toBe(0);
    expect(crop.height).toBe(1);

    // and the picture in front shows the new crop: the crop is not a
    // rectangle drawn over the whole picture, it is the picture (D-139)
    await waitFor(() => {
      const cropped = container.querySelector(
        '[data-testid="panel-screenshot-focus-cropped"]',
      ) as HTMLElement;

      expect(cropped).not.toBeNull();
      expect(cropped.style.width).toBe(`${crop.width * size.width}px`);
    });
  });

  it("AC-176 the picture in front shows only the cropped part", async () => {
    // A crop that is drawn over the whole picture is a promise the panel does
    // not keep: the teacher cannot see what they are about to place (D-139).
    const { container, panel } = await renderEditor();

    act(() => {
      setPendingScreenshotCrop(panel.id, {
        x: 0.25,
        y: 0.5,
        width: 0.5,
        height: 0.25,
      });
    });

    await waitFor(() => {
      const cropped = container.querySelector(
        '[data-testid="panel-screenshot-focus-cropped"]',
      ) as HTMLElement;

      expect(cropped).not.toBeNull();
    });

    const size = display(1000);

    const cropped = container.querySelector(
      '[data-testid="panel-screenshot-focus-cropped"]',
    ) as HTMLElement;

    // the window shows the cropped part, and only that
    expect(cropped.style.width).toBe(`${0.5 * size.width}px`);
    expect(cropped.style.height).toBe(`${0.25 * size.height}px`);
    expect(cropped.style.left).toBe(`${0.25 * size.width}px`);
    expect(cropped.style.top).toBe(`${0.5 * size.height}px`);

    // and the picture is drawn whole behind it, so the right part of it shows
    const image = container.querySelector(
      '[data-testid="panel-screenshot-focus-image"]',
    ) as HTMLElement;

    expect(image.style.width).toBe(`${size.width}px`);
    expect(image.style.left).toBe(`${-0.25 * size.width}px`);
    expect(image.style.top).toBe(`${-0.5 * size.height}px`);
  });

  it("AC-176 the crop is the screenshot's own state and reverts one step", async () => {
    // The crop belongs to the **picture**, not to the canvas (D-116), and one
    // step takes it back - and there is no second step.
    const { container, panel } = await renderEditor();

    act(() => {
      setPendingScreenshotCrop(panel.id, {
        x: 0.1,
        y: 0.1,
        width: 0.5,
        height: 0.5,
      });
    });

    act(() => {
      setPendingScreenshotCrop(panel.id, {
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.3,
      });
    });

    // the crop is the screenshot's own state
    expect(getPendingScreenshot(panel.id)!.crop).toEqual({
      x: 0.2,
      y: 0.2,
      width: 0.3,
      height: 0.3,
    });

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-crop-revert"]'),
      ).not.toBeNull(),
    );

    // one step of revert: back to the crop before it - and no further
    act(() => {
      fireEvent.click(
        container.querySelector(
          '[data-testid="panel-screenshot-crop-revert"]',
        )!,
      );
    });

    expect(getPendingScreenshot(panel.id)!.crop).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.5,
    });

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-crop-revert"]'),
      ).toBeNull(),
    );

    // and the picture itself was never touched: the crop is a view of it
    expect(getPendingScreenshot(panel.id)!.dataURL).toBe(
      "data:image/jpeg;base64,AAAA",
    );
    expect(getPendingScreenshot(panel.id)!.crop).not.toEqual(WHOLE_PICTURE);

    // and the picture in front shows the crop that is left
    const size = display(1000);

    const cropped = container.querySelector(
      '[data-testid="panel-screenshot-focus-cropped"]',
    ) as HTMLElement;

    expect(cropped.style.width).toBe(`${0.5 * size.width}px`);
    expect(cropped.style.height).toBe(`${0.5 * size.height}px`);
  });

  it("AC-176 the wireframe stands above the panels with the canvas dimmed behind it", async () => {
    // The wireframe is a guide on the canvas: it must not compete with the
    // panels in the same z-plane (D-140).
    const { container } = await renderEditor("place");

    // the canvas behind is dimmed
    const scrim = container.querySelector(
      '[data-testid="panel-screenshot-focus-scrim"]',
    ) as HTMLElement;

    expect(scrim).not.toBeNull();
    expect(scrim.style.background).toContain("rgba(0, 0, 0");

    // and the wireframe stands on it
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-wireframe"]'),
      ).not.toBeNull(),
    );

    const css = stylesheet();

    // the focus state is **over** the panels: the crop handles are live, and
    // the popup is not behind the panels (D-139, D-140)
    expect(cssVariable(css, "zIndex-panelFocus")).toBeGreaterThan(
      cssVariable(css, "zIndex-panels")!,
    );

    // and over the interactive canvas, which used to take the pointer and
    // leave the handles visible and dead (D-139)
    expect(cssVariable(css, "zIndex-panelFocus")).toBeGreaterThan(
      cssVariable(css, "zIndex-interactiveCanvas")!,
    );

    // the wireframe is over the panels as well
    expect(cssVariable(css, "zIndex-screenshotWireframe")).toBeGreaterThan(
      cssVariable(css, "zIndex-panels")!,
    );
    expect(cssVariable(css, "zIndex-screenshotWireframe")).toBeGreaterThan(
      cssVariable(css, "zIndex-panelFocus")!,
    );

    // and the rules use those planes
    expect(css).toMatch(
      /&__panel-screenshot-wireframe \{[^}]*z-index: var\(--zIndex-screenshotWireframe\)/,
    );
    expect(css).toMatch(
      /&__panel-screenshot-focus-preview \{[^}]*z-index: var\(--zIndex-panelFocus\)/,
    );

    // the dimming stays **under** the panels: a panel dims its own content,
    // and its own chrome - the three choices - stays bright (D-140)
    expect(cssVariable(css, "zIndex-panelFocusScrim")).toBeLessThan(
      cssVariable(css, "zIndex-panels")!,
    );
    expect(css).toMatch(
      /&__panel-screenshot-focus-scrim \{[^}]*z-index: var\(--zIndex-panelFocusScrim\)/,
    );
  });
});
