import {
  getCameraFromPageRelative,
  getCurrentPageRect,
  getFitPageZoom,
  getPageRelativeCamera,
} from "@excalidraw/excalidraw";

import { DEFAULT_LASER_COLOR, MAX_ZOOM, MIN_ZOOM } from "@excalidraw/common";
import { clamp } from "@excalidraw/math";

import type {
  AppState,
  BinaryFileData,
  Collaborator,
  NormalizedZoomValue,
  SocketId,
} from "@excalidraw/excalidraw/types";
import type { PanelCapture } from "@excalidraw/excalidraw";
import type {
  FileId,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";

/**
 * Transport used to mirror the editor scene into a dedicated presenter window
 * (typically dragged onto a second display).
 *
 * The presenter window is opened by the editor tab itself, so both windows are
 * same-origin. We use `BroadcastChannel` which means:
 *
 * - no server / websocket roundtrip (works fully offline)
 * - no localStorage polling
 * - sub-frame latency while drawing
 *
 * The editor window only publishes when at least one presenter is connected, so
 * the hot `onChange` path stays a couple of ref writes when the feature is
 * unused.
 */

export const PRESENTER_CHANNEL_NAME = "excalidraw-presenter-v1";

/** query param which turns a window into a presenter view */
export const PRESENTER_QUERY_PARAM = "presenter";

/** named window so that re-triggering the menu item focuses it */
export const PRESENTER_WINDOW_NAME = "_excalidraw-presenter";

/**
 * Camera + canvas chrome we mirror along with the scene, so the projector shows
 * exactly what the editor window shows.
 *
 * The raw `scrollX` / `scrollY` / `zoomValue` triple is *not* enough: the two
 * windows have different sizes, so replaying the same triple on a bigger screen
 * reveals more of the scene — which is what made the projector look "larger
 * than" the editor. Instead we also send a resolution-independent, page-relative
 * camera (how far into the current page the view is scrolled, 0..1) plus the
 * editor's viewport size, so the projector can reproduce the *same region of the
 * page* at its own scale. A point 40% across the page is then 40% across on both
 * displays.
 */
export type PresenterCamera = {
  scrollX: AppState["scrollX"];
  scrollY: AppState["scrollY"];
  zoomValue: AppState["zoom"]["value"];
  viewBackgroundColor: AppState["viewBackgroundColor"];
  gridModeEnabled: AppState["gridModeEnabled"];
  gridSize: AppState["gridSize"];

  /** whether the editor has the pages system enabled */
  pagesEnabled: boolean;
  pages: AppState["pages"];
  currentPageId: AppState["currentPageId"];
  /** fraction of the current page scrolled off to the left / top, 0..1 */
  pageOffsetX: number;
  pageOffsetY: number;
  /** editor viewport size in css px, used to match the visible page fraction */
  editorWidth: number;
  editorHeight: number;
};

export type PresenterScene = {
  elements: readonly OrderedExcalidrawElement[];
  camera: PresenterCamera;
};

/**
 * Pointer + tool state, mirrored separately from the scene.
 *
 * The laser pointer is *not* an element: Excalidraw draws it as an animated SVG
 * trail fed from pointer events, and nothing about it survives in the scene
 * payload — which is why the projector showed nothing at all while the laser
 * was in use. Mirroring the pointer is enough, because `LaserTrails` already
 * knows how to build a trail from a collaborator's pointer.
 *
 * Coordinates are in scene space, which is what the trail renderer consumes
 * directly, so they travel unchanged even though the two windows show the same
 * page at different scales.
 */
export type PresenterPointer = {
  x: number;
  y: number;
  tool: "pointer" | "laser";
  button: "up" | "down";
};

/** socket id of the single synthetic collaborator that carries the pointer */
export const PRESENTER_POINTER_SOCKET_ID = "presenter-pointer" as SocketId;

/**
 * Turns a mirrored pointer into the collaborator map `LaserTrails` reads.
 *
 * This is the whole trick behind showing the laser on the projector: the trail
 * is drawn from `appState.collaborators`, so mirroring the pointer as one
 * remote user is enough for the library to build the stroke — start on button
 * down, extend on move, end on button up, then decay on its own.
 *
 * `renderCursor: false` matters: it keeps the remote cursor + username overlay
 * off a projector, leaving only the trail.
 */
export const pointerCollaborators = (
  pointer: PresenterPointer,
): Map<SocketId, Collaborator> =>
  new Map([
    [
      PRESENTER_POINTER_SOCKET_ID,
      {
        id: PRESENTER_POINTER_SOCKET_ID,
        pointer: {
          x: pointer.x,
          y: pointer.y,
          tool: pointer.tool,
          renderCursor: false,
          laserColor: DEFAULT_LASER_COLOR,
        },
        button: pointer.button,
        username: null,
      },
    ],
  ]);

export type PresenterMessage =
  /** presenter announces itself, editor replies with a full snapshot */
  | { type: "presenter:hello"; presenterId: string }
  /** presenter is going away, editor stops publishing */
  | { type: "presenter:bye"; presenterId: string }
  /** scene + camera update */
  | { type: "presenter:scene"; scene: PresenterScene }
  /** pointer update — this is what drives the mirrored laser trail */
  | { type: "presenter:pointer"; pointer: PresenterPointer }
  /** presenter is missing binary files (images) it does not have yet */
  | { type: "presenter:files-request"; presenterId: string; fileIds: FileId[] }
  /** editor answers a file request */
  | { type: "presenter:files"; presenterId: string; files: BinaryFileData[] }
  /**
   * the live view's **descriptor** for one panel (D-101).
   *
   * The picture never travels - it is served as a stream from the extension -
   * but the presenter is a **second JavaScript context**, so the registry that
   * holds the descriptor is empty there. The editor hands it over, and the
   * presenter writes it into its own registry.
   *
   * The stream's URL carries the connection's capability (D-86), and the
   * session token is never in a URL (D-50). A `BroadcastChannel` is readable
   * only by this origin's own pages, so the descriptor does not travel
   * further than the window the teacher opened.
   */
  | { type: "presenter:live-view"; panelId: string; capture: PanelCapture };

/** presenters announce themselves at least this often while starved */
export const PRESENTER_HEARTBEAT_MS = 2000;

/**
 * a presenter that has not been heard from for this long is considered gone
 * (crashed window, killed tab) so the editor stops publishing
 */
export const PRESENTER_STALE_MS = 10000;

/**
 * The **size guard** of the files channel.
 *
 * A video panel's file is a video, and a video is big: the channel posts the
 * whole `BinaryFileData` in one frame, so a 40 MB video would either block the
 * editor or be dropped with a console error (D-65).
 *
 * The transfer stays **chunk-free** — a second message type would duplicate a
 * binary path that already works (D-58) — and the guard is what keeps a big
 * file from becoming an accident.
 */
export const PRESENTER_FILE_MAX_BYTES = 32 * 1024 * 1024;

/**
 * The size of a file, in bytes.
 *
 * A `dataURL` is ASCII, so its length is its size. The bytes are the base64
 * payload, which is what actually travels.
 */
export const presenterFileSize = (file: BinaryFileData): number =>
  file.dataURL.length;

/**
 * Whether a file is small enough to travel the files channel.
 */
export const isPresenterFileWithinLimit = (file: BinaryFileData): boolean =>
  presenterFileSize(file) <= PRESENTER_FILE_MAX_BYTES;

/**
 * The sentence the app says when a file is too big to travel.
 *
 * It is a **clear error**, not a silent drop: a panel that shows nothing and
 * says nothing is indistinguishable from a panel that has nothing to show.
 */
export const presenterFileTooLargeMessage = (file: BinaryFileData): string =>
  `the file "${file.id}" is ${Math.round(
    presenterFileSize(file) / (1024 * 1024),
  )} MB, and the presenter only takes files up to ${Math.round(
    PRESENTER_FILE_MAX_BYTES / (1024 * 1024),
  )} MB — it was not sent`;

export const isPresenterSupported = () =>
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined";

/** `true` when the current window was opened as a presenter view */
export const isPresenterWindow = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    new URLSearchParams(window.location.search).get(PRESENTER_QUERY_PARAM) ===
    "true"
  );
};

