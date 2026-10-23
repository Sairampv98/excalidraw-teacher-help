/**
 * The app's side of the **screenshot**: the wireframe that stands where the
 * picture will land, and the new page the picture can land on (D-104).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { renderHook } from "@testing-library/react";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import {
  clearAllPendingScreenshots,
  Excalidraw,
  setPendingScreenshot,
} from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawPanelElement, FileId } from "@excalidraw/element/types";
import type {
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";

import { useScreenshot } from "../bridge/useScreenshot";

/** a live video panel, so the wireframe has a panel to belong to */
const panel = (): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    panelKind: "video",
    panel: {
      source: {
        type: "file",
        fileId: "file-1" as FileId,
        mimeType: "video/mp4",
      },
      options: {
        naturalWidth: 1920,
        naturalHeight: 1080,
        captions: null,
      },
    },
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;

const camera = {
  zoom: { value: 1 as NormalizedZoomValue },
  scrollX: 0,
  scrollY: 0,
  offsetLeft: 0,
  offsetTop: 0,
};

const renderEditor = async () => {
  let api: ExcalidrawImperativeAPI | null = null;

  await render(
    <Excalidraw
      panelScreenshot={{
        onCapture: () => {},
        onChoice: () => {},
        onPlace: () => {},
      }}
      onExcalidrawAPI={(next) => {
        api = next;
      }}
    />,
  );

  await waitFor(() => expect(api).toBeTruthy());

  return api!;
};

afterEach(() => {
  act(() => {
    clearAllPendingScreenshots();
  });
});

describe("placing a screenshot", () => {
  it("AC-141 a wireframe stands where the screenshot will land", async () => {
    const element = panel();

    await renderEditor();

    API.setElements([element]);

    // the capture happened: the picture is waiting to be placed
    act(() => {
      setPendingScreenshot({
        panelId: element.id,
        source: "video",
        dataURL: "data:image/png;base64,AAAA",
        width: 1920,
        height: 1080,
        x: 100,
        y: 200,
        canvasWidth: 460,
        canvasHeight: 259,
      });
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-screenshot-wireframe"]'),
      ).not.toBeNull(),
    );

    const wireframe = document.querySelector(
      '[data-testid="panel-screenshot-wireframe"]',
    ) as HTMLElement;

    // the wireframe stands where the picture will land: the position comes
    // from the library's own conversion, the oracle (D-34)
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: 100, sceneY: 200 },
      camera,
    );

    expect(wireframe.style.left).toBe(`${x}px`);
    expect(wireframe.style.top).toBe(`${y}px`);

    // and it is the picture's own size on the canvas
    expect(wireframe.style.width).toBe("460px");
    expect(wireframe.style.height).toBe("259px");
  });

  it("AC-141 the new-page choice creates the page and puts the picture on it", async () => {
    const api = await renderEditor();

    const { result } = renderHook(() =>
      useScreenshot({ api, readOcr: vi.fn() }),
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
      await result.current.choose("panel-1", "new-page");
    });

    const appState = api.getAppState();

    // the page was created, and it is the page the teacher is on now
    expect(appState.pages.length).toBe(2);
    expect(appState.currentPageId).not.toBe(appState.pages[0].id);

    // and the picture is on it: an ordinary image element
    const image = api
      .getSceneElements()
      .find((element) => element.type === "image");

    expect(image).toBeTruthy();
    expect(image!.pageId).toBe(appState.currentPageId);

    // the bytes are in the document's own file store
    const files = api.getFiles();

    expect(
      Object.values(files).some((file) => file.dataURL.includes("QUJD")),
    ).toBe(true);
  });
});
