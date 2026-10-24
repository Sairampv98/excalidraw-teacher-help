/**
 * The app's side of the **OCR capability**: the request carries the region the
 * teacher picked, and the answer puts the text back where it was read from.
 *
 * AC-73: the OCR request carries the ROI region, and the result places
 *        PER-LINE text elements over the crop.
 *
 * AC-173: the panel's sentence names the engine the panel will **use** - the
 *         one the teacher picked - and not the extension's own default
 *         (D-134).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi } from "vitest";

import React from "react";

import { act, render, renderHook, waitFor } from "@testing-library/react";

import { Excalidraw } from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { render as renderEditor } from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useOcr, ocrEngineMessage, ocrReadMessage } from "../bridge/useOcr";
import { dataUrlToBase64, ocrTextElements } from "../bridge/ocrPlacement";

import { createOcrClient } from "../../packages/vscode-bridge/bridge/src/ocrClient";

import type {
  OcrEngineState,
  OcrRequest,
  OcrResult,
} from "../../packages/vscode-bridge/bridge/src/ocr";
import type { BridgeMessage } from "../../packages/vscode-bridge/bridge/src/protocol";

/** the picture the teacher wants read */
const IMAGE = {
  dataURL: "data:image/png;base64,SU1BR0U=",
  width: 1920,
  height: 1080,
};

/** the part of the picture the teacher picked — a subtitle band */
const REGION = { x: 0, y: 900, width: 1920, height: 180 };

/** where the picture is drawn on the canvas */
const PLACEMENT = { x: 0, y: 0, width: 960, height: 540 };

/** the lines the bridge read, in the picture's own pixels */
const LINES = [
  { text: "the first line", x: 60, y: 920, width: 400, height: 32 },
  { text: "the second line", x: 60, y: 960, width: 380, height: 32 },
];

/**
 * The app's scene, and the API the hook writes into.
 *
 * The hook needs an API; this one keeps the elements in a variable, so the
 * test can look at what the app put on the canvas.
 *
 * The selection is part of the API too: the panel's chrome is drawn for the
 * **selected** panel, so the sentence under the "Read the text" button belongs
 * to that panel (D-134).
 */
