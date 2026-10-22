/**
 * The presenter's **files path**: the bytes of a video panel travel the
 * existing `presenter:files` message — the very same path an image takes —
 * and a file that is too big is refused with a clear error.
 *
 * AC-72: a VIDEO binary file travels the presenter:files path, and a file over
 *        the size guard is refused with a clear error.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import React from "react";

import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";

import {
  Excalidraw,
  ExcalidrawAPIProvider,
  videoPanelContent,
} from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { ExcalidrawPanelElement, FileId } from "@excalidraw/element/types";

import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import { PresenterView } from "../presenter/PresenterView";
import { usePresenterBroadcaster } from "../presenter/usePresenterBroadcaster";
import {
  PRESENTER_FILE_MAX_BYTES,
  presenterFileTooLargeMessage,
} from "../presenter/presenterChannel";

const VIDEO_FILE_ID = "video-file-1" as FileId;

const OVER_SIZE_FILE_ID = "video-file-2" as FileId;

/**
 * A stand-in for the browser's `BroadcastChannel`.
 *
 * The test plays both sides: the editor's channel and the presenter's channel
 * are two instances, and the test hands the messages from one to the other.
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

  /** the other side sends a message */
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

const videoFile = (id: FileId = VIDEO_FILE_ID): BinaryFileData => ({
  id,
  mimeType: "video/mp4",
  dataURL: "data:video/mp4;base64,AAAA" as BinaryFileData["dataURL"],
  created: 1,
  lastRetrieved: 1,
  version: 1,
});

/**
 * A file that is **over the size guard**.
 *
 * The guard measures the data URL's length, and a data URL is ASCII — so a
 * string of that length is a file of that size. The string is built here and
 * not kept: the test only needs the length.
 */
const overSizeFile = (id: FileId = OVER_SIZE_FILE_ID): BinaryFileData => ({
  ...videoFile(id),
  dataURL: "x".repeat(
    PRESENTER_FILE_MAX_BYTES + 1,
  ) as BinaryFileData["dataURL"],
});

const videoPanel = (fileId: FileId = VIDEO_FILE_ID) =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "video",
    panel: videoPanelContent({
      source: { type: "file", fileId, mimeType: "video/mp4" },
      tracks: [],
      language: "en",
      naturalWidth: 1920,
      naturalHeight: 1080,
    }),
    posterMode: false,
    posterFileId: null,
  } as never) as unknown as ExcalidrawPanelElement;

/** the editor's side: the app publishes the scene into the presenter */
const Broadcaster = () => {
  usePresenterBroadcaster(true);

  return null;
};

const camera = {
  scrollX: 0,
  scrollY: 0,
  zoomValue: 1,
  viewBackgroundColor: "#ffffff",
  gridModeEnabled: false,
  gridSize: null,
  pagesEnabled: false,
  pages: null,
  currentPageId: "page-1",
  pageOffsetX: 0,
  pageOffsetY: 0,
  editorWidth: 1200,
  editorHeight: 800,
} as const;

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the presenter's files path", () => {
  it("AC-72 a VIDEO binary file travels the presenter:files path, and a file over the size guard is refused with a clear error", async () => {
    const panel = videoPanel();

    // -------------------------------------------------------------------------
    // the editor: the video's bytes travel the files path, on request
    // -------------------------------------------------------------------------
    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as never,
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      >
        <Broadcaster />
      </Excalidraw>,
    );

    const editorChannel = FakeBroadcastChannel.instances[0];

    expect(editorChannel).toBeDefined();

    await act(async () => {
      editorChannel.receive({
        type: "presenter:files-request",
        presenterId: "presenter-1",
        fileIds: [VIDEO_FILE_ID],
      });
    });

    const sent = editorChannel.posted.filter(
      (message) => (message as { type?: string }).type === "presenter:files",
    ) as { type: string; files: BinaryFileData[] }[];

    expect(sent).toHaveLength(1);
    expect(sent[0].files.map((file) => file.id)).toEqual([VIDEO_FILE_ID]);

    // and the file that travels is the **video** — a video's media type is
    // what tells the presenter's surface that it is a video (D-58)
    expect(sent[0].files[0].mimeType).toBe("video/mp4");

    // -------------------------------------------------------------------------
    // the editor: a file over the size guard is refused, with a clear error
    // -------------------------------------------------------------------------
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as never,
          files: { [OVER_SIZE_FILE_ID]: overSizeFile() },
        }}
      >
        <Broadcaster />
      </Excalidraw>,
    );

    const secondEditorChannel = FakeBroadcastChannel.instances[1];

    await act(async () => {
      secondEditorChannel.receive({
        type: "presenter:files-request",
        presenterId: "presenter-1",
        fileIds: [OVER_SIZE_FILE_ID],
      });
    });

    // nothing was sent ...
    expect(
      secondEditorChannel.posted.filter(
        (message) => (message as { type?: string }).type === "presenter:files",
      ),
    ).toHaveLength(0);

    // ... and the reason was said out loud
    expect(errors).toHaveBeenCalled();
    expect(String(errors.mock.calls[0][0])).toContain(
      presenterFileTooLargeMessage(overSizeFile()),
    );

    errors.mockRestore();

    // -------------------------------------------------------------------------
    // the presenter: a file over the size guard is refused there too
    // -------------------------------------------------------------------------
    const presenterErrors = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    const presenterChannel = FakeBroadcastChannel.instances[2];

    await act(async () => {
      presenterChannel.receive({
        type: "presenter:scene",
        scene: { elements: [panel], camera },
      });

      presenterChannel.receive({
        type: "presenter:files",
        presenterId: "presenter-1",
        files: [overSizeFile()],
      });
    });

    API.setAppState({ width: 1000, height: 1000 });

    // the presenter says why it did not take the file ...
    expect(presenterErrors).toHaveBeenCalled();
    expect(String(presenterErrors.mock.calls[0][0])).toContain(
      presenterFileTooLargeMessage(overSizeFile()),
    );

    presenterErrors.mockRestore();

    // ... and the video never shows up, because the bytes never arrived
    await waitFor(() => {
      expect(document.querySelector('[data-testid="panel-video"]')).toBeNull();
    });
  });
});
