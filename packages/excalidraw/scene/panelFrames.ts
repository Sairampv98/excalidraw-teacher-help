/**
 * The live frames of the code panels - and the place they **must not** be.
 *
 * A panel's live state rides inside the element's payload (`CodePanelState`,
 * written by `withCodePanelState`), and the payload is **saved with the
 * document**. So a frame in the payload would put the teacher's screen into
 * the `.excalidraw` file, and it would grow the document by hundreds of
 * kilobytes a second (D-82).
 *
 * The frames therefore travel on a **second channel**: this registry. It is
 * a module-level store - never serialized, never inside an element - owned by
 * the **library**, and the two sides of it are:
 *
 *  - the **app** pushes each arriving frame in (`setPanelCapture`);
 *  - the **panel** subscribes to it (`subscribePanelCaptures`) and reads the
 *    frame that belongs to **its own** element id.
 *
 * The key is the panel element's id, so two panels cannot show each other's
 * frames.
 *
 * The registry is per window: the presenter is a second Excalidraw instance in
 * another window, with its own module instance, so it has no frames and shows
 * the text mirror - the same fallback a panel without a bridge shows.
 */

/** A frame of the editor's window, as it is drawn. */
export interface PanelLiveFrame {
  status: "live";
  /** the PNG, base64-encoded */
  data: string;
  /** the frame's own width, in pixels */
  width: number;
  /** the frame's own height, in pixels */
  height: number;
  /** the frame's number: 1, 2, 3 ... */
  seq: number;
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
  /** the frame's number: the last one that arrived, or 0 */
  seq: number;
}

/** What a panel knows about the live view. */
export type PanelCapture = PanelLiveFrame | PanelCaptureUnavailable;

/** The frames, by the panel element's id. */
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
 * Publish the capture of a panel.
 *
 * The app calls this for every frame that arrives, and for the state that says
 * the capture cannot run.
 */
export const setPanelCapture = (
  panelId: string,
  capture: PanelCapture,
): void => {
  captures.set(panelId, capture);
  notify();
};

/**
 * The capture of a panel, or `null` when it has none.
 *
 * The object is the one that was published, so it keeps its identity until
 * the next frame - which is what `useSyncExternalStore` needs to tell "the
 * same frame" from "a new one".
 */
export const getPanelCapture = (panelId: string): PanelCapture | null =>
  captures.get(panelId) ?? null;

/** Forget the capture of one panel. */
export const clearPanelCapture = (panelId: string): void => {
  if (captures.delete(panelId)) {
    notify();
  }
};

/**
 * Forget every capture.
 *
 * The bridge session's end is the moment the frames stop being true: the
 * editor they came from may be a different one now.
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
