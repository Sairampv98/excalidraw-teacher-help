import { useCallback, useEffect, useRef, useState } from "react";

import { isPanelElement, syncInvalidIndices } from "@excalidraw/element";

import { captureVideoFrame, getVideoSurface } from "@excalidraw/excalidraw";
import { t } from "@excalidraw/excalidraw/i18n";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import {
  BRIDGE_NEEDED_REASON,
  BROWSER_ENGINE_REASON,
  BROWSER_OCR_ENGINES,
  DEFAULT_PANEL_OCR_ENGINE,
  OCR_ENGINE_CHOICES,
  ocrLadderFor,
} from "../ocr/engines";

import { dataUrlToBase64, ocrTextElements } from "./ocrPlacement";

import type { OcrRegion } from "../../packages/vscode-bridge/bridge/src/ocr";

import type {
  OcrEngineName,
  OcrEngineState,
  OcrRequest,
  OcrResult,
} from "../../packages/vscode-bridge/bridge/src/ocr";

import type { OcrLadderStep } from "../ocr/engines";

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
 *
 * And the engine is not a choice the teacher has to make at all: the read
 * walks the **ladder** (D-137) — indra when the bridge is there, tesseract
 * when it is not, paddle only as the last resort — and it says which engine
 * ran, how long it took, and **why the one before it did not** (D-75, D-93,
 * D-125). A read that takes time says so while it takes it, and it can be
 * cancelled (D-138).
 */

/** the sentence the panel shows before anything was read */
export const OCR_IDLE_MESSAGE = "Read the text with the bridge.";

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

/**
 * A rung of the ladder that did **not** run, and why (D-137).
 *
 * The reason is not decoration: a fall-back that says nothing is a fall-back
 * the teacher cannot trust, and this project keeps refusing them (D-75, D-93,
 * D-125).
 */
export type OcrLadderSkip = {
  /** the engine that did not run */
  engine: OcrEngineName;
  /** why it did not run */
  reason: string;
};

/** what the walk of the ladder did */
export type OcrLadderOutcome = {
  /** the engine that read the text, when one did */
  engine?: OcrEngineName;
  /** the read's own answer */
  result?: OcrResult;
  /** the rungs that did not run, and why */
  skipped: OcrLadderSkip[];
};

/**
 * The walk of the **ladder** (D-137).
 *
 * The machine walks the rungs in order and stops at the first one that reads.
 * Every rung it did not use is **named**, with the reason:
 *
 * - a rung that needs the bridge and there is no bridge says so;
 * - a rung that would run in the browser and no engine runs there says so
 *   (D-59) — the browser has no engine, and pretending otherwise would be a
 *   lie the teacher pays for;
 * - a rung the bridge refused says the bridge's own reason.
 */
export const walkOcrLadder = async ({
  ladder,
  read,
  bridgeConnected,
  browserEngines = BROWSER_OCR_ENGINES,
}: {
  /** the rungs, in the order the machine walks them */
  ladder: readonly OcrLadderStep[];
  /** reads with one rung's engine */
  read: (step: OcrLadderStep) => Promise<OcrResult>;
  /** is the bridge there? */
  bridgeConnected: boolean;
  /** the engines the browser can run by itself */
  browserEngines?: readonly OcrEngineName[];
}): Promise<OcrLadderOutcome> => {
  const skipped: OcrLadderSkip[] = [];

  for (const rung of ladder) {
    if (rung.route === "bridge" && !bridgeConnected) {
      skipped.push({ engine: rung.engine, reason: BRIDGE_NEEDED_REASON });
      continue;
    }

    if (rung.route === "browser" && !browserEngines.includes(rung.engine)) {
      skipped.push({ engine: rung.engine, reason: BROWSER_ENGINE_REASON });
      continue;
    }

    try {
      const result = await read(rung);

      return {
        engine: result.engine ?? rung.engine,
        result,
        skipped,
      };
    } catch (error) {
      skipped.push({ engine: rung.engine, reason: (error as Error).message });
    }
  }

  return { skipped };
};

