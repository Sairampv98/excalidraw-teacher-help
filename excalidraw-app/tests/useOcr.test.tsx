/**
 * The app's side of the **OCR capability** for a screenshot and for an
 * ordinary image (D-105).
 *
 * One OCR, not two: the screenshot's read is the project's existing OCR path —
 * the same request the bridge's engine answers — and an ordinary image element
 * is offered the same choice, because a screenshot the teacher pasted in by
 * hand is an ordinary image.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi } from "vitest";

import React from "react";

import { renderHook } from "@testing-library/react";

import {
  clearAllPendingScreenshots,
  Excalidraw,
  setPendingScreenshot,
} from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  act,
  fireEvent,
  GlobalTestState,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useOcr } from "../bridge/useOcr";
import { useScreenshot } from "../bridge/useScreenshot";

import ExcalidrawApp from "../App";

/** the context menu's entry for the read of an ordinary image */
const OCR_IMAGE_ENTRY = 'li[data-testid="ocrImage"]';

const renderEditor = async () => {
  let api: ExcalidrawImperativeAPI | null = null;

  await render(
    <Excalidraw
      onExcalidrawAPI={(next) => {
        api = next;
      }}
    />,
  );

  await waitFor(() => expect(api).toBeTruthy());

  return api!;
};

describe("reading the text out of a picture", () => {
  it("AC-142 the screenshot's OCR goes through the existing OCR request", async () => {
    // the bridge's own OCR request: the engine lives in the bridge's Node
    // process and never in the browser (D-59)
    const requestOcr = vi.fn(async (request: { imageBase64: string }) => {
      expect(request.imageBase64).toBeTruthy();

      return {
        id: "ocr-1",
        text: "hello",
        lines: [{ text: "hello", x: 0, y: 0, width: 40, height: 12 }],
      };
    });

    const api = await renderEditor();

    // the app's existing OCR path ...
    const { result: ocr } = renderHook(() => useOcr({ api, requestOcr }));

    // ... and the screenshot's choice, which uses it
    const { result: screenshot } = renderHook(() =>
      useScreenshot({ api, readOcr: ocr.current.read }),
    );

    act(() => {
      setPendingScreenshot({
        panelId: "panel-1",
        source: "editor",
        dataURL: "data:image/jpeg;base64,QUJD",
        width: 1295,
        height: 687,
        x: 100,
        y: 200,
        canvasWidth: 460,
        canvasHeight: 244,
      });
    });

    await act(async () => {
      await screenshot.current.choose("panel-1", "ocr");
    });

    // the read went through the EXISTING request, carrying the screenshot's
    // own bytes (D-105)
    expect(requestOcr).toHaveBeenCalledTimes(1);
    expect(requestOcr.mock.calls[0][0].imageBase64).toBe("QUJD");

    // and the result landed as ordinary text elements over the picture
    const texts = api
      .getSceneElements()
      .filter((element) => element.type === "text");

    expect(texts.length).toBe(1);
    expect(texts[0].text).toBe("hello");

    clearAllPendingScreenshots();
  });

  it("AC-142 an ordinary image element offers the same OCR choice", async () => {
    await render(<ExcalidrawApp />);

    // an ordinary image on the canvas — a screenshot the teacher pasted in by
    // hand
    const image = API.createElement({
      type: "image",
      x: 0,
      y: 0,
      width: 200,
      height: 150,
      fileId: "file-1",
    });

    API.setElements([image]);
    API.setSelectedElements([image]);

    await waitFor(() => expect(API.getSelectedElements().length).toBe(1));

    fireEvent.contextMenu(GlobalTestState.interactiveCanvas, {
      button: 2,
      clientX: 10,
      clientY: 10,
    });

    const menu = UI.queryContextMenu();

    expect(menu).not.toBeNull();

    // the choice is there: the same read, for an ordinary image (D-105)
    const entry = menu!.querySelector(OCR_IMAGE_ENTRY);

    expect(entry).not.toBeNull();
    expect(entry!.textContent).toBe("Read the text");
  });
});
