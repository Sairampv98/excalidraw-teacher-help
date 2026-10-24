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
import { clamp } from "@excalidraw/math";

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
  PanelCaptionTrack,
  PanelContent,
} from "@excalidraw/element/types";

import type { NormalizedZoomValue } from "../types";

import type { PanelSource } from "./mediaRegistry";

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
 * The scale the panel is rendered at.
 *
 * It is the camera's zoom — the very number `panelTransform` folds into the
 * panel's transform — so the transform and the chrome cannot disagree about
 * the zoom (D-92). It is published on the panel element as the CSS custom
 * property `--panel-scale`, and the chrome's sizes are the screen sizes
 * divided by it.
 */
export const panelScale = (camera: PanelCamera): number => camera.zoom.value;

/**
 * The transform that draws a panel over the canvas.
 *
 * The position comes from the library's own conversion,
 * `sceneCoordsToViewportCoords`, and not from a hand-derived formula
 * (D-34): the overlay's host sits inside the editor container, so the
 * container's own offset is subtracted for the DOM placement
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
    // the canvas scales the whole scene; this is that, folded in here. It is
    // the same number the chrome is sized against (D-92).
    `scale(${panelScale(camera)})`,
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
  /**
   * Which view the panel shows (D-83).
   *
   * `"live"` is the **default**: the panel draws the live picture of the
   * teacher's editor window. `"editor"` is the alternative: the mirrored text
   * in the editor, with the file's own grammar.
   *
   * It is the panel's OWN property and it is persisted with the document, so
   * the teacher's choice survives a reload. It is optional, so a document
   * written before it still loads - and it reads as the default.
   */
  view?: CodePanelView;
  /**
   * Whether the teacher **chose** the view (D-99).
   *
   * The default alone is not enough: wave 5h wrote `view: "editor"` into
   * every panel's payload, and that was the OLD default, not a choice. So the
   * choice is a **flag beside** the view: a panel that carries no flag follows
   * the default, and a panel the teacher switched keeps what the teacher
   * switched to.
   *
   * It is a flag and not a second view string, so a payload written before
   * this wave still loads.
   */
  viewChosen?: boolean;
  /**
   * The teacher's **own** text for this panel (D-123).
   *
   * It is the panel's payload, so it is saved with the document and it survives
   * a reload - and it is **beside** the live state on purpose: the bridge
   * rewrites `code` on every keystroke in the teacher's editor, and a draft
   * that lived inside it would be overwritten every time (D-123).
   *
   * Optional, so a document written before this wave still loads.
   */
  draft?: CodePanelDraft;
};

/**
 * The **draft** of a code panel: the teacher's own text (D-123).
 *
 * The editor view used to be a **mirror**: it showed what the extension
 * published and could not be typed into, so with no bridge there was nothing
 * to show - a black box, which is what the owner reported on 2026-10-23
 * (D-123).
 *
 * So the panel carries the teacher's own text, and the **mirror is only what a
 * draft starts from**: a panel the teacher has never edited shows the mirrored
 * text, and the first keystroke makes the draft theirs - after which a mirror
 * update never overwrites it.
 */
export type CodePanelDraft = {
  /** the teacher's own text */
  text: string;
  /**
   * The language the draft is in - the id the extension's runtime table uses
   * (`python`, `javascript`, ...).
   */
  language: string;
  /**
   * Whether the teacher has touched this draft.
   *
   * It is the flag that keeps a mirror from overwriting the teacher's text: an
   * edited draft is the teacher's, and the mirror is only where it started.
   */
  edited: boolean;
};

/**
 * The view a code panel shows.
 *
 * - `"editor"` — the mirrored text, in the editor, with the file's grammar.
 * - `"live"` — the live picture of the editor's own window.
 */
export type CodePanelView = "editor" | "live";

/**
 * The view a code panel shows when it says nothing.
 *
 * The live window is the DEFAULT and the mirrored editor is the alternative
 * (D-99): a panel that was created before this wave - or one whose payload
 * says nothing at all - shows the live window.
 */
export const DEFAULT_CODE_PANEL_VIEW: CodePanelView = "live";

