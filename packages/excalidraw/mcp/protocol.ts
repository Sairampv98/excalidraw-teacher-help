/**
 * The protocol between the MCP server and the page (D-397, D-398).
 *
 * The MCP server is a separate program, started by the AI assistant's client
 * over stdio. It cannot reach into the page, so the **page connects to it**, the
 * way the page connects to the VS Code bridge (D-50, D-67): the server listens on
 * the loopback interface on a fixed port, the origin is checked before the
 * upgrade, and what the page proves in its first frame is the pairing code - never
 * a URL, never a command line.
 *
 * Both sides import this module. It is the one definition of the messages, and it
 * has no dependency, so the server and the app can both take it.
 */

/** The version every message carries. */
export const MCP_PROTOCOL_VERSION = 1;

/** The loopback host the server listens on. Never `0.0.0.0`. */
export const DEFAULT_MCP_HOST = "127.0.0.1";

/** The fixed port the server listens on when nothing overrides it. */
export const DEFAULT_MCP_PORT = 47711;

/** The build-time variable that carries the server's address into the app. */
export const MCP_URL_ENV_VAR = "VITE_APP_MCP_URL";

/** The close code the server answers a wrong pairing code with. */
export const MCP_CLOSE_UNAUTHORIZED = 1008;

/** The longest message either side accepts, in bytes (media comes in pieces). */
export const MCP_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;

/** How long the server waits for the page to answer a call, in milliseconds. */
export const MCP_CALL_TIMEOUT_MS = 60_000;

/** The error codes a call can end with. The list is closed. */
export const MCP_ERROR_CODES = [
  /** the page is not connected, or is not paired */
  "not-connected",
  /** the tool does not exist */
  "unknown-tool",
  /** the arguments are not what the tool takes */
  "bad-arguments",
  /** Allow changes is off */
  "changes-not-allowed",
  /** the call asked for more than the limits allow */
  "too-large",
  /** a thing the call named is not there (an id, a page) */
  "not-found",
  /** the page tried, and what was asked cannot be done */
  "failed",
  /** the page did not answer in time */
  "timeout",
] as const;

export type McpErrorCode = typeof MCP_ERROR_CODES[number];

export type McpError = { code: McpErrorCode; message: string };

/** What the page tells the server about itself, so a tool can say what is on. */
export type McpPageState = {
  /** whether the assistant may change the scene (D-399) */
  allowChanges: boolean;
  /** the app's name and version, for `describe_capabilities` */
  app: string;
  /** what the page can do besides the canvas tools */
  features: string[];
};

/** page -> server */
export type McpPageMessage =
  | { v: 1; type: "mcp:auth"; code: string }
  | ({ v: 1; type: "mcp:state" } & McpPageState)
  | { v: 1; type: "mcp:result"; id: string; ok: true; result: unknown }
  | { v: 1; type: "mcp:result"; id: string; ok: false; error: McpError }
  | { v: 1; type: "pong" };

/** server -> page */
export type McpServerMessage =
  | { v: 1; type: "mcp:ready"; server: string; version: string }
  | { v: 1; type: "mcp:call"; id: string; tool: string; args: unknown }
  | { v: 1; type: "ping" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isMcpErrorCode = (value: unknown): value is McpErrorCode =>
  typeof value === "string" &&
  (MCP_ERROR_CODES as readonly string[]).includes(value);

/** a message from the page, or null when it is not one the protocol has */
export const parseMcpPageMessage = (text: string): McpPageMessage | null => {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.v !== MCP_PROTOCOL_VERSION) {
    return null;
  }

  switch (value.type) {
    case "mcp:auth":
      return typeof value.code === "string"
        ? { v: 1, type: "mcp:auth", code: value.code }
        : null;
    case "mcp:state":
      return typeof value.allowChanges === "boolean" &&
        typeof value.app === "string" &&
        Array.isArray(value.features) &&
        value.features.every((feature) => typeof feature === "string")
        ? {
            v: 1,
            type: "mcp:state",
            allowChanges: value.allowChanges,
            app: value.app,
            features: value.features as string[],
          }
        : null;
    case "mcp:result":
      if (typeof value.id !== "string") {
        return null;
      }

      if (value.ok === true) {
        return {
          v: 1,
          type: "mcp:result",
          id: value.id,
          ok: true,
          result: value.result,
        };
      }

      return value.ok === false &&
        isRecord(value.error) &&
        isMcpErrorCode(value.error.code) &&
        typeof value.error.message === "string"
        ? {
            v: 1,
            type: "mcp:result",
            id: value.id,
            ok: false,
            error: { code: value.error.code, message: value.error.message },
          }
        : null;
    case "pong":
      return { v: 1, type: "pong" };
    default:
      return null;
  }
};

/** a message from the server, or null when it is not one the protocol has */
export const parseMcpServerMessage = (
  text: string,
): McpServerMessage | null => {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.v !== MCP_PROTOCOL_VERSION) {
    return null;
  }

  switch (value.type) {
    case "mcp:ready":
      return typeof value.server === "string" &&
        typeof value.version === "string"
        ? {
            v: 1,
            type: "mcp:ready",
            server: value.server,
            version: value.version,
          }
        : null;
    case "mcp:call":
      return typeof value.id === "string" && typeof value.tool === "string"
        ? {
            v: 1,
            type: "mcp:call",
            id: value.id,
            tool: value.tool,
            args: value.args,
          }
        : null;
    case "ping":
      return { v: 1, type: "ping" };
    default:
      return null;
  }
};

export const encodeMcpMessage = (
  message: McpPageMessage | McpServerMessage,
): string => JSON.stringify(message);
