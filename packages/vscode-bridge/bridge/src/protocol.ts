import type { FileId } from "@excalidraw/element/types";

import { isOcrEngineName, isOcrLine, isOcrModel, isOcrRegion } from "./ocr";

import type { OcrEngineName, OcrLine, OcrModel, OcrRegion } from "./ocr";

/**
 * The bridge protocol - the ONE definition of the message types.
 *
 * Both sides import this module: the extension through a relative import
 * (`../../bridge/src/protocol`), the Excalidraw app through a path alias. There
 * is no second copy of these types anywhere in the repository.
 *
 * The rules this file encodes (D-50, D-67):
 *
 *  - the bridge listens on 127.0.0.1 only, on a FIXED port, and the port
 *    travels to the app as a build-time `VITE_APP_*` variable - never as a
 *    random free port and never as a port scan;
 *  - the per-session token is negotiated IN BAND, in the FIRST websocket frame
 *    (`bridge:auth`). It is never in a URL and never on a command line;
 *  - the server rejects a connection that does not present the token, and a
 *    connection whose origin is not localhost.
 */

/** The protocol version every message carries. */
export const BRIDGE_PROTOCOL_VERSION = 1;

/** The loopback host the bridge listens on. Never `0.0.0.0`. */
export const DEFAULT_BRIDGE_HOST = "127.0.0.1";

/**
 * The fixed port the bridge listens on when nothing overrides it.
 *
 * It is a constant and not a random free port, so the app knows where to
 * connect before the extension has ever run (D-67).
 */
export const DEFAULT_BRIDGE_PORT = 47511;

/**
 * The build-time variable that carries the bridge URL into the app - the same
 * shape as `VITE_APP_WS_SERVER_URL`, which is how the collaboration server is
 * found today.
 */
export const BRIDGE_URL_ENV_VAR = "VITE_APP_BRIDGE_URL";

/** The task type the extension contributes, so a run can be owned by the extension. */
export const BRIDGE_TASK_TYPE = "excalidraw-bridge.run";

/** Every message type in the protocol. Used by the round-trip test (AC-62). */
export const BRIDGE_MESSAGE_TYPES = [
  "bridge:auth",
  "bridge:hello",
  "editor:content",
  "editor:capture",
  "run:started",
  "run:output",
  "run:exit",
  "run:start",
  "run:stop",
  "code:run",
  "run:notice",
  "run:runtimes",
  "ocr:request",
  "ocr:result",
  "ocr:error",
  "ocr:state",
  "ping",
  "pong",
] as const;

export type BridgeMessageType = typeof BRIDGE_MESSAGE_TYPES[number];

/**
 * What the hello says when the teacher has **no folder open** (D-122).
 *
 * The workspace's name was sent as the empty string when there was no folder,
 * and the panel then said *"Connected to Visual Studio Code ()"* - an empty pair
 * of brackets, which says nothing. So the name is **never blank**: the bridge
 * says this instead, and the teacher knows the difference between "no folder" and
 * "a folder called nothing".
 */
export const NO_WORKSPACE_NAME = "no folder open";

/**
 * The workspace's name for the hello: the name when there is one, and
 * {@link NO_WORKSPACE_NAME} when there is not (D-122).
 *
 * One place, so the bridge and the panel cannot disagree about what a blank
 * workspace means.
 */
export const workspaceName = (workspace: string | undefined | null): string => {
  const name = (workspace ?? "").trim();

  return name === "" ? NO_WORKSPACE_NAME : name;
};

/** The selection the teacher's editor has, as offsets into the text. */
export interface BridgeSelection {
  start: number;
  end: number;
}

/**
 * A message on the wire.
 *
 * Direction is a convention, not a type-level distinction: the panel sends the
 * `run:*`/`ocr:*` commands, the extension sends the content and the output.
 */
