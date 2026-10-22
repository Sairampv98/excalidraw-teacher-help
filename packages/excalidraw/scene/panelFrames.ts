/**
 * The live view of the code panels - and the place the picture **must not** be.
 *
 * A panel's live state rides inside the element's payload (`CodePanelState`,
 * written by `withCodePanelState`), and the payload is **saved with the
 * document**. So a frame in the payload would put the teacher's screen into
 * the `.excalidraw` file, and it would grow the document by hundreds of
 * kilobytes a second (D-82).
 *
 * Since wave 5i the rule is **stronger**: the frames do not travel over the
 * websocket at all. The extension serves them as an MJPEG stream from its own
 * HTTP server, and the panel plays that stream in a plain `<img>` (D-85). So
 * a frame never enters the app's data - it is never in a message, never in
 * the registry, and never in the element.
 *
 * What the registry holds is therefore the live view's **descriptor**: the
 * capture's state and the URL of the stream. It is a module-level store -
 * never serialized, never inside an element - owned by the **library**, and
 * the two sides of it are:
 *
 *  - the **app** pushes the descriptor in (`setPanelCapture`), when the
 *    capture's state changes;
 *  - the **panel** subscribes to it (`subscribePanelCaptures`) and reads the
 *    entry that belongs to **its own** element id.
 *
 * The key is the panel element's id, so two panels cannot show each other's
 * live view.
 *
 * The registry is per window: the presenter is a second Excalidraw instance in
 * another window, with its own module instance, so it has no stream and shows
 * the text mirror - the same fallback a panel without a bridge shows.
 */

/**
 * The live view is running.
 *
 * The picture is NOT here: the panel points a plain `<img>` at the stream,
 * and the browser decodes it natively. So the app does no per-frame work at
 * all (D-85).
 */
export interface PanelCaptureLive {
  status: "live";
  /**
   * The MJPEG stream's URL.
   *
   * It carries the connection's **capability** in its path, and the session
   * token is never in a URL (D-50, D-86). It is **not** in the element's
   * payload: the payload is saved with the document, and the capability dies
   * with the connection.
   */
  streamUrl: string;
}

/**
 * The capture cannot run, and this is why.
 *
 * The reason is part of the state, because the panel has to **say** it: a
 * panel that is connected and shows nothing is indistinguishable from a
 * broken one (D-75).
 */
export interface PanelCaptureUnavailable {
  status: "unavailable";
  /** why there is no live view. Never empty. */
  reason: string;
}

/** What a panel knows about the live view. */
export type PanelCapture = PanelCaptureLive | PanelCaptureUnavailable;

/** The live views, by the panel element's id. */
const captures = new Map<string, PanelCapture>();

/** The panels that are watching. */
const listeners = new Set<() => void>();

const notify = () => {
  // a copy: a listener may unsubscribe while it is being called
  for (const listener of [...listeners]) {
    listener();
  }
};

/**
 * Publish the live view of a panel.
 *
 * The app calls this when the capture's **state** changes - not per frame,
 * because there are no frames in the app any more (D-85).
 */
export const setPanelCapture = (
  panelId: string,
  capture: PanelCapture,
): void => {
  captures.set(panelId, capture);
  notify();
};

/**
 * The live view of a panel, or `null` when it has none.
 *
 * The object is the one that was published, so it keeps its identity until
 * the state changes - which is what `useSyncExternalStore` needs to tell
 * "the same state" from "a new one".
 */
export const getPanelCapture = (panelId: string): PanelCapture | null =>
  captures.get(panelId) ?? null;

/** Forget the live view of one panel. */
export const clearPanelCapture = (panelId: string): void => {
  if (captures.delete(panelId)) {
    notify();
  }
};

/**
 * Forget every live view.
 *
 * The bridge session's end is the moment the stream stops being true: the
 * editor it came from may be a different one now, and the capability in its
 * URL is dead anyway (D-82, D-86).
 */
export const clearAllPanelCaptures = (): void => {
  if (!captures.size) {
    return;
  }

  captures.clear();
  notify();
};

/** Watch the registry. The returned function stops watching. */
export const subscribePanelCaptures = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};
