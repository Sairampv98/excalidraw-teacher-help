/**
 * The camera and the read of a YouTube panel (D-352): the player is a foreign
 * document, so its picture is the tab's picture of it.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { renderHook } from "@testing-library/react";

import {
  Excalidraw,
  clearAllPendingScreenshots,
  getPendingScreenshot,
  getYoutubeSurface,
  youtubePanelContent,
} from "@excalidraw/excalidraw";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import ExcalidrawApp from "../App";
import { TabCaptureError, captureYoutubePicture } from "../bridge/tabCapture";
import { useScreenshot } from "../bridge/useScreenshot";

vi.mock("../bridge/tabCapture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bridge/tabCapture")>()),
  captureYoutubePicture: vi.fn(),
}));

const PICTURE = {
  dataURL: "data:image/png;base64,UElDVFVSRQ==",
  width: 640,
  height: 360,
};

const youtubePanel = (): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 100,
    y: 100,
    width: 480,
    height: 270,
    panelKind: "video",
    panel: youtubePanelContent({ videoId: "jNQXAC9IVRw" }),
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;

afterEach(() => {
  act(() => clearAllPendingScreenshots());
  vi.mocked(captureYoutubePicture).mockReset();
  vi.unstubAllGlobals();
});

describe("the camera of a YouTube panel", () => {
  it("AC-413 the iframe of the panel is where the host looks for its picture", async () => {
    const panel = youtubePanel();

    await render(<Excalidraw initialData={{ elements: [panel as never] }} />);
    API.setAppState({ width: 1000, height: 1000 });

    await waitFor(() => expect(getYoutubeSurface(panel.id)).not.toBeNull());

    expect(getYoutubeSurface(panel.id)).toBe(
      document.querySelector('[data-testid="panel-youtube-embed"]'),
    );
  });

  it("AC-413 the camera takes the tab's picture of the player and holds it for the crop window", async () => {
    vi.mocked(captureYoutubePicture).mockResolvedValue(PICTURE);

    const panel = youtubePanel();
    let api: ExcalidrawImperativeAPI | null = null;

    await render(
      <Excalidraw
        initialData={{ elements: [panel as never] }}
        onExcalidrawAPI={(next) => {
          api = next;
        }}
      />,
    );
    API.setAppState({ width: 1000, height: 1000 });

    await waitFor(() => expect(getYoutubeSurface(panel.id)).not.toBeNull());

    const { result } = renderHook(() =>
      useScreenshot({ api, readOcr: vi.fn() }),
    );

    await act(async () => {
      await result.current.capture(panel.id);
    });

    // the picture is cut from the iframe's own rectangle
    expect(captureYoutubePicture).toHaveBeenCalledTimes(1);
    // the picture is of the panel's iframe, in the panel's own shape
    expect(vi.mocked(captureYoutubePicture).mock.calls[0][0]).toBe(
      getYoutubeSurface(panel.id),
    );
    expect(vi.mocked(captureYoutubePicture).mock.calls[0][1]).toBeCloseTo(
      480 / 270,
      5,
    );

    const pending = getPendingScreenshot(panel.id);

    expect(pending?.dataURL).toBe(PICTURE.dataURL);
    expect(pending?.width).toBe(640);
    expect(pending?.source).toBe("video");
  });

  it("AC-413 a tab that was not shared is said, and nothing is held", async () => {
    vi.mocked(captureYoutubePicture).mockRejectedValue(
      new TabCaptureError("not-shared"),
    );

    const panel = youtubePanel();
    let api: ExcalidrawImperativeAPI | null = null;

    await render(
      <Excalidraw
        initialData={{ elements: [panel as never] }}
        onExcalidrawAPI={(next) => {
          api = next;
        }}
      />,
    );
    API.setAppState({ width: 1000, height: 1000 });

    await waitFor(() => expect(getYoutubeSurface(panel.id)).not.toBeNull());

    const { result } = renderHook(() =>
      useScreenshot({ api, readOcr: vi.fn() }),
    );

    await act(async () => {
      await result.current.capture(panel.id);
    });

    expect(getPendingScreenshot(panel.id)).toBeNull();
    expect(api!.getAppState().toast?.message).toContain("share");
  });
});

describe("the read of a YouTube panel", () => {
  it("AC-413 the read asks which part, with the tab's picture of the player in the window", async () => {
    vi.stubGlobal("Worker", class {});
    vi.mocked(captureYoutubePicture).mockResolvedValue(PICTURE);

    await render(<ExcalidrawApp />);

    API.setAppState({ width: 1000, height: 1000 });

    const panel = youtubePanel();

    API.setElements([panel as never]);
    API.setSelectedElements([panel as never]);

    const button = await waitFor(() => {
      const found = document.querySelector('[data-testid="panel-ocr-button"]');

      expect(found).not.toBeNull();

      return found as HTMLElement;
    });

    fireEvent.click(button);

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="ocr-area-picture"]'),
      ).not.toBeNull(),
    );

    expect(captureYoutubePicture).toHaveBeenCalledTimes(1);
    expect(document.body.innerHTML).toContain(
      "data:image/png;base64,UElDVFVSRQ==",
    );
  });
});