export type BridgeMessage =
  /** panel -> extension. The FIRST frame of every connection. */
  | { v: 1; type: "bridge:auth"; token: string }
  /** extension -> panel. Sent once, right after a successful auth. */
  | {
      v: 1;
      type: "bridge:hello";
      version: string;
      workspace: string;
      /**
       * Which editor this is: "Visual Studio Code", "VSCodium", ...
       *
       * The port is **fixed** (D-67), so with two editors running only one of
       * them holds it - and the app reaches that one, not necessarily the one
       * the teacher has their file open in. The name is what makes the
       * mismatch visible (D-76).
       *
       * Optional, so an extension that predates the field still connects; it
       * simply does not say which editor it is.
       */
      appName?: string;
      /**
       * The **MJPEG stream's** URL - the live view of the editor's own window
       * (D-85).
       *
       * The picture itself never travels over the websocket: the extension
       * serves it from the HTTP server it already has, and the panel plays it
       * in a plain `<img>`. So the app does no per-frame work at all.
       *
       * The URL carries the **connection's capability** in its path, and the
       * session TOKEN is never in a URL (D-50, D-86). The capability is
       * single-purpose and per connection: it dies with the connection.
       *
       * Optional, so an extension that predates the field still connects; the
       * panel then falls back to the mirrored text and says why.
       */
      streamUrl?: string;
    }
  /** extension -> panel. The active editor's text. */
  | {
      v: 1;
      type: "editor:content";
      uri: string;
      language: string;
      text: string;
      selection?: BridgeSelection;
      version: number;
    }
  /**
   * extension -> panel. The state of the capture of the editor's own window
   * (D-82, D-85).
   *
   * **The picture is NOT in this message.** The frames are served as an MJPEG
   * stream from the extension's own HTTP server, and the panel plays that
   * stream in a plain `<img>` - so a frame never travels over the websocket
   * and never reaches the app's data at all.
   *
   * What travels is the **state**: "live" (the capture is running) or
   * "unavailable" (it cannot run, and this is why). The state is a message,
   * not a silence: the panel has to be able to say why there is no live view
   * (D-75).
   *
   * The state is published when it **changes**, not per frame: the panel
   * re-renders when the state changes, and the app does no per-frame work.
   */
  | {
      v: 1;
      type: "editor:capture";
      /**
       * "live" - the capture is running. "unavailable" - the capture cannot
       * run.
       */
      state: "live" | "unavailable";
      /**
       * Why the capture is not running. Never empty when the state is
       * "unavailable", and never set when it is "live".
       */
      reason?: string;
      /** the frame's number when the state was published: 1, 2, 3 ... */
      seq: number;
    }
  /** extension -> panel. The program started. */
  | { v: 1; type: "run:started"; runId: string; command: string; cwd: string }
  /** extension -> panel. One line of the program's output. */
  | {
      v: 1;
      type: "run:output";
      runId: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  /** extension -> panel. The program ended. `code` is null when it was killed. */
  | { v: 1; type: "run:exit"; runId: string; code: number | null }
  /** panel -> extension. Run the program. */
  | { v: 1; type: "run:start"; command: string; args: string[]; cwd?: string }
  /** panel -> extension. Stop the run. */
  | { v: 1; type: "run:stop"; runId: string }
  /**
   * panel -> extension. Run the **draft** (D-124).
   *
   * The panel's Run control sends the teacher's own text and the language it
   * is in; the extension writes it to a temporary file in the teacher's
   * workspace, runs it with that language's runtime, and returns the output.
   */
  | {
      v: 1;
      type: "code:run";
      /**
       * The request's id.
       *
       * It is the **run's** id when the run happens, so every message about
       * that run carries it - and when the run does NOT happen (there is no
       * runtime for the language), the notice carries it too, and the panel
       * never claims a run happened (D-124).
       */
      id: string;
      /** the language, as the grammar registry names it */
      language: string;
      /** the teacher's own text */
      text: string;
    }
  /**
   * extension -> panel. A **fact** about a run (D-124).
   *
   * The facts are the ones the teacher must not be left guessing about: the
   * run was killed at the timeout, the output was longer than the bound, or
   * the language's runtime is not on this machine.
   */
  | {
      v: 1;
      type: "run:notice";
      runId: string;
      /**
       * - "timed-out" - the program ran and was killed at the timeout
       * - "truncated" - the output was longer than the bound
       * - "missing-runtime" - the language's runtime is not on this machine,
       *   and **nothing ran**
       */
      kind: "timed-out" | "truncated" | "missing-runtime";
      /** the sentence the panel shows. Never empty. */
      text: string;
    }
  /**
   * extension -> panel. The runtimes that are **actually** on this machine
   * (D-124).
   *
   * The panel's language picker offers only these, so it never offers a
   * language that cannot run here.
   */
  | {
      v: 1;
      type: "run:runtimes";
      /** the language ids that can be run here */
      languages: string[];
    }
  /** panel -> extension. Read the text out of an image. */
  | {
      v: 1;
      type: "ocr:request";
      id: string;
      /** the file the image came from, when it came from one */
      fileId?: FileId;
      imageBase64: string;
      /**
       * The region of interest, in the image's **own pixels**.
       *
       * The crop is the one OCR lever that costs nothing and buys the most, so
       * it travels with the request (D-55, D-59).
       */
      region?: OcrRegion;
      language?: string;
      /**
       * The engine the caller wants (D-90).
       *
       * It is **optional**: when it is absent the extension falls back to its
       * own setting, and an extension that predates the field still reads.
       */
      engine?: OcrEngineName;
    }
  /** extension -> panel. The text that was read out of an image. */
  | {
      v: 1;
      type: "ocr:result";
      id: string;
      /** the file the image came from, when it came from one */
      fileId?: FileId;
      text: string;
      /** the per-line boxes, so the text can be placed as individual elements */
      lines?: OcrLine[];
      confidence?: number;
      /** which engine actually read it (D-90) */
      engine?: OcrEngineName;
      /** how long the read took, in milliseconds (D-90) */
      durationMs?: number;
      /**
       * How the engine's model was built (D-106).
       *
       * It says whether the engine ran **without** oneDNN, so the panel can
       * tell the teacher why a read was slow (D-91).
       */
      model?: OcrModel;
    }
  /**
   * extension -> panel. The state of the OCR engine (D-90, D-91).
   *
   * It is a **state**, not a silence: the panel has to be able to say which
   * engine is in use, and - when the engine is not there - **why** it is not
   * there and what to install (D-75, D-91).
   *
   * A ready state carries the engine's name; an unavailable one carries the
   * reason and nothing else.
   */
  | {
      v: 1;
      type: "ocr:state";
      state: "ready" | "unavailable";
      /** the engine that is in use */
      engine?: OcrEngineName;
      /**
       * Why the engine is not there. Never empty when the state is
       * "unavailable", and never set when the state is "ready".
       */
      reason?: string;
    }
  /**
   * extension -> panel. The read **failed**.
   *
   * A failure is a message, not a silence: the app has to be able to say why
   * the text did not arrive (D-59).
   */
  | {
      v: 1;
      type: "ocr:error";
      id: string;
      message: string;
    }
  /** panel -> extension. */
  | { v: 1; type: "ping" }
  /** extension -> panel. */
  | { v: 1; type: "pong" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isSelection = (value: unknown): value is BridgeSelection =>
  isRecord(value) &&
  typeof value.start === "number" &&
  typeof value.end === "number";

/**
 * The runtime guard for the protocol.
 *
 * The types above are erased at run time; this function is what actually
 * decides whether a frame is a legal message. Every frame that enters the
 * server or the client goes through it, so a malformed frame can never be
 * mistaken for a command.
 */
export function isBridgeMessage(value: unknown): value is BridgeMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.v !== BRIDGE_PROTOCOL_VERSION) {
    return false;
  }
  const type = value.type;
  if (typeof type !== "string") {
    return false;
  }
  switch (type) {
    case "bridge:auth":
      return typeof value.token === "string";
    case "bridge:hello":
      return (
        typeof value.version === "string" &&
        typeof value.workspace === "string" &&
        (value.appName === undefined || typeof value.appName === "string") &&
        // the stream's URL is optional: an extension that predates it still
        // connects, and the panel falls back to the mirrored text (D-85)
        (value.streamUrl === undefined || typeof value.streamUrl === "string")
      );
    case "editor:content":
      return (
        typeof value.uri === "string" &&
        typeof value.language === "string" &&
        typeof value.text === "string" &&
        typeof value.version === "number" &&
        (value.selection === undefined || isSelection(value.selection))
      );
    case "editor:capture":
      return (
        (value.state === "live" || value.state === "unavailable") &&
        typeof value.seq === "number" &&
        // a live capture carries no reason; an unavailable one carries the
        // reason and nothing else - the panel has to be able to SAY it (D-75)
        (value.state === "live"
          ? value.reason === undefined
          : typeof value.reason === "string" && value.reason.length > 0)
      );
    case "run:started":
      return (
        typeof value.runId === "string" &&
        typeof value.command === "string" &&
        typeof value.cwd === "string"
      );
    case "run:output":
      return (
        typeof value.runId === "string" &&
        (value.stream === "stdout" || value.stream === "stderr") &&
        typeof value.text === "string"
      );
    case "run:exit":
      return (
        typeof value.runId === "string" &&
        (value.code === null || typeof value.code === "number")
      );
    case "run:start":
      return (
        typeof value.command === "string" &&
        isStringArray(value.args) &&
        (value.cwd === undefined || typeof value.cwd === "string")
      );
    case "run:stop":
      return typeof value.runId === "string";
    case "code:run":
      return (
        typeof value.id === "string" &&
        typeof value.language === "string" &&
        typeof value.text === "string"
      );
    case "run:notice":
      return (
        typeof value.runId === "string" &&
        (value.kind === "timed-out" ||
          value.kind === "truncated" ||
          value.kind === "missing-runtime") &&
        // the sentence the panel shows is never empty: an empty notice is a
        // bug, and the rule is to say what is missing (D-122)
        typeof value.text === "string" &&
        value.text.length > 0
      );
    case "run:runtimes":
      return Array.isArray(value.languages) && isStringArray(value.languages);
    case "ocr:request":
      return (
        typeof value.id === "string" &&
        (value.fileId === undefined || typeof value.fileId === "string") &&
        typeof value.imageBase64 === "string" &&
        (value.region === undefined || isOcrRegion(value.region)) &&
        (value.language === undefined || typeof value.language === "string") &&
        // the engine is optional: an extension that predates it still reads
        (value.engine === undefined || isOcrEngineName(value.engine))
      );
    case "ocr:result":
      return (
        typeof value.id === "string" &&
        (value.fileId === undefined || typeof value.fileId === "string") &&
        typeof value.text === "string" &&
        (value.lines === undefined ||
          (Array.isArray(value.lines) && value.lines.every(isOcrLine))) &&
        (value.confidence === undefined ||
          typeof value.confidence === "number") &&
        // the engine and the time are optional (D-90)
        (value.engine === undefined || isOcrEngineName(value.engine)) &&
        (value.durationMs === undefined ||
          typeof value.durationMs === "number") &&
        // how the model was built is optional (D-106)
        (value.model === undefined || isOcrModel(value.model))
      );
    case "ocr:state":
      return (
        (value.state === "ready" || value.state === "unavailable") &&
        (value.engine === undefined || isOcrEngineName(value.engine)) &&
        // a ready state carries no reason; an unavailable one carries the
        // reason and nothing else - the panel has to be able to SAY it (D-91)
        (value.state === "ready"
          ? value.reason === undefined
          : typeof value.reason === "string" && value.reason.length > 0)
      );
    case "ocr:error":
      return typeof value.id === "string" && typeof value.message === "string";
    case "ping":
    case "pong":
      return true;
    default:
      return false;
  }
}

/** Parse a raw frame into a message, or `null` when it is not one. */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isBridgeMessage(parsed) ? parsed : null;
}

/** Serialise a message for the wire. */
export function encodeBridgeMessage(message: BridgeMessage): string {
  return JSON.stringify(message);
}

/** The URL the app connects to. The token is NOT part of it. */
export function bridgeUrl(
  port: number = DEFAULT_BRIDGE_PORT,
  host: string = DEFAULT_BRIDGE_HOST,
): string {
  return `ws://${host}:${port}/`;
}
