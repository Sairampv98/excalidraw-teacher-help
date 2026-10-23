/**
 * The video panel: the element, the captions beside it, and the poster.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { THEME } from "@excalidraw/common";
import { renderElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawPanelElement,
  FileId,
  NonDeletedExcalidrawElement,
  PanelCaptionTrack,
} from "@excalidraw/element/types";

import { getDefaultAppState } from "../appState";
import { restoreElements } from "../data/restore";
import { captionTextElement, videoPanelContent } from "../index";
import { Excalidraw } from "../index";
import { registerMediaResolver } from "../index";
import { readCaptionBinding } from "../scene/panelContent";
import { PANEL_SCALE_PROPERTY } from "../scene/panelChrome";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { BinaryFileData } from "../types";
import type { StaticCanvasAppState } from "../types";
import type { StaticCanvasRenderConfig } from "../scene/types";

const VIDEO_FILE_ID = "video-file-1" as FileId;

/** the size the video itself has — the size a poster is captured at */
const INTRINSIC_WIDTH = 1920;
const INTRINSIC_HEIGHT = 1080;

/** the size the panel happens to be shown at on the canvas */
const DISPLAY_WIDTH = 400;
const DISPLAY_HEIGHT = 300;

const CAPTION_TRACK: PanelCaptionTrack = {
  language: "en",
  label: "English",
  cues: [
    { startMs: 0, endMs: 2000, text: "the first cue" },
    { startMs: 2000, endMs: 4000, text: "the second cue" },
  ],
};

const videoFile = () => ({
  id: VIDEO_FILE_ID,
  // the file store's media-type list is image-shaped, and it lives in
  // `@excalidraw/element` — outside this wave's scope. A video file keeps its
  // own type, because the overlay tells "a video" from "a picture" by it.
  mimeType: "video/mp4" as unknown as BinaryFileData["mimeType"],
  dataURL: "data:video/mp4;base64,AAAA" as BinaryFileData["dataURL"],
  created: 1,
  lastRetrieved: 1,
  version: 1,
});

/** the id the **host's** media store knows a big video by (D-94, D-95) */
const MEDIA_ID = "media-1";

/**
 * A video panel whose bytes live in the **host's** media store (D-95).
 *
 * The bytes are not in the document: the panel names them by id, and the
 * library asks the host for a URL.
 */
const mediaPanel = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    panelKind: "video",
    panel: videoPanelContent({
      source: {
        type: "media",
        mediaId: MEDIA_ID,
        mimeType: "video/x-matroska",
      },
      tracks: [],
      language: "en",
      naturalWidth: INTRINSIC_WIDTH,
      naturalHeight: INTRINSIC_HEIGHT,
    }),
    posterMode: false,
    posterFileId: null,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

/**
 * The **host's** resolver (D-95).
 *
 * It is asked for a URL, and it is asked **again** when the panel needs a
 * fresh one: the URL the host lent may be stale or revoked, and the fallback
 * asks for another one (D-126).
 */
const hostResolver = () => {
  const asked: string[] = [];

  registerMediaResolver(async (mediaId: string) => {
    asked.push(mediaId);

    return `blob:mock/${asked.length}`;
  });

  return asked;
};

/** the browser's own verdict on a video, as the element reports it */
const browserVerdict = (
  video: Element,
  code: number,
  message = "The video format is not supported",
) => {
  Object.defineProperty(video, "error", {
    configurable: true,
    value: { code, message },
  });
};

/**
 * The panel's `<video>`, once it is on the page.
 *
 * A media-backed panel asks the host for its URL first, so the element is not
 * there the moment the panel is rendered.
 */
const videoElement = async () =>
  await waitFor(() => {
    const video = document.querySelector('[data-testid="panel-video"]');

    expect(video).not.toBeNull();

    return video!;
  });

/** the panel's failure message, once it is on the page */
const failurePanel = async () =>
  await waitFor(() => {
    const failed = document.querySelector('[data-testid="panel-video-error"]');

    expect(failed).not.toBeNull();

    return failed!;
  });

/** a video panel, with a caption track */
const videoPanel = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    panelKind: "video",
    panel: videoPanelContent({
      source: { type: "file", fileId: VIDEO_FILE_ID, mimeType: "video/mp4" },
      tracks: [CAPTION_TRACK],
      language: "en",
      naturalWidth: INTRINSIC_WIDTH,
      naturalHeight: INTRINSIC_HEIGHT,
    }),
    posterMode: false,
    posterFileId: null,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

