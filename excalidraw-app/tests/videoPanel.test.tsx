/**
 * The app's side of the video panel: the insert of a local video, its
 * **sidecar** captions, and the caption element beside the panel.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi } from "vitest";

import { readCaptionBinding } from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawPanelElement,
  ExcalidrawTextElement,
  FileId,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { insertVideoPanel } from "../sidebar/videoPanel";
import { findCaptionSidecar } from "../components/videoCaptions";

/**
 * The browser cannot hash a file in jsdom, and it cannot read a video's
 * metadata either. Both are the browser's job, not the insert's, so they are
 * stood in for here — the insert's own logic is what this file is about.
 */
vi.mock("@excalidraw/excalidraw/data/blob", async (importOriginal) => {
  const mod = await importOriginal<
    typeof import("@excalidraw/excalidraw/data/blob")
  >();

  return {
    ...mod,
    generateIdFromFile: async () => "video-file-1" as FileId,
    getDataURL: async () => "data:video/mp4;base64,AAAA" as never,
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

const SRT = `1
00:00:00,000 --> 00:00:02,000
the first cue

2
00:00:02,000 --> 00:00:04,000
the second cue
`;

const videoFile = (name = "lesson.mp4") =>
  new File(["video-bytes"], name, { type: "video/mp4" });

const sidecarFile = (name = "lesson.srt") =>
  new File([SRT], name, { type: "application/x-subrip" });

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

const textOf = (state: { elements: ExcalidrawElement[] }) =>
  state.elements.find(
    (element) => element.type === "text",
  ) as unknown as ExcalidrawTextElement;

describe("the app inserts a video panel", () => {
  it("AC-67 a video with a sidecar gets a caption element beside the panel, and the two are bound", async () => {
    const { api, state } = fakeApi();

    const { caption } = await insertVideoPanel(api, {
      videoFile: videoFile(),
      sidecarFile: sidecarFile(),
    });

    const panel = panelOf(state);

    expect(panel.panelKind).toBe("video");
    expect(panel.panel.source).toMatchObject({
      type: "file",
      mimeType: "video/mp4",
    });

    // the video's own size is in the payload: it is what a poster is captured
    // at, and the panel's own size never changes it
    expect(panel.panel.options.naturalWidth).toBe(1920);
    expect(panel.panel.options.naturalHeight).toBe(1080);

    // the caption is an ordinary text element beside the panel
    expect(caption).not.toBeNull();
    expect(caption!.type).toBe("text");
    expect(caption!.x).toBeGreaterThan(panel.x + panel.width);

    // and the binding names the text element, the panel and the language
    const binding = readCaptionBinding(panel);

    expect(binding).not.toBeNull();
    expect(binding!.elementId).toBe(caption!.id);
    expect(binding!.panelId).toBe(panel.id);
    expect(binding!.language).toBe("en");

    // the caption element is on the panel's own page
    expect(caption!.pageId).toBe(panel.pageId);
  });

  it("AC-67 a video with no caption track gets no caption element at all", async () => {
    const { api, state } = fakeApi();

    const { caption, track } = await insertVideoPanel(api, {
      videoFile: videoFile(),
      sidecarFile: null,
    });

    expect(track).toBeNull();
    expect(caption).toBeNull();

    const panel = panelOf(state);

    // and there is nothing bound to the panel either
    expect(readCaptionBinding(panel)).toBeNull();

    // the panel itself is still there
    expect(panel.panelKind).toBe("video");
    expect(state.elements.filter((el) => el.type === "text")).toHaveLength(0);
  });

  it("AC-67 a sidecar with no cue is the same as no sidecar at all", async () => {
    const { api, state } = fakeApi();

    const { caption, track } = await insertVideoPanel(api, {
      videoFile: videoFile(),
      sidecarFile: new File(["not a caption file"], "lesson.srt", {
        type: "application/x-subrip",
      }),
    });

    expect(track).toBeNull();
    expect(caption).toBeNull();
    expect(state.elements.filter((el) => el.type === "text")).toHaveLength(0);
  });

  it("AC-66 the caption element the insert makes is an ordinary text element", async () => {
    const { api, state } = fakeApi();

    await insertVideoPanel(api, {
      videoFile: videoFile(),
      sidecarFile: sidecarFile(),
    });

    const element = textOf(state);

    // it starts on the first cue, so the teacher sees the caption's own box
    expect(element.text).toBe("the first cue");
    expect(element.type).toBe("text");
  });

  it("AC-67 a language-tagged sidecar is the sidecar of the video too", async () => {
    const { api, state } = fakeApi();

    // the shape the sidebar sees: a scanned file, with its name and its path
    const scanned = (name: string) => ({
      name,
      path: `videos/${name}`,
      file: sidecarFile(name),
    });

    const sidecar = findCaptionSidecar(
      { name: "lesson.mp4", path: "videos/lesson.mp4" },
      [scanned("lesson.en.srt")],
    );

    // the sidecar is found: a video with a caption file next to it must not
    // look like a video with no captions at all
    expect(sidecar).not.toBeNull();
    expect(sidecar!.name).toBe("lesson.en.srt");

    const { caption, track } = await insertVideoPanel(api, {
      videoFile: videoFile(),
      sidecarFile: sidecar!.file,
    });

    // and the caption element is made, in the language the name carries
    expect(track!.language).toBe("en");
    expect(caption).not.toBeNull();
    expect(textOf(state).text).toBe("the first cue");
  });
});
