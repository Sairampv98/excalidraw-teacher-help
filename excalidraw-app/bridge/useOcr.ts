import { useCallback, useEffect, useState } from "react";

import { isPanelElement, syncInvalidIndices } from "@excalidraw/element";

import { captureVideoFrame, getVideoSurface } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import { DEFAULT_PANEL_OCR_ENGINE, OCR_ENGINE_CHOICES } from "../ocr/engines";

import { dataUrlToBase64, ocrTextElements } from "./ocrPlacement";

import type { OcrRegion } from "../../packages/vscode-bridge/bridge/src/ocr";

import type {
  OcrEngineName,
  OcrEngineState,
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
 *
 * The panel also says **which engine** read the text and **how long** it took:
 * the engine is a choice (D-90), and a choice the teacher cannot see is a
 * choice the teacher cannot make.
 */

/** the sentence the panel shows before anything was read */
export const OCR_IDLE_MESSAGE = "Read the text with the bridge.";

/** the sentence the panel shows while a read is running */
export const OCR_READING_MESSAGE = "Reading the text…";

/**
 * The sentence that says which engine is in use.
 *
 * The engine named is the one the panel will **use** (D-134): the engine the
 * teacher picked for that panel, or - when there is no picker at all - the
 * engine the extension reported in `ocr:state`.
 *
 * The extension's own setting is only the **fallback** for a machine with no
 * picker (D-118): with a picker, the panel sends the chosen engine with every
 * request, so the engine that **runs** is the one the teacher picked, and the
 * sentence has to name that one.
 *
 * An engine that is not there is **said**, with the reason: the teacher has to
 * be able to fix it (D-91).
 */
export const ocrEngineMessage = (
  state: OcrEngineState | null,
  engine?: OcrEngineName | null,
): string => {
  if (!state) {
    return OCR_IDLE_MESSAGE;
  }

  if (engine) {
    // the reason is about the engine that will run, so it is kept (D-91)
    if (state.state === "unavailable" && engine === state.engine) {
      return state.reason ?? "The OCR engine is not available.";
    }

    return `${OCR_IDLE_MESSAGE} (engine: ${engine})`;
  }

  if (state.state === "unavailable") {
    return state.reason ?? "The OCR engine is not available.";
  }

  return `${OCR_IDLE_MESSAGE} (engine: ${state.engine ?? "unknown"})`;
};

/**
 * The sentence that says what was read, and by whom.
 *
 * The engine and the time are in it, so a fast engine and a slow one look
 * different (D-90).
 */
export const ocrReadMessage = ({
  lines,
  engine,
  durationMs,
}: {
  lines: number;
  engine?: string;
  durationMs?: number;
}): string => {
  const count = `${lines} line${lines === 1 ? "" : "s"}`;
  const by = engine ? ` with ${engine}` : "";
  const took =
    durationMs === undefined ? "" : ` in ${Math.round(durationMs)} ms`;

  return `Read ${count}${by}${took}.`;
};

export type OcrImage = {
  /** the picture, as a data URL */
  dataURL: string;
  /** the picture's own size, in its pixels */
  width: number;
  height: number;
};

/**
 * The picture's own size, in its pixels.
 *
 * An ordinary image element does not carry its natural size - the element's
 * width and height are its size **on the canvas** - and the OCR's lines come
 * back in the picture's own pixels (D-59). So the picture is decoded to learn
 * its size, and the browser does that natively.
 *
 * `0` when the picture cannot be decoded: the caller then falls back to the
 * size the canvas knows.
 */
export const imageNaturalSize = (
  dataURL: string,
): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const image = new Image();

    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = dataURL;
  });

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
  engineState = null,
}: {
  api: ExcalidrawImperativeAPI | null;
  /** asks the bridge to read a picture */
  requestOcr: (request: Omit<OcrRequest, "id">) => Promise<OcrResult>;
  /** the engine's state, as the extension said it (D-90, D-91) */
  engineState?: OcrEngineState | null;
}) => {
  const [readMessage, setReadMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The engine the teacher chose, **per panel** (D-118).
   *
   * The picker belongs to the panel, so the choice belongs to the panel too:
   * one panel may be read with indra while another is read with paddle.
   *
   * A panel with no choice reads with the **fastest measured** engine
   * (`DEFAULT_PANEL_OCR_ENGINE`), and the bridge's own setting stays the
   * fallback for a machine with no picker at all.
   */
  const [enginesByPanel, setEnginesByPanel] = useState<
    Record<string, OcrEngineName>
  >({});

  const selectEngine = useCallback((panelId: string, engineId: string) => {
    setEnginesByPanel((current) => {
      if (current[panelId] === engineId) {
        return current;
      }

      return { ...current, [panelId]: engineId as OcrEngineName };
    });
  }, []);

  const engineFor = useCallback(
    (panelId: string) => enginesByPanel[panelId] ?? DEFAULT_PANEL_OCR_ENGINE,
    [enginesByPanel],
  );

  /**
   * The panel whose row carries the sentence (D-134).
   *
   * The chrome is drawn for the **selected** panel, so the sentence under the
   * "Read the text" button belongs to that panel - and it has to name the
   * engine **that** panel will read with.
   */
  const [activePanelId, setActivePanelId] = useState<string | null>(null);

  useEffect(() => {
    const current = api;

    if (!current?.onChange) {
      return;
    }

    /**
     * The selection the app last saw.
     *
     * The app state's selection object is a **new** object exactly when the
     * selection changed, so the scene is only walked when it really changed -
     * and a scroll, which changes the app state on every frame, costs nothing.
     */
    let lastSelection: Record<string, boolean> | null = null;

    const readSelection = () => {
      const selected = current.getAppState()?.selectedElementIds;

      if (!selected || selected === lastSelection) {
        return;
      }

      lastSelection = selected;

      const panelId = Object.keys(selected).find((elementId) =>
        isPanelElement(
          current
            .getSceneElements()
            .find((element) => element.id === elementId),
        ),
      );

      setActivePanelId(panelId ?? null);
    };

    readSelection();

    return current.onChange(readSelection);
  }, [api]);

  /**
   * The engine the panel will read with (D-134).
   *
   * It is the teacher's choice for that panel, or the fastest measured engine
   * when they chose none (D-118). The extension's own setting is only the
   * fallback for a machine with no picker, so it is never named here.
   */
  const activeEngine = activePanelId
    ? engineFor(activePanelId)
    : DEFAULT_PANEL_OCR_ENGINE;

  /**
   * The sentence the panel shows.
   *
   * It is the read's own sentence when there was one, and otherwise the
   * engine's: which engine is in use, or - when it is not there - why, and
   * what to install (D-90, D-91).
   */
  const message = busy
    ? OCR_READING_MESSAGE
    : readMessage ?? ocrEngineMessage(engineState, activeEngine);

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
      engine,
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
      /**
       * Which engine to read with (D-118).
       *
       * The engine travels with the request, so the extension reads with the
       * one the teacher picked in the panel. Without it the extension falls
       * back to its own setting (D-90).
       */
      engine?: OcrEngineName;
    }) => {
      setBusy(true);
      setReadMessage(null);

      try {
        const result = await requestOcr({
          imageBase64: dataUrlToBase64(image.dataURL),
          ...(region ? { region } : {}),
          ...(engine ? { engine } : {}),
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

        setReadMessage(
          elements.length
            ? ocrReadMessage({
                lines: elements.length,
                ...(result.engine === undefined
                  ? {}
                  : { engine: result.engine }),
                ...(result.durationMs === undefined
                  ? {}
                  : { durationMs: result.durationMs }),
              })
            : "No text was found.",
        );

        return result;
      } catch (error) {
        // the failure is said, never swallowed
        setReadMessage((error as Error).message);

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

  return {
    read,
    imageOfPanel,
    message,
    busy,
    /** the engines the picker offers, with their measured speed (D-118) */
    engines: OCR_ENGINE_CHOICES,
    /** the engine chosen for a panel */
    engineFor,
    /** the teacher chose an engine for a panel */
    selectEngine,
  };
};
