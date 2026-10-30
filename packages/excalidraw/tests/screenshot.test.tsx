/**
 * The **screenshot** of a panel: the capture, and the three choices that
 * follow it.
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
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw, videoPanelContent } from "../index";
import { capturePausedVideoFrame } from "../components/videoPanelSurface";
import {
  WHOLE_PICTURE,
  clearAllPendingScreenshots,
  fetchEditorSnapshot,
  getPendingScreenshot,
  setPendingScreenshot,
  setPendingScreenshotCrop,
  snapshotUrl,
} from "../scene/panelScreenshot";
import { codePanelContent, emptyCodePanelState } from "../scene/panelContent";
import { PANEL_CHROME } from "../scene/panelChrome";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { BinaryFileData } from "../types";
import type { CodePanelState } from "../scene/panelContent";

/** the stylesheet the chrome's rules live in (D-108) */
const stylesheet = () =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "css", "styles.scss"),
    "utf8",
  );

/** the video file the video panel plays */
const VIDEO_FILE_ID = "video-file-1" as FileId;

const videoFile = () => ({
  id: VIDEO_FILE_ID,
  mimeType: "video/mp4" as unknown as BinaryFileData["mimeType"],
  dataURL: "data:video/mp4;base64,AAAA" as BinaryFileData["dataURL"],
  created: 1,
  lastRetrieved: 1,
  version: 1,
});

/** A code panel that is connected and has something to show. */
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

/**
 * A video panel: the **control group** of the chrome's buttons (D-108).
 *
 * Its play and mute buttons are the same size as the screenshot button, but
 * they carry a glyph as text - so their min-content width is the glyph and
 * they do not collapse the way an icon-only button did.
 */
const videoPanel = (): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 600,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "video",
    panel: videoPanelContent({
      source: { type: "file", fileId: VIDEO_FILE_ID, mimeType: "video/mp4" },
      naturalWidth: 1920,
      naturalHeight: 1080,
    }),
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;

const asElement = (panel: ExcalidrawPanelElement) =>
  panel as unknown as NonDeletedExcalidrawElement;

afterEach(() => {
  act(() => {
    clearAllPendingScreenshots();
  });
  vi.unstubAllGlobals();
});