/** stable-ish id for this window, so the editor can count presenters */
export const createPresenterId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const getPresenterCamera = (
  appState: AppState,
  pagesEnabled = false,
): PresenterCamera => {
  const base = {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoomValue: appState.zoom.value,
    viewBackgroundColor: appState.viewBackgroundColor,
    gridModeEnabled: appState.gridModeEnabled,
    gridSize: appState.gridSize,
    pages: appState.pages,
    currentPageId: appState.currentPageId,
    editorWidth: appState.width,
    editorHeight: appState.height,
  };

  if (!pagesEnabled) {
    return {
      ...base,
      pagesEnabled: false,
      pageOffsetX: 0,
      pageOffsetY: 0,
    };
  }

  const pageRect = getCurrentPageRect(appState.pages, appState.currentPageId);
  const { offsetX, offsetY } = getPageRelativeCamera({
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    pageRect,
  });

  return {
    ...base,
    pagesEnabled: true,
    pageOffsetX: offsetX,
    pageOffsetY: offsetY,
  };
};

/**
 * Turns a mirrored {@link PresenterCamera} into the presenter's own
 * `scrollX` / `scrollY` / `zoom` triple.
 *
 * With pages enabled the goal is that both windows show *the same slice of the
 * page*: the presenter repositions itself using the resolution-independent
 * page-relative offset, then picks the zoom at which its own viewport covers
 * exactly as much of the page as the editor's viewport does
 * (`editorWidth / editorZoom` scene units).
 *
 * `viewport` must be the presenter's *measured* canvas size in css px — reading
 * it from `getAppState()` is not safe, because that value still holds whatever
 * size was persisted by the editor session until the first resize lands, and
 * using a stale value scales the zoom by up to the difference between the two
 * windows. `PresenterView` therefore measures the canvas with a
 * `ResizeObserver` and re-derives whenever it changes.
 */
