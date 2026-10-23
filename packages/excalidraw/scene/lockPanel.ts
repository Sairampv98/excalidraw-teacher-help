/**
 * The **lock transition** of a panel: live → poster → live.
 *
 * Locking a panel freezes its content into a poster image, so the panel stops
 * being a live surface and becomes an ordinary picture on the canvas. The
 * transition is **reversible**: the live payload is never discarded, so
 * unlocking restores the panel exactly as it was.
 *
 * ## The one rule that matters
 *
 * A poster is captured at the content's **native** resolution — the size the
 * content itself has — and **not** at the size the panel happens to be
 * displayed at on the canvas. A panel shown at 400×300 whose host renders it
 * at 1920×1080 must produce a 1920×1080 poster; a poster taken from the
 * on-canvas size is a thumbnail, and a thumbnail is not a poster.
 *
 * This module is **pure**: it computes the poster's specification and the
 * element updates. Capturing the pixels is the host's job, because only the
 * host knows how its content is rendered (a video's current frame, an
 * editor's own renderer, a chart's exporter) — see `panelCapture()`.
 */

import type { FileId } from "@excalidraw/element/types";
import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import { panelNativeSize } from "./panelContent";

import type { BinaryFiles } from "../types";

/**
 * What a poster image must be: its pixel size and its media type.
 *
 * The size is the content's **native** size.
 */
export type PanelPosterSpec = {
  /** the poster's pixel width — the content's native width */
  width: number;
  /** the poster's pixel height — the content's native height */
  height: number;
  /** the media type the poster is stored as */
  mimeType: string;
};

/** The media type a poster is stored as. */
export const PANEL_POSTER_MIME_TYPE = "image/png";

/** The element update that turns a live panel into a poster panel. */
export type PanelLockUpdate = {
  posterMode: true;
  posterFileId: FileId;
};

/** The element update that turns a poster panel back into a live one. */
export type PanelUnlockUpdate = {
  posterMode: false;
  posterFileId: null;
};

/**
 * The poster's specification for a panel.
 *
 * The size is the content's **native** size — `panel.options.naturalWidth` /
 * `naturalHeight` — and never the panel's on-canvas size. When the content's
 * native size is unknown, the panel's on-canvas size is the best available
 * answer.
 */
export const panelPosterSpec = (
  panel: ExcalidrawPanelElement,
  mimeType: string = PANEL_POSTER_MIME_TYPE,
): PanelPosterSpec => {
  const { width, height } = panelNativeSize(panel);

  return { width, height, mimeType };
};

/**
 * Whether a panel can be **frozen** into a poster (D-120).
 *
 * A poster is a **picture** of the panel's content, so the content has to be
 * something that can become a picture: a file in the document's own store (an
 * image) or a video the panel is showing - a video's poster is the frame the
 * teacher is looking at.
 *
 * A panel whose content lives in **another process** - a code panel, whose
 * content is the editor's own window - has no picture of its own to freeze, so
 * it cannot be locked.
 *
 * This is the rule the chrome asks **before** it draws the lock: a control
 * that cannot act must not be drawn, because a control that does nothing costs
 * the teacher a click and teaches them nothing (D-120).
 */
export const canLockPanel = (
  panel: ExcalidrawPanelElement,
  files: BinaryFiles,
): boolean => {
  const source = panel.panel.source;

  if (source.type !== "file") {
    return false;
  }

  if (!files[source.fileId]) {
    return false;
  }

  return (
    source.mimeType.startsWith("image/") || source.mimeType.startsWith("video/")
  );
};

/**
 * The element update that locks a panel.
 *
 * The poster's file id is the id of the file the poster was stored under; the
 * poster itself is an ordinary PNG in the document's own file store, which is
 * what keeps it inside the only channel that may carry it (D-65).
 */
export const panelLockUpdate = (posterFileId: FileId): PanelLockUpdate => ({
  posterMode: true,
  posterFileId,
});

/**
 * The element update that unlocks a panel.
 *
 * The live payload is left alone — it is never discarded — so unlocking
 * restores the panel exactly as it was.
 */
export const panelUnlockUpdate = (): PanelUnlockUpdate => ({
  posterMode: false,
  posterFileId: null,
});

/**
 * What a host must be able to produce to freeze a panel's content.
 *
 * `dataURL` is the poster's image; its pixel size is **not** taken from
 * here — the poster's size is the content's native size, which the panel
 * carries, so that a host cannot accidentally hand in a thumbnail.
 */
export type PanelCapture = {
  dataURL: string;
  mimeType?: string;
};

/**
 * The capture hook: how a host freezes its panel's content.
 *
 * The foundation wave ships the hook and the pure transition around it; each
 * per-kind wave supplies the capture for its own surface (a video's current
 * frame, an editor's own renderer, a chart's exporter).
 *
 * A capture that returns `null` means "this surface cannot be frozen yet" —
 * the panel stays live and the caller is told why.
 */
export type PanelCaptureFn = (
  panel: ExcalidrawPanelElement,
) => PanelCapture | null | Promise<PanelCapture | null>;
