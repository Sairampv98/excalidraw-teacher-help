/**
 * The app's side of the **placement flow** (D-140).
 *
 * The owner wrote the three flows out, and this file walks them in the
 * owner's order: the crop comes first, the target is chosen **after** it, the
 * flow that writes **text** asks where the **text** goes, the third flow goes
 * through the **page selector ribbon**, and a finished placement gives the
 * canvas back.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { renderHook } from "@testing-library/react";

import {
  clearAllPendingScreenshots,
  Excalidraw,
  getPendingScreenshot,
  setPendingScreenshot,
} from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawPanelElement, FileId } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { PanelScreenshotChoice } from "@excalidraw/excalidraw";

import { useScreenshot } from "../bridge/useScreenshot";

/** a live video panel, so the screenshot has a panel to belong to */
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

/** the picture the capture took */
const picture = (panelId: string) => ({
  panelId,
  source: "editor" as const,
  dataURL: "data:image/jpeg;base64,QUJD",
  width: 1295,
  height: 687,
  x: 100,
  y: 200,
  canvasWidth: 460,
  canvasHeight: 244,
});

/** what the OCR read is given (D-140) */
type ReadArgs = {
  image: { dataURL: string; width: number; height: number };
  placement: { x: number; y: number; width: number; height: number };
  pageId: string;
  region?: { x: number; y: number; width: number; height: number };
  place?: boolean;
};

const renderEditor = async (
  readOcr = vi.fn(async (_args: ReadArgs) => ({ lines: [] })),
) => {
  let api: ExcalidrawImperativeAPI | null = null;

  /** the library's own controls, wired to the app's hook */
  const bridge: {
    choose?: (panelId: string, choice: PanelScreenshotChoice) => Promise<void>;
    choosePage?: (panelId: string, pageId: string | null) => void;
    place?: (panelId: string, at: { x: number; y: number }) => void;
  } = {};

  await render(
    <Excalidraw
      panelScreenshot={{
        onCapture: () => {},
        onChoice: (panelId: string, choice: PanelScreenshotChoice) => {
          void bridge.choose?.(panelId, choice);
        },
        onPageChoice: (panelId: string, pageId: string | null) => {
          bridge.choosePage?.(panelId, pageId);
        },
        onPlace: (panelId: string, at: { x: number; y: number }) => {
          bridge.place?.(panelId, at);
        },
      }}
      onExcalidrawAPI={(next) => {
        api = next;
      }}
    />,
  );

  await waitFor(() => expect(api).toBeTruthy());

  const { result } = renderHook(() => useScreenshot({ api, readOcr }));

  bridge.choose = result.current.choose;
  bridge.choosePage = result.current.choosePage;
  bridge.place = result.current.place;

  return { api: api!, result, bridge, readOcr };
};

/** the wireframe, when it is there */
const wireframe = () =>
  document.querySelector(
    '[data-testid="panel-screenshot-wireframe"]',
  ) as HTMLElement | null;

afterEach(() => {
  act(() => {
    clearAllPendingScreenshots();
  });
});

