import type { BridgeMessage } from "../../bridge/src/protocol";

/**
 * The capture's **state**, as the protocol carries it.
 *
 * The picture itself never crosses the websocket (D-85): what crosses is the
 * state - "live" or "unavailable" and the reason - and it is published when
 * it **changes**.
 */

/** The capture's state. */
export interface CaptureState {
  /** "live" - the capture is running. "unavailable" - it cannot run. */
  state: "live" | "unavailable";
  /** why the capture is not running. Never empty when it is "unavailable". */
  reason?: string;
}

/** The message the state travels in. */
export type CaptureStateMessage = Extract<
  BridgeMessage,
  { type: "editor:capture" }
>;

export interface CaptureStatePublisher {
  /** the capture is running */
  live: (seq: number) => void;
  /** the capture cannot run, and this is why */
  unavailable: (reason: string, seq?: number) => void;
  /** the state as it stands, or null when nothing has been published yet */
  readonly state: CaptureState | null;
}

/**
 * The capture's state, published **only when it changes**.
 *
 * The frames themselves go to the MJPEG stream and to nothing else (D-85),
 * so this message is the only thing the capture says over the websocket - and
 * it says it when the state changes, not per frame. That is what makes the
 * app's per-frame work **zero**: the panel re-renders when the state
 * changes, and a static editor changes nothing at all.
 *
 * The state is a **message**, not a silence: the panel has to be able to say
 * why there is no live view (D-75).
 */
export const createCaptureStatePublisher = (
  publish: (message: CaptureStateMessage) => void,
): CaptureStatePublisher => {
  let state: CaptureState | null = null;

  const send = (next: CaptureState, seq: number) => {
    state = next;

    publish({
      v: 1,
      type: "editor:capture",
      state: next.state,
      ...(next.reason ? { reason: next.reason } : {}),
      seq,
    });
  };

  return {
    live: (seq: number) => {
      if (state?.state === "live") {
        // nothing changed
        return;
      }

      send({ state: "live" }, seq);
    },

    unavailable: (reason: string, seq = 0) => {
      if (state?.state === "unavailable" && state.reason === reason) {
        // nothing changed
        return;
      }

      send({ state: "unavailable", reason }, seq);
    },

    get state(): CaptureState | null {
      return state;
    },
  };
};
