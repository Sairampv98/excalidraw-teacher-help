import type { FileId } from "@excalidraw/element/types";

import { isOcrLine, isOcrRegion } from "./ocr";

import type { OcrLine, OcrRegion } from "./ocr";

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
  "run:started",
  "run:output",
  "run:exit",
  "run:start",
  "run:stop",
  "ocr:request",
  "ocr:result",
  "ocr:error",
  "ping",
  "pong",
] as const;

export type BridgeMessageType = typeof BRIDGE_MESSAGE_TYPES[number];

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
        (value.appName === undefined || typeof value.appName === "string")
      );
    case "editor:content":
      return (
        typeof value.uri === "string" &&
        typeof value.language === "string" &&
        typeof value.text === "string" &&
        typeof value.version === "number" &&
        (value.selection === undefined || isSelection(value.selection))
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
    case "ocr:request":
      return (
        typeof value.id === "string" &&
        (value.fileId === undefined || typeof value.fileId === "string") &&
        typeof value.imageBase64 === "string" &&
        (value.region === undefined || isOcrRegion(value.region)) &&
        (value.language === undefined || typeof value.language === "string")
      );
    case "ocr:result":
      return (
        typeof value.id === "string" &&
        (value.fileId === undefined || typeof value.fileId === "string") &&
        typeof value.text === "string" &&
        (value.lines === undefined ||
          (Array.isArray(value.lines) && value.lines.every(isOcrLine))) &&
        (value.confidence === undefined || typeof value.confidence === "number")
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
