import type { PanelBridgeStatus } from "./panelContent";
import type { PanelCapture } from "./panelFrames";

/**
 * What the **VS Code mirror** shows (D-331, D-333).
 *
 * The mirror is the editor's live window and nothing else, so it is in one of a
 * few states, and the teacher is told which - never a blank panel and never a
 * panel that says "not arrived yet" without saying what it is waiting for
 * (D-75):
 *
 *  - `live`        the editor's window, drawn;
 *  - `connecting`  the page is opening the connection (a spinner);
 *  - `looking`     the page is trying and the extension does not answer: VS Code
 *                  is not running, or the extension is not (a spinner, and the
 *                  token field in case the token is the problem);
 *  - `token`       there is no token, or the page is not connected and has not
 *                  tried: the field to paste it in;
 *  - `refused`     the extension answered and did not accept the token (an error,
 *                  and the field);
 *  - `waiting`     connected, and the editor has not sent the live view yet (a
 *                  spinner);
 *  - `unavailable` connected, and the extension says it cannot draw the window,
 *                  and why (an error).
 *
 * It is a pure rule, so it is tested without a browser.
 */
export type MirrorView =
  | "live"
  | "connecting"
  | "looking"
  | "token"
  | "refused"
  | "waiting"
  | "unavailable";

/** The connection's phase, as the host's session names it (D-333). */
export type MirrorBridgePhase =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "refused"
  | "closed";

export const mirrorPanelView = (input: {
  /** the host is a read-only mirror - the presenter (D-57) */
  readOnly: boolean;
  /** what the host says about the connection; none without a host's bridge */
  bridge?: { status: PanelBridgeStatus; phase?: MirrorBridgePhase };
  /** the live view's descriptor, as the registry holds it */
  capture: PanelCapture | null;
}): MirrorView => {
  const fromCapture = (): MirrorView =>
    input.capture?.status === "live"
      ? "live"
      : input.capture?.status === "unavailable"
      ? "unavailable"
      : "waiting";

  // The presenter, and a host with no bridge, have no connection to say
  // anything about: the picture is what the registry holds.
  if (input.readOnly || !input.bridge) {
    return fromCapture();
  }

  if (input.bridge.status === "connected") {
    return fromCapture();
  }

  switch (input.bridge.phase) {
    case "connecting":
      return "connecting";
    case "refused":
      return "refused";
    case "reconnecting":
      return "looking";
    case "idle":
    case "closed":
      return "token";
    default:
      // a host that does not name the phase: "rejected" is a try that did not
      // work, and "not connected" is a connection that was never tried
      return input.bridge.status === "rejected" ? "looking" : "token";
  }
};