describe("the placement flow", () => {
  it("AC-178 the wireframe waits for the choice", async () => {
    // The owner's first flow: "(crop image) -> insert image in this page ->
    // (crop image) -> select where the screenshot goes to". The target is
    // chosen **after** the choice, so the wireframe is not there before it.
    const { api, result, bridge } = await renderEditor();

    const element = panel();

    API.setElements([element as unknown as ExcalidrawPanelElement]);

    act(() => {
      setPendingScreenshot(picture(element.id));
    });

    // the picture is in front - the crop is the first step
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-screenshot-focus"]'),
      ).not.toBeNull(),
    );

    // and the target is not being asked for yet
    expect(wireframe()).toBeNull();

    // the teacher presses the first choice
    await act(async () => {
      await result.current.choose(element.id, "page");
    });

    // now it is
    await waitFor(() => expect(wireframe()).not.toBeNull());

    // and the teacher says where it goes
    await act(async () => {
      bridge.place?.(element.id, { x: 100, y: 200 });
    });

    const image = api
      .getSceneElements()
      .find((element) => element.type === "image");

    expect(image).toBeTruthy();
    expect(image!.x).toBe(100);
    expect(image!.y).toBe(200);
  });

  it("AC-178 the flow that reads the text asks where the text goes", async () => {
    // The owner's second flow: "(crop image) -> read text in this cropped
    // region -> select where the extracted text goes to".
    const readOcr = vi.fn(async (_args: ReadArgs) => ({
      lines: [{ text: "hello", x: 0, y: 0, width: 100, height: 20 }],
    }));

    const { api, result } = await renderEditor(readOcr);

    const element = panel();

    API.setElements([element as unknown as ExcalidrawPanelElement]);

    act(() => {
      setPendingScreenshot(picture(element.id));
    });

    await act(async () => {
      await result.current.choose(element.id, "ocr");
    });

    // the read happened on the **cropped region**, and it did **not** put the
    // text on the canvas: the teacher has not said where yet
    expect(readOcr).toHaveBeenCalledTimes(1);

    const read = readOcr.mock.calls[0]?.[0];

    expect(read?.place).toBe(false);
    expect(read?.region).toEqual({
      x: 0,
      y: 0,
      width: 1295,
      height: 687,
    });
    expect(
      api.getSceneElements().filter((element) => element.type === "text"),
    ).toHaveLength(0);

    // the wireframe asks where the **text** goes - not where the picture would
    await waitFor(() => expect(wireframe()).not.toBeNull());
    expect(wireframe()!.textContent).toBe("The text goes here");

    // and the text lands where the teacher said
    await act(async () => {
      result.current.place(element.id, { x: 300, y: 400 });
    });

    const texts = api
      .getSceneElements()
      .filter((element) => element.type === "text");

    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("hello");
    expect(texts[0].x).toBe(300);
    expect(texts[0].y).toBe(400);

    // and no picture was placed: the flow was about the text
    expect(
      api.getSceneElements().filter((element) => element.type === "image"),
    ).toHaveLength(0);
  });

  it("AC-178 the third flow goes through the page selector ribbon", async () => {
    // The owner's third flow: "(crop image) -> insert image in another page ->
    // select the page (through the page selecter ribbon) -> (crop image) ->
    // select where the screenshot goes to".
    const { api, result } = await renderEditor();

    const element = panel();

    API.setElements([element as unknown as ExcalidrawPanelElement]);

    // the document has a second page
    act(() => {
      api.updateScene({
        appState: {
          pages: [
            { id: "page-1", name: "Page 1" },
            { id: "page-2", name: "Page 2" },
          ],
        },
      });
    });

    act(() => {
      setPendingScreenshot(picture(element.id));
    });

    await act(async () => {
      await result.current.choose(element.id, "new-page");
    });

    // the ribbon is up: the page comes before the target
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-screenshot-pages"]'),
      ).not.toBeNull(),
    );
    expect(wireframe()).toBeNull();

    // the teacher picks the page
    await act(async () => {
      result.current.choosePage(element.id, "page-2");
    });

    // and only then the target is asked for
    await waitFor(() => expect(wireframe()).not.toBeNull());

    await act(async () => {
      result.current.place(element.id, { x: 100, y: 200 });
    });

    const image = api
      .getSceneElements()
      .find((element) => element.type === "image");

    expect(image).toBeTruthy();
    // the picture is on the page the ribbon named
    expect(image!.pageId).toBe("page-2");
  });

  it("AC-178 a finished placement closes the popup and hands the canvas back", async () => {
    // "the popup vanishes and we return back to the canvas".
    const { api, result } = await renderEditor();

    const element = panel();

    API.setElements([element as unknown as ExcalidrawPanelElement]);

    act(() => {
      setPendingScreenshot(picture(element.id));
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-screenshot-focus"]'),
      ).not.toBeNull(),
    );

    await act(async () => {
      await result.current.choose(element.id, "page");
    });

    // the popup is **still** up: the target is chosen after the choice, and
    // the picture lands only when the teacher says where (D-140)
    expect(
      document.querySelector('[data-testid="panel-screenshot-focus"]'),
    ).not.toBeNull();
    expect(
      api.getSceneElements().filter((element) => element.type === "image"),
    ).toHaveLength(0);

    await waitFor(() => expect(wireframe()).not.toBeNull());

    await act(async () => {
      result.current.place(element.id, { x: 100, y: 200 });
    });

    // the popup is gone: the picture in front and the dimming with it
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="panel-screenshot-focus"]'),
      ).toBeNull(),
    );
    expect(
      document.querySelector('[data-testid="panel-screenshot-focus-scrim"]'),
    ).toBeNull();

    // and the wireframe with it
    expect(wireframe()).toBeNull();

    // the picture is not pending any more
    expect(getPendingScreenshot(element.id)).toBeNull();

    // and the canvas is the teacher's again
    expect(
      api.getSceneElements().filter((element) => element.type === "image"),
    ).toHaveLength(1);
  });
});