/**
 * The live state of a code panel that has not heard from the bridge yet.
 */
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
    // a new panel shows the LIVE WINDOW (D-99). It carries no choice: the
    // teacher has not chosen anything yet, so the panel follows the default.
    view: DEFAULT_CODE_PANEL_VIEW,
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
 * The view a code panel shows.
 *
 * The only way to READ the view — and a payload that carries no **choice**
 * reads as the DEFAULT: the live window (D-99).
 *
 * The choice is what makes the teacher's own view survive: a panel the teacher
 * switched carries the flag beside the view, and a panel that carries no flag
 * follows the default — even when its payload still says the OLD default
 * (`view: "editor"`, written by wave 5h).
 */
export const readPanelView = (content: PanelContent): CodePanelView => {
  const widened: Partial<CodePanelContent> = content;

  if (!widened.viewChosen) {
    return DEFAULT_CODE_PANEL_VIEW;
  }

  return widened.view ?? DEFAULT_CODE_PANEL_VIEW;
};

/**
 * The same payload with a new view in it.
 *
 * The only way to WRITE the view — the widening stays in here.
 *
 * The spread keeps everything else, and that is the point: the bridge writes
 * the panel's payload on **every keystroke** in the teacher's editor, and the
 * teacher's choice of view must survive that (D-83).
 *
 * Writing the view is writing the teacher's **choice**, so the flag goes with
 * it (D-99): from here on the panel keeps what the teacher switched to, and
 * only a panel that was never switched follows the default.
 */
export const withPanelView = (
  content: PanelContent,
  view: CodePanelView,
): PanelContent => {
  const widened: PanelContent & {
    view?: CodePanelView;
    viewChosen?: boolean;
  } = {
    ...content,
    view,
    viewChosen: true,
  };

  return widened;
};

/**
 * The element update that changes a panel's view.
 *
 * In the same style as `panelLockUpdate` / `panelUnlockUpdate`
 * (`./lockPanel`): the update is the payload with the new view in it, and it
 * goes through `mutateElement`, so it is undoable like every other change.
 */
export type PanelViewUpdate = {
  panel: PanelContent;
};

export const panelViewUpdate = (
  content: PanelContent,
  view: CodePanelView,
): PanelViewUpdate => ({
  panel: withPanelView(content, view),
});

/**
 * The **draft** on a panel, or null when the payload carries none.
 *
 * The only way to READ the draft - the widening stays in here.
 */
export const readPanelDraft = (
  content: PanelContent,
): CodePanelDraft | null => {
  const widened: Partial<CodePanelContent> = content;

  return widened.draft ?? null;
};

/**
 * The same payload with a draft in it.
 *
 * The only way to WRITE the draft - the widening stays in here.
 *
 * The spread keeps everything else, and that is the point: the bridge rewrites
 * the panel's payload on **every keystroke** in the teacher's editor, and the
 * teacher's own text must survive that (D-123).
 */
export const withPanelDraft = (
  content: PanelContent,
  draft: CodePanelDraft | null,
): PanelContent => {
  const widened: PanelContent & {
    draft?: CodePanelDraft;
  } = {
    ...content,
    draft: draft ?? undefined,
  };

  return widened;
};

/**
 * The element update that changes a panel's draft.
 *
 * In the same style as `panelViewUpdate`: the update is the payload with the
 * new draft in it, and it goes through `mutateElement`, so it is undoable like
 * every other change.
 */
export const panelDraftUpdate = (
  content: PanelContent,
  draft: CodePanelDraft,
): PanelViewUpdate => ({
  panel: withPanelDraft(content, draft),
});

/**
 * What the editor view **shows**, and where the text came from (D-123).
 *
 * The oracle for the panel's editor: the panel asks this, and the answer says
 * both the text and **which** it is - the mirror (the draft's starting point)
 * or the teacher's own draft.
 *
 * The rule: **a mirror never overwrites a draft the teacher has edited.**
 */
export const panelEditorText = (
  content: PanelContent,
  mirror: { text: string; language: string } | null,
): { text: string; language: string; source: "draft" | "mirror" } => {
  const draft = readPanelDraft(content);

  if (draft?.edited) {
    // the teacher's own text: the mirror never overwrites it (D-123)
    return {
      text: draft.text,
      language: draft.language || mirror?.language || "",
      source: "draft",
    };
  }

  if (mirror && mirror.text) {
    // the draft has not been touched, so the mirror is what it starts from
    return {
      text: mirror.text,
      language: draft?.language || mirror.language,
      source: "mirror",
    };
  }

  if (draft) {
    return { text: draft.text, language: draft.language, source: "draft" };
  }

  return { text: "", language: mirror?.language ?? "", source: "mirror" };
};

