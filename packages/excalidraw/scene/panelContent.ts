/**
 * The shared machinery of a **canvas panel**.
 *
 * A panel is a live surface on the canvas: a mirrored editor, a video, an
 * animated flowchart. This wave builds the machinery **once**, so the per-kind
 * waves only have to say what a panel *contains*.
 *
 * ## The two modes
 *
 * A panel is either **live** or a **poster**, and the discriminator is
 * `posterMode` (D-33) — deliberately **not** the base element's `locked`
 * flag, which already means "immutable" and would make a poster panel
 * un-selectable. The base `locked` stays `false` in both modes.
 *
 * - a **live** panel paints nothing on the canvas; its content is a real DOM
 *   surface mounted by `components/PanelOverlay.tsx`;
 * - a **poster** panel is an ordinary image at that point: the canvas paints
 *   its poster at the panel's bounds.
 *
 * ## The placement
 *
 * The overlay's position comes from the library's own
 * `sceneCoordsToViewportCoords` — **the oracle** — and never from a
 * hand-derived transform and never from a copy of `animatedImageTransform`
 * (D-34). A panel is *interactive*, so a misplacement is visible, not
 * cosmetic.
 */

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import {
  getElementAbsoluteCoords,
  isLivePanelElement,
  isPanelElement,
} from "@excalidraw/element";
import { isPosterPanelElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawPanelElement,
  PanelContent,
} from "@excalidraw/element/types";

import type { NormalizedZoomValue } from "../types";

export type PanelCamera = {
  zoom: { value: NormalizedZoomValue };
  scrollX: number;
  scrollY: number;
  offsetLeft: number;
  offsetTop: number;
};

/**
 * Every panel of the given elements — the live ones **and** the posters.
 *
 * The live/poster split is what the overlay needs, but a caller that caches
 * the list needs the **whole** list: a panel that is locked or unlocked is
 * mutated in place, so the elements array keeps its identity and only the
 * panel's own version changes.
 */
export const getAllPanelElements = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawPanelElement[] =>
  elements.filter((element): element is ExcalidrawPanelElement =>
    isPanelElement(element),
  );

/**
 * The live panels of the given elements — the ones the DOM overlay mounts.
 *
 * The parallel of `getAnimatedImageElements()`: an animated image cannot be
 * painted onto the canvas (a frame baked in with `drawImage` never advances),
 * and a live panel cannot be painted onto the canvas either (a frame baked in
 * with `drawImage` is not a live surface).
 *
 * A **poster** panel is not in this list: it is painted by the canvas.
 */
export const getPanelElements = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawPanelElement[] =>
  elements.filter((element): element is ExcalidrawPanelElement =>
    isLivePanelElement(element),
  );

/**
 * The content's **native** size — the size of the content itself, not the size
 * it is displayed at on the canvas.
 *
 * This is the size a poster is captured at: a panel shown at 400×300 on the
 * canvas but rendered by its host at 1920×1080 must produce a 1920×1080
 * poster, not a 400×300 one.
 *
 * When the content's native size is not known, the panel's on-canvas size is
 * the best available answer.
 */
export const panelNativeSize = (
  panel: ExcalidrawPanelElement,
): { width: number; height: number } => {
  const { naturalWidth, naturalHeight } = panel.panel.options;

  return {
    width: naturalWidth ?? panel.width,
    height: naturalHeight ?? panel.height,
  };
};

/**
 * The file id of a panel's source, when the source is a file in the document's
 * own file store.
 *
 * A file-backed panel is **re-creatable** after a reload, which is what makes
 * it mirrorable to the presenter for free (D-64): the presenter is a second
 * Excalidraw instance, so anything the library mounts is mounted there too.
 */
export const panelSourceFileId = (
  panel: ExcalidrawPanelElement,
): string | null => {
  const { source } = panel.panel;

  return source.type === "file" ? source.fileId : null;
};