const scene = (selectedElementIds: Record<string, boolean> = {}) => {
  const state: { elements: ExcalidrawElement[] } = { elements: [] };

  const listeners: (() => void)[] = [];

  const api = {
    getSceneElements: () => state.elements,
    updateScene: (data: { elements?: readonly ExcalidrawElement[] }) => {
      if (data.elements) {
        state.elements = [...data.elements];
      }
    },
    getFiles: () => ({}),
    getAppState: () => ({
      currentItemStrokeColor: "#1e1e1e",
      selectedElementIds,
    }),
    // the app hears about the scene and the app state changing (D-134)
    onChange: (callback: () => void) => {
      listeners.push(callback);

      return () => {
        const index = listeners.indexOf(callback);

        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
  } as unknown as ExcalidrawImperativeAPI;

  return { api, state, listeners };
};

describe("the app's OCR", () => {
  it("AC-73 the OCR request carries the ROI region, and the result places PER-LINE text elements over the crop", async () => {
    const { api, state } = scene();

    const requests: Omit<OcrRequest, "id">[] = [];

    // the **real** client, so the message that goes out is the message the
    // bridge receives
    const sent: BridgeMessage[] = [];

    const client = createOcrClient({
      send: (message) => {
        sent.push(message);
        return true;
      },
    });

    const requestOcr = vi.fn(
      async (request: Omit<OcrRequest, "id">): Promise<OcrResult> => {
        requests.push(request);

        const pending = client.recognize(request);

        // the bridge answers
        const id = (sent[sent.length - 1] as { id: string }).id;

        client.settle({
          id,
          text: "the first line\nthe second line",
          lines: LINES,
        });

        return pending;
      },
    );

    let read:
      | ((args: {
          image: typeof IMAGE;
          region?: typeof REGION;
          placement: typeof PLACEMENT;
          pageId: string;
        }) => Promise<OcrResult | null>)
      | null = null;

    const Harness = () => {
      const ocr = useOcr({ api, requestOcr });

      read = ocr.read;

      return null;
    };

    await render(<Harness />);

    await act(async () => {
      await read!({
        image: IMAGE,
        region: REGION,
        placement: PLACEMENT,
        pageId: "page-1",
      });
    });

    // -------------------------------------------------------------------------
    // the request carries the region
    // -------------------------------------------------------------------------
    expect(requests).toHaveLength(1);
    expect(requests[0].region).toEqual(REGION);

    // and the image travels as base64, without the `data:` prefix: the prefix
    // says what the image is, and the engine already knows
    expect(requests[0].imageBase64).toBe(dataUrlToBase64(IMAGE.dataURL));

    // and the region is in the **message** the bridge receives — not only in
    // the app's own call
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: "ocr:request",
      region: REGION,
      imageBase64: dataUrlToBase64(IMAGE.dataURL),
    });

    // -------------------------------------------------------------------------
    // the answer lands as one text element per line, over the picture
    // -------------------------------------------------------------------------
    await waitFor(() => {
      expect(state.elements).toHaveLength(2);
    });

    const [first, second] = state.elements as unknown as {
      type: string;
      text: string;
      x: number;
      y: number;
    }[];

    // one element per line — not one element for the whole text
    expect(first.type).toBe("text");
    expect(second.type).toBe("text");
    expect(first.text).toBe("the first line");
    expect(second.text).toBe("the second line");

    // and each one sits where its line was read from: the picture is drawn
    // half its own size, so every pixel is half a canvas unit
    expect(first.x).toBeCloseTo(60 * (PLACEMENT.width / IMAGE.width));
    expect(first.y).toBeCloseTo(920 * (PLACEMENT.height / IMAGE.height));
    expect(second.x).toBeCloseTo(60 * (PLACEMENT.width / IMAGE.width));
    expect(second.y).toBeCloseTo(960 * (PLACEMENT.height / IMAGE.height));
  });

  it("AC-173 the OCR sentence names the engine the panel picked, not the extension's default", async () => {
    // the extension's own setting - the fallback for a machine with no picker
    const engineState: OcrEngineState = { state: "ready", engine: "paddle" };

    // the panel the teacher is working on: the chrome is drawn for the
    // selected panel, so the row's sentence belongs to that panel
    const { api, state } = scene({ "panel-1": true });

    state.elements = [
      { id: "panel-1", type: "panel" } as unknown as ExcalidrawElement,
    ];

    const requestOcr = vi.fn(
      async (): Promise<OcrResult> => ({
        id: "ocr-1",
        text: "",
        lines: [],
      }),
    );

    const { result } = renderHook(() =>
      useOcr({ api, requestOcr, engineState }),
    );

    // the panel's own engine - the fastest measured one, until the teacher
    // picks another (D-118) - and NOT the extension's default (D-134)
    expect(result.current.message).toContain("indra");
    expect(result.current.message).not.toContain("paddle");

    // and the picker and the sentence are the same thing: the engine the
    // teacher picks for this panel is the engine the sentence names
    act(() => {
      result.current.selectEngine("panel-1", "tesseract");
    });

    expect(result.current.engineFor("panel-1")).toBe("tesseract");
    expect(result.current.message).toContain("tesseract");
    expect(result.current.message).not.toContain("paddle");
  });

  it("AC-122 the panel says which engine is in use, and says why when there is none", () => {
    // the engine that is in use: the teacher can SEE the choice (D-90)
    expect(ocrEngineMessage({ state: "ready", engine: "indra" })).toContain(
      "indra",
    );

    // and an engine that is not there: the REASON, with the command that
    // installs it - a teacher who cannot read the reason cannot fix it (D-91)
    const missing = ocrEngineMessage({
      state: "unavailable",
      engine: "paddle",
      reason:
        "paddleocr is not installed - pip install paddleocr paddlepaddle. PaddlePaddle has no build for Python 3.14; it needs Python 3.12 or 3.13",
    });

    expect(missing).toContain("pip install paddleocr paddlepaddle");
    expect(missing).toContain("PaddlePaddle has no build for Python 3.14");

    // and the read says which engine ran, and how long it took
    const read = ocrReadMessage({
      lines: 3,
      engine: "indra",
      durationMs: 228,
    });

    expect(read).toContain("3 lines");
    expect(read).toContain("indra");
    expect(read).toContain("228 ms");
  });

  it("AC-73 the placement of a line is the line's own box, scaled to the canvas", () => {
    const elements = ocrTextElements({
      lines: LINES,
      x: 100,
      y: 200,
      width: 960,
      height: 540,
      imageWidth: 1920,
      imageHeight: 1080,
      pageId: "page-1",
    });

    expect(elements).toHaveLength(2);

    // the first line is at (60, 920) in the picture, and the picture is drawn
    // at half its own size, at (100, 200)
    expect(elements[0].x).toBeCloseTo(100 + 60 / 2);
    expect(elements[0].y).toBeCloseTo(200 + 920 / 2);

    // and the font follows the line's own height, so the text covers the line
    expect(elements[0].fontSize).toBeGreaterThan(0);
    expect(elements[0].fontSize).toBeLessThanOrEqual(32 / 2 + 1);
  });
});

