import type {
  BridgeControlState,
  BridgeMessage,
  BridgeMirrorRegion,
} from "../../bridge/src/protocol";

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

/**
 * What is **mirrored** of the editor's window (D-143).
 *
 * It is the teacher's own choice, and it is part of the capture's descriptor:
 * a panel that shows the live view says what it is showing.
 */
export interface CaptureMirror {
  /** the region that is mirrored, or null for the whole window */
  region: BridgeMirrorRegion | null;
  /** whether the region follows the pointer. Off by default. */
  follow: boolean;
}

/** The picture's own size, in its own pixels. */
export interface CaptureSize {
  width: number;
  height: number;
}

export interface CaptureStatePublisher {
  /** the capture is running */
  live: (seq: number, size?: CaptureSize) => void;
  /** the capture cannot run, and this is why */
  unavailable: (reason: string, seq?: number) => void;
  /**
   * The teacher chose what is mirrored (D-143).
   *
   * The choice is published again, so the descriptor says what is mirrored
   * now - and so a panel that connects later learns the choice.
   */
  setMirror: (mirror: CaptureMirror) => void;
  /**
   * What the control says: whether it is on, the route its input takes and why
   * (D-323, D-326). It is part of the descriptor, so a panel that connects
   * later learns it.
   */
  setControl: (control: BridgeControlState) => void;
  /** whether the editor's window is parked off every display (D-328) */
  setParked: (parked: boolean) => void;
  /** the state as it stands, or null when nothing has been published yet */
  readonly state: CaptureState | null;
}

/**
 * The capture's state, published **only when it changes**.
 *
 * The frames themselves go to the MJPEG stream and to nothing else (D-85),
 * so this message is the only thing the capture says over the websocket - and
 * it says it when the state changes, not per frame. That is what makes the
 * app's per-frame work **zero**: the panel re-renders when the state changes,
 * and a static editor changes nothing at all.
 *
 * The state is a **message**, not a silence: the panel has to be able to say
 * why there is no live view (D-75).
 *
 * The descriptor also carries **what is mirrored** (D-143) and the picture's
 * own size: the crop is measured in fractions of the picture, so the size is
 * what turns a fraction into the shape the teacher sees.
 */
export const createCaptureStatePublisher = (
  publish: (message: CaptureStateMessage) => void,
): CaptureStatePublisher => {
  let state: CaptureState | null = null;

  /** what is mirrored. The whole window until the teacher says otherwise. */
  let mirror: CaptureMirror = { region: null, follow: false };

  /** the picture's own size, as the last frame said it. */
  let size: CaptureSize | null = null;

  /** the control: off until the teacher turns it on (D-323) */
  let control: BridgeControlState | null = null;

  /** is the editor's window parked? (D-328) */
  let parked = false;

  /** the last frame's number: the seq a re-published state carries. */
  let seq = 0;

  const send = (next: CaptureState) => {
    state = next;

    publish({
      v: 1,
      type: "editor:capture",
      state: next.state,
      ...(next.reason ? { reason: next.reason } : {}),
      seq,
      ...(mirror.region ? { region: mirror.region } : {}),
      ...(mirror.follow ? { follow: true } : {}),
      ...(size ? { width: size.width, height: size.height } : {}),
      ...(control ? { control } : {}),
      ...(parked ? { parked: true } : {}),
    });
  };

  return {
    live: (nextSeq: number, nextSize?: CaptureSize) => {
      seq = nextSeq;

      // a window that was resized has a new picture, and the panel has to
      // know it: the crop is measured in fractions of the picture (D-143)
      const sizeChanged =
        !!nextSize &&
        (size?.width !== nextSize.width || size?.height !== nextSize.height);

      if (nextSize) {
        size = nextSize;
      }

      if (state?.state === "live") {
        if (sizeChanged) {
          send({ state: "live" });
        }

        return;
      }

      send({ state: "live" });
    },

    unavailable: (reason: string, nextSeq = 0) => {
      seq = nextSeq;

      if (state?.state === "unavailable" && state.reason === reason) {
        // nothing changed
        return;
      }

      send({ state: "unavailable", reason });
    },

    setMirror: (next: CaptureMirror) => {
      mirror = next;

      if (!state) {
        // nothing has been published yet: the choice will be in the first
        // message, so there is nothing to publish now
        return;
      }

      // the choice is published again, so the descriptor says what is mirrored
      // now (D-143)
      send(state);
    },

    setControl: (next: BridgeControlState) => {
      if (
        control?.enabled === next.enabled &&
        control.route === next.route &&
        control.reason === next.reason
      ) {
        // the same thing again is not a change: nothing is published for it
        return;
      }

      control = next;

      if (state) {
        send(state);
      }
    },

    setParked: (next: boolean) => {
      if (parked === next) {
        return;
      }

      parked = next;

      if (state) {
        send(state);
      }
    },

    get state(): CaptureState | null {
      return state;
    },
  };
};