/**
 * Whether a panel's content can be re-created after a reload.
 *
 * A **bridge**-backed panel lives in a helper process and cannot; a
 * **file**-backed or **inline** panel can.
 */
export const isPanelSourceRecreatable = (
  panel: ExcalidrawPanelElement,
): boolean => panel.panel.source.type !== "bridge";

/**
 * The on-screen position of one of a panel's corners, in the overlay host's
 * own coordinates.
 *
 * The panel's chrome — the lock button — hangs off a corner, so it has to be
 * placed by the same oracle as the panel itself (D-34); otherwise the button
 * and the panel drift apart as the camera moves.
 */
export const panelCornerPosition = (
  element: ExcalidrawPanelElement,
  camera: PanelCamera,
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right",
): { x: number; y: number } => {
  const sceneX = corner.includes("right")
    ? element.x + element.width
    : element.x;
  const sceneY = corner.includes("bottom")
    ? element.y + element.height
    : element.y;

  const { x, y } = sceneCoordsToViewportCoords({ sceneX, sceneY }, camera);

  return { x: x - camera.offsetLeft, y: y - camera.offsetTop };
};

/**
 * The **poster rule**: a poster panel's poster is a raster stretched to the
 * panel's bounds, so it keeps its aspect ratio exactly like an image does.
 *
 * A **live** panel does not: its content is a live surface that reflows, so
 * it resizes freely.
 *
 * The rule lives here, in one place, because it is read from two places — the
 * resize gesture and the dimension field — and the two cannot drift apart.
 */
export const panelKeepsAspectRatio = (element: ExcalidrawElement): boolean =>
  isPosterPanelElement(element);

/**
 * The CSS transform that puts a panel's box exactly where the canvas would
 * draw it.
 *
 * The placement comes from **the oracle**: `sceneCoordsToViewportCoords`
 * returns viewport coordinates, and the overlay's host sits inside the editor
 * container, so the container's own offset is subtracted for the DOM placement
 * (D-34) — the same convention `ElementCanvasButtons` uses.
 *
 * The chain is `translate → scale → rotate → translate`, and the box is laid
 * out at the element's own size, so the element's local `(0, 0)` lands on the
 * element's top-left exactly as the canvas would have put it. The rotation is
 * about the element's centre, which is where the canvas rotates it too.
 */
export const panelTransform = (
  element: ExcalidrawPanelElement,
  elementsMap: ElementsMap,
  camera: PanelCamera,
): string => {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);

  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  // THE ORACLE (D-34). Not `(center + scroll) * zoom` re-derived here: the
  // conversion belongs to the library, and a hand-rolled copy is exactly the
  // kind of bug that puts a panel off the side of the screen.
  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX: centerX, sceneY: centerY },
    camera,
  );

  // the element's own origin, relative to its centre — the same quantity the
  // renderer computes when it composes an element into the scene
  const shiftX = (x2 - x1) / 2 - (element.x - x1);
  const shiftY = (y2 - y1) / 2 - (element.y - y1);

  return [
    `translate(${x - camera.offsetLeft}px, ${y - camera.offsetTop}px)`,
    // the canvas scales the whole scene; this is that, folded in here
    `scale(${camera.zoom.value})`,
    `rotate(${element.angle}rad)`,
    `translate(${-shiftX}px, ${-shiftY}px)`,
  ].join(" ");
};

/**
 * Where a bridge-backed panel's connection stands, as the panel shows it.
 *
 * - `not-connected` — there is no token yet, or the bridge has not answered;
 * - `connected` — the bridge accepted the token;
 * - `rejected` — the connection was refused: the token was wrong, or the
 *   extension is not running.
 *
 * Three states, because three is what the teacher can act on: paste a token,
 * carry on, or fix the token.
 */
export type PanelBridgeStatus = "not-connected" | "connected" | "rejected";

/** The state of the program's run, as the panel shows it. */
export type CodePanelRunState = "idle" | "running" | "exited";

