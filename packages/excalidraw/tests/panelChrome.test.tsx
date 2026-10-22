/**
 * The **chrome** of a panel: the header, the control strip, the buttons and
 * the sliders.
 *
 * A panel is a DOM overlay, and the overlay draws it with a `transform:
 * scale(...)`, so everything inside the panel is multiplied by the canvas zoom
 * before it reaches the screen. The CONTENT wants that - the code and the
 * picture are the panel's own. The CHROME does not: the header, the control
 * strip and the controls are the teacher's instrument panel, and they have to
 * be readable and hittable at every zoom (D-92).
 *
 * So every chrome size is a **screen** size, and it is put into the panel's
 * own units by dividing it by the scale. The scale is the panel element's own
 * `--panel-scale`, which is the very number the transform carries.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import React from "react";

import type {
  ExcalidrawElement,
  ExcalidrawPanelElement,
  FileId,
} from "@excalidraw/element/types";

import { Excalidraw, videoPanelContent } from "../index";
import { codePanelContent, emptyCodePanelState } from "../scene/panelContent";
import { PANEL_CHROME, PANEL_SCALE_PROPERTY } from "../scene/panelChrome";

import { API } from "./helpers/api";
import { render } from "./test-utils";

import type { BinaryFileData, NormalizedZoomValue } from "../types";

const VIDEO_FILE_ID = "video-file-1" as FileId;

const videoFile = () => ({
  id: VIDEO_FILE_ID,
  // the file store's media-type list is image-shaped, and it lives in
  // `@excalidraw/element` — outside this wave's scope. A video file keeps its
  // own type, because the overlay tells "a video" from "a picture" by it.
  mimeType: "video/mp4" as unknown as BinaryFileData["mimeType"],
  dataURL: "data:video/mp4;base64,AAAA" as BinaryFileData["dataURL"],
  created: 1,
  lastRetrieved: 1,
  version: 1,
});

const videoPanel = () =>
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

const codePanel = () =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(
      {
        ...emptyCodePanelState(),
        connection: "connected",
        statusMessage: "Connected to the Excalidraw Bridge.",
        editor: {
          uri: "file:///demo/main.py",
          language: "python",
          text: "print('hello')",
          selection: { start: 0, end: 0 },
          version: 1,
        },
      },
      "session-1",
    ),
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;

/**
 * What the chrome measures ON SCREEN, at one zoom.
 *
 * The chrome is laid out inside the panel, and the panel is drawn with a
 * `transform: scale(...)`: a size inside the panel is multiplied by the scale
 * on its way to the screen. So the on-screen size is the size in the panel's
 * own units, times the scale — and the scale is the panel element's own
 * `--panel-scale`, the very number the transform carries.
 */
type Measurement = {
  zoom: number;
  /** the code panel's header, on screen */
  headerHeight: number;
  headerFontSize: number;
  /** the video's control strip, on screen */
  controlHeight: number;
  /** the mute button, on screen */
  buttonSize: number;
  /** the volume slider, on screen */
  volumeWidth: number;
  volumeHeight: number;
};

/** Renders both panels at a zoom and measures the chrome on screen. */
const measureAt = async (zoom: number): Promise<Measurement> => {
  const { container } = await render(
    <Excalidraw
      initialData={{
        elements: [codePanel(), videoPanel()] as unknown as ExcalidrawElement[],
        files: { [VIDEO_FILE_ID]: videoFile() },
      }}
    />,
  );

  API.setAppState({
    width: 1000,
    height: 1000,
    zoom: { value: zoom as NormalizedZoomValue },
  });

  // the panel element publishes the scale its own transform carries
  const panel = container.querySelector(
    '[data-testid="panel"]',
  ) as HTMLElement | null;

  expect(panel).not.toBeNull();

  const scale = parseFloat(
    getComputedStyle(panel!).getPropertyValue(PANEL_SCALE_PROPERTY),
  );

  // the scale is the camera's zoom — one source, and no number is hard-coded
  expect(scale).toBeCloseTo(zoom, 5);

  const header = container.querySelector(
    '[data-testid="code-panel-header"]',
  ) as HTMLElement | null;
  const controls = container.querySelector(
    '[data-testid="panel-video-controls"]',
  ) as HTMLElement | null;
  const mute = container.querySelector(
    '[data-testid="panel-video-mute"]',
  ) as HTMLElement | null;
  const volume = container.querySelector(
    '[data-testid="panel-video-volume"]',
  ) as HTMLElement | null;

  expect(header).not.toBeNull();
  expect(controls).not.toBeNull();
  expect(mute).not.toBeNull();
  expect(volume).not.toBeNull();

  return {
    zoom,
    headerHeight: parseFloat(header!.style.minHeight) * scale,
    headerFontSize: parseFloat(header!.style.fontSize) * scale,
    controlHeight: parseFloat(controls!.style.minHeight) * scale,
    buttonSize: parseFloat(mute!.style.width) * scale,
    volumeWidth: parseFloat(volume!.style.width) * scale,
    volumeHeight: parseFloat(volume!.style.height) * scale,
  };
};

describe("the panel's chrome", () => {
  it("AC-128 the panel's chrome keeps its size on screen at any canvas zoom", async () => {
    // the two zooms: the panel as it is drawn, and the panel at half size —
    // the case the owner saw on 2026-10-22, where the header's text
    // overlapped and the control buttons were about five pixels tall
    const measured = [await measureAt(1), await measureAt(0.5)];

    for (const measurement of measured) {
      // the chrome's size ON SCREEN is the same at every zoom: the header is
      // still 22 screen pixels tall, and the control strip still 26
      expect(measurement.headerHeight).toBeCloseTo(
        PANEL_CHROME.headerHeight,
        3,
      );
      expect(measurement.headerFontSize).toBeCloseTo(
        PANEL_CHROME.headerFontSize,
        3,
      );
      expect(measurement.controlHeight).toBeCloseTo(
        PANEL_CHROME.controlHeight,
        3,
      );
      expect(measurement.buttonSize).toBeCloseTo(PANEL_CHROME.buttonSize, 3);
      expect(measurement.volumeWidth).toBeCloseTo(PANEL_CHROME.volumeWidth, 3);
      expect(measurement.volumeHeight).toBeCloseTo(
        PANEL_CHROME.sliderHeight,
        3,
      );

      // and the chrome is big enough to use: the header is tall enough for its
      // own text, and the control strip is not squeezed to nothing
      expect(measurement.headerHeight).toBeGreaterThanOrEqual(20);
      expect(measurement.headerHeight).toBeGreaterThan(
        measurement.headerFontSize,
      );
      expect(measurement.controlHeight).toBeGreaterThanOrEqual(24);
      expect(measurement.buttonSize).toBeGreaterThanOrEqual(20);
      expect(measurement.volumeWidth).toBeGreaterThanOrEqual(48);
      expect(measurement.volumeHeight).toBeGreaterThanOrEqual(16);
    }

    // and the two zooms agree: the chrome does not shrink with the canvas
    expect(measured[1].headerHeight).toBeCloseTo(measured[0].headerHeight, 3);
    expect(measured[1].controlHeight).toBeCloseTo(measured[0].controlHeight, 3);
    expect(measured[1].buttonSize).toBeCloseTo(measured[0].buttonSize, 3);
    expect(measured[1].volumeWidth).toBeCloseTo(measured[0].volumeWidth, 3);
  });
});
