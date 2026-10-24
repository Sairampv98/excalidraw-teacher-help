import { useCallback, useRef } from "react";

import { syncInvalidIndices } from "@excalidraw/element";

import {
  capturePausedVideoFrame,
  clearPendingScreenshot,
  fetchEditorSnapshot,
  getPageRect,
  getPanelCapture,
  getPendingScreenshot,
  getVideoSurface,
  setPendingScreenshot,
  setPendingScreenshotStage,
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

import { ocrTextElements } from "./ocrPlacement";

import type { ScreenshotPlacement } from "../sidebar/insertIntoScene";
import type { OcrImage, OcrPlacement } from "./useOcr";
import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * The app's side of the **screenshot** (D-102, D-103, D-104, D-105, D-140).
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
 *
 * ## The order of the flow (D-140)
 *
 * The owner wrote the three flows out, and this hook follows them:
 *
 * - the **crop** comes first - the teacher crops the picture in the focus
 *   state, and the crop is the picture's own (D-116);
 * - the **choice** comes next: the picture goes on this page, the text is read
 *   out of the cropped region, or the picture goes on another page;
 * - the **page** is chosen through the ribbon, for the third flow;
 * - the **target** is chosen **last**: the wireframe stands on the canvas and
 *   the teacher says where it goes.
 *
 * And a finished placement **gives the canvas back**: the pending screenshot
 * is forgotten, so the focus state - the dimming and the picture in front -
 * goes with it.
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
    /** whether the read puts the text on the canvas (D-140) */
    place?: boolean;
  }) => Promise<{ lines?: readonly OcrLine[] } | null>;
}) => {
  /**
   * The text of a read that has **not** been placed yet (D-140).
   *
   * The flow that writes text reads the cropped region first and places the
   * text afterwards - where the teacher says. The lines are held here until
   * then; a pointer's worth of state is not a document's worth, so it does not
   * belong in the scene.
   */
  const pendingText = useRef<{
    panelId: string;
    lines: readonly OcrLine[];
  } | null>(null);

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
   * The teacher chose one of the three (D-103, D-140).
   *
   * The choice does **not** place the picture: it says **what** is placed,
   * and the target is chosen **after** it. So:
   *
   * - "on this page" and "read the text" go straight to the **wireframe** - the
   *   teacher says where it goes;
   * - "on another page" goes to the **page selector ribbon** first: the
   *   teacher says which page, and the wireframe comes after that.
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
        // the page is chosen through the ribbon, and the picture is placed
        // after it (D-140)
        setPendingScreenshotStage(panelId, "page", { choice });

        return;
      }

      if (choice === "ocr") {
        // The read of the **cropped region** happens first, and the text is
        // placed afterwards - where the teacher says, not where the picture
        // would go (D-140).
        const at = placement(screenshot);

        const result = await readOcr({
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
          // the text is **not** placed yet: the teacher has not said where
          place: false,
        });

        const lines = result?.lines;

        if (!lines?.length) {
          // the read failed, and it said so (D-75): the popup closes and the
          // canvas comes back
          clearPendingScreenshot(panelId);

          return;
        }

        pendingText.current = { panelId, lines };

        setPendingScreenshotStage(panelId, "place", {
          choice,
          placing: "text",
        });

        return;
      }

      // the picture goes on this page, where the teacher says
      setPendingScreenshotStage(panelId, "place", {
        choice,
        placing: "picture",
      });
    },
    [api, readOcr],
  );

  /**
   * The teacher picked a page in the **page selector ribbon** (D-140).
   *
   * `null` means a **new** page: it is made when the picture is placed, in the
   * same scene write, so the page and the picture cannot disagree (D-104).
   */
  const choosePage = useCallback((panelId: string, pageId: string | null) => {
    setPendingScreenshotStage(panelId, "place", {
      ...(pageId
        ? { targetPageId: pageId }
        : { choice: "new-page" as const, targetPageId: null }),
      placing: "picture",
    });
  }, []);

  /**
   * The teacher clicked the wireframe: it lands here (D-104, D-140).
   *
   * What lands is what the choice was about: the **picture**, the **text**, or
   * the picture on the page the ribbon named. And the pending screenshot is
   * forgotten, so the focus state goes with it and the canvas comes back.
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

      const size = placement(screenshot);

      if (screenshot.placing === "text") {
        // The **text** goes where the teacher said (D-140): the lines were
        // read already, and they are put down now - as ordinary text
        // elements, so they can be moved, restyled and undone like any other.
        const text = pendingText.current;

        if (text?.panelId === panelId && text.lines.length) {
          const elements = ocrTextElements({
            lines: text.lines,
            x: at.x,
            y: at.y,
            width: size.canvasWidth,
            height: size.canvasHeight,
            imageWidth: screenshot.width,
            imageHeight: screenshot.height,
            pageId: current.getAppState().currentPageId,
          });

          if (elements.length) {
            current.updateScene({
              elements: syncInvalidIndices([
                ...current.getSceneElements(),
                ...elements,
              ]),
            });
          }
        }
      } else if (screenshot.targetPageId) {
        // the picture goes on the page the ribbon named (D-140): the position
        // is the wireframe's, carried over to that page's own origin
        const pages = current.getAppState().pages ?? [];
        const currentPageId = current.getAppState().currentPageId ?? "";
        const from = getPageRect(pages, currentPageId);
        const to = getPageRect(pages, screenshot.targetPageId);

        insertScreenshotIntoScene(
          current,
          {
            ...size,
            x: at.x + (to.x - from.x),
            y: at.y + (to.y - from.y),
          },
          screenshot.targetPageId,
        );
      } else if (screenshot.choice === "new-page") {
        // a new page is made **with** the picture, in one scene write (D-104)
        insertScreenshotOnNewPage(current, { ...size, x: at.x, y: at.y });
      } else {
        insertScreenshotIntoScene(current, { ...size, x: at.x, y: at.y });
      }

      pendingText.current = null;

      // the placement is done: the popup closes and the canvas comes back
      clearPendingScreenshot(panelId);
    },
    [api],
  );

  return { capture, choose, choosePage, place };
};
