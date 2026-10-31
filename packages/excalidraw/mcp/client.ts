/**
 * The page's end of the link to the MCP server (D-397, D-398).
 *
 * It uses the browser's own `WebSocket` and has no dependency. It connects to the
 * server's loopback address, presents the pairing code in its first frame, tells
 * the server what is on (Allow changes), answers each call with the runner's
 * result, and - like the VS Code bridge's client - says honestly where it stands:
 * it never reports "connected" before the server has accepted the code, a refused
 * code is a different state from a server that is not there, and a refused code
 * is not retried.
 */

import {
  MCP_CLOSE_UNAUTHORIZED,
  MCP_MAX_MESSAGE_BYTES,
  encodeMcpMessage,
  parseMcpServerMessage,
} from "./protocol";

import type { McpPageMessage, McpPageState } from "./protocol";
import type { McpRunOutcome } from "./runner";

export type McpClientStatus =
  /** not started, or stopped */
  | "idle"
  /** trying to reach the server */
  | "connecting"
  /** the server accepted the code */
  | "connected"
  /** the server is there and did not accept the code */
  | "refused";

export type McpClientState = {
  status: McpClientStatus;
  /** a sentence for the person; never empty */
  message: string;
  /** how many times the client has tried to connect */
  attempt: number;
};

/** the part of the browser's `WebSocket` the client uses */
export interface McpWebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type McpWebSocketConstructor = new (url: string) => McpWebSocketLike;

const OPEN = 1;

export const MCP_RETRY_FIRST_MS = 1_000;
export const MCP_RETRY_MAX_MS = 15_000;

export type McpClient = {
  /** connects, and goes on trying until stopped or refused */
  start: () => void;
  stop: () => void;
  /** tells the server what is on now (Allow changes) */
  pushState: () => void;
  state: () => McpClientState;
};

export const describeMcpState = (
  status: McpClientStatus,
  attempt: number,
): string => {
  switch (status) {
    case "idle":
      return "Not connected to an assistant.";
    case "connecting":
      return attempt > 1
        ? "Waiting for the assistant's server. Is it running? (Your assistant starts it.)"
        : "Connecting to the assistant's server…";
    case "connected":
      return "Connected to the assistant.";
    case "refused":
      return "The assistant's server did not accept that pairing code. Ask the assistant for the code again (its status tool tells it) and type it here.";
  }
};

export const createMcpClient = ({
  url,
  getCode,
  getState,
  onCall,
  onStateChange = () => undefined,
  WebSocketImpl = globalThis.WebSocket as unknown as McpWebSocketConstructor,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
}: {
  url: string;
  /** the pairing code, read each time the client connects */
  getCode: () => string;
  getState: () => McpPageState;
  onCall: (tool: string, args: unknown) => Promise<McpRunOutcome>;
  onStateChange?: (state: McpClientState) => void;
  WebSocketImpl?: McpWebSocketConstructor;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): McpClient => {
  let state: McpClientState = {
    status: "idle",
    message: describeMcpState("idle", 0),
    attempt: 0,
  };
  let socket: McpWebSocketLike | null = null;
  let retry: unknown = null;
  let running = false;
  let delay = MCP_RETRY_FIRST_MS;
  /** the calls are run one at a time, in the order they came */
  let queue: Promise<void> = Promise.resolve();

  const set = (status: McpClientStatus, attempt = state.attempt) => {
    state = { status, message: describeMcpState(status, attempt), attempt };
    onStateChange(state);
  };

  const send = (message: McpPageMessage) => {
    if (socket && socket.readyState === OPEN) {
      socket.send(encodeMcpMessage(message));
    }
  };

  const reply = (id: string, outcome: McpRunOutcome) => {
    const message: McpPageMessage = outcome.ok
      ? { v: 1, type: "mcp:result", id, ok: true, result: outcome.result }
      : { v: 1, type: "mcp:result", id, ok: false, error: outcome.error };
    const text = encodeMcpMessage(message);

    if (text.length > MCP_MAX_MESSAGE_BYTES) {
      send({
        v: 1,
        type: "mcp:result",
        id,
        ok: false,
        error: {
          code: "too-large",
          message:
            "The answer is larger than a message may be. Ask for less at a time.",
        },
      });
      return;
    }

    if (socket && socket.readyState === OPEN) {
      socket.send(text);
    }
  };

  const connect = () => {
    retry = null;

    if (!running) {
      return;
    }

    set("connecting", state.attempt + 1);

    let ready = false;
    let ws: McpWebSocketLike;

    try {
      ws = new WebSocketImpl(url);
    } catch {
      scheduleRetry();
      return;
    }

    socket = ws;

    ws.onopen = () => {
      // the pairing code is the first frame, and nothing else goes before it
      ws.send(encodeMcpMessage({ v: 1, type: "mcp:auth", code: getCode() }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      const message = parseMcpServerMessage(event.data);

      if (!message) {
        return;
      }

      if (message.type === "mcp:ready") {
        ready = true;
        delay = MCP_RETRY_FIRST_MS;
        set("connected");
        send({ v: 1, type: "mcp:state", ...getState() });
      } else if (message.type === "ping") {
        send({ v: 1, type: "pong" });
      } else if (message.type === "mcp:call" && ready) {
        const { id, tool, args } = message;

        queue = queue.then(async () => {
          let outcome: McpRunOutcome;

          try {
            outcome = await onCall(tool, args);
          } catch (error) {
            outcome = {
              ok: false,
              error: {
                code: "failed",
                message: error instanceof Error ? error.message : String(error),
              },
            };
          }

          reply(id, outcome);
        });
      }
    };

    ws.onclose = (event) => {
      if (socket === ws) {
        socket = null;
      }

      if (!running) {
        return;
      }

      if (!ready && event.code === MCP_CLOSE_UNAUTHORIZED) {
        // a code that was refused is not tried again until the person types another
        running = false;
        set("refused");
        return;
      }

      scheduleRetry();
    };

    ws.onerror = () => {
      // the close that follows decides what happens next
    };
  };

  const scheduleRetry = () => {
    if (!running || retry !== null) {
      return;
    }

    set("connecting");
    retry = setTimer(connect, delay);
    delay = Math.min(delay * 2, MCP_RETRY_MAX_MS);
  };

  return {
    start: () => {
      if (running) {
        return;
      }

      running = true;
      delay = MCP_RETRY_FIRST_MS;
      state = { ...state, attempt: 0 };
      connect();
    },
    stop: () => {
      running = false;

      if (retry !== null) {
        clearTimer(retry);
        retry = null;
      }

      const open = socket;

      socket = null;
      open?.close(1000);
      set("idle", 0);
    },
    pushState: () => {
      if (state.status === "connected") {
        send({ v: 1, type: "mcp:state", ...getState() });
      }
    },
    state: () => state,
  };
};