const map = (elements: NonDeletedExcalidrawElement[]) =>
  new Map(elements.map((el) => [el.id, el])) as unknown as ElementsMap;

const canvasContext = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  return context as CanvasRenderingContext2D & {
    __getDrawCalls: () => { type: string; props: Record<string, unknown> }[];
  };
};

const renderConfig = (
  overrides: Partial<StaticCanvasRenderConfig> = {},
): StaticCanvasRenderConfig => ({
  canvasBackgroundColor: "#ffffff",
  imageCache: new Map(),
  renderGrid: false,
  isExporting: false,
  embedsValidationStatus: new Map(),
  elementsPendingErasure: new Set(),
  pendingFlowchartNodes: null,
  theme: THEME.LIGHT,
  ...overrides,
});

const appState = (): StaticCanvasAppState => {
  const state = getDefaultAppState();

  return {
    ...state,
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as StaticCanvasAppState["zoom"]["value"] },
    width: 1200,
    height: 800,
    offsetLeft: 0,
    offsetTop: 0,
    theme: THEME.LIGHT,
  };
};

/** the element of the scene with that id */
const elementById = (id: string) =>
  window.h.elements.find((element) => element.id === id);

describe("the video panel", () => {
  afterEach(() => {
    // the host's resolver is a singleton: no test may leave one behind
    registerMediaResolver(null);
  });

  it("AC-65 a video panel is created with the right kind and source, and the canvas does not paint it", () => {
    const panel = videoPanel();

    // the kind and the source are what tell the machinery what this is
    expect(panel.panelKind).toBe("video");
    expect(panel.panel.source).toEqual({
      type: "file",
      fileId: VIDEO_FILE_ID,
      mimeType: "video/mp4",
    });

    // the content's own size is in the payload: it is what a poster is
    // captured at
    expect(panel.panel.options.naturalWidth).toBe(INTRINSIC_WIDTH);
    expect(panel.panel.options.naturalHeight).toBe(INTRINSIC_HEIGHT);

    // and a live panel paints NOTHING on the canvas: the canvas is a single
    // raster, and a live surface is a real element in the page
    const live = panel as unknown as NonDeletedExcalidrawElement;
    const elementsMap = map([live]);
    const context = canvasContext();

    renderElement(
      live,
      elementsMap as never,
      elementsMap as never,
      null as never,
      context,
      renderConfig(),
      appState(),
    );

    expect(context.__getDrawCalls()).toHaveLength(0);
  });

  it("AC-66 a cue change replaces the bound text element's text, and the element is on the panel's own page", async () => {
    const panel = videoPanel();

    const caption = API.createElement({
      type: "text",
      text: "the first cue",
      x: 600,
      y: 300,
      width: 200,
      height: 30,
    }) as unknown as NonDeletedExcalidrawElement;

    // the binding names the text element, the panel and the track's language
    const bound = {
      ...panel,
      captionBinding: {
        elementId: caption.id,
        panelId: panel.id,
        language: "en",
      },
    } as unknown as ExcalidrawPanelElement;

    await render(
      <Excalidraw
        initialData={{
          elements: [bound, caption] as unknown as ExcalidrawElement[],
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    // jsdom has no layout, so the editor's own viewport is 0×0 and nothing
    // would be visible
    API.setAppState({ width: 1000, height: 1000 });

    const video = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement | null;

    expect(video).not.toBeNull();

    // the browser owns the position of the video; the test plays it at 2.5 s
    Object.defineProperty(video!, "currentTime", {
      value: 2.5,
      writable: true,
      configurable: true,
    });

    await act(async () => {
      fireEvent.timeUpdate(video!);
    });

    const updated = elementById(caption.id) as unknown as {
      text: string;
      pageId: string;
    };

    // the cue that is on screen is now the text of the element
    expect(updated.text).toBe("the second cue");

    // and the caption element is on the panel's own page: a caption of a
    // panel on another page would be a caption nobody can see
    expect(updated.pageId).toBe(bound.pageId);

    // the binding is SCENE data: it survives a save and a restore, so the
    // caption is still bound after a reload (D-54)
    const restored = restoreElements(
      [bound, caption] as unknown as ExcalidrawElement[],
      null,
    );

    const restoredPanel = restored.find(
      (element) => element.id === panel.id,
    ) as unknown as ExcalidrawPanelElement;

    expect(restoredPanel).toBeDefined();
    expect(readCaptionBinding(restoredPanel)).toEqual({
      elementId: caption.id,
      panelId: panel.id,
      language: "en",
    });
  });

  it("AC-67 a video with no caption track gets no caption element at all", () => {
    // no track: nothing to show, so nothing is created
    expect(
      captionTextElement({
        track: null,
        x: 0,
        y: 0,
        fontSize: 20,
        strokeColor: "#000000",
      }),
    ).toBeNull();

    // a track without a cue is the same thing: there is no caption to show
    expect(
      captionTextElement({
        track: { language: "en", label: "English", cues: [] },
        x: 0,
        y: 0,
        fontSize: 20,
        strokeColor: "#000000",
      }),
    ).toBeNull();

    // and a track with a cue does make one
    const element = captionTextElement({
      track: CAPTION_TRACK,
      x: 0,
      y: 0,
      fontSize: 20,
      strokeColor: "#000000",
    });

    expect(element).not.toBeNull();
    expect(element!.text).toBe("the first cue");
  });

  it("AC-68 locking a local video panel produces a poster at the video's own size, not the panel's", async () => {
    // the poster is written with `toDataURL`, and the canvas it is written
    // from is the video's own size — this is where that size shows up
    const captures: { width: number; height: number }[] = [];

    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      function (this: HTMLCanvasElement) {
        captures.push({ width: this.width, height: this.height });

        return "data:image/png;base64,POSTER";
      },
    );

    const panel = videoPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setSelectedElements([panel as unknown as NonDeletedExcalidrawElement]);

    const video = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement | null;

    expect(video).not.toBeNull();

    // the browser tells the video its own size; jsdom does not
    Object.defineProperty(video!, "videoWidth", { value: INTRINSIC_WIDTH });
    Object.defineProperty(video!, "videoHeight", { value: INTRINSIC_HEIGHT });

    const lock = document.querySelector(
      '[data-testid="panel-lock-button"]',
    ) as HTMLButtonElement | null;

    expect(lock).not.toBeNull();

    await act(async () => {
      fireEvent.click(lock!);
    });

    // the poster was taken at the VIDEO's size, not at the size the panel is
    // shown at
    expect(captures).toEqual([
      { width: INTRINSIC_WIDTH, height: INTRINSIC_HEIGHT },
    ]);
    expect(captures[0].width).not.toBe(DISPLAY_WIDTH);
    expect(captures[0].height).not.toBe(DISPLAY_HEIGHT);

    const locked = elementById(panel.id) as unknown as ExcalidrawPanelElement;

    expect(locked.posterMode).toBe(true);
    expect(locked.posterFileId).not.toBeNull();
    expect(locked.panel.options.naturalWidth).toBe(INTRINSIC_WIDTH);
    expect(locked.panel.options.naturalHeight).toBe(INTRINSIC_HEIGHT);
  });

  it("AC-129 the video's volume slider sets the element's volume, the mute button sets the element's muted, and the control says which state it is in", async () => {
    const panel = videoPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement | null;
    const volume = document.querySelector(
      '[data-testid="panel-video-volume"]',
    ) as HTMLInputElement | null;
    const mute = document.querySelector(
      '[data-testid="panel-video-mute"]',
    ) as HTMLButtonElement | null;

    expect(video).not.toBeNull();
    expect(volume).not.toBeNull();
    expect(mute).not.toBeNull();

    // The slider sets the ELEMENT's volume. The element is the truth and the
    // React state only mirrors it - so the assertion is on the element, not
    // on the state.
    await act(async () => {
      fireEvent.change(volume!, { target: { value: "0.35" } });
    });

    expect(video!.volume).toBeCloseTo(0.35, 5);

    // and the slider says what it says
    expect(volume!.value).toBe("0.35");

    // The mute button sets the ELEMENT's muted.
    await act(async () => {
      fireEvent.click(mute!);
    });

    expect(video!.muted).toBe(true);

    // and the control SHOWS which state it is in: the button says it, and the
    // volume slider carries it, so a muted panel is readable at a glance and
    // not only in the DOM
    expect(mute!.getAttribute("aria-pressed")).toBe("true");
    expect(mute!.getAttribute("aria-label")).toBe("Unmute");
    expect(mute!.textContent).toBe("🔇");
    expect(volume!.getAttribute("data-muted")).toBe("true");

    // and unmuting says so too
    await act(async () => {
      fireEvent.click(mute!);
    });

    expect(video!.muted).toBe(false);
    expect(mute!.getAttribute("aria-pressed")).toBe("false");
    expect(mute!.getAttribute("aria-label")).toBe("Mute");
    expect(volume!.getAttribute("data-muted")).toBe("false");

    // and the control is REACHABLE: the mute button and the volume slider are
    // big enough to hit, ON SCREEN - the panel's own scale is what turns the
    // size inside the panel into the size the teacher sees (D-92)
    const panelElement = document.querySelector(
      '[data-testid="panel"]',
    ) as HTMLElement | null;

    expect(panelElement).not.toBeNull();

    const scale = parseFloat(
      getComputedStyle(panelElement!).getPropertyValue(PANEL_SCALE_PROPERTY),
    );

    expect(parseFloat(mute!.style.width) * scale).toBeGreaterThanOrEqual(20);
    expect(parseFloat(mute!.style.height) * scale).toBeGreaterThanOrEqual(20);
    expect(parseFloat(volume!.style.width) * scale).toBeGreaterThanOrEqual(48);
    expect(parseFloat(volume!.style.height) * scale).toBeGreaterThanOrEqual(16);
  });

  it("AC-157 a volume of zero shows the muted state", async () => {
    const panel = videoPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const volume = document.querySelector(
      '[data-testid="panel-video-volume"]',
    ) as HTMLInputElement | null;
    const mute = document.querySelector(
      '[data-testid="panel-video-mute"]',
    ) as HTMLButtonElement | null;

    expect(volume).not.toBeNull();
    expect(mute).not.toBeNull();

    // the slider goes to zero: the video is silent
    await act(async () => {
      fireEvent.change(volume!, { target: { value: "0" } });
    });

    // and the control SAYS the panel is muted - the state the teacher
    // experiences, not the field the control happens to be bound to (D-119).
    // The owner's report: "sliding the volume slider completely down does not
    // show the mute icon".
    expect(mute!.getAttribute("aria-pressed")).toBe("true");
    expect(mute!.getAttribute("aria-label")).toBe("Unmute");
    expect(mute!.textContent).toBe("🔇");
    expect(volume!.getAttribute("data-muted")).toBe("true");
  });

  it("AC-157 the mute button restores a usable volume", async () => {
    const panel = videoPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement | null;
    const volume = document.querySelector(
      '[data-testid="panel-video-volume"]',
    ) as HTMLInputElement | null;
    const mute = document.querySelector(
      '[data-testid="panel-video-mute"]',
    ) as HTMLButtonElement | null;

    expect(video).not.toBeNull();
    expect(volume).not.toBeNull();
    expect(mute).not.toBeNull();

    // the slider goes to zero
    await act(async () => {
      fireEvent.change(volume!, { target: { value: "0" } });
    });

    expect(video!.volume).toBe(0);

    // clicking the button unmutes - and gives the video a volume back, or it
    // would stay silent while the button says "unmuted" (D-119)
    await act(async () => {
      fireEvent.click(mute!);
    });

    expect(video!.muted).toBe(false);
    expect(video!.volume).toBeGreaterThan(0);

    // and the control says so
    expect(mute!.getAttribute("aria-pressed")).toBe("false");
    expect(mute!.getAttribute("aria-label")).toBe("Mute");
    expect(mute!.textContent).toBe("🔊");
    expect(volume!.getAttribute("data-muted")).toBe("false");
    expect(volume!.value).not.toBe("0");
  });

  it("AC-131 the video panel says so when its file is gone", async () => {
    const panel = videoPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
          // the file is not in the document's store: it was deleted, or the
          // document was saved without it
          files: {},
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    // the panel says so, in words - a blank frame looks like a panel that is
    // broken (D-93)
    const gone = document.querySelector('[data-testid="panel-file-gone"]');

    expect(gone).not.toBeNull();
    expect(gone!.textContent).toBe(
      "This panel's file is no longer in the document.",
    );

    // and there is no empty frame pretending to be the video
    expect(document.querySelector('[data-testid="panel-video"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="panel-video-box"]'),
    ).toBeNull();
  });

  it("AC-132 the video's captions live outside the player, in the text element beside it", async () => {
    const panel = videoPanel();

    const caption = API.createElement({
      type: "text",
      text: "the first cue",
      x: 600,
      y: 300,
      width: 200,
      height: 30,
    }) as unknown as NonDeletedExcalidrawElement;

    const bound = {
      ...panel,
      captionBinding: {
        elementId: caption.id,
        panelId: panel.id,
        language: "en",
      },
    } as unknown as ExcalidrawPanelElement;

    await render(
      <Excalidraw
        initialData={{
          elements: [bound, caption] as unknown as ExcalidrawElement[],
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement | null;

    expect(video).not.toBeNull();

    // the cues ride in `<track>` elements ...
    const tracks = video!.querySelectorAll("track");

    expect(tracks.length).toBe(1);

    // ... and NONE of them is `default`: the player does not draw the caption,
    // because the caption lives in the text element beside the panel (the
    // owner's rule, 2026-10-21)
    for (const track of Array.from(tracks)) {
      expect(track.hasAttribute("default")).toBe(false);
    }

    // so the player's own box carries no caption at all
    expect(video!.textContent).not.toContain("the first cue");

    // the browser plays it at 2.5 s
    Object.defineProperty(video!, "currentTime", {
      value: 2.5,
      writable: true,
      configurable: true,
    });

    await act(async () => {
      fireEvent.timeUpdate(video!);
    });

    // and the caption the teacher reads is the one in the ordinary text
    // element beside the panel
    const updated = elementById(caption.id) as unknown as { text: string };

    expect(updated.text).toBe("the second cue");

    // and the panel's own box never shows it
    expect(
      document.querySelector('[data-testid="panel-video-box"]')!.textContent,
    ).not.toContain("the second cue");
  });

  it("AC-135 a video the browser cannot play says why and shows the ffmpeg command", async () => {
    // a `.mkv`: the browser demuxes Matroska (measured, 2026-10-23) - what it
    // cannot decode is **this file's** codec
    const panel = videoPanel({
      panel: videoPanelContent({
        source: {
          type: "file",
          fileId: VIDEO_FILE_ID,
          mimeType: "video/x-matroska",
        },
        tracks: [],
        language: "en",
        naturalWidth: INTRINSIC_WIDTH,
        naturalHeight: INTRINSIC_HEIGHT,
      }),
    });

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
          files: { [VIDEO_FILE_ID]: videoFile() },
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = document.querySelector(
      '[data-testid="panel-video"]',
    ) as HTMLVideoElement | null;

    expect(video).not.toBeNull();

    // The browser's own verdict is the oracle (D-97): `MEDIA_ERR_SRC_NOT_
    // SUPPORTED` is it saying "I cannot decode this file".
    browserVerdict(video!, 4);

    await act(async () => {
      fireEvent.error(video!);
    });

    // The panel tries the **fallback** first (D-126): the file store's data
    // URL, reached through an object URL - the other way of reaching the same
    // bytes.
    const fallbackVideo = await waitFor(() => {
      const next = document.querySelector('[data-testid="panel-video"]');

      expect(next).not.toBeNull();
      expect(next).not.toBe(video);

      return next;
    });

    expect(fallbackVideo!.getAttribute("src")).not.toBe(
      video!.getAttribute("src"),
    );

    // and the fallback fails too
    browserVerdict(fallbackVideo!, 4);

    await act(async () => {
      fireEvent.error(fallbackVideo!);
    });

    // the panel says so, in words: the file could not be played, and the
    // command that fixes it
    const failed = document.querySelector('[data-testid="panel-video-error"]');

    expect(failed).not.toBeNull();
    expect(failed!.textContent).toContain("ffmpeg");
    expect(failed!.textContent).toContain("libx264");
    expect(failed!.textContent).toContain("output.mp4");

    // and it says that the fallback was tried as well (D-126)
    expect(failed!.textContent).toContain("The fallback was tried as well");

    // and there is no empty player pretending to be the video (D-93)
    expect(document.querySelector('[data-testid="panel-video"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="panel-video-box"]'),
    ).toBeNull();
  });

  it("AC-165 the failure message does not claim the browser cannot play the format", async () => {
    const asked = hostResolver();

    const panel = mediaPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = await videoElement();

    expect(video).not.toBeNull();

    browserVerdict(video!, 4);

    await act(async () => {
      fireEvent.error(video!);
    });

    // the fallback is tried first (D-126), and it fails too
    const fallbackVideo = await waitFor(() => {
      const next = document.querySelector('[data-testid="panel-video"]');

      expect(next).not.toBeNull();
      expect(next).not.toBe(video);

      return next;
    });

    browserVerdict(fallbackVideo!, 4);

    await act(async () => {
      fireEvent.error(fallbackVideo!);
    });

    const failed = await failurePanel();

    // The message must NOT claim that the browser cannot play the format:
    // Chrome demuxes Matroska (measured, 2026-10-23 - a blob URL and a data
    // URL both play an H.264 `.mkv`, and `canPlayType("video/x-matroska")`
    // answers "maybe"), so that claim was FALSE (D-125).
    expect(failed!.textContent).not.toContain("cannot play");
    expect(failed!.textContent).not.toContain("matroska");

    // and it names the FILE - the browser's verdict is about the bytes
    expect(failed!.textContent).toContain("this file");

    // the host was asked for the bytes twice: the primary and the fallback
    expect(asked).toEqual([MEDIA_ID, MEDIA_ID]);
  });

  it("AC-165 the failure message names the codec as the usual cause and keeps the ffmpeg remedy", async () => {
    hostResolver();

    const panel = mediaPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = await videoElement();

    browserVerdict(video!, 4);

    await act(async () => {
      fireEvent.error(video!);
    });

    const fallbackVideo = await waitFor(() => {
      const next = document.querySelector('[data-testid="panel-video"]');

      expect(next).not.toBeNull();
      expect(next).not.toBe(video);

      return next;
    });

    browserVerdict(fallbackVideo!, 4);

    await act(async () => {
      fireEvent.error(fallbackVideo!);
    });

    const failed = await failurePanel();

    // the usual cause is the CODEC, not the container (D-125)
    expect(failed!.textContent).toContain("codec");

    // and the remedy that always works is still there: the `ffmpeg` command
    // is a remedy, not a verdict on the container
    expect(failed!.textContent).toContain("ffmpeg");
    expect(failed!.textContent).toContain("libx264");
    expect(failed!.textContent).toContain("output.mp4");
  });

  it("AC-166 the panel asks for a fresh url when the first one fails", async () => {
    const asked = hostResolver();

    // the fallback must never build a base64 string of a big file: that is
    // the 827 MiB of memory wave 5l removed (D-94, D-126)
    const readAsDataURL = vi.spyOn(FileReader.prototype, "readAsDataURL");
    const encode = vi.spyOn(globalThis, "btoa");

    const panel = mediaPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = await videoElement();

    expect(video!.getAttribute("src")).toBe("blob:mock/1");

    browserVerdict(video!, 4);

    await act(async () => {
      fireEvent.error(video!);
    });

    // the host is asked **again** for the same media: the panel wants a
    // FRESH url, because the one it had may be stale or revoked (D-126)
    await waitFor(() => expect(asked).toEqual([MEDIA_ID, MEDIA_ID]));

    // and the fresh url is the one the video is pointed at now
    const next = document.querySelector('[data-testid="panel-video"]');

    expect(next).not.toBe(video);
    expect(next!.getAttribute("src")).toBe("blob:mock/2");

    // and the fallback never built a base64 string of the file
    expect(readAsDataURL).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  it("AC-166 the panel says the fallback was tried and that it failed too", async () => {
    hostResolver();

    const panel = mediaPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const video = await videoElement();

    browserVerdict(video!, 4);

    await act(async () => {
      fireEvent.error(video!);
    });

    const fallbackVideo = await waitFor(() => {
      const next = document.querySelector('[data-testid="panel-video"]');

      expect(next).not.toBeNull();
      expect(next).not.toBe(video);

      return next;
    });

    browserVerdict(fallbackVideo!, 4);

    await act(async () => {
      fireEvent.error(fallbackVideo!);
    });

    const failed = await failurePanel();

    // the panel says **which** it tried: the fallback was tried, and it
    // failed too (D-126). A panel that says "this file could not be played"
    // without saying that hides half of what it knows.
    expect(failed!.getAttribute("data-fallback-tried")).toBe("true");
    expect(failed!.textContent).toContain("The fallback was tried as well");
    expect(failed!.textContent).toContain("it failed too");
  });

  it("AC-167 an error from a replaced url does not report a playback failure", async () => {
    hostResolver();

    const panel = mediaPanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const first = await videoElement();

    // the first source fails: the panel replaces it with the fallback
    browserVerdict(first!, 4);

    await act(async () => {
      fireEvent.error(first!);
    });

    await waitFor(() =>
      expect(document.querySelector('[data-testid="panel-video"]')).not.toBe(
        first,
      ),
    );

    // and now the error of the **replaced** source arrives. The source is
    // gone, so this error is not a fact about the file (D-127).
    browserVerdict(first!, 4);

    await act(async () => {
      fireEvent.error(first!);
    });

    // so the panel says nothing about the file
    expect(
      document.querySelector('[data-testid="panel-video-error"]'),
    ).toBeNull();

    // and the video is still there, waiting for the fallback to say its own
    // verdict
    expect(
      document.querySelector('[data-testid="panel-video"]'),
    ).not.toBeNull();
  });
});
