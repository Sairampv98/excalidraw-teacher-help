/**
 * A video that is too big to travel in the document does not travel in the
 * document (D-94).
 *
 * The insert used to read the whole file into memory as a base64 data URL and
 * then read it **again** for a SHA-1, so a 620 MB video became ~2.5 GB of
 * allocation and the insert never survived it. Over the threshold the bytes go
 * into a Blob in the origin's own IndexedDB and the document carries a short
 * id instead.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExcalidrawElement,
  ExcalidrawPanelElement,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { MEDIA_STORE_MAX_BYTES, readMedia } from "../data/mediaStore";
import { insertVideoPanel } from "../sidebar/videoPanel";

/**
 * The store, in memory.
 *
 * The browser's own store cannot be used here: jsdom has no IndexedDB, and
 * `fake-indexeddb` (which the test setup installs) clones with Node's
 * `structuredClone`, which refuses a jsdom `Blob` with a `DataCloneError`. A
 * real browser stores a Blob **by reference** and never reads it into the
 * heap — which is the whole point of this wave — so the store is stood in for
 * here, and the test looks inside it.
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
 * The two whole-file reads the insert used to do, watched.
 *
 * They are the thing this wave removes, so the test has to see them *not*
 * happen.
 */
const reads = vi.hoisted(() => ({
  getDataURL: vi.fn(async () => "data:video/mp4;base64,AAAA"),
  generateIdFromFile: vi.fn(async () => "video-file-1"),
}));

vi.mock("@excalidraw/excalidraw/data/blob", async (importOriginal) => {
  const mod = await importOriginal<
    typeof import("@excalidraw/excalidraw/data/blob")
  >();

  return {
    ...mod,
    getDataURL: reads.getDataURL,
    generateIdFromFile: reads.generateIdFromFile,
  };
});

vi.mock("../components/videoCaptions", async (importOriginal) => {
  const mod = await importOriginal<
    typeof import("../components/videoCaptions")
  >();

  return {
    ...mod,
    readVideoSize: async () => ({ width: 1920, height: 1080 }),
  };
});

/** a video small enough to travel in the document, as it always did */
const smallVideo = () =>
  new File(["video-bytes"], "lesson.mp4", { type: "video/mp4" });

/**
 * A video over the threshold.
 *
 * Its **size** is what the threshold is measured against, and a 40 MB file in
 * a test would be 40 MB of memory for nothing — so the size is stated rather
 * than allocated.
 */
const bigVideo = () => {
  const file = new File(["video-bytes"], "huge.mkv", {
    type: "video/x-matroska",
  });

  Object.defineProperty(file, "size", {
    configurable: true,
    value: MEDIA_STORE_MAX_BYTES + 1,
  });

  return file;
};

/**
 * The app's side of the insert, as the host app sees it: a scene, some files
 * and a toast.
 */
const fakeApi = () => {
  const state = {
    elements: [] as ExcalidrawElement[],
    files: [] as BinaryFileData[],
    appState: {
      width: 1200,
      height: 800,
      scrollX: 0,
      scrollY: 0,
      offsetLeft: 0,
      offsetTop: 0,
      zoom: { value: 1 as never },
      currentPageId: "page-1",
      currentItemStrokeColor: "#1e1e1e",
    },
  };

  const api = {
    getAppState: () => state.appState,
    getSceneElements: () => state.elements,
    addFiles: (files: BinaryFileData[]) => {
      state.files.push(...files);
    },
    updateScene: (data: {
      elements?: readonly ExcalidrawElement[];
      appState?: Record<string, unknown>;
    }) => {
      if (data.elements) {
        state.elements = [...data.elements];
      }
      if (data.appState) {
        Object.assign(state.appState, data.appState);
      }
    },
    setToast: () => {},
  } as unknown as ExcalidrawImperativeAPI;

  return { api, state };
};

const panelOf = (state: { elements: ExcalidrawElement[] }) =>
  state.elements.find(
    (element) => element.type === "panel",
  ) as unknown as ExcalidrawPanelElement;

beforeEach(() => {
  mediaStore.clear();
  reads.getDataURL.mockClear();
  reads.generateIdFromFile.mockClear();
});

describe("a video too big for the document", () => {
  it("AC-133 a video over the threshold is stored as media and not as a base64 data URL", async () => {
    const { api, state } = fakeApi();

    const videoFile = bigVideo();

    await insertVideoPanel(api, {
      videoFile,
      sidecarFile: null,
    });

    // the whole file was never read into a string: no base64, and no hash
    // either (hashing would mean reading the file again)
    expect(reads.getDataURL).not.toHaveBeenCalled();
    expect(reads.generateIdFromFile).not.toHaveBeenCalled();

    const panel = panelOf(state);

    // the panel names the media by a short id, and says what it is
    expect(panel.panel.source).toMatchObject({
      type: "media",
      mimeType: "video/x-matroska",
    });

    const source = panel.panel.source as unknown as { mediaId: string };

    expect(typeof source.mediaId).toBe("string");
    expect(source.mediaId.length).toBeLessThan(64);

    // and the bytes are in the store, under that id — read back out through the
    // app's own reader, so the round trip is proven and not merely asserted
    const stored = await readMedia(source.mediaId);

    // the **same** Blob, by reference: the bytes never became a string
    expect(stored).toBe(videoFile);
    expect(stored).toBeInstanceOf(File);
    expect((stored as File).name).toBe("huge.mkv");
    expect((stored as File).type).toBe("video/x-matroska");

    // the document carries no video at all: no file in its file store ...
    expect(state.files).toHaveLength(0);

    // ... and no base64 anywhere in the element
    expect(JSON.stringify(panel)).not.toContain("base64");
  });

  it("AC-133 a video under the threshold still travels in the file store", async () => {
    const { api, state } = fakeApi();

    await insertVideoPanel(api, {
      videoFile: smallVideo(),
      sidecarFile: null,
    });

    // the old path is untouched: the file is read and hashed as it always was
    expect(reads.getDataURL).toHaveBeenCalledTimes(1);
    expect(reads.generateIdFromFile).toHaveBeenCalledTimes(1);

    const panel = panelOf(state);

    expect(panel.panel.source).toMatchObject({
      type: "file",
      fileId: "video-file-1",
      mimeType: "video/mp4",
    });

    // and the video is in the document's own file store, as it always was
    expect(state.files).toHaveLength(1);
    expect(state.files[0].dataURL).toBe("data:video/mp4;base64,AAAA");

    // the media store was not touched at all: there is no media id to read
    const source = panel.panel.source as unknown as { mediaId?: string };

    expect(source.mediaId).toBeUndefined();
  });
});
