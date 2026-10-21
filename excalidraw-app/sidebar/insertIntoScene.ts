import {
  FONT_FAMILY,
  getFontString,
  getLineHeight,
  randomId,
} from "@excalidraw/common";
import {
  newElement,
  newImageElement,
  newTextElement,
} from "@excalidraw/element";
import { reconcileElements, stampCurrentPage } from "@excalidraw/excalidraw";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";

import type { ClipboardData } from "@excalidraw/excalidraw/clipboard";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type {
  AppState,
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { codeCardColumns, highlightCode, layoutCode } from "./codeCard";

/**
 * Appends freshly created elements to the scene. `reconcileElements` is what
 * assigns the fractional ordering indices, so freshly built elements (which
 * start with `index: null`) have to go through it.
 */
const appendElements = (
  api: ExcalidrawImperativeAPI,
  added: readonly ExcalidrawElement[],
  appState?: { selectedElementIds: AppState["selectedElementIds"] },
) => {
  const existing = api.getSceneElements();

  // Pages: content inserted into the live scene belongs to the page the user is
  // acting on. The element factories cannot know it — `newImageElement()` and
  // friends default to the first page — so it is stamped here, through the same
  // helper the library's own insertion paths use. Without it, an image (or a
  // code card) inserted while a later page was active landed on page 1 and was
  // invisible on the canvas even though it was in the document.
  const stamped = stampCurrentPage(added, api.getAppState().currentPageId);

  api.updateScene({
    elements: reconcileElements(
      existing,
      [...existing, ...stamped] as RemoteExcalidrawElement[],
      api.getAppState(),
    ),
    appState,
  });
};

/** max on-canvas edge length for an inserted image */
const MAX_IMAGE_SIZE = 460;

const CODE_FONT_SIZE = 16;
const CODE_MAX_CHARS = 76;
const CODE_PADDING = 18;

const CODE_BG = "#1e1e1e";
const CODE_BORDER = "#3c3c3c";
const CODE_TEXT = "#e6edf3";

/**
 * The drawing surface as the scene maths needs to see it.
 *
 * `left` / `top` / `width` / `height` are the canvas' on-screen box, and
 * `scrollX` / `scrollY` / `zoom` come straight from `AppState`.
 */
export type ViewportFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
};

/** the sidebar box, which is an overlay on top of the canvas */
const SIDEBAR_SELECTOR = ".sidebar";

/**
 * How much of the canvas a floating panel hides, in CSS px, measured inward
 * from each edge of the canvas box.
 *
 * The sidebar is an *overlay*: it does not shrink the canvas wrapper, it sits
 * on top of it. So the geometric middle of the canvas is not the middle of
 * what the user can see — with a 302px sidebar over a 640px window, the real
 * centre is barely inside the visible strip. The page camera already knows
 * this (`getPageViewportWidth` in `useSidebarLayout.ts`), but inserts were
 * still centred on the raw box, which is why "Insert into canvas" appeared to
 * do nothing: the image landed underneath the panel.
 */
export type ViewportCover = {
  /** hidden band along the canvas' left edge */
  left: number;
  /** hidden band along the canvas' right edge */
  right: number;
};

/** no panel is covering the canvas */
export const NO_COVER: ViewportCover = { left: 0, right: 0 };

/**
 * Viewport -> scene, mirroring the library's `viewportCoordsToSceneCoords`
 * exactly:
 *
 *     sceneX = (clientX - originLeft) / zoom - scrollX
 *
 * The zoom **divides** and the scroll **subtracts**. This file previously had
 * the pre-pages convention instead (`* zoom + scroll`), and the two errors
 * compound in the same direction: on a 1920-wide page at 55% zoom, a drop in
 * the middle of the canvas resolved roughly 570 scene px short of where it
 * should have — enough to land the image in the far corner of the page rather
 * than under the pointer.
 */
