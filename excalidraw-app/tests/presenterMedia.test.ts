/**
 * The presenter and the **media store** (D-96).
 *
 * The presenter is a **second window of the same origin**, so it has the same
 * IndexedDB as the editor: a media-backed panel is resolved **here**, from the
 * same store, and its bytes never travel the channel at all. The presenter's
 * own 32 MB guard stays exactly where it is — it is the guard of the legacy
 * file path, and it keeps doing its job there.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createElement } from "react";

import { act, render, waitFor } from "@excalidraw/excalidraw/tests/test-utils";

import {
  ExcalidrawAPIProvider,
  videoPanelContent,
} from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { ExcalidrawPanelElement, FileId } from "@excalidraw/element/types";

import type { BinaryFileData } from "@excalidraw/excalidraw/types";

import { MEDIA_STORE_MAX_BYTES, storeMedia } from "../data/mediaStore";
import { PresenterView } from "../presenter/PresenterView";
import {
  PRESENTER_FILE_MAX_BYTES,
  isPresenterFileWithinLimit,
  presenterFileTooLargeMessage,
} from "../presenter/presenterChannel";

/**
 * The store, in memory.
 *
 * The browser's own store cannot be used here: jsdom has no IndexedDB, and
 * `fake-indexeddb` (which the test setup installs) clones with Node's
 * `structuredClone`, which refuses a jsdom `Blob` with a `DataCloneError`. A
 * real browser stores a Blob **by reference** and never reads it into the
 * heap — which is the whole point of this wave — so the store is stood in for
 * here.
 */
const mediaStore = vi.hoisted(() => new Map<string, unknown>());

vi.mock("idb-keyval", () => ({
  createStore: () => ({}),
  get: async (key: string) => mediaStore.get(key),
  set: async (key: string, value: unknown) => {
    mediaStore.set(key, value);
  },
  del: async (key: string) => {
    mediaStore.delete(key);
  },
}));

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

/** a panel whose content is in the **media store**, not in the document */
const mediaPanel = (mediaId: string) =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "video",
    panel: videoPanelContent({
      source: { type: "media", mediaId, mimeType: "video/mp4" },
      tracks: [],
      language: "en",
      naturalWidth: 1920,
      naturalHeight: 1080,
    }),
    posterMode: false,
    posterFileId: null,
  } as never) as unknown as ExcalidrawPanelElement;

/**
 * A file that is **over** the presenter's own guard.
 *
 * The guard measures the data URL's length, and a data URL is ASCII — so a
 * string of that length is a file of that size.
 */
const overSizeFile = (): BinaryFileData => ({
  id: "video-file-2" as FileId,
  mimeType: "video/mp4",
  dataURL: "x".repeat(
    PRESENTER_FILE_MAX_BYTES + 1,
  ) as BinaryFileData["dataURL"],
  created: 1,
  lastRetrieved: 1,
  version: 1,
});

const camera = {
  scrollX: 0,
  scrollY: 0,
  zoomValue: 1,
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
} as const;

const createObjectURL = vi.fn(() => "blob:mock/media-1");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  mediaStore.clear();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

  // jsdom has no object URLs, and the store's resolver makes one per media
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

describe("the presenter and the media store", () => {
  it("AC-134 the presenter resolves a media-backed video from the store without a files message", async () => {
    // the bytes are in the origin's own store, under a short id — the very
    // id the panel will name
    const mediaId = await storeMedia(
      new File(["video-bytes"], "lesson.mkv", { type: "video/mp4" }),
    );

    await render(
      createElement(ExcalidrawAPIProvider, null, createElement(PresenterView)),
    );

    const presenterChannel = FakeBroadcastChannel.instances[0];

    expect(presenterChannel).toBeDefined();

    await act(async () => {
      presenterChannel.receive({
        type: "presenter:scene",
        scene: { elements: [mediaPanel(mediaId)], camera },
      });
    });

    // jsdom has no layout, so the presenter's own viewport is 0×0 and the
    // overlay is mounted on the next render
    API.setAppState({ width: 1000, height: 1000 });

    // The presenter does NOT ask for the bytes: it has them (D-96). A
    // files-request here would be the 620 MB video travelling the channel all
    // over again.
    expect(
      presenterChannel.posted.filter(
        (message) =>
          (message as { type?: string }).type === "presenter:files-request",
      ),
    ).toHaveLength(0);

    // and no file was sent either
    expect(
      presenterChannel.posted.filter(
        (message) => (message as { type?: string }).type === "presenter:files",
      ),
    ).toHaveLength(0);

    // the presenter resolved the media ITSELF, from the same origin's store
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    // and the video is on the screen, playing from its own object URL
    await waitFor(() => {
      const video = document.querySelector(
        '[data-testid="panel-video"]',
      ) as HTMLVideoElement | null;

      expect(video).not.toBeNull();
      expect(video!.getAttribute("src")).toBe("blob:mock/media-1");
    });
  });

  it("AC-134 the presenter's legacy file guard still refuses a file over 32 MB", async () => {
    // the two guards are the SAME number, seen from two sides (D-94, D-96)
    expect(MEDIA_STORE_MAX_BYTES).toBe(PRESENTER_FILE_MAX_BYTES);
    expect(MEDIA_STORE_MAX_BYTES).toBe(32 * 1024 * 1024);

    // and the presenter's own guard still refuses a big file on the legacy
    // path: the change is that a big video no longer USES that path
    const file = overSizeFile();

    expect(isPresenterFileWithinLimit(file)).toBe(false);
    expect(presenterFileTooLargeMessage(file)).toContain("32 MB");
  });
});
