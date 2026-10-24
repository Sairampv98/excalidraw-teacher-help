/**
 * The **media registry** (D-95).
 *
 * A video that is too big to travel in the document does not travel in the
 * document at all: its bytes live in a Blob in the origin's own IndexedDB, and
 * the panel's payload carries a **short id** instead of them (D-94).
 *
 * The library is the **oracle** (D-95): it must not import `idb-keyval`, must
 * not touch IndexedDB, and must not know what a Blob store is. So the library
 * owns the **shape** and the host owns the **bytes**: the host registers one
 * resolver here, the library asks it for a URL, and renders a plain
 * `<video src={url}>`.
 *
 * The URL is **lent**: the library revokes it when the panel goes away, so the
 * host must hand out a URL it does not use itself.
 */

import type {
  ExcalidrawPanelElement,
  PanelContent,
} from "@excalidraw/element/types";

import type { YoutubePanelSource } from "./panelContent";

/**
 * Where a **media-backed** panel's content comes from.
 *
 * The fourth variant beside `bridge`, `file` and `inline`: the content is not
 * in the document's own file store, it is in the **host's** media store, and
 * the payload names it by id.
 */
export type MediaPanelSource = {
  type: "media";
  /** the id the host's store knows the media by */
  mediaId: string;
  /** the media's own type, so the panel can say what it cannot play */
  mimeType: string;
};

/**
 * The panel's source, as the **library** sees it: the document's own variants
 * plus the media one and the **YouTube** one (D-128).
 *
 * `PanelContent["source"]` cannot name the media variant — the element type
 * lives in `@excalidraw/element`, outside this wave's scope — so the widening
 * happens here, in one place, and every read goes through `panelSource()`.
 */
export type PanelSource =
  | PanelContent["source"]
  | MediaPanelSource
  | YoutubePanelSource;

/**
 * The resolver the **host** fills (D-95).
 *
 * It answers with a URL for a media id, or `null` when the host does not have
 * that media any more.
 */
export type MediaResolver = (mediaId: string) => Promise<string | null>;

/**
 * The **fallback** for a panel's bytes (D-126).
 *
 * The **other way of reaching the same bytes**: a fresh object URL from the
 * host, or the file store's data URL. It is asked for **once**, when the first
 * source fails, and it never rebuilds a base64 string of a big file - that is
 * the 827 MiB of memory wave 5l removed (D-94).
 */
export type MediaFallback = () => Promise<string | null>;

let resolver: MediaResolver | null = null;

/**
 * Registers the host's resolver, or clears it with `null`.
 *
 * The library asks for a URL; it never asks for the bytes.
 */
export const registerMediaResolver = (next: MediaResolver | null): void => {
  resolver = next;
};

/** whether a host has registered a resolver at all */
export const hasMediaResolver = (): boolean => resolver !== null;

/**
 * Asks the host for the URL of a media id.
 *
 * `null` when there is no resolver, or when the host does not have the media.
 */
export const resolveMediaUrl = async (
  mediaId: string,
): Promise<string | null> => (resolver ? await resolver(mediaId) : null);

/**
 * The bytes of a data URL, reached through an **object URL** (D-126).
 *
 * The file store's `dataURL` is re-read and handed to the browser as a Blob:
 * the browser decodes the base64 itself, so **no base64 string is ever
 * built** - that is the 827 MiB of memory wave 5l removed (D-94).
 *
 * This is the fallback for a file-backed panel, and it is measured to reach
 * where the data URL cannot: a data URL **without** a type fails with "Unable
 * to load URL due to content type", while a blob URL with an empty type plays
 * (Chrome, 2026-10-23).
 *
 * `null` when the browser cannot do it: the fallback has then failed, and the
 * panel says so (D-126).
 */
export const mediaObjectUrl = async (
  dataUrl: string,
): Promise<string | null> => {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
};

/**
 * The panel's source, widened to the media variant.
 *
 * The only way to read a panel's source: `panel.panel.source` is typed by the
 * element package, which cannot name the media variant.
 */
export const panelSource = (panel: ExcalidrawPanelElement): PanelSource =>
  panel.panel.source as PanelSource;

/** whether a source names media in the host's store */
export const isMediaPanelSource = (
  source: PanelSource,
): source is MediaPanelSource => source.type === "media";
