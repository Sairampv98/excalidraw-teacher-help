/**
 * The presenter shows the panels — the owner's item 10, part 1.
 *
 * AC-70: the presenter renders the SAME panel overlay the editor does, from the
 *        same element list.
 * AC-71: a playback position of t = 5 reaches the presenter, and the presenter
 *        does NOT write playback back.
 * AC-138: the presenter shows the LIVE WINDOW from the editor's descriptor, and
 *        says why when it has heard nothing yet.
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
  codePanelContent,
  emptyCodePanelState,
  getPanelCapture,
  readPanelPlayback,
  videoPanelContent,
} from "@excalidraw/excalidraw";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type {
  ExcalidrawPanelElement,
  ExcalidrawElement,
  FileId,
} from "@excalidraw/element/types";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import type { CodePanelState, PanelCapture } from "@excalidraw/excalidraw";
import type { PanelBridgeControls } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { useBridgePanel } from "../bridge/useBridgePanel";
import { PresenterView } from "../presenter/PresenterView";
import { usePresenterBroadcaster } from "../presenter/usePresenterBroadcaster";

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

/**
 * The socket the app opens, standing in for the browser's `WebSocket`.
 *
 * The bridge server is in the teacher's VS Code, so the app's side is tested
 * against a socket the test drives: the test opens it and sends the frames
 * the extension would send.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];

  readyState = 1;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  /** every frame the app sent */
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** the socket opens */
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** the bridge sends a frame */
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

/**
 * A token that is **obviously** not a secret: the kit's secret scanner
 * exempts values that say they are a test, a fake or a placeholder.
 */
const TEST_TOKEN = "test-token-placeholder";

/** The clipboard the bridge field reads. */
const mockClipboard = (text: string) => {
  const clipboard = {
    read: vi.fn(async () => []),
    readText: vi.fn(async () => text),
    writeText: vi.fn(async () => undefined),
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return clipboard;
};

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

/** a bridge-backed code panel: connected, with a file open */
const codePanel = (): ExcalidrawPanelElement => {
  const state: CodePanelState = {
    ...emptyCodePanelState(),
    connection: "connected",
    statusMessage: "Connected to the Excalidraw Bridge.",
    editor: {
      uri: "file:///demo/main.py",
      language: "python",
      text: "print('hello')",
      selection: { start: 0, end: 0 },
      version: 3,
    },
  };

  return API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    panelKind: "code",
    // the live window is the default now (D-99), and this panel carries no
    // choice - so it is in the live view
    panel: codePanelContent(state, "session-1"),
    posterMode: false,
    posterFileId: null,
  } as never) as unknown as ExcalidrawPanelElement;
};

/**
 * The app's scene, and the API the bridge hook writes into.
 *
 * The hook needs an API; this one keeps the elements in a variable, so the
 * test can see what the app wrote into the document.
 */
const editorScene = (element: ExcalidrawElement) => {
  const state: { elements: ExcalidrawElement[] } = { elements: [element] };

  const api = {
    getSceneElements: () => state.elements,
    updateScene: (data: { elements?: readonly ExcalidrawElement[] }) => {
      if (data.elements) {
        state.elements = [...data.elements];
      }
    },
  } as unknown as ExcalidrawImperativeAPI;

  return { api, state };
};

/**
 * The editor's side: the bridge, and the presenter channel it publishes on.
 *
 * The live view's descriptor travels from the bridge to the presenter through
 * these two (D-101): the bridge publishes it, and the broadcaster hands it
 * over.
 */