export const viewportToScene = (
  { clientX, clientY }: { clientX: number; clientY: number },
  frame: ViewportFrame,
): ScenePoint => ({
  x: (clientX - frame.left) / frame.zoom - frame.scrollX,
  y: (clientY - frame.top) / frame.zoom - frame.scrollY,
});

/**
 * The middle of what is actually *visible*, in scene coordinates.
 *
 * Without a `cover` this is the middle of the canvas box, which is what a
 * docked or closed sidebar wants. With one, it is the middle of the free strip
 * — the reason an insert stops disappearing behind the panel.
 */
export const viewportCenterScene = (
  frame: ViewportFrame,
  cover?: ViewportCover,
): ScenePoint => {
  const left = Math.max(0, cover?.left ?? 0);
  const right = Math.max(0, cover?.right ?? 0);
  const freeWidth = Math.max(0, frame.width - left - right);

  return {
    x: (left + freeWidth / 2) / frame.zoom - frame.scrollX,
    y: frame.height / 2 / frame.zoom - frame.scrollY,
  };
};

/**
 * Measures how much of the canvas the open sidebar is sitting on top of.
 *
 * Deliberately geometric and DOM-derived rather than read from app state: the
 * library tracks the width for its own camera maths, but the *overlap* only
 * exists once the box has been laid out. Clipping to the canvas box keeps a
 * sidebar wider than the canvas, or one that hangs off the edge, from claiming
 * more than it hides. Which edge it hides comes from where its midpoint falls,
 * so a right-to-left layout is handled by the same code.
 */
export const readCover = (
  canvas: HTMLElement | null,
  root: ParentNode | null = typeof document === "undefined" ? null : document,
): ViewportCover => {
  const sidebar = root?.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

  if (!canvas || !sidebar) {
    return NO_COVER;
  }

  const canvasRect = canvas.getBoundingClientRect();
  const sidebarRect = sidebar.getBoundingClientRect();

  const overlapX =
    Math.min(canvasRect.right, sidebarRect.right) -
    Math.max(canvasRect.left, sidebarRect.left);
  const overlapY =
    Math.min(canvasRect.bottom, sidebarRect.bottom) -
    Math.max(canvasRect.top, sidebarRect.top);

  // no horizontal or vertical intersection: the panel is beside the canvas
  // (docked) or fully off it (animating out), so it hides nothing
  if (overlapX <= 0 || overlapY <= 0) {
    return NO_COVER;
  }

  const hidden = Math.min(overlapX, canvasRect.width);
  const coversLeft =
    sidebarRect.left + sidebarRect.width / 2 <
    canvasRect.left + canvasRect.width / 2;

  return coversLeft ? { left: hidden, right: 0 } : { left: 0, right: hidden };
};

/**
 * Reads the frame from the *live* canvas rect rather than
 * `appState.offsetLeft/offsetTop`, because a persisted appState can still be
 * showing the previous session's size on a fresh mount — the same staleness
 * that used to desync the presenter.
 */
const readFrame = (
  api: ExcalidrawImperativeAPI,
  canvas: HTMLCanvasElement | null,
): ViewportFrame => {
  const { scrollX, scrollY, zoom, width, height, offsetLeft, offsetTop } =
    api.getAppState();
  const rect = canvas?.getBoundingClientRect();

  return {
    left: rect ? rect.left : offsetLeft,
    top: rect ? rect.top : offsetTop,
    width: rect ? rect.width : width,
    height: rect ? rect.height : height,
    scrollX,
    scrollY,
    zoom: zoom.value,
  };
};

/**
 * Top-left of something `width` x `height` big, centred on what the user is
 * currently looking at.
 *
 * This is the *default* placement only. An explicit drop or click point is
 * user-authoritative and is passed straight through by `insertImageIntoScene`.
 */
const viewportCenter = (
  api: ExcalidrawImperativeAPI,
  width: number,
  height: number,
) => {
  const canvas = findCanvas();
  const center = viewportCenterScene(readFrame(api, canvas), readCover(canvas));

  return { x: center.x - width / 2, y: center.y - height / 2 };
};