/**
 * Whether a panel is a code panel backed by a bridge session.
 *
 * A code panel with any other source is not a live mirror: it has no bridge to
 * mirror, so it shows nothing but its own state.
 */
export const isBridgeCodePanel = (panel: ExcalidrawPanelElement): boolean =>
  panel.panelKind === "code" && panel.panel.source.type === "bridge";

/**
 * The name of the file a code panel is mirroring.
 *
 * The bridge sends the mirrored editor's **uri** (D-51), and a uri is not a
 * name: it is `file:///home/sai/main.py`, or `file:///C:/work/main.py`, or
 * `untitled:Untitled-1`. What a VS Code tab says is the **last segment** of
 * it - and the panel has to say it too, or the code reads as a text box
 * (D-80).
 *
 * An empty uri means there is no file open, and the name is empty then.
 */
export const codePanelFileName = (uri: string): string => {
  const trimmed = uri.trim();

  if (!trimmed) {
    return "";
  }

  // a VS Code uri may carry a position ("main.py?line=12") - the position is
  // not part of the name
  const withoutPosition = trimmed.split(/[?#]/)[0];

  // the last segment of the path, on either separator
  const segments = withoutPosition.split(/[\\/]/).filter(Boolean);
  const last = segments[segments.length - 1] ?? "";

  // an unsaved file is "untitled:Untitled-1" - the scheme is not the name
  const withoutScheme = last.replace(/^[a-z][a-z0-9+.-]*:/i, "");

  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    // a malformed escape is still a name
    return withoutScheme;
  }
};

/**
 * The bounds of a new code panel's size, in scene units.
 *
 * A code panel is a **share of the visible canvas**, not a constant (D-80):
 * the owner asked for the editor's view to cover half the canvas, and half of
 * what the teacher can see is 990x1024 on a 1980x2048 screen. The bounds keep
 * the panel usable on a small screen and stop it from running off a big one.
 */
export const CODE_PANEL_MIN_WIDTH = 280;
export const CODE_PANEL_MAX_WIDTH = 1200;
export const CODE_PANEL_MIN_HEIGHT = 200;
export const CODE_PANEL_MAX_HEIGHT = 1200;

/**
 * The size of a **new** code panel, in scene units.
 *
 * The viewport is in pixels and the panel's size is in scene units, so the
 * zoom is divided out: the panel then covers half of the **screen** at any
 * zoom, which is what the owner asked for.
 */
export const codePanelSize = (
  viewport: { width: number; height: number },
  zoom: number,
): { width: number; height: number } => ({
  width: clamp(
    Math.round(viewport.width / (2 * zoom)),
    CODE_PANEL_MIN_WIDTH,
    CODE_PANEL_MAX_WIDTH,
  ),
  height: clamp(
    Math.round(viewport.height / (2 * zoom)),
    CODE_PANEL_MIN_HEIGHT,
    CODE_PANEL_MAX_HEIGHT,
  ),
});

/**
 * The code region's **minimum** height, in CSS pixels.
 *
 * The code is what the teacher reads. The chrome, the output region and the
 * console region share the panel with it, and they must never squeeze it out
 * (D-80).
 */
export const CODE_PANEL_EDITOR_MIN_HEIGHT = 120;

/**
 * The flex contract of a code panel's three regions.
 *
 * The editor **grows** into the space the panel has and does **not shrink**
 * below its minimum height; the output and the console shrink (and scroll)
 * instead of taking the code's space (D-80).
 *
 * The contract is inline rather than in the stylesheet because it is a
 * **rule**, not a look: it is the thing a test can hold on to, and the two
 * cannot drift apart.
 */
export const CODE_PANEL_REGION_STYLE = {
  editor: { flex: "1 1 auto", minHeight: `${CODE_PANEL_EDITOR_MIN_HEIGHT}px` },
  output: { flex: "0 1 auto" },
  console: { flex: "0 1 auto" },
} as const;

/**
 * Where a **video** panel's content comes from.
 *
 * The payload's own `source` says it: a **file** in the document's store. A
 * local video is such a file, and a YouTube video becomes one too — the
 * bridge fetches it and the app stores it, so the panel is the same panel
 * either way, and the only thing that differs is where the **captions** come
 * from: a sidecar next to the file, or the bridge.
 *
 * And a video too big to travel in the document names **media** instead (D-95):
 * the bytes stay in the host's media store and the payload carries a short id.
 */
export type VideoPanelSource = PanelSource;

/**
 * The video's format, in the words a teacher would use.
 *
 * `video/x-matroska` is "matroska", `video/mp4` is "mp4". It is read off the
 * media type and not off a list of "good" extensions: the browser's own
 * verdict is the oracle (D-97), and this only names what it rejected.
 */
export const videoFormatName = (mimeType: string) => {
  const subtype = mimeType.split("/")[1] ?? mimeType;

  return subtype.replace(/^x-/, "");
};

/**
 * The live state of a **video panel**.
 *
 * Plain data and nothing else: it rides inside the element's payload, so it
 * has to survive `JSON.stringify` and a structured clone (D-46).
 */
export type VideoPanelState = {
  /**
   * Every caption track the video carries.
   *
   * A sidecar gives one; YouTube gives several. The **active** one — the one
   * the player shows and the one the caption text follows — is the payload's
   * `options.captions`, which is the home the foundation already defines for a
   * panel's caption track.
   */
  tracks: PanelCaptionTrack[];
  /** the language of the active track */
  language: string;
  /** the playback position, in milliseconds */
  timeMs: number;
  /** whether the video is playing */
  playing: boolean;
};

/**
 * The payload of a video panel.
 *
 * `PanelContent` (in `@excalidraw/element`) declares the payload's `source`
 * and `options`; the video panel's own live state is a third thing, and the
 * element type lives outside this wave's scope, so the widening happens here,
 * in one place — the same rule the code panel follows.
 *
 * The `source` of a **media-backed** panel names the media variant (D-95),
 * which `PanelContent` cannot: the element type lives in `@excalidraw/element`,
 * outside this wave's scope, so that widening happens here too.
 * `panelSource()` is the only way to **read** a panel's source back, and it
 * returns the widened union.
 */
export type VideoPanelContent = PanelContent & {
  /** the video panel's live state, or null when the panel has none yet */
  video: VideoPanelState | null;
};

/**
 * The payload of a video panel.
 *
 * The caption **track** rides in `options.captions` — the foundation's own
 * home for a panel's caption track — and the **active** track is the one whose
 * language the state names.
 */
export const videoPanelContent = ({
  source,
  tracks = [],
  language = "en",
  timeMs = 0,
  playing = false,
  naturalWidth = null,
  naturalHeight = null,
}: {
  source: VideoPanelSource;
  tracks?: PanelCaptionTrack[];
  language?: string;
  timeMs?: number;
  playing?: boolean;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
}): VideoPanelContent => {
  const active =
    tracks.find((track) => track.language === language) ?? tracks[0] ?? null;

  return {
    // The payload's `source` type is declared by `@excalidraw/element`, and it
    // cannot name the **media** variant (D-95) — the element type is outside
    // this wave's scope. So the widening is paid for HERE, in one place, and
    // `panelSource()` is the only way to read the source back.
    source: source as PanelContent["source"],
    options: {
      naturalWidth,
      naturalHeight,
      captions: active,
    },
    video: {
      tracks,
      language: active?.language ?? language,
      timeMs,
      playing,
    },
  };
};

/**
 * The live state of a video panel's payload, or null when the payload carries
 * none.
 *
 * The only way to read it — the widening stays in here.
 */
export const readVideoPanelState = (
  content: PanelContent,
): VideoPanelState | null => {
  const widened: Partial<VideoPanelContent> = content;

  return widened.video ?? null;
};

/**
 * The same payload with a new live state in it.
 *
 * The only way to write it — the widening stays in here.
 */
export const withVideoPanelState = (
  content: PanelContent,
  state: VideoPanelState | null,
): PanelContent => {
  const widened: VideoPanelContent = { ...content, video: state };

  return widened;
};

/**
 * A **YouTube** panel's source (D-128).
 *
 * The panel holds a **video id** — not a URL, and not a copy of YouTube's page.
 * The id is the only thing YouTube's own player needs, and the embed URL is
 * built from it in {@link youtubeEmbedUrl}: one place, and nothing of ours
 * talks to their pages, so nothing of ours can rot.
 */
export type YoutubePanelSource = {
  type: "youtube";
  /** the YouTube video id */
  videoId: string;
};

/**
 * Which **tier** answered the caption request (D-129).
 *
 * The captions are the fragile half of the YouTube path, so they degrade in
 * tiers — and the tier travels with the answer, so the panel can say which
 * one it is and the teacher is never left guessing why a video has no text.
 *
 * The library does not fetch anything: the **host** asks the bridge, and the
 * bridge answers with one of these.
 */
export type PanelCaptionTier = "api" | "public" | "none";

/**
 * The live state of a **YouTube** panel (D-129).
 *
 * The **cues** are not here: they ride in the payload's own homes —
 * `options.captions` for the active track and `video.tracks` for every track —
 * exactly as they do for a local video, because the panel does not know where
 * the cues came from. What is here is only what the panel has to **say**: which
 * tier answered, and why there are none when there are none.
 */
export type YoutubePanelState = {
  /** which tier answered (D-129) */
  tier: PanelCaptionTier | null;
  /** why there are no captions, when there are none (D-129) */
  reason: string | null;
};

/**
 * The payload of a **YouTube** panel.
 *
 * A YouTube panel **is** a video panel — it is the same panel with a different
 * source — so the caption track rides in the same homes and the caption shape
 * does not change at all. Only the tier is added, because only the tier is new.
 */
export type YoutubePanelContent = VideoPanelContent & {
  /** which tier answered, and why there are none when there are none (D-129) */
  youtube: YoutubePanelState | null;
};

/**
 * The **embed URL** of a YouTube video (D-128).
 *
 * The one place the URL is built. An iframe of YouTube's own player is the
 * **supported** way to play a YouTube video in a web page: there is no
 * endpoint to call, no markup to parse and no signature to compute, so the
 * video keeps working when YouTube changes anything.
 */
export const youtubeEmbedUrl = (videoId: string): string =>
  `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;

/**
 * The payload of a **YouTube** panel.
 *
 * The caption track rides in `options.captions` — the foundation's own home for
 * a panel's caption track — and the **active** track is the one whose language
 * the state names. The tier rides beside it, and the tier is the only thing
 * the panel has to say about where the cues came from (D-129).
 */
export const youtubePanelContent = ({
  videoId,
  tracks = [],
  language = "en",
  tier = null,
  reason = null,
  naturalWidth = 640,
  naturalHeight = 360,
}: {
  /** the YouTube video id — the only thing the panel holds (D-128) */
  videoId: string;
  tracks?: PanelCaptionTrack[];
  language?: string;
  /** which tier answered (D-129) */
  tier?: PanelCaptionTier | null;
  /** why there are no captions, when there are none (D-129) */
  reason?: string | null;
  naturalWidth?: number | null;
  naturalHeight?: number | null;
}): YoutubePanelContent => {
  const base = videoPanelContent({
    source: { type: "youtube", videoId },
    tracks,
    language,
    naturalWidth,
    naturalHeight,
  });

  return { ...base, youtube: { tier, reason } };
};

/**
 * The live state of a YouTube panel's payload, or null when the payload carries
 * none.
 *
 * The only way to read it — the widening stays in here.
 */
export const readYoutubePanelState = (
  content: PanelContent,
): YoutubePanelState | null => {
  const widened: Partial<YoutubePanelContent> = content;

  return widened.youtube ?? null;
};

/**
 * The same payload with a new live state in it.
 *
 * The only way to write it — the widening stays in here.
 */
export const withYoutubePanelState = (
  content: PanelContent,
  state: YoutubePanelState | null,
): PanelContent => {
  const widened: YoutubePanelContent = {
    ...content,
    // the video state is kept as it is - a YouTube panel is a video panel, and
    // the caption track lives in its own homes
    video: readVideoPanelState(content),
    youtube: state,
  };

  return widened;
};

/**
 * The binding between a video panel and the **text element** its captions are
 * written into.
 *
 * It names both elements and the language of the track it follows, so the
 * binding is enough on its own to keep the two in step — after a page switch,
 * after a reload, and in the presenter, which is a second Excalidraw instance
 * that gets the document and nothing else.
 */
export type CaptionBinding = {
  /** the id of the text element the captions are written into */
  elementId: string;
  /** the id of the video panel the captions belong to */
  panelId: string;
  /** the language of the track the binding follows */
  language: string;
};

/**
 * A panel element that carries a caption binding.
 *
 * ## WHY THE BINDING IS HERE AND NOT IN THE PANEL'S PAYLOAD
 *
 * The payload (`panel.panel`) is the panel's **own content**: its source, its
 * native size and its caption track. It is plain data and it travels — through
 * `postMessage` to the presenter, and through the document's own file. The
 * binding is not content: it is a **relationship between two elements** of the
 * document, the panel and the text element beside it, and it points at an
 * element that is not the panel.
 *
 * So it lives on the panel **element**, beside the payload — next to
 * `posterMode` and `posterFileId`, which are the foundation's own
 * element-level facts — and not inside the payload. The element type lives in
 * `@excalidraw/element`, outside this wave's scope, so the widening happens
 * here, in one place, and every reader goes through `readCaptionBinding()`.
 *
 * The element is **not** part of the payload, and it still survives a reload:
 * the document's own element list is the scene, and an element's own fields
 * travel with it (`restoreElement` keeps the properties it does not know, for
 * forward compatibility).
 */
export type CaptionBoundPanel = ExcalidrawPanelElement & {
  captionBinding?: CaptionBinding | null;
};

/**
 * The caption binding of a panel, or null when the panel has none.
 *
 * The only way to read it — the widening stays in here.
 */
export const readCaptionBinding = (
  panel: ExcalidrawPanelElement,
): CaptionBinding | null => {
  const widened: CaptionBoundPanel = panel;

  return widened.captionBinding ?? null;
};

/**
 * The element update that gives a panel a caption binding (or takes it away).
 *
 * The only way to write it — the widening stays in here.
 */
export const captionBindingUpdate = (
  binding: CaptionBinding | null,
): { captionBinding: CaptionBinding | null } => ({
  captionBinding: binding,
});

/**
 * The **playback position** of a panel whose content is time-based — a video.
 *
 * It is state that has to be **shared**: the editor plays the video, and the
 * presenter (a second Excalidraw instance) has to show the same video at the
 * same position (D-57).
 *
 * The position is in **seconds**, because that is what the `<video>` element
 * speaks.
 */
export type PanelPlayback = {
  /** the position, in seconds */
  time: number;
  /** whether the content is playing */
  playing: boolean;
};

/**
 * A panel element that carries a playback position.
 *
 * ## WHY THE PLAYBACK IS HERE AND NOT IN THE PANEL'S PAYLOAD
 *
 * The payload is the panel's **own content**; the playback is not content, it is
 * the **state of the content right now**, and it changes while the teacher
 * teaches. It rides on the element, beside the payload, for the same reason the
 * caption binding does (D-54): the element type lives in `@excalidraw/element`,
 * outside this wave's scope, so the widening happens here, in one place, and
 * every reader goes through `readPanelPlayback()`.
 *
 * The element is not part of the payload, and it still survives a reload and a
 * trip to the presenter: `restoreElement` keeps the properties it does not know.
 */
export type PlaybackPanel = ExcalidrawPanelElement & {
  playback?: PanelPlayback | null;
};

/**
 * The playback position of a panel, or null when the panel carries none.
 *
 * The only way to read it — the widening stays in here.
 */
export const readPanelPlayback = (
  panel: ExcalidrawPanelElement,
): PanelPlayback | null => {
  const widened: PlaybackPanel = panel;

  return widened.playback ?? null;
};

/**
 * The element update that gives a panel a playback position (or takes it away).
 *
 * The only way to write it — the widening stays in here.
 */
export const panelPlaybackUpdate = (
  playback: PanelPlayback | null,
): { playback: PanelPlayback | null } => ({
  playback,
});

/**
 * A **video panel** element: the payload carries the video's own state, and the
 * element carries the caption binding and the playback position.
 *
 * Both widenings live here, in one place, because the element type itself
 * lives in `@excalidraw/element` — outside this wave's scope.
 */
export type VideoPanelElement = CaptionBoundPanel &
  PlaybackPanel & {
    panel: VideoPanelContent;
  };