const EditorHarness = ({
  api,
  bridgeRef,
}: {
  api: ExcalidrawImperativeAPI;
  bridgeRef: React.MutableRefObject<PanelBridgeControls | null>;
}) => {
  const { publishLiveView } = usePresenterBroadcaster(true);
  const { bridge } = useBridgePanel(api, publishLiveView);

  bridgeRef.current = bridge;

  return null;
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
  FakeSocket.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("WebSocket", FakeSocket);
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

  it("AC-138 the presenter shows the live window from the editor's descriptor", async () => {
    const panel = codePanel();

    await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    const channel = FakeBroadcastChannel.instances[0];

    expect(channel).toBeDefined();

    // the editor sends the scene — the code panel is in it, and it is in the
    // LIVE view: the live window is the default now (D-99)
    await act(async () => {
      channel.receive({
        type: "presenter:scene",
        scene: { elements: [panel], camera: camera() },
      });
    });

    // and then the editor hands over the live view's **descriptor** (D-101).
    // The presenter is a second JavaScript context, so the registry that
    // holds the descriptor is EMPTY there until the editor says so — that is
    // why the presenter's live view was black.
    await act(async () => {
      channel.receive({
        type: "presenter:live-view",
        panelId: panel.id,
        capture: {
          status: "live",
          streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
        },
      });
    });

    API.setAppState({ width: 1000, height: 1000 });

    // the presenter draws the LIVE WINDOW: the same stream the editor plays,
    // in a plain `<img>`. The picture itself never travels — the descriptor
    // does (D-85, D-101).
    const frame = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-live-frame"]',
      );

      expect(found).not.toBeNull();

      return found as HTMLImageElement;
    })) as HTMLImageElement;

    expect(frame.getAttribute("src")).toBe(
      "http://127.0.0.1:47511/s/a-capability/frame",
    );

    // and the PRESENTER's own registry holds the descriptor now - it was
    // empty before the editor handed it over (D-101)
    expect(getPanelCapture(panel.id)).toEqual({
      status: "live",
      streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
    });

    // and the mirror is a mirror: the presenter does NOT get the toggle
    expect(
      document.querySelector('[data-testid="code-panel-view-toggle"]'),
    ).toBeNull();
  });

  it("AC-138 a presenter with no descriptor says why instead of showing black", async () => {
    const panel = codePanel();

    await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    const channel = FakeBroadcastChannel.instances[0];

    // the editor sends the scene — and NOTHING else: the presenter has heard
    // no descriptor yet
    await act(async () => {
      channel.receive({
        type: "presenter:scene",
        scene: { elements: [panel], camera: camera() },
      });
    });

    API.setAppState({ width: 1000, height: 1000 });

    // the presenter's own registry is EMPTY: the editor has handed over
    // nothing yet, and that is exactly why the panel cannot draw a live
    // window (D-101)
    expect(getPanelCapture(panel.id)).toBeNull();

    // the panel says WHY there is no live window (D-75): a region with
    // nothing in it is never an answer, and a black rectangle is the one
    // thing a teacher cannot read
    const status = (await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="code-panel-live-status"]',
      );

      expect(found).not.toBeNull();

      return found as HTMLElement;
    })) as HTMLElement;

    expect(status.textContent).toContain("live window");

    // and there is no picture pretending to be the editor
    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).toBeNull();

    // the mirrored text is still there: the text is the FALLBACK, never a
    // blank region
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-source"] .cm-editor'),
      ).not.toBeNull(),
    );
  });

  it("AC-138 the editor hands the live view's descriptor to the presenter", async () => {
    mockClipboard(TEST_TOKEN);

    const panel = codePanel();
    const { api } = editorScene(panel as unknown as ExcalidrawElement);

    const bridgeRef = {
      current: null,
    } as React.MutableRefObject<PanelBridgeControls | null>;

    await render(
      <Excalidraw initialData={{ elements: [panel] as never }}>
        <EditorHarness api={api} bridgeRef={bridgeRef} />
      </Excalidraw>,
    );

    const editorChannel = FakeBroadcastChannel.instances[0];

    expect(editorChannel).toBeDefined();

    // a presenter is there: the editor publishes only when somebody listens
    await act(async () => {
      editorChannel.receive({
        type: "presenter:hello",
        presenterId: "presenter-1",
      });
    });

    // the bridge connects: the token comes from the clipboard
    await act(async () => {
      await bridgeRef.current!.onPasteToken?.();
    });

    await waitFor(() => expect(FakeSocket.instances.length).toBe(1));

    const socket = FakeSocket.instances[0];

    socket.open();

    await waitFor(() => expect(socket.sent.length).toBe(1));

    // the extension says hello, with the stream's URL in it ...
    act(() => {
      socket.receive({
        v: 1,
        type: "bridge:hello",
        version: "0.1.0",
        workspace: "demo",
        appName: "VSCodium",
        streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
      });
    });

    // ... and then it says the capture is running. The picture itself does NOT
    // come over the websocket: it is served as an MJPEG stream (D-85).
    act(() => {
      socket.receive({
        v: 1,
        type: "editor:capture",
        state: "live",
        seq: 1,
      });
    });

    // and the editor hands the DESCRIPTOR to the presenter (D-101): the
    // panel's id, the capture's state, and the stream's URL. The picture does
    // not travel - the presenter plays the same stream.
    await waitFor(() => {
      const sent = editorChannel.posted.filter(
        (message) =>
          (message as { type?: string }).type === "presenter:live-view",
      ) as { type: string; panelId: string; capture: PanelCapture }[];

      expect(sent).toHaveLength(1);
      expect(sent[0].panelId).toBe(panel.id);
      expect(sent[0].capture).toEqual({
        status: "live",
        streamUrl: "http://127.0.0.1:47511/s/a-capability/frame",
      });
    });

    // and the session token is NOT in it: the URL carries the connection's
    // capability, and the token never travels (D-50)
    expect(JSON.stringify(editorChannel.posted)).not.toContain(TEST_TOKEN);
  });
});