const getImageSize = (src: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("could not decode image"));
    image.src = src;
  });

/** a position in scene coordinates */
export type ScenePoint = { x: number; y: number };

export const insertImageIntoScene = async (
  api: ExcalidrawImperativeAPI,
  file: File,
  /** where the image should land, by its centre. Defaults to the viewport centre. */
  at?: ScenePoint,
) => {
  const dataURL = await getDataURL(file);
  const fileId = await generateIdFromFile(file);
  const natural = await getImageSize(dataURL);
  const ratio = Math.min(
    1,
    MAX_IMAGE_SIZE / Math.max(natural.width, natural.height),
  );

  const width = Math.max(1, natural.width * ratio);
  const height = Math.max(1, natural.height * ratio);
  const { x, y } = at
    ? { x: at.x - width / 2, y: at.y - height / 2 }
    : viewportCenter(api, width, height);

  const image = newImageElement({
    type: "image",
    x,
    y,
    width,
    height,
    fileId,
  });

  const now = Date.now();
  api.addFiles([
    {
      id: fileId,
      mimeType: (file.type || "image/png") as BinaryFileData["mimeType"],
      dataURL,
      created: now,
      lastRetrieved: now,
      version: 1,
    },
  ]);

  appendElements(api, [image]);
};

/**
 * "Click a file, click the canvas" is the clipboard flow, but the clipboard
 * is not always reachable: Chromium gates it behind permissions and a secure
 * context, and it is absent altogether under some embedders. So the selected
 * image is *also* stashed here in module state, and the canvas listener below
 * pastes from the stash. Copying is best-effort and never throws — failing to
 * reach the clipboard must not break the list the user is clicking through.
 */

let pendingPaste: File | null = null;
let detachCanvasPaste: (() => void) | null = null;

/** the image waiting for the next canvas click, if any */
export const pendingImagePaste = () => pendingPaste;

/** forgets the stashed image and stops listening for a paste */
export const cancelImagePaste = () => {
  pendingPaste = null;

  if (detachCanvasPaste) {
    detachCanvasPaste();
    detachCanvasPaste = null;
  }
};

