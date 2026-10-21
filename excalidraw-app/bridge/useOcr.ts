import { useCallback, useState } from "react";

import { syncInvalidIndices } from "@excalidraw/element";

import { captureVideoFrame, getVideoSurface } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import { dataUrlToBase64, ocrTextElements } from "./ocrPlacement";

import type { OcrRegion } from "../../packages/vscode-bridge/bridge/src/ocr";

import type {
  OcrRequest,
  OcrResult,
} from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * The app's side of the **OCR capability** (D-59).
 *
 * The engine is in the bridge's Node process, so the app's job is small:
 *
 * - take the picture the teacher wants read (a poster, or the frame the video
 *   is showing right now);
 * - ask the bridge to read it, with the **region** the teacher picked — the
 *   crop is the one OCR lever that costs nothing and buys the most;
 * - put the **per-line** text back where it was read from, as ordinary text
 *   elements of the document.
 *
 * With no bridge the read fails, and the failure is **said**: the panel shows
 * the reason, so the teacher is never left with a panel that shows nothing and
 * no idea why (D-59).
 */

/** the sentence the panel shows before anything was read */
export const OCR_IDLE_MESSAGE = "Read the text with the bridge.";

/** the sentence the panel shows while a read is running */
export const OCR_READING_MESSAGE = "Reading the text…";

export type OcrImage = {
  /** the picture, as a data URL */
  dataURL: string;
  /** the picture's own size, in its pixels */
  width: number;
  height: number;
};

export type OcrPlacement = {
  /** where the picture is drawn on the canvas */
  x: number;
  y: number;
  width: number;
  height: number;
};

export const useOcr = ({
  api,
  requestOcr,
}: {
  api: ExcalidrawImperativeAPI | null;
  /** asks the bridge to read a picture */
  requestOcr: (request: Omit<OcrRequest, "id">) => Promise<OcrResult>;
}) => {
  const [message, setMessage] = useState(OCR_IDLE_MESSAGE);
  const [busy, setBusy] = useState(false);

  /**
   * Reads a picture and puts the lines back where they were read from.
   *
   * The lines land as **ordinary text elements**, so the teacher can move
   * them, restyle them and undo them like any other text.
   */
  const read = useCallback(
    async ({
      image,
      region,
      placement,
      pageId,
      strokeColor = "#000000",
    }: {
      /** the picture to read */
      image: OcrImage;
      /** the part of the picture to read, in the picture's own pixels */
      region?: OcrRegion;
      /** where the picture is drawn on the canvas */
      placement: OcrPlacement;
      /** the page the text goes on */
      pageId: string;
      /** the colour of the text */
      strokeColor?: string;
    }) => {
      setBusy(true);
      setMessage(OCR_READING_MESSAGE);

      try {
        const result = await requestOcr({
          imageBase64: dataUrlToBase64(image.dataURL),
          ...(region ? { region } : {}),
        });

        const elements = ocrTextElements({
          lines: result.lines,
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          imageWidth: image.width,
          imageHeight: image.height,
          pageId,
          strokeColor,
        });

        const current = api;

        if (current && elements.length) {
          current.updateScene({
            elements: syncInvalidIndices([
              ...current.getSceneElements(),
              ...elements,
            ]),
          });
        }

        setMessage(
          elements.length
            ? `Read ${elements.length} line${elements.length === 1 ? "" : "s"}.`
            : "No text was found.",
        );

        return result;
      } catch (error) {
        // the failure is said, never swallowed
        setMessage((error as Error).message);

        return null;
      } finally {
        setBusy(false);
      }
    },
    [api, requestOcr],
  );

  /**
   * The picture of a panel: its **poster**, or the frame the video is showing
   * right now.
   */
  const imageOfPanel = useCallback(
    (panel: ExcalidrawPanelElement): OcrImage | null => {
      const current = api;

      if (!current) {
        return null;
      }

      if (panel.posterMode && panel.posterFileId) {
        const file = current.getFiles()[panel.posterFileId];

        if (!file) {
          return null;
        }

        return {
          dataURL: file.dataURL,
          width: panel.panel.options.naturalWidth ?? panel.width,
          height: panel.panel.options.naturalHeight ?? panel.height,
        };
      }

      // a live video: the frame the teacher is looking at, at the video's own
      // size
      const video = getVideoSurface(panel.id);

      if (!video) {
        return null;
      }

      const frame = captureVideoFrame(video);

      if (!frame) {
        return null;
      }

      return {
        dataURL: frame.dataURL,
        width: frame.width,
        height: frame.height,
      };
    },
    [api],
  );

  return { read, imageOfPanel, message, busy };
};
