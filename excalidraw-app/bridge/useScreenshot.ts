import { useCallback } from "react";

import {
  capturePausedVideoFrame,
  clearPendingScreenshot,
  fetchEditorSnapshot,
  getPanelCapture,
  getPendingScreenshot,
  getVideoSurface,
  setPendingScreenshot,
  snapshotUrl,
} from "@excalidraw/excalidraw";

import type {
  PanelScreenshot,
  PanelScreenshotChoice,
  PanelScreenshotSource,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  insertScreenshotIntoScene,
  insertScreenshotOnNewPage,
  placementFor,
  screenshotCanvasSize,
} from "../sidebar/insertIntoScene";

import type { OcrImage, OcrPlacement } from "./useOcr";

/**
 * The app's side of the **screenshot** (D-102, D-103, D-104, D-105).
 *
 * The library draws the button, the choice strip and the wireframe; the app
 * does the three things that need the app:
 *
 * - it takes the **picture** — the video's own pixels, or one frame from the
 *   extension's HTTP server (D-102);
 * - it puts the picture on the canvas, on this page or on a new one (D-104);
 * - it reads the picture with the project's **existing** OCR path (D-105).
 *
 * The picture is pending between the capture and the placement: the library
 * holds it, and the wireframe stands where it will land.
 */
export const useScreenshot = ({
  api,
  readOcr,
}: {
  api: ExcalidrawImperativeAPI | null;
  /** the app's existing OCR path: the same read the panel's OCR uses (D-105) */
  readOcr: (args: {
    image: OcrImage;
    placement: OcrPlacement;
    pageId: string;
  }) => Promise<unknown>;
}) => {
  /**
   * Publish the picture that was taken.
   *
   * It starts in the middle of what the teacher is looking at, and the
   * wireframe stands there until they move it or place it (D-104).
   */
  const publish = useCallback(
    (
      panelId: string,
      source: PanelScreenshotSource,
      picture: { dataURL: string; width: number; height: number },
    ) => {
      const current = api;

      if (!current) {
        return;
      }

      const size = screenshotCanvasSize(picture.width, picture.height);
      const at = placementFor(current, size);

      setPendingScreenshot({
        panelId,
        source,
        dataURL: picture.dataURL,
        width: picture.width,
        height: picture.height,
        x: at.x,
        y: at.y,
        canvasWidth: size.width,
        canvasHeight: size.height,
      });
    },
    [api],
  );

  /**
   * Takes the picture of a panel (D-102).
   *
   * The two sources are different, and the difference is real:
   *
   * - the **video's** frame is right here: the `<video>` element is in the
   *   page, so the frame is the video's own pixels — and the video is
   *   **paused** first, because the owner asked for the paused frame;
   * - the **editor's** window is not in the app: the frames live in the
   *   extension, so the app asks for **one** of them over the extension's own
   *   HTTP server, on the stream's URL with one more path segment. The session
   *   token is never in a URL, and the capability in it is the one that
   *   already authorises the stream (D-50, D-86).
   */
  const capture = useCallback(
    async (panelId: string) => {
      const video = getVideoSurface(panelId);

      if (video) {
        const frame = capturePausedVideoFrame(video);

        if (frame) {
          publish(panelId, "video", frame);
        }

        return;
      }

      const live = getPanelCapture(panelId);

      if (!live || live.status !== "live") {
        // there is no live window to take a picture of
        return;
      }

      const picture = await fetchEditorSnapshot(snapshotUrl(live.streamUrl));

      if (!picture) {
        return;
      }

      publish(panelId, "editor", picture);
    },
    [publish],
  );

  /** the picture, as the canvas needs it */
  const placement = (screenshot: PanelScreenshot) => ({
    dataURL: screenshot.dataURL,
    canvasWidth: screenshot.canvasWidth,
    canvasHeight: screenshot.canvasHeight,
    x: screenshot.x,
    y: screenshot.y,
  });

  /**
   * The teacher chose one of the three (D-103).
   *
   * "Place on this page" and "OCR the screenshot" both put the picture on the
   * canvas where the wireframe stands; the OCR choice also reads it, with the
   * project's existing OCR path — one OCR, not two (D-105). "Place on a new
   * page" creates the page and puts the picture on it.
   */
  const choose = useCallback(
    async (panelId: string, choice: PanelScreenshotChoice) => {
      const current = api;

      if (!current) {
        return;
      }

      const screenshot = getPendingScreenshot(panelId);

      if (!screenshot) {
        return;
      }

      if (choice === "new-page") {
        insertScreenshotOnNewPage(current, placement(screenshot));
        clearPendingScreenshot(panelId);

        return;
      }

      insertScreenshotIntoScene(current, placement(screenshot));

      if (choice === "ocr") {
        await readOcr({
          image: {
            dataURL: screenshot.dataURL,
            width: screenshot.width,
            height: screenshot.height,
          },
          placement: {
            x: screenshot.x,
            y: screenshot.y,
            width: screenshot.canvasWidth,
            height: screenshot.canvasHeight,
          },
          pageId: current.getAppState().currentPageId,
        });
      }

      clearPendingScreenshot(panelId);
    },
    [api, readOcr],
  );

  /**
   * The teacher clicked the wireframe: the picture lands here (D-104).
   */
  const place = useCallback(
    (panelId: string, at: { x: number; y: number }) => {
      const current = api;

      if (!current) {
        return;
      }

      const screenshot = getPendingScreenshot(panelId);

      if (!screenshot) {
        return;
      }

      insertScreenshotIntoScene(current, {
        ...placement(screenshot),
        x: at.x,
        y: at.y,
      });

      clearPendingScreenshot(panelId);
    },
    [api],
  );

  return { capture, choose, place };
};