/**
 * The sentence the panel shows after the ladder walked (D-137).
 *
 * It says **which engine ran**, **how long it took** and **why the one before
 * it did not** — the three things a teacher needs to trust the read, and the
 * three things a silent fall-back never says.
 */
export const ocrLadderMessage = ({
  lines,
  engine,
  durationMs,
  skipped,
}: {
  /** the lines that were read, when there was a read */
  lines?: number;
  /** the engine that ran, when one did */
  engine?: OcrEngineName;
  /** how long the read took */
  durationMs?: number;
  /** the rungs that did not run */
  skipped: readonly OcrLadderSkip[];
}): string => {
  const notes = skipped.map((skip) =>
    t("labels.ocrLadder.skipped", {
      engine: skip.engine,
      reason: skip.reason,
    }),
  );

  if (engine === undefined || lines === undefined) {
    // nothing could read it: the reasons are the whole sentence
    return [t("labels.ocrLadder.none"), ...notes].join(" ");
  }

  /**
   * The headline.
   *
   * A read that found **no** text still says which engine ran and why the
   * one before it did not: a read that says nothing about the engine is a
   * read that says nothing (D-75, D-93, D-125).
   */
  const headline = lines
    ? ocrReadMessage({
        lines,
        engine,
        ...(durationMs === undefined ? {} : { durationMs }),
      })
    : durationMs === undefined
    ? t("labels.ocrLadder.noText", { engine })
    : t("labels.ocrLadder.noTextTook", {
        engine,
        ms: Math.round(durationMs),
      });

  return notes.length ? [headline, ...notes].join(" ") : headline;
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
  bridgeConnected = true,
}: {
  api: ExcalidrawImperativeAPI | null;
  /** asks the bridge to read a picture */
  requestOcr: (request: Omit<OcrRequest, "id">) => Promise<OcrResult>;
  /** the engine's state, as the extension said it (D-90, D-91) */
  engineState?: OcrEngineState | null;
  /**
   * Is the bridge there?
   *
   * It decides the ladder (D-137): with the bridge the fastest engine there
   * is goes first, without it the rung that needs nothing but the browser
   * does.
   */
  bridgeConnected?: boolean;
}) => {
  const [readMessage, setReadMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The read that is running, and whether it was cancelled (D-138).
   *
   * The cancel is a **flag**, not a kill: the read may still finish in the
   * extension, but its answer is dropped, and the panel is usable again.
   */
  const cancelledRef = useRef(false);

  /**
   * The **crop** of each panel's picture, in the picture's own pixels (D-137).
   *
   * The crop and the read are **one** action: the teacher crops the panel
   * once, and every read of that panel reads the region they cropped - the
   * read takes the cropped region, and not the whole picture.
   *
   * The crop lives in a **ref**, and not in the state: the read that follows
   * the crop has to see it at once, and a state update is not there yet when
   * the read starts.
   */
  const cropsRef = useRef<Record<string, OcrRegion>>({});

  /**
   * Remembers the crop of a panel (D-137).
   *
   * The crop dialog hands the crop over when the teacher reads it, and the
   * panel's own read uses it from then on.
   */
  const rememberCrop = useCallback((panelId: string, region: OcrRegion) => {
    cropsRef.current = { ...cropsRef.current, [panelId]: region };
  }, []);

  /** the crop of a panel, when it has one */
  const cropFor = useCallback(
    (panelId: string) => cropsRef.current[panelId] ?? null,
    [],
  );

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
   * The engine the teacher **chose** for a panel, when they chose one.
   *
   * The picker's default is not a choice: it is the fastest measured engine
   * (D-118). The ladder is what the machine does when the teacher did not
   * choose (D-137), so the read needs to know the difference between "the
   * teacher picked this" and "this is only the default".
   */
  const pickedEngineFor = useCallback(
    (panelId: string) => enginesByPanel[panelId] ?? null,
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
    ? t("labels.ocrLadder.reading")
    : readMessage ?? ocrEngineMessage(engineState, activeEngine);

  /**
   * Reads a picture and puts the lines back where they were read from.
   *
   * The lines land as **ordinary text elements**, so the teacher can move
   * them, restyle them and undo them like any other text.
   *
   * The read walks the **ladder** (D-137): the engine the teacher picked goes
   * first when they picked one, and the machine's own order is the rest of it.
   */
  const read = useCallback(
    async ({
      image,
      region,
      panelId,
      placement,
      pageId,
      strokeColor = "#000000",
      engine,
    }: {
      /** the picture to read */
      image: OcrImage;
      /** the part of the picture to read, in the picture's own pixels */
      region?: OcrRegion;
      /**
       * The panel the picture belongs to (D-137).
       *
       * The read of a panel takes the **crop** the teacher took for it, so
       * the crop and the read are one action and not two.
       */
      panelId?: string;
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
      cancelledRef.current = false;

      /**
       * The region the read takes.
       *
       * The region the caller names wins - it is the crop being read right
       * now - and the panel's own crop is the fallback, so that the panel's
       * read reads the region the teacher cropped (D-137).
       */
      const readRegion =
        region ??
        (panelId ? cropsRef.current[panelId] ?? undefined : undefined);

      /**
       * The rungs, in the order this read walks them.
       *
       * The teacher's own choice goes first when they made one - the ladder
       * is what the machine does when the teacher did not choose (D-118,
       * D-137).
       */
      const ladder = ocrLadderFor({ bridgeConnected });
      const chosen = engine
        ? ladder.filter((step) => step.engine === engine)
        : [];
      const rest = ladder.filter((step) => !engine || step.engine !== engine);

      try {
        const outcome = await walkOcrLadder({
          ladder: [...chosen, ...rest],
          bridgeConnected,
          read: async (step) => {
            if (step.route === "browser") {
              // no engine runs in the browser (D-59): the rung says so rather
              // than pretending it read something
              throw new Error(BROWSER_ENGINE_REASON);
            }

            return requestOcr({
              imageBase64: dataUrlToBase64(image.dataURL),
              ...(readRegion ? { region: readRegion } : {}),
              engine: step.engine,
            });
          },
        });

        // a cancelled read is dropped: its answer belongs to a read the
        // teacher stopped watching for (D-138)
        if (cancelledRef.current) {
          return null;
        }

        const result = outcome.result;

        if (!result) {
          // nothing could read it, and every reason is said (D-75, D-125)
          setReadMessage(ocrLadderMessage({ skipped: outcome.skipped }));

          return null;
        }

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
          ocrLadderMessage({
            lines: elements.length,
            ...(outcome.engine === undefined ? {} : { engine: outcome.engine }),
            ...(result.durationMs === undefined
              ? {}
              : { durationMs: result.durationMs }),
            skipped: outcome.skipped,
          }),
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
    [api, bridgeConnected, requestOcr],
  );

  /**
   * Stops the read that is running (D-138).
   *
   * The panel is usable again at once, and the answer of a read that is
   * cancelled is dropped: a text that lands after the teacher moved on is
   * worse than no text at all.
   */
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setBusy(false);
    setReadMessage(t("labels.ocrLadder.cancelled"));
  }, []);

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
    /** stops the read that is running (D-138) */
    cancel,
    /** remembers the crop of a panel (D-137) */
    rememberCrop,
    /** the crop of a panel, when it has one (D-137) */
    cropFor,
    /** the engines the picker offers, with their measured speed (D-118) */
    engines: OCR_ENGINE_CHOICES,
    /** the engine chosen for a panel */
    engineFor,
    /** the engine the teacher chose for a panel, when they chose one */
    pickedEngineFor,
    /** the teacher chose an engine for a panel */
    selectEngine,
  };
};
