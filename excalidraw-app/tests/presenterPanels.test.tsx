/**
 * The presenter shows the panels — the owner's item 10, part 1.
 *
 * AC-70: the presenter renders the SAME panel overlay the editor does, from the
 *        same element list.
 * AC-71: a playback position of t = 5 reaches the presenter, and the presenter
 *        does NOT write playback back.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import React from "react";

import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import {
  Excalidraw,
  ExcalidrawAPIProvider,
  readPanelPlayback,
  videoPanelContent,
} from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { ExcalidrawPanelElement, FileId } from "@excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import { PresenterView } from "../presenter/PresenterView";

import type { PresenterCamera } from "../presenter/presenterChannel";

const VIDEO_FILE_ID = "video-file-1" as FileId;

const INTRINSIC_WIDTH = 1920;
const INTRINSIC_HEIGHT = 1080;

const DISPLAY_WIDTH = 400;
const DISPLAY_HEIGHT = 300;

/**
 * A stand-in for the browser's `BroadcastChannel`.
 *
 * The test plays the **editor's** side: it hands the messages to the
 * presenter, and it keeps what the presenter posted.
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  onmessage: ((event: { data: unknown }) => void) | null = null;

  posted: unknown[] = [];

  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    this.posted.push(data);
  }

  close() {}

  /** the editor sends a message */
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

const videoFile = (): BinaryFileData => ({
  id: VIDEO_FILE_ID,
  mimeType: "video/mp4",
  dataURL: "data:video/mp4;base64,AAAA" as BinaryFileData["dataURL"],
  created: 1,
  lastRetrieved: 1,
  version: 1,
});

/** a video panel, with the playback position the editor published */
const videoPanel = (playback?: { time: number; playing: boolean }) => {
  const panel = API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    panelKind: "video",
    panel: videoPanelContent({
      source: { type: "file", fileId: VIDEO_FILE_ID, mimeType: "video/mp4" },
      tracks: [],
      language: "en",
      naturalWidth: INTRINSIC_WIDTH,
      naturalHeight: INTRINSIC_HEIGHT,
    }),
    posterMode: false,
    posterFileId: null,
  } as never) as unknown as ExcalidrawPanelElement;

  // the playback rides on the element, beside the payload — the same way the
  // caption binding does
  return playback ? ({ ...panel, playback } as ExcalidrawPanelElement) : panel;
};

const camera = (): PresenterCamera => ({
  scrollX: 0,
  scrollY: 0,
  zoomValue: 1 as PresenterCamera["zoomValue"],
  viewBackgroundColor: "#ffffff",
  gridModeEnabled: false,
  gridSize: 20,
  pagesEnabled: false,
  pages: [],
  currentPageId: "page-1",
  pageOffsetX: 0,
  pageOffsetY: 0,
  editorWidth: 1200,
  editorHeight: 800,
});

/** the element of the scene with that id */
const elementById = (id: string) =>
  window.h?.elements.find((element) => element.id === id) as
    | ExcalidrawPanelElement
    | undefined;

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the presenter shows the panels", () => {
  it("AC-70 the presenter renders the same panel overlay the editor does, from the same element list", async () => {
    const panel = videoPanel();

    await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    // the editor sends the scene — the whole element list, exactly as it does
    // to the projector today
    const channel = FakeBroadcastChannel.instances[0];

    expect(channel).toBeDefined();

    await act(async () => {
      channel.receive({
        type: "presenter:scene",
        scene: { elements: [panel], camera: camera() },
      });

      // and the video's bytes, on the very same path an image takes
      channel.receive({
        type: "presenter:files",
        presenterId: "presenter-1",
        files: [videoFile()],
      });
    });

    // jsdom has no layout, so the presenter's own viewport is 0×0 and the
    // overlay is mounted on the next render
    API.setAppState({ width: 1000, height: 1000 });

    // the very same overlay the editor shows: the panel is in the page, with
    // its own surface, and it is the panel the editor sent
    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="panel-overlay"]'),
      ).not.toBeNull();
    });

    const rendered = document.querySelector(
      '[data-testid="panel"]',
    ) as HTMLElement | null;

    expect(rendered).not.toBeNull();
    expect(rendered!.dataset.panelId).toBe(panel.id);
    expect(rendered!.dataset.panelKind).toBe("video");

    // and the surface is the video's own — the panel's content, not a picture
    // of it
    expect(
      document.querySelector('[data-testid="panel-video"]'),
    ).not.toBeNull();
  });

  it("AC-71 the playback position reaches the presenter, and the presenter does not write playback back", async () => {
    // -------------------------------------------------------------------------
    // the editor publishes the position onto the element
    // -------------------------------------------------------------------------
    const editorPanel = videoPanel();

    const editor = await render(
      <Excalidraw
        initialData={{
          elements: [editorPanel] as never,
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    // jsdom has no layout, so the editor's own viewport is 0×0 and the overlay
    // is mounted on the next render
    API.setAppState({ width: 1000, height: 1000 });

    const editorVideo = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement | null;

    expect(editorVideo).not.toBeNull();

    // the browser owns the position of the video; the test plays it at 5 s
    Object.defineProperty(editorVideo!, "currentTime", {
      value: 5,
      writable: true,
      configurable: true,
    });

    await act(async () => {
      fireEvent.timeUpdate(editorVideo!);
    });

    // the position rides on the element, so it travels with the scene — there
    // is no second transport for it
    expect(readPanelPlayback(elementById(editorPanel.id)!)).toEqual({
      time: 5,
      playing: false,
    });

    // -------------------------------------------------------------------------
    // the presenter applies it — and writes nothing back
    // -------------------------------------------------------------------------
    // the editor's window is gone: the presenter is a window of its own
    editor.unmount();

    const presenterPanel = videoPanel({ time: 5, playing: false });

    await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    const channel = FakeBroadcastChannel.instances[0];

    await act(async () => {
      channel.receive({
        type: "presenter:scene",
        scene: { elements: [presenterPanel], camera: camera() },
      });

      // and the video's bytes, on the very same path an image takes
      channel.receive({
        type: "presenter:files",
        presenterId: "presenter-1",
        files: [videoFile()],
      });
    });

    API.setAppState({ width: 1000, height: 1000 });

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="panel-video"]'),
      ).not.toBeNull();
    });

    const presenterVideo = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement;

    // the presenter shows the video at the position the editor published
    await waitFor(() => {
      expect(presenterVideo.currentTime).toBe(5);
    });

    // now the presenter drifts — the window is a second instance, and the
    // video can be out of step for a moment
    presenterVideo.currentTime = 7;

    await act(async () => {
      fireEvent.timeUpdate(presenterVideo);
    });

    // and the presenter does NOT write the position back: the editor owns it,
    // and two windows writing to each other would fight over the same video
    expect(readPanelPlayback(elementById(presenterPanel.id)!)).toEqual({
      time: 5,
      playing: false,
    });
  });
});
