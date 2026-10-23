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
  clearAllPendingScreenshots,
  fetchEditorSnapshot,
  setPendingScreenshot,
  snapshotUrl,
} from "../scene/panelScreenshot";
import { codePanelContent, emptyCodePanelState } from "../scene/panelContent";
import { PANEL_CHROME, PANEL_SCALE_PROPERTY } from "../scene/panelChrome";

import { API } from "./helpers/api";
import { act, render, waitFor } from "./test-utils";

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

    // the chrome carries the screenshot button, and one button only
    expect(
      document.querySelector('[data-testid="panel-screenshot-button"]'),
    ).not.toBeNull();

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
        document.querySelector('[data-testid="panel-screenshot-choices"]'),
      ).not.toBeNull(),
    );

    // exactly three: OCR the screenshot, place on this page, place on a new
    // page (D-103)
    const choices = document.querySelectorAll(
      '[data-testid="panel-screenshot-choices"] button',
    );

    expect(choices).toHaveLength(3);

    expect(
      document.querySelector('[data-testid="panel-screenshot-choice-ocr"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="panel-screenshot-choice-page"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="panel-screenshot-choice-newPage"]'),
    ).not.toBeNull();
  });

  it("AC-145 the screenshot button's inline style keeps its width and cannot be shrunk", async () => {
    // The button collapsed on the owner's screen on 2026-10-22: it measured
    // ZERO pixels wide, because it is a flex item of a tight header, its
    // content is an `<svg>` with no intrinsic width, and the stylesheet sized
    // that svg in percentages of the button (D-108).
    //
    // jsdom cannot lay out a flexbox, so the test asserts the STYLE that
    // makes the collapse impossible: the size is the chrome's size, in the
    // panel's own units (D-92), and the flexbox may not shrink it.
    const { container } = await render(
      <Excalidraw
        initialData={{ files: { [VIDEO_FILE_ID]: videoFile() } }}
        panelScreenshot={{ onCapture: () => {} }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel()), asElement(videoPanel())]);

    // the panels are drawn by the overlay, which renders after the scene is
    // restored
    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="panel-screenshot-button"]'),
      ).not.toBeNull(),
    );

    const button = container.querySelector(
      '[data-testid="panel-screenshot-button"]',
    ) as HTMLElement | null;

    expect(button).not.toBeNull();

    // the panel publishes the scale its own transform carries
    const scale = parseFloat(
      getComputedStyle(
        container.querySelector('[data-testid="panel"]')!,
      ).getPropertyValue(PANEL_SCALE_PROPERTY),
    );

    // the width is the chrome's width: 24 screen pixels, whatever the zoom
    expect(parseFloat(button!.style.width) * scale).toBeCloseTo(
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
});