/**
 * The **crop and the read are one action**, and the engine is a **ladder**
 * (AC-175, D-137, D-138).
 */
describe("the crop-and-read action, and the engine ladder", () => {
  /** the crop the teacher took for a panel */
  const CROP = { x: 120, y: 640, width: 640, height: 180 };

  it("AC-175 the read takes the cropped region", async () => {
    const { api } = scene();

    const requests: Omit<OcrRequest, "id">[] = [];

    const requestOcr = vi.fn(
      async (request: Omit<OcrRequest, "id">): Promise<OcrResult> => {
        requests.push(request);

        return {
          id: "ocr-1",
          text: "the first line",
          lines: [
            { text: "the first line", x: 120, y: 640, width: 400, height: 32 },
          ],
        };
      },
    );

    const { result } = renderHook(() =>
      useOcr({ api, requestOcr, bridgeConnected: true }),
    );

    // the teacher cropped the panel in the crop dialog
    act(() => {
      result.current.rememberCrop("panel-1", CROP);
    });

    // and the panel's own read takes that crop: one action, not two
    await act(async () => {
      await result.current.read({
        image: IMAGE,
        panelId: "panel-1",
        placement: PLACEMENT,
        pageId: "page-1",
      });
    });

    expect(requests).toHaveLength(1);

    // the request carries the **crop**, and not the whole picture
    expect(requests[0].region).toEqual(CROP);

    // and the panel's crop is the crop the teacher took
    expect(result.current.cropFor("panel-1")).toEqual(CROP);
  });

  it("AC-175 the engine ladder runs indra with the bridge and paddle only as a last resort", async () => {
    const { api } = scene();

    /** the engines the machine asked for, in the order it asked */
    const asked: string[] = [];

    const requestOcr = vi.fn(
      async (request: Omit<OcrRequest, "id">): Promise<OcrResult> => {
        asked.push(request.engine ?? "");

        if (request.engine !== "paddle") {
          throw new Error(`${request.engine} is not available`);
        }

        return {
          id: "ocr-1",
          text: "",
          lines: [],
          engine: "paddle",
          durationMs: 27822,
        };
      },
    );

    const { result } = renderHook(() =>
      useOcr({ api, requestOcr, bridgeConnected: true }),
    );

    await act(async () => {
      await result.current.read({
        image: IMAGE,
        placement: PLACEMENT,
        pageId: "page-1",
      });
    });

    // the ladder: **indra** first with the bridge, then **tesseract**, and
    // **paddle** only as the last resort (D-137)
    expect(asked).toEqual(["indra", "tesseract", "paddle"]);

    // and the teacher is never asked to choose: the machine chose, and the
    // panel says what it chose
    expect(result.current.message).toContain("paddle");
  });

  it("AC-175 the answer says which engine ran and why the one before it did not", async () => {
    const { api } = scene();

    const requestOcr = vi.fn(
      async (request: Omit<OcrRequest, "id">): Promise<OcrResult> => {
        if (request.engine === "indra") {
          throw new Error("indra is not available: pip install indra-ocr");
        }

        return {
          id: "ocr-1",
          text: "the first line",
          lines: [
            { text: "the first line", x: 60, y: 920, width: 400, height: 32 },
          ],
          engine: "tesseract",
          durationMs: 278,
        };
      },
    );

    const { result } = renderHook(() =>
      useOcr({ api, requestOcr, bridgeConnected: true }),
    );

    await act(async () => {
      await result.current.read({
        image: IMAGE,
        placement: PLACEMENT,
        pageId: "page-1",
      });
    });

    // which engine ran ...
    expect(result.current.message).toContain("tesseract");

    // ... how long it took ...
    expect(result.current.message).toContain("278 ms");

    // ... and why the one before it did not (D-75, D-93, D-125): a fall-back
    // that says nothing is a fall-back the teacher cannot trust
    expect(result.current.message).toContain("indra");
    expect(result.current.message).toContain("pip install indra-ocr");
  });

  it("AC-175 a slow read shows the loading state and can be cancelled", async () => {
    const { api, state } = scene();

    /** the bridge's answer, when it comes */
    let settle: (result: OcrResult) => void = () => undefined;

    const requestOcr = vi.fn(
      async (): Promise<OcrResult> =>
        new Promise<OcrResult>((resolve) => {
          settle = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useOcr({ api, requestOcr, bridgeConnected: true }),
    );

    let reading: Promise<OcrResult | null> | null = null;

    act(() => {
      reading = result.current.read({
        image: IMAGE,
        placement: PLACEMENT,
        pageId: "page-1",
      });
    });

    // the read is running, and the panel says so while it takes it (D-138)
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(result.current.message).toContain("Reading");

    // the teacher stops it
    act(() => {
      result.current.cancel();
    });

    // and the panel is usable again at once
    expect(result.current.busy).toBe(false);
    expect(result.current.message).toContain("cancelled");

    // the answer of a cancelled read is dropped: a text that lands after the
    // teacher moved on is worse than no text at all
    await act(async () => {
      settle({
        id: "ocr-1",
        text: "the first line",
        lines: [
          { text: "the first line", x: 60, y: 920, width: 400, height: 32 },
        ],
        engine: "indra",
        durationMs: 147,
      });

      await reading;
    });

    expect(state.elements).toHaveLength(0);
  });

  it("AC-175 the panel's own control shows the loading state and offers the cancel", async () => {
    // a panel on the canvas - the chrome is drawn for the SELECTED panel
    const element = API.createElement({
      type: "panel",
      x: 100,
      y: 100,
      width: 400,
      height: 300,
      panelKind: "image",
      panel: {
        source: { type: "inline", payload: null },
        options: { naturalWidth: 400, naturalHeight: 300, captions: null },
      },
      posterMode: false,
      posterFileId: null,
    }) as unknown as ExcalidrawElement;

    const onCancel = vi.fn();

    const { container } = await renderEditor(
      <Excalidraw
        initialData={{ elements: [element] }}
        panelOcr={{
          message: "Reading the text…",
          busy: true,
          onOcr: () => undefined,
          onCancel,
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setSelectedElements([element]);

    // the control says it is reading ...
    expect(
      container.querySelector('[data-testid="panel-ocr-button"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="panel-ocr-spinner"]'),
    ).not.toBeNull();

    // ... and the cancel is there
    const cancel = container.querySelector(
      '[data-testid="panel-ocr-cancel"]',
    ) as HTMLButtonElement | null;

    expect(cancel).not.toBeNull();

    await act(async () => {
      cancel!.click();
    });

    // and it stops the read
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