/** One line of the program's output. */
export type CodePanelOutputLine = {
  stream: "stdout" | "stderr";
  text: string;
};

/** One line of the bridge's own messages. */
export type CodePanelConsoleLine = {
  level: "info" | "error";
  text: string;
  /**
   * What the line is about.
   *
   * A **connection** line is a status, not a log entry: the console is saved
   * with the document, so a line that is added on every reconnect would grow
   * the document for ever. The latest connection line replaces the previous
   * one (D-75).
   *
   * Optional, so a document written before it still loads.
   */
  kind?: "connection" | "message";
};

/**
 * The live state of a **code panel** — the mirrored editor, the program's
 * output and the bridge's own messages.
 *
 * Plain data and nothing else: it rides inside the element's payload, so it
 * has to survive `JSON.stringify` and a structured clone (D-46). There is no
 * class, no function and no live socket in here.
 *
 * The **token is not in here**: the token is a secret and the panel's payload
 * is saved with the document (D-50).
 */
export interface CodePanelState {
  /** where the bridge connection stands */
  connection: PanelBridgeStatus;
  /** a sentence for the connection state. Never empty. */
  statusMessage: string;
  /** the mirrored editor */
  editor: {
    uri: string;
    language: string;
    text: string;
    selection: { start: number; end: number } | null;
    version: number;
  };
  /** the program's output, in the order it arrived */
  output: CodePanelOutputLine[];
  /** the bridge's own messages */
  console: CodePanelConsoleLine[];
  /** the run */
  run: {
    runId: string | null;
    command: string;
    state: CodePanelRunState;
    exitCode: number | null;
  };
}

/**
 * The payload of a code panel.
 *
 * `PanelContent` (in `@excalidraw/element`) declares the payload's `source`
 * and `options`. The code panel's own live state is a **third** thing, and the
 * element type lives outside this wave's scope, so the widening happens here,
 * in one place: every writer goes through `withCodePanelState()` and every
 * reader through `readCodePanelState()`.
 */
export type CodePanelContent = PanelContent & {
  /** the code panel's live state, or null when the panel has none yet */
  code: CodePanelState | null;
};

/** The state of a code panel that has not heard from the bridge yet. */
export const emptyCodePanelState = (): CodePanelState => ({
  connection: "not-connected",
  statusMessage: "Not connected to the Excalidraw Bridge.",
  editor: { uri: "", language: "", text: "", selection: null, version: 0 },
  output: [],
  console: [],
  run: { runId: null, command: "", state: "idle", exitCode: null },
});

/**
 * The payload of a code panel that is backed by a bridge session.
 *
 * The session id names the session; the state is the content.
 */
export const codePanelContent = (
  state: CodePanelState,
  sessionId: string,
): PanelContent => {
  const content: CodePanelContent = {
    source: { type: "bridge", sessionId },
    options: { naturalWidth: null, naturalHeight: null, captions: null },
    code: state,
  };

  return content;
};

/**
 * The live state of a panel's payload, or null when the payload carries none.
 *
 * The only way to read the code panel's state — the widening stays in here.
 */
export const readCodePanelState = (
  content: PanelContent,
): CodePanelState | null => {
  const widened: Partial<CodePanelContent> = content;

  return widened.code ?? null;
};

/**
 * The same payload with a new live state in it.
 *
 * The only way to write the code panel's state — the widening stays in here.
 */
export const withCodePanelState = (
  content: PanelContent,
  state: CodePanelState | null,
): PanelContent => {
  const widened: CodePanelContent = { ...content, code: state };

  return widened;
};

/**
 * Whether a panel is a code panel backed by a bridge session.
 *
 * A code panel with any other source is not a live mirror: it has no bridge to
 * mirror, so it shows nothing but its own state.
 */
export const isBridgeCodePanel = (panel: ExcalidrawPanelElement): boolean =>
  panel.panelKind === "code" && panel.panel.source.type === "bridge";
