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
  WHOLE_PICTURE,
} from "@excalidraw/excalidraw";
import { t } from "@excalidraw/excalidraw/i18n";

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

import type { ScreenshotPlacement } from "../sidebar/insertIntoScene";
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
    /** the part of the picture to read, in the picture's own pixels (D-116) */
    region?: { x: number; y: number; width: number; height: number };
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
      const current = api;
      const video = getVideoSurface(panelId);

      if (video) {
        const frame = capturePausedVideoFrame(video);

        if (frame) {
          publish(panelId, "video", frame);
          return;
        }

        // the failure is **said**, never swallowed (D-75): a button that does
        // nothing looks like a button that is broken
        current?.setToast({
          message: t("labels.panel.screenshot.captureFailed"),
        });

        return;
      }

      const live = getPanelCapture(panelId);

      if (!live || live.status !== "live") {
        // there is no live window to take a picture of - and the teacher is
        // told so (D-75)
        current?.setToast({
          message: t("labels.panel.screenshot.nothingToCapture"),
        });

        return;
      }

      const picture = await fetchEditorSnapshot(snapshotUrl(live.streamUrl));

      if (!picture) {
        current?.setToast({
          message: t("labels.panel.screenshot.captureFailed"),
        });

        return;
      }

      publish(panelId, "editor", picture);
    },
    [api, publish],
  );

  /**
   * The picture, as the canvas needs it.
   *
   * The crop the teacher took in the focus state is the **picture's own**
   * (D-116), so the placed picture is the cropped part of it: it is the size
   * the crop leaves of the picture, and it stands where that part of the
   * picture stood. The bytes are the picture's own - the crop is a view of
   * them, so the picture stays the picture the teacher took.
   */
  const placement = (screenshot: PanelScreenshot): ScreenshotPlacement => {
    const crop = screenshot.crop ?? WHOLE_PICTURE;

    const isWhole =
      crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;

    if (isWhole) {
      return {
        dataURL: screenshot.dataURL,
        canvasWidth: screenshot.canvasWidth,
        canvasHeight: screenshot.canvasHeight,
        x: screenshot.x,
        y: screenshot.y,
      };
    }

    return {
      dataURL: screenshot.dataURL,
      canvasWidth: screenshot.canvasWidth * crop.width,
      canvasHeight: screenshot.canvasHeight * crop.height,
      x: screenshot.x + screenshot.canvasWidth * crop.x,
      y: screenshot.y + screenshot.canvasHeight * crop.y,
      crop: {
        x: Math.round(crop.x * screenshot.width),
        y: Math.round(crop.y * screenshot.height),
        width: Math.round(crop.width * screenshot.width),
        height: Math.round(crop.height * screenshot.height),
        naturalWidth: screenshot.width,
        naturalHeight: screenshot.height,
      },
    };
  };

  /**
   * The part of the picture the OCR reads, in the picture's own pixels.
   *
   * The crop the teacher took is the region of interest (D-116): the teacher
   * cropped the picture because they wanted that part, and the read is about
   * the same part.
   */
  const ocrRegion = (screenshot: PanelScreenshot) => {
    const crop = screenshot.crop ?? WHOLE_PICTURE;

    return {
      x: Math.round(crop.x * screenshot.width),
      y: Math.round(crop.y * screenshot.height),
      width: Math.round(crop.width * screenshot.width),
      height: Math.round(crop.height * screenshot.height),
    };
  };

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
        const at = placement(screenshot);

        await readOcr({
          image: {
            dataURL: screenshot.dataURL,
            width: screenshot.width,
            height: screenshot.height,
          },
          placement: {
            x: at.x,
            y: at.y,
            width: at.canvasWidth,
            height: at.canvasHeight,
          },
          // the crop the teacher took is the part to read (D-116)
          region: ocrRegion(screenshot),
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