/** best-effort image copy; resolves false when the clipboard refused */
export const copyImageToClipboard = async (file: File) => {
  try {
    const clipboard = navigator?.clipboard;
    const ClipboardItemCtor = globalThis.ClipboardItem;

    if (!clipboard?.write || !ClipboardItemCtor) {
      return false;
    }

    // the declared type has to match the blob's own, or the write throws
    const type = file.type || "image/png";

    await clipboard.write([new ClipboardItemCtor({ [type]: file })]);

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

/**
 * The canvas we listen on.
 *
 * The order matters and was the second bug: Excalidraw renders several
 * `canvas.excalidraw__canvas` elements, and the **first** one in the document
 * is the static canvas, which carries `.static` and is `pointer-events: none`.
 * A `pointerdown` listener on it can never fire, so the click-to-paste flow was
 * silently dead. Only `.interactive` actually receives pointer input.
 *
 * All of them share the same box, so the rect stays a valid coordinate origin
 * whichever one we get.
 */
const findCanvas = () =>
  document.querySelector<HTMLCanvasElement>(
    "canvas.excalidraw__canvas.interactive",
  ) ??
  document.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas") ??
  document.querySelector<HTMLCanvasElement>(".excalidraw canvas");

/** pointer coordinates -> scene coordinates, without pulling in the library's helper */
const clientPointToScene = (
  api: ExcalidrawImperativeAPI,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): ScenePoint => viewportToScene({ clientX, clientY }, readFrame(api, canvas));

/**
 * Stashes `file` and arms a single canvas click to paste it where it was
 * clicked. The listener sits in the capture phase so it wins over the pointer
 * handlers Excalidraw installs itself, and it detaches itself before doing any
 * async work — a double click pastes once. Returns the cancel function, which
 * the caller must also run on unmount so a stale click can't paste later.
 */
export const armImagePasteOnCanvas = (
  api: ExcalidrawImperativeAPI,
  file: File,
  /** run once the stash has been consumed, so the caller can drop its hint */
  onConsumed?: () => void,
) => {
  cancelImagePaste();

  pendingPaste = file;

  const canvas = findCanvas();

  if (!canvas) {
    // no canvas (yet) — keep the stash so the button can still insert it
    return cancelImagePaste;
  }

  const onPointerDown = (event: PointerEvent) => {
    // consume first: whatever happens next, this stash is spent
    const stashed = pendingPaste;

    cancelImagePaste();

    if (!stashed) {
      return;
    }

    onConsumed?.();

    insertImageIntoScene(
      api,
      stashed,
      clientPointToScene(api, canvas, event.clientX, event.clientY),
    ).catch((error) => {
      console.error(error);
      api.setToast?.({
        message: `Could not paste ${stashed.name}`,
        closable: true,
      });
    });
  };

  canvas.addEventListener("pointerdown", onPointerDown, true);
  detachCanvasPaste = () =>
    canvas.removeEventListener("pointerdown", onPointerDown, true);

  return cancelImagePaste;
};

/**
 * Dragging a row is the same flow as clicking one, minus the clipboard: the
 * file is stashed, the canvas accepts the release, and the image lands under the
 * pointer. The listeners sit on `window` in the capture phase, which puts them
 * ahead of the library's own React `onDrop` on `.excalidraw` — React delegates
 * to the root container, so stopping propagation here means `handleAppOnDrop`
 * never sees the event and there is exactly one insertion path.
 *
 * The listeners live on `window` rather than the canvas because the canvas is
 * not guaranteed to be the drag's hit target (overlay layers sit above it),
 * so acceptance is decided geometrically instead.
 */

/** private mime type, so the drag starts without advertising a real file */
export const DRAG_MIME = "application/x-excalidraw-app-sidebar-file";

let pendingDrag: File | null = null;
let detachCanvasDrop: (() => void) | null = null;

/** the image being dragged over the canvas, if any */
export const pendingImageDrag = () => pendingDrag;

/** forgets the dragged image and stops listening for the release */
export const cancelImageDrag = () => {
  pendingDrag = null;

  if (detachCanvasDrop) {
    detachCanvasDrop();
    detachCanvasDrop = null;
  }
};

export type DropAcceptance = {
  clientX: number;
  clientY: number;
  rect: { left: number; top: number; right: number; bottom: number };
  /** the pointer is over the sidebar, which floats above the canvas */
  overSidebar: boolean;
};

/**
 * Whether a drop at these coordinates should insert. The sidebar overlaps the
 * canvas, so being inside the canvas rect is not enough — a release over the
 * sidebar is a cancelled drag, not an insert behind the panel.
 */
export const acceptsDrop = ({
  clientX,
  clientY,
  rect,
  overSidebar,
}: DropAcceptance) =>
  !overSidebar &&
  clientX >= rect.left &&
  clientX <= rect.right &&
  clientY >= rect.top &&
  clientY <= rect.bottom;

const isOverSidebar = (event: Event) => {
  const target = event.target;
  return target instanceof Element && !!target.closest(SIDEBAR_SELECTOR);
};

/**
 * Stashes `file` for a single drag. `dragover` is only prevented over the
 * canvas, which is also what makes the copy cursor appear there and nowhere
 * else; everywhere else the browser ends the drag on its own. Returns the
 * cancel function, which the caller must also run when the drag ends so a
 * release outside the canvas can't leave the stash armed.
 */
export const armImageDragOnCanvas = (
  api: ExcalidrawImperativeAPI,
  file: File,
  /** run once the stash has been consumed, so the caller can drop its hint */
  onConsumed?: () => void,
) => {
  cancelImageDrag();

  pendingDrag = file;

  const canvas = findCanvas();

  if (!canvas) {
    // no canvas to drop onto — keep the stash so nothing half-armed survives
    pendingDrag = null;
    return cancelImageDrag;
  }

  const accepted = (event: DragEvent) => {
    const rect = canvas.getBoundingClientRect();

    return acceptsDrop({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
      overSidebar: isOverSidebar(event),
    });
  };

  const onDragOver = (event: DragEvent) => {
    if (!pendingDrag || !accepted(event)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = (event: DragEvent) => {
    if (!pendingDrag || !accepted(event)) {
      // released somewhere we don't take it — `dragend` clears the stash
      return;
    }

    // consume first, so a stray second drop can't insert twice
    const stashed = pendingDrag;
    cancelImageDrag();

    event.preventDefault();
    event.stopPropagation();

    onConsumed?.();

    insertImageIntoScene(
      api,
      stashed,
      clientPointToScene(api, canvas, event.clientX, event.clientY),
    ).catch((error) => {
      console.error(error);
      api.setToast?.({
        message: `Could not add ${stashed.name}`,
        closable: true,
      });
    });
  };

  window.addEventListener("dragover", onDragOver, true);
  window.addEventListener("drop", onDrop, true);

  detachCanvasDrop = () => {
    window.removeEventListener("dragover", onDragOver, true);
    window.removeEventListener("drop", onDrop, true);
  };

  return cancelImageDrag;
};

/**
 * Soft-wraps source so the inserted block stays a sane width. Wrapping happens
 * here (rather than leaning on the text element) so the measured box matches
 * what actually gets rendered.
 */
const wrapCode = (code: string, maxChars: number) =>
  code
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .flatMap((line) => {
      if (line.length <= maxChars) {
        return [line];
      }

      const indent = line.match(/^\s*/)?.[0] ?? "";
      const words = line.trim().split(/\s+/);
      const wrapped: string[] = [];
      let current = indent;

      for (const word of words) {
        const candidate = current.trim()
          ? `${current} ${word}`
          : `${current}${word}`;
        if (current.trim() && candidate.length > maxChars) {
          wrapped.push(current);
          current = `${indent}${word}`;
        } else {
          current = candidate;
        }
      }
      wrapped.push(current);

      return wrapped;
    })
    .join("\n");

/**
 * The advance width of one character in the card's font.
 *
 * Measured with the same font string the editor renders with, so a run's width
 * is exactly `characters x advance` and the columns line up. A monospace face
 * keeps that true for every glyph, which is the whole reason the card is set in
 * one.
 */
const codeCharWidth = () => {
  const context = document.createElement("canvas").getContext("2d");

  if (!context) {
    return CODE_FONT_SIZE * 0.6;
  }

  context.font = getFontString({
    fontSize: CODE_FONT_SIZE,
    fontFamily: FONT_FAMILY.Cascadia,
  });

  return Math.max(context.measureText("M").width || 0, CODE_FONT_SIZE * 0.6);
};

/**
 * Inserts a snippet as a syntax-highlighted code card.
 *
 * The card is a rounded rectangle plus one small text element per run of
 * same-coloured characters, all in one group. It is deliberately *not* a single
 * text element: a text element has one style, so one element cannot colour a
 * keyword differently from the string it returns, which was the whole complaint.
 * And it is deliberately not an image either, so the code stays real text —
 * selectable, searchable and editable on the canvas.
 *
 * Highlighting is best-effort. An unknown language, or a snippet too large to
 * highlight, falls back to a plain monospace text element on the same card, so
 * there is always something to paste.
 *
 * Returns `true` when the card came out highlighted.
 */
export const insertCodeIntoScene = async (
  api: ExcalidrawImperativeAPI,
  rawCode: string,
  {
    fileName: _fileName,
    language,
    at,
  }: { fileName?: string; language?: string; at?: ScenePoint } = {},
) => {
  const lines = await highlightCode(rawCode, language);

  // one fresh group per card. This used to be `api.id`, which is the editor's
  // own fixed id: every card ever inserted shared it, so the second paste
  // silently joined the first group and the two resized as a single entity.
  const groupId = randomId();

  if (!lines) {
    // no colours available: one plain text element, wrapped the simple way
    const body = newTextElement({
      text: wrapCode(rawCode, CODE_MAX_CHARS),
      fontFamily: FONT_FAMILY.Cascadia,
      fontSize: CODE_FONT_SIZE,
      autoResize: true,
      textAlign: "left",
      verticalAlign: "top",
      strokeColor: CODE_TEXT,
      x: 0,
      y: 0,
      groupIds: [groupId],
    });

    placeCodeCard(api, [body], body.width, body.height, at, groupId);

    return false;
  }

  const rows = layoutCode(lines, { maxColumns: CODE_MAX_CHARS });
  const charWidth = codeCharWidth();
  const lineHeight = CODE_FONT_SIZE * getLineHeight(FONT_FAMILY.Cascadia);

  const runs: ExcalidrawTextElement[] = [];

  rows.forEach((row, rowIndex) => {
    for (const run of row) {
      if (!run.text) {
        continue;
      }

      runs.push(
        newTextElement({
          text: run.text,
          fontFamily: FONT_FAMILY.Cascadia,
          fontSize: CODE_FONT_SIZE,
          autoResize: true,
          textAlign: "left",
          verticalAlign: "top",
          strokeColor: run.color,
          x: run.column * charWidth,
          y: rowIndex * lineHeight,
          groupIds: [groupId],
        }),
      );
    }
  });

  if (!runs.length) {
    return false;
  }

  const contentWidth = codeCardColumns(rows) * charWidth;
  const contentHeight = rows.length * lineHeight;

  placeCodeCard(api, runs, contentWidth, contentHeight, at, groupId);

  return true;
};

/**
 * Puts the card frame behind the text and drops the whole group where the user
 * asked for it, or in the middle of what they can see.
 */
const placeCodeCard = (
  api: ExcalidrawImperativeAPI,
  runs: ExcalidrawTextElement[],
  contentWidth: number,
  contentHeight: number,
  at: ScenePoint | undefined,
  groupId: string,
) => {
  const card = newElement({
    type: "rectangle",
    x: -CODE_PADDING,
    y: -CODE_PADDING,
    width: contentWidth + CODE_PADDING * 2,
    height: contentHeight + CODE_PADDING * 2,
    strokeColor: CODE_BORDER,
    backgroundColor: CODE_BG,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: { type: 3 },
    groupIds: [groupId],
  });

  // top-left of the card: an explicit point is the user's, anything else
  // centres on what they can see (and clear of the sidebar)
  const origin = at
    ? { x: at.x - card.width / 2, y: at.y - card.height / 2 }
    : viewportCenter(api, card.width, card.height);

  const placed = [card, ...runs].map((element) => ({
    ...element,
    x: element.x + origin.x - card.x,
    y: element.y + origin.y - card.y,
  }));

  appendElements(api, placed, {
    selectedElementIds: { [runs[0].id]: true },
  });
};

export const CODE_CARD_PADDING = CODE_PADDING;

/**
 * Copying code and pasting it into Excalidraw normally lands as a plain text
 * element: the clipboard only ever carried the source text, and the library's
 * paste path has no way to know it was code. So the source is stashed here as
 * well, and the next paste becomes the *same code card* the Insert button
 * builds — monospace, on its dark background, soft-wrapped to a sane width.
 *
 * The decision is made **inside the library's paste path** (`props.onPaste`),
 * not in a DOM listener. The context menu's Paste (`actionPaste`) fires no DOM
 * `paste` event at all — it calls `app.pasteFromClipboard(...)` directly — so
 * a listener only ever saw the keyboard paste, and the right-click paste came
 * out as plain text boxes. `pasteFromClipboard` is the one funnel both paths
 * go through, so the hook covers both.
 *
 * The plain-text copy on the clipboard is left completely alone, so pasting
 * into a code editor, Word or a chat still gets ordinary text.
 */

type StashedCode = {
  code: string;
  fileName?: string;
  language?: string;
  /** the editor the card is inserted into */
  api: ExcalidrawImperativeAPI;
  /** run once the stash has been consumed, so the caller can drop its hint */
  onConsumed?: () => void;
};

let pendingCode: StashedCode | null = null;
let detachCodePaste: (() => void) | null = null;
/** where the pointer was, so the card lands under the cursor */
let lastPointer: { clientX: number; clientY: number } | null = null;

/** the code waiting for the next paste, if any */
export const pendingCodePaste = () => pendingCode;

/** forgets the stashed code and stops listening for the pointer */
export const cancelCodePaste = () => {
  pendingCode = null;
  lastPointer = null;

  if (detachCodePaste) {
    detachCodePaste();
    detachCodePaste = null;
  }
};

/**
 * Stashes `code` and turns the next paste on the canvas into a code card.
 * Returns the cancel function, which the caller must also run on unmount so a
 * later paste can't insert code nobody asked for.
 */
export const armCodePasteOnCanvas = (
  api: ExcalidrawImperativeAPI,
  code: string,
  {
    fileName,
    language,
    onConsumed,
  }: {
    fileName?: string;
    language?: string;
    onConsumed?: () => void;
  } = {},
) => {
  cancelCodePaste();

  if (!code) {
    return cancelCodePaste;
  }

  pendingCode = { code, fileName, language, api, onConsumed };

  // where the pointer is at paste time, so the card lands under the cursor
  // the way a native paste does rather than in the middle of the view. The
  // context menu's paste builds a synthetic event whose clientX/clientY are
  // 0, so the pointer has to be tracked here rather than read off the event.
  const onPointerMove = (event: PointerEvent) => {
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
  };

  window.addEventListener("pointermove", onPointerMove, true);

  detachCodePaste = () => {
    window.removeEventListener("pointermove", onPointerMove, true);
  };

  return cancelCodePaste;
};

/**
 * Whether the clipboard still holds the stashed code.
 *
 * The library trims the text it reads out of the clipboard, so both sides are
 * compared trimmed. The user may have copied something else since the code was
 * armed, and that paste is an ordinary one.
 */
const clipboardHoldsCode = (stashed: StashedCode, data: ClipboardData) =>
  typeof data.text === "string" && data.text.trim() === stashed.code.trim();

/**
 * The app's `onPaste` hook.
 *
 * The library calls this from `pasteFromClipboard` — the one funnel the
 * keyboard paste and the context menu's paste both go through — so the armed
 * code arrives as a code card however it was pasted. Returning `false` means
 * "handled it": the library then does not insert the plain text.
 */
export const handleCodePaste = async (
  data: ClipboardData,
  event: ClipboardEvent | null,
): Promise<boolean> => {
  const stashed = pendingCode;

  if (!stashed) {
    // nothing armed: an ordinary paste
    return true;
  }

  if (!clipboardHoldsCode(stashed, data)) {
    // the clipboard holds something else now: an ordinary paste
    return true;
  }

  // the pointer is read before the stash is dropped
  const pointer = lastPointer;

  // consume first: whatever happens next, this stash is spent
  cancelCodePaste();

  // the library calls `event?.preventDefault()` only *after* this hook, and it
  // returns early when the hook says false — so the browser's own paste has to
  // be stopped here.
  event?.preventDefault();

  stashed.onConsumed?.();

  const canvas = findCanvas();

  if (!canvas) {
    return false;
  }

  // highlighting is async, so the card appears a moment later — and falls
  // back to the editable text card if this snippet cannot be highlighted
  void insertCodeIntoScene(stashed.api, stashed.code, {
    fileName: stashed.fileName,
    language: stashed.language,
    at: pointer
      ? clientPointToScene(
          stashed.api,
          canvas,
          pointer.clientX,
          pointer.clientY,
        )
      : undefined,
  });

  return false;
};