describe("the screenshot of a panel", () => {
  it("AC-139 the video is paused before its frame is captured", () => {
    // The order is the whole point: "for video that should pause the video"
    // (D-102). A frame drawn while the video is still running is a frame of a
    // moment the teacher never saw.
    //
    // The order is read off the **video itself**: the capture reads the
    // video's own size on its way to the canvas, so the pause has to have
    // happened before that read.
    const order: string[] = [];

    const video = document.createElement("video");

    Object.defineProperty(video, "pause", {
      configurable: true,
      value: () => {
        order.push("pause");
      },
    });

    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      get: () => {
        order.push("read-width");
        return 1920;
      },
    });

    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      get: () => {
        order.push("read-height");
        return 1080;
      },
    });

    const frame = capturePausedVideoFrame(video);

    expect(frame).not.toBeNull();
    expect(order[0]).toBe("pause");
    expect(order).toContain("read-width");

    // and the picture is the video's own size, not the panel's
    expect(frame!.width).toBe(1920);
    expect(frame!.height).toBe(1080);
  });

  it("AC-139 the editor's window is captured through the extension's snapshot path", async () => {
    // The frames live in the **extension**, so the app asks for one of them
    // over the extension's own HTTP server (D-102).
    //
    // The snapshot is the stream's URL with ONE more path segment, under the
    // SAME capability: the capability that authorises the stream authorises
    // the snapshot, and the session token is never in a URL (D-50, D-86).
    const streamUrl = "http://127.0.0.1:47511/s/a-capability/frame";
    const snapshot = snapshotUrl(streamUrl);

    expect(snapshot).toBe("http://127.0.0.1:47511/s/a-capability/snapshot");
    expect(snapshot).toContain("/s/a-capability/");

    // and the capture is a plain GET on that path
    const requested: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(url);

        return {
          ok: true,
          headers: {
            get: (name: string) =>
              ({
                "content-type": "image/jpeg",
                "x-frame-width": "1295",
                "x-frame-height": "687",
              }[name.toLowerCase()] ?? null),
          },
          arrayBuffer: async () =>
            new Uint8Array([0xff, 0xd8, 0xff, 0xdb]).buffer,
        };
      }),
    );

    const picture = await fetchEditorSnapshot(snapshot);

    expect(requested).toEqual([snapshot]);
    expect(picture).not.toBeNull();

    // the picture's own size travels in the headers, so the app never has to
    // decode an image to learn it (D-102)
    expect(picture!.width).toBe(1295);
    expect(picture!.height).toBe(687);
    expect(picture!.dataURL.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("AC-140 no choice is offered before the screenshot is taken", async () => {
    const panel = codePanel();

    await render(<Excalidraw panelScreenshot={{ onCapture: () => {} }} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel"]'),
      ).not.toBeNull(),
    );

    // The camera is a choice ABOUT the panel, so it lives in the panel's
    // properties (D-135): the teacher selects the panel and the camera is
    // there - outside the picture, where a click always reaches it. A camera
    // drawn on the picture would be a camera under a YouTube panel's iframe,
    // and the iframe would take the click.
    API.setSelectedElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-screenshot-button"]'),
      ).not.toBeNull(),
    );

    // and the picture itself carries no button at all
    expect(
      document.querySelector(
        '[data-testid="panel"] [data-testid="panel-screenshot-button"]',
      ),
    ).toBeNull();

    // and NO choice: the three options come after the capture, not before it
    // (D-103). In particular there is no OCR of a screenshot that was never
    // taken.
    expect(
      document.querySelector('[data-testid="panel-screenshot-choices"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="panel-screenshot-choice-ocr"]'),
    ).toBeNull();
  });

  it("AC-140 the capture offers exactly three choices", async () => {
    const panel = codePanel();

    await render(<Excalidraw panelScreenshot={{ onCapture: () => {} }} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel"]'),
      ).not.toBeNull(),
    );

    // the capture happened
    act(() => {
      setPendingScreenshot({
        panelId: panel.id,
        source: "editor",
        dataURL: "data:image/jpeg;base64,AAAA",
        width: 1295,
        height: 687,
        x: 100,
        y: 100,
        canvasWidth: 460,
        canvasHeight: 244,
      });
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-screenshot-actions"]'),
      ).not.toBeNull(),
    );

    // exactly three choices, in the teacher's order: put the picture on this
    // page, on a new page, read its text (D-103, D-339), and a way out
    const choices = Array.from(
      document.querySelectorAll(
        '[data-testid="panel-screenshot-actions"] button[data-testid^="panel-screenshot-action-"]',
      ),
    ).map((button) => button.getAttribute("data-testid"));

    expect(choices).toEqual([
      "panel-screenshot-action-page",
      "panel-screenshot-action-new-page",
      "panel-screenshot-action-ocr",
    ]);

    expect(
      document.querySelector('[data-testid="panel-screenshot-cancel"]'),
    ).not.toBeNull();
  });
  it("AC-145 the screenshot button's inline style keeps its width and cannot be shrunk", async () => {
    // The button collapsed on the owner's screen on 2026-10-22: it measured
    // ZERO pixels wide, because it is a flex item of a tight header, its
    // content is an `<svg>` with no intrinsic width, and the stylesheet sized
    // that svg in percentages of the button (D-108).
    //
    // jsdom cannot lay out a flexbox, so the test asserts the STYLE that
    // makes the collapse impossible: the size is the chrome's size, in
    // SCREEN pixels (D-92), and the flexbox may not shrink it.
    //
    // The camera lives in the panel's **properties** now (D-135), so it is
    // outside the panel's transform: its width is the screen width and not
    // the screen width divided by the panel's scale.
    const { container } = await render(
      <Excalidraw
        initialData={{ files: { [VIDEO_FILE_ID]: videoFile() } }}
        panelScreenshot={{ onCapture: () => {} }}
      />,
    );

    const code = codePanel();
    const video = videoPanel();

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(code), asElement(video)]);

    // the panels are drawn by the overlay, which renders after the scene is
    // restored
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="code-panel"]'),
      ).not.toBeNull(),
    );

    // and the camera is in the properties panel, which the teacher opens by
    // selecting the panel
    API.setSelectedElements([asElement(code)]);

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-button"]'),
      ).not.toBeNull(),
    );

    const button = container.querySelector(
      '[data-testid="panel-screenshot-button"]',
    ) as HTMLElement | null;

    expect(button).not.toBeNull();

    // the width is the chrome's width: 24 screen pixels, whatever the zoom
    // and whatever the panel's scale - the button is not inside the panel's
    // transform any more, so it is not divided by the scale
    expect(parseFloat(button!.style.width)).toBeCloseTo(
      PANEL_CHROME.buttonSize,
      3,
    );

    // and the flexbox may not take it away. The rule is INLINE, so it holds
    // in a page whose stylesheet has not loaded - which is the case jsdom is.
    expect(button!.style.flexShrink).toBe("0");

    // The control group: the video's play and mute buttons carry a glyph as
    // text, so their min-content width is the glyph and they never collapsed
    // - but their size is decided as well, so they carry the same rule.
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-video-mute"]'),
      ).not.toBeNull(),
    );

    for (const testId of ["panel-video-play", "panel-video-mute"]) {
      const control = container.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLElement | null;

      expect(control).not.toBeNull();
      expect(control!.style.flexShrink).toBe("0");
    }
  });

  it("AC-145 the stylesheet gives the chrome's icon an absolute size, not a percentage", () => {
    // The rule has to be visible to a reader as well as in the inline style
    // (D-108), and it has to break the circle: a percentage makes the icon's
    // width depend on the button's width, and the button's width depends on
    // its content.
    const css = stylesheet();

    const button = css.slice(css.indexOf("&__panel-screenshot-button"));
    const svg = button.slice(
      button.indexOf("svg {"),
      button.indexOf("}", button.indexOf("svg {")),
    );

    expect(svg).toContain("svg {");

    // the icon's size is ABSOLUTE: a screen size, divided by the panel's own
    // scale, like the chrome's other sizes (D-92)
    expect(svg).not.toContain("%");
    expect(svg).toMatch(/width:\s*calc\(\d+px\s*\/\s*var\(--panel-scale\)\)/);
    expect(svg).toMatch(/height:\s*calc\(\d+px\s*\/\s*var\(--panel-scale\)\)/);
  });

  it("AC-151 the crop window's buttons are large, and the flexbox may not shrink them", async () => {
    // A button the flexbox may shrink is a choice the teacher cannot read and
    // cannot hit (D-114). jsdom cannot lay out a flexbox, so the test asserts
    // the STYLE that makes the size impossible to lose (D-339).
    const { container } = await render(
      <Excalidraw panelScreenshot={{ onCapture: () => {} }} />,
    );

    const panel = codePanel();

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="code-panel"]'),
      ).not.toBeNull(),
    );

    act(() => {
      setPendingScreenshot({
        panelId: panel.id,
        source: "editor",
        dataURL: "data:image/jpeg;base64,AAAA",
        width: 1295,
        height: 687,
        x: 100,
        y: 100,
        canvasWidth: 460,
        canvasHeight: 244,
      });
    });

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-actions"]'),
      ).not.toBeNull(),
    );

    const buttons = container.querySelectorAll(
      '[data-testid="panel-screenshot-actions"] button',
    );

    // the three choices and the way out
    expect(buttons).toHaveLength(4);

    for (const button of Array.from(buttons)) {
      const element = button as HTMLElement;

      expect(parseFloat(element.style.fontSize)).toBeGreaterThanOrEqual(16);
      expect(parseFloat(element.style.padding)).toBeGreaterThanOrEqual(10);
      expect(element.style.flexShrink).toBe("0");
    }
  });
  it("AC-151 the bar of choices is across the top of the crop window, whatever the panel is", async () => {
    // The choices used to hang on the panel, which can be clipped or out of
    // view, and then the teacher had a picture and no way to place it (D-278).
    // They are on the crop window itself now (D-339).
    const { container } = await render(
      <Excalidraw panelScreenshot={{ onCapture: () => {} }} />,
    );

    const panel = codePanel();

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="code-panel"]'),
      ).not.toBeNull(),
    );

    act(() => {
      setPendingScreenshot({
        panelId: panel.id,
        source: "editor",
        dataURL: "data:image/jpeg;base64,AAAA",
        width: 1295,
        height: 687,
        x: 100,
        y: 100,
        canvasWidth: 460,
        canvasHeight: 244,
      });
    });

    const bar = (await waitFor(() => {
      const found = container.querySelector(
        '[data-testid="panel-screenshot-actions"]',
      );

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    expect(bar.style.position).toBe("absolute");
    expect(bar.style.top).toBe("0px");
    expect(bar.style.left).toBe("0px");
    expect(bar.style.right).toBe("0px");

    // on the window, and not on the panel
    expect(
      container
        .querySelector('[data-testid="panel-screenshot-focus"]')!
        .contains(bar),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="panel"]')!.contains(bar),
    ).toBe(false);
  });

  it("AC-152 a video panel carries a screenshot button", async () => {
    // The owner's item 5.4: "video does not get a camera icon at all".
    //
    // The camera is a control that acts on the **panel**, so it lives in the
    // panel's PROPERTIES - for every kind of panel (D-135). It is not on the
    // video's own controls either: a control that lives in the content is a
    // control some panels do not have at all.
    const { container } = await render(
      <Excalidraw
        initialData={{ files: { [VIDEO_FILE_ID]: videoFile() } }}
        panelScreenshot={{ onCapture: () => {} }}
      />,
    );

    const video = videoPanel();

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(video)]);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="panel"]')).not.toBeNull(),
    );

    // the teacher selects the video panel, and the camera is there
    API.setSelectedElements([asElement(video)]);

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-button"]'),
      ).not.toBeNull(),
    );

    // and it is NOT on the panel's picture: a camera drawn over the picture is
    // a camera under a YouTube panel's iframe, and the iframe takes the click
    expect(
      container.querySelector(
        '[data-testid="panel"] [data-testid="panel-screenshot-button"]',
      ),
    ).toBeNull();
  });

  it("AC-152 the screenshot button is reachable from the panel's properties", async () => {
    // The camera is a choice about the panel, so it lives where the panel's
    // other choices are (D-135) - and a button there always works, because
    // the properties panel is ordinary DOM beside the canvas.
    const captured: string[] = [];

    const { container } = await render(
      <Excalidraw
        panelScreenshot={{
          onCapture: (panelId) => captured.push(panelId),
        }}
      />,
    );

    const panel = codePanel();

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="panel"]')).not.toBeNull(),
    );

    // the panel is on the canvas, and it is NOT selected: the picture carries
    // no button at all, so there is nothing to click there
    expect(API.getSelectedElements()).toHaveLength(0);
    expect(
      container.querySelector('[data-testid="panel-screenshot-button"]'),
    ).toBeNull();

    // the teacher selects the panel, and the camera appears in its properties
    API.setSelectedElements([asElement(panel)]);

    const camera = await waitFor(() => {
      const button = container.querySelector(
        '[data-testid="panel-screenshot-button"]',
      );

      expect(button).not.toBeNull();

      return button as HTMLElement;
    });

    // and clicking it WORKS: the host is asked for the picture
    await act(async () => {
      fireEvent.click(camera);
    });

    expect(captured).toEqual([panel.id]);
  });

  it("AC-153 a pending screenshot opens an opaque crop window with the picture in it", async () => {
    // The picture comes forward, in a window of its own that nothing of the
    // canvas shows through (D-116, D-339).
    const { container } = await render(
      <Excalidraw panelScreenshot={{ onCapture: () => {} }} />,
    );

    const panel = codePanel();

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="panel"]')).not.toBeNull(),
    );

    // before the capture there is no crop window: there is no picture
    expect(
      container.querySelector('[data-testid="panel-screenshot-focus"]'),
    ).toBeNull();

    act(() => {
      setPendingScreenshot({
        panelId: panel.id,
        source: "editor",
        dataURL: "data:image/jpeg;base64,AAAA",
        width: 1295,
        height: 687,
        x: 100,
        y: 100,
        canvasWidth: 460,
        canvasHeight: 244,
      });
    });

    const focus = (await waitFor(() => {
      const found = container.querySelector(
        '[data-testid="panel-screenshot-focus"]',
      );

      expect(found).not.toBeNull();

      return found;
    })) as HTMLElement;

    // the window is opaque and over the app's whole chrome
    expect(focus.style.background).toBe("rgb(17, 17, 19)");
    expect(focus.style.zIndex).toBe("var(--zIndex-cropWindow)");

    // there is no dimming of the canvas, and no dimming of the panel
    expect(
      container.querySelector('[data-testid="panel-screenshot-focus-scrim"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="panel-focus-scrim"]'),
    ).toBeNull();

    // and the picture is in it
    expect(
      container.querySelector('[data-testid="panel-screenshot-focus-preview"]'),
    ).not.toBeNull();

    const image = container.querySelector(
      '[data-testid="panel-screenshot-focus-image"]',
    ) as HTMLImageElement;

    expect(image.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
  });
  it("AC-153 the crop can be reverted once to the uncropped capture", async () => {
    // The owner asked for a cropping tool "that is turned on by default" and a
    // crop that can be reverted "back one step" (D-116).
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
        width: 1295,
        height: 687,
        x: 100,
        y: 100,
        canvasWidth: 460,
        canvasHeight: 244,
      });
    });

    // the crop is **on by default**: the handles are there the moment the
    // picture arrives (D-116)
    await waitFor(() =>
      expect(
        container.querySelector(
          '[data-testid="panel-screenshot-crop-handle-top-left"]',
        ),
      ).not.toBeNull(),
    );

    // the teacher crops the picture
    act(() => {
      setPendingScreenshotCrop(panel.id, {
        x: 0.1,
        y: 0.1,
        width: 0.5,
        height: 0.5,
      });
    });

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-crop-revert"]'),
      ).not.toBeNull(),
    );

    // the crop is the **picture's own** state: it belongs to the screenshot,
    // not to the canvas (D-116)
    expect(getPendingScreenshot(panel.id)!.crop).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.5,
    });

    // one step of revert: back to the uncropped capture
    fireEvent.click(
      container.querySelector('[data-testid="panel-screenshot-crop-revert"]')!,
    );

    await waitFor(() =>
      expect(getPendingScreenshot(panel.id)!.crop).toEqual(WHOLE_PICTURE),
    );

    // and there is no second step: a crop that has been reverted has nothing
    // to revert to
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-crop-revert"]'),
      ).toBeNull(),
    );
  });
});
