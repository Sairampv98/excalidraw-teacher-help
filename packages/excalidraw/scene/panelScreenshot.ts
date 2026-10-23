/**
 * The screenshot - the picture the teacher takes of a panel - and the three
 * choices that follow it (D-102, D-103, D-104).
 *
 * The picture itself is **not** here: a screenshot is an ordinary image file
 * once it lands (D-104), and the **host** is the side that takes it and puts it
 * on the canvas. What is here is the **pending** screenshot: the picture that
 * has been taken and has not been placed yet, and where it will land.
 *
 * The pending screenshot is a module-level store - never serialized, never
 * inside an element - owned by the **library**, and the two sides of it are:
 *
 *  - the **host** (the app) takes the picture and publishes it here
 *    (`setPendingScreenshot`);
 *  - the **library** draws the choice strip (D-103) and the wireframe (D-104),
 *    and reads the entry that belongs to **its own** panel.
 *
 * The rule the live view's registry follows is the same one: a picture must
 * never reach the document by accident (D-82). A screenshot that has not been
 * placed is a **pending** thing, and a pending thing is not part of the
 * document.
 */

/**
 * What the teacher chose in the strip (D-103).
 *
 * Exactly three: read the text out of the picture, put it on this page, put it
 * on a new page.
 */
export type PanelScreenshotChoice = "ocr" | "page" | "new-page";

/**
 * Where the picture came from (D-102).
 *
 * The **video's** frame is drawn from the `<video>` element's own pixels; the
 * **editor's** window is fetched from the extension's own HTTP server.
 */
export type PanelScreenshotSource = "video" | "editor";

/** A picture, and its own size. */
export interface PanelScreenshotPicture {
  /** the picture, as a data URL */
  dataURL: string;
  /** the picture's own size, in its own pixels */
  width: number;
  height: number;
}

/**
 * A picture that has been taken and has not been placed yet.
 *
 * The position is the picture's **top-left**, in scene coordinates, so the
 * wireframe can stand exactly where the picture will land (D-104).
 */
export interface PanelScreenshot extends PanelScreenshotPicture {
  /** the panel the picture was taken from */
  panelId: string;
  /** where the picture came from */
  source: PanelScreenshotSource;
  /** the picture's top-left, in scene coordinates */
  x: number;
  y: number;
  /** the picture's size on the canvas, in scene units */
  canvasWidth: number;
  canvasHeight: number;
}

/** The pending screenshots, by the panel's id. */
const screenshots = new Map<string, PanelScreenshot>();

/** The panels that are watching. */
const listeners = new Set<() => void>();

const notify = () => {
  // a copy: a listener may unsubscribe while it is being called
  for (const listener of [...listeners]) {
    listener();
  }
};

/**
 * Publish a picture that has been taken and has not been placed yet.
 *
 * The host calls this the moment the capture is done. The library's strip and
 * wireframe read it (D-103, D-104).
 */
export const setPendingScreenshot = (screenshot: PanelScreenshot): void => {
  screenshots.set(screenshot.panelId, screenshot);
  notify();
};

/**
 * The pending screenshot of a panel, or `null` when it has none.
 *
 * The object is the one that was published, so it keeps its identity until it
 * changes - which is what `useSyncExternalStore` needs to tell "the same
 * state" from "a new one".
 */
export const getPendingScreenshot = (panelId: string): PanelScreenshot | null =>
  screenshots.get(panelId) ?? null;

/**
 * The pending screenshot of **any** panel, or `null` when there is none.
 *
 * The wireframe stands for whichever picture is waiting to be placed (D-104),
 * and it does not care which panel the picture came from - it cares that the
 * picture is waiting.
 */
export const getAnyPendingScreenshot = (): PanelScreenshot | null => {
  for (const screenshot of screenshots.values()) {
    return screenshot;
  }

  return null;
};

/**
 * Move a pending screenshot.
 *
 * The wireframe is dragged on the canvas, and the drag is the teacher's, so
 * the position lives with the picture (D-104).
 */
export const movePendingScreenshot = (
  panelId: string,
  x: number,
  y: number,
): void => {
  const screenshot = screenshots.get(panelId);

  if (!screenshot || (screenshot.x === x && screenshot.y === y)) {
    return;
  }

  screenshots.set(panelId, { ...screenshot, x, y });
  notify();
};

/**
 * Forget a pending screenshot.
 *
 * The picture has landed, or the teacher dismissed the choice, or the panel is
 * gone (D-104).
 */
export const clearPendingScreenshot = (panelId: string): void => {
  if (screenshots.delete(panelId)) {
    notify();
  }
};

/** Forget every pending screenshot. */
export const clearAllPendingScreenshots = (): void => {
  if (screenshots.size) {
    screenshots.clear();
    notify();
  }
};

/** Watch the pending screenshots. */
export const subscribePendingScreenshots = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/**
 * The snapshot's URL, from the stream's URL.
 *
 * The stream is `.../s/<capability>/frame` and the snapshot is
 * `.../s/<capability>/snapshot`: one more path segment under the **same**
 * capability, so the same authorisation covers it (D-86, D-102). The session
 * token is never in a URL (D-50) and the capability is already in this one.
 */
export const snapshotUrl = (streamUrl: string): string =>
  streamUrl.replace(/\/frame(\?.*)?$/, "/snapshot$1");

/**
 * The bytes, as a base64 string.
 *
 * The chunking matters: a whole window's frame is tens of kilobytes, and
 * `String.fromCharCode(...)` with tens of thousands of arguments overflows the
 * call stack.
 */
const bytesToBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
    );
  }

  return btoa(binary);
};

/**
 * The editor's window, as a picture.
 *
 * The frames live in the **extension**, not in the app: the app fetches the
 * last one over the extension's own HTTP server, with a plain `GET` on the
 * stream's URL (D-102). The picture's own size travels in the response's
 * headers, because the app has to know how big the picture is before it draws
 * it - and the app must not decode an image to learn its size.
 *
 * `null` when the server has no frame yet, or the fetch failed: the caller
 * then says why, and never says nothing (D-75).
 */
export const fetchEditorSnapshot = async (
  url: string,
): Promise<PanelScreenshotPicture | null> => {
  const response = await fetch(url);

  if (!response.ok) {
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  if (!bytes.length) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";

  return {
    dataURL: `data:${contentType};base64,${bytesToBase64(bytes)}`,
    width: Number(response.headers.get("x-frame-width") ?? 0),
    height: Number(response.headers.get("x-frame-height") ?? 0),
  };
};