export const resolvePresenterCamera = (
  camera: PresenterCamera,
  viewport: { width: number; height: number },
): Pick<AppState, "scrollX" | "scrollY" | "zoom"> => {
  const { width, height } = viewport;
  const measured = width > 0 && height > 0;

  if (!camera.pagesEnabled || !camera.pages.length || !measured) {
    return {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: {
        value: clamp(
          camera.zoomValue,
          MIN_ZOOM,
          MAX_ZOOM,
        ) as NormalizedZoomValue,
      },
    };
  }

  const pageRect = getCurrentPageRect(camera.pages, camera.currentPageId);

  const { scrollX, scrollY } = getCameraFromPageRelative({
    offsetX: camera.pageOffsetX,
    offsetY: camera.pageOffsetY,
    pageRect,
  });

  // scene-space extent the editor currently shows
  const visibleWidth = camera.editorWidth / camera.zoomValue;

  // clamp to what this window can actually frame: never tighter than the whole
  // page (the page clamp in `App` would reject it anyway)
  //
  // the floor is the fit zoom of **this** page, not of the default page size:
  // a page that is bigger than the default (a legacy file's page, grown to
  // hold the whole board) has a much smaller fit zoom, and the default's floor
  // would force the mirrored window to zoom *in* past the editor's own (D-30)
  //
  // The editor's own camera may zoom out **below** the page's fit zoom now
  // (D-117), and the projector still shows the **whole page** rather than
  // empty canvas around it: that is D-30's rule and it is the presenter's own
  // decision, not a copy of the editor's floor.
  const minZoom = getFitPageZoom(
    width,
    height,
    pageRect.width,
    pageRect.height,
  );
  const zoom = clamp(width / visibleWidth, minZoom, MAX_ZOOM);

  return {
    scrollX,
    scrollY,
    zoom: { value: zoom as NormalizedZoomValue },
  };
};

/**
 * Opens a channel listening for presenter messages.
 *
 * Returns `null` when the browser has no `BroadcastChannel` support — callers
 * are expected to degrade gracefully rather than throw.
 */
export const createPresenterChannel = (
  onMessage: (message: PresenterMessage) => void,
): BroadcastChannel | null => {
  if (!isPresenterSupported()) {
    return null;
  }

  const channel = new BroadcastChannel(PRESENTER_CHANNEL_NAME);

  channel.onmessage = (event: MessageEvent) => {
    const message = event.data as PresenterMessage | null;
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }
    onMessage(message);
  };

  return channel;
};
