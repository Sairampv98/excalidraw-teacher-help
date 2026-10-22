/**
 * The **coalesced publish** (D-88).
 *
 * `vscode.workspace.onDidChangeTextDocument` fires on **every keystroke**, and
 * the message the extension sends carries the **whole file** - so every
 * keystroke in the teacher's editor made the app rewrite the whole scene.
 *
 * The publish is now coalesced: **at most one** every 100 ms, and the **last**
 * state is **always** published by a trailing timer, so the final text is
 * never lost.
 *
 * The whole-file payload stays: a diff is a bigger change than this wave is
 * for. The coalescing is what removes the per-keystroke scene rewrite.
 *
 * The 100 ms is a **constant with a comment**, not a number scattered through
 * the code - it is here, once.
 */

/** How often the text is published, at most. */
export const PUBLISH_INTERVAL_MS = 100;

export interface CoalescedPublisherOptions {
  /**
   * The publish itself.
   *
   * It reads the state **when it is called**, so the trailing publish always
   * carries the latest state and never a stale one.
   */
  publish: () => void;
  /** how often the state is published, at most. Defaults to 100 ms. */
  intervalMs?: number;
  /** the clock. Overridable, for the tests. */
  now?: () => number;
  /** the timer. Overridable, for the tests. */
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  /** the timer's cancel. Overridable, for the tests. */
  clearTimer?: (handle: unknown) => void;
}

export interface CoalescedPublisher {
  /**
   * Ask for a publish.
   *
   * The first ask publishes at once; the asks that follow inside the window
   * are coalesced into **one** trailing publish, which carries the state as
   * it is when the timer fires.
   */
  request: () => void;
  /** publish right now, if one is pending */
  flush: () => void;
  /** stop the timer. A pending publish is dropped. */
  stop: () => void;
  /** is a publish pending? */
  readonly pending: boolean;
}

export const createCoalescedPublisher = (
  options: CoalescedPublisherOptions,
): CoalescedPublisher => {
  const intervalMs = options.intervalMs ?? PUBLISH_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>));

  /** when the last publish happened. Null before the first one. */
  let lastPublishedAt: number | null = null;

  /** the pending trailing publish, if there is one */
  let timer: unknown = null;

  const publish = () => {
    lastPublishedAt = now();
    options.publish();
  };

  const request = () => {
    if (timer !== null) {
      // A publish is already scheduled. It reads the state when it fires, so
      // it carries the LATEST state - there is nothing to add.
      return;
    }

    const elapsed =
      lastPublishedAt === null
        ? Number.POSITIVE_INFINITY
        : now() - lastPublishedAt;

    if (elapsed >= intervalMs) {
      publish();
      return;
    }

    timer = setTimer(() => {
      timer = null;
      publish();
    }, intervalMs - elapsed);
  };

  const flush = () => {
    if (timer === null) {
      return;
    }

    clearTimer(timer);
    timer = null;
    publish();
  };

  const stop = () => {
    if (timer === null) {
      return;
    }

    clearTimer(timer);
    timer = null;
  };

  return {
    request,
    flush,
    stop,
    get pending(): boolean {
      return timer !== null;
    },
  };
};
