/**
 * The link to the page (D-397, D-398): a websocket server on the loopback
 * interface, written on `node:http` and the bridge's own frame codec - there is
 * no websocket dependency, exactly as in the VS Code bridge.
 *
 * The rules, the same as the bridge's (D-50, D-67):
 *  - it listens on 127.0.0.1 only, on a fixed port;
 *  - the origin is checked BEFORE the upgrade, and only a page served from the
 *    loopback interface may connect;
 *  - the first frame is the pairing code; nothing else is accepted from a
 *    connection before that, and a wrong code is closed with 1008;
 *  - one page is paired at a time: a page that pairs later takes over from the
 *    one before it.
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";

import {
  WS_OPCODE,
  createFrameDecoder,
  encodeFrame,
} from "../../vscode-bridge/bridge/src/ws-frame";
import {
  DEFAULT_MCP_HOST,
  DEFAULT_MCP_PORT,
  MCP_CALL_TIMEOUT_MS,
  MCP_CLOSE_UNAUTHORIZED,
  MCP_MAX_MESSAGE_BYTES,
  encodeMcpMessage,
  parseMcpPageMessage,
} from "../../excalidraw/mcp/protocol";

import { pairingCodesMatch } from "./pairing";

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type {
  McpError,
  McpErrorCode,
  McpPageState,
  McpServerMessage,
} from "../../excalidraw/mcp/protocol";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** how long a connection may stay silent before it has to pair */
export const AUTH_WINDOW_MS = 5_000;

/** how often the server asks a paired page whether it is still there */
const PING_EVERY_MS = 20_000;

/** a call that ended with an error the protocol names */
export class McpCallError extends Error {
  readonly code: McpErrorCode;

  constructor({ code, message }: McpError) {
    super(message);
    this.name = "McpCallError";
    this.code = code;
  }
}

/** a loopback origin: the app served from this machine, on any port */
export const isLoopbackOrigin = (origin: string | undefined): boolean => {
  if (!origin) {
    return false;
  }

  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const host = url.hostname.toLowerCase();

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
};

export type PageLink = {
  /** starts listening; resolves with the port it is on */
  start: () => Promise<number>;
  stop: () => Promise<void>;
  /** asks the page to run a tool, and waits for the answer */
  call: (tool: string, args: unknown, timeoutMs?: number) => Promise<unknown>;
  /** whether a page is paired, and what it said about itself */
  status: () => { connected: boolean; state: McpPageState | null };
};

export const createPageLink = ({
  code,
  serverName,
  version,
  host = DEFAULT_MCP_HOST,
  port = DEFAULT_MCP_PORT,
  authWindowMs = AUTH_WINDOW_MS,
  log = () => undefined,
}: {
  code: string;
  serverName: string;
  version: string;
  host?: string;
  port?: number;
  /** how long a connection may stay silent before it has to pair */
  authWindowMs?: number;
  log?: (message: string) => void;
}): PageLink => {
  type Page = {
    socket: Duplex;
    state: McpPageState | null;
    ping: ReturnType<typeof setInterval>;
  };

  let page: Page | null = null;
  const sockets = new Set<Duplex>();
  let counter = 0;

  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const send = (socket: Duplex, message: McpServerMessage) => {
    if (!socket.destroyed) {
      socket.write(
        encodeFrame(WS_OPCODE.text, Buffer.from(encodeMcpMessage(message))),
      );
    }
  };

  const close = (socket: Duplex, closeCode: number) => {
    if (!socket.destroyed) {
      const payload = Buffer.alloc(2);

      payload.writeUInt16BE(closeCode);
      socket.write(encodeFrame(WS_OPCODE.close, payload));
      socket.end();
    }
  };

  /** every call that is waiting ends: there is no page to answer it */
  const failAll = (message: string) => {
    for (const [id, waiting] of pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new McpCallError({ code: "not-connected", message }));
      pending.delete(id);
    }
  };

  const forget = (socket: Duplex) => {
    sockets.delete(socket);

    if (page?.socket === socket) {
      clearInterval(page.ping);
      page = null;
      failAll("The page disconnected while the call was running.");
    }
  };

  const handleUpgrade = (req: IncomingMessage, socket: Duplex) => {
    const origin = req.headers.origin;

    // the origin is checked before the upgrade
    if (!isLoopbackOrigin(origin)) {
      log(`refused a connection from origin ${origin ?? "(none)"}`);
      socket.write(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      socket.destroy();
      return;
    }

    const key = req.headers["sec-websocket-key"];

    if (typeof key !== "string" || !key) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${createHash("sha1")
          .update(key + WS_GUID)
          .digest("base64")}\r\n\r\n`,
    );
    (socket as unknown as { setNoDelay?: (on: boolean) => void }).setNoDelay?.(
      true,
    );
    sockets.add(socket);

    const id = ++counter;
    let paired = false;
    const authTimer = setTimeout(() => {
      if (!paired) {
        log(`connection ${id} did not pair in time`);
        close(socket, MCP_CLOSE_UNAUTHORIZED);
      }
    }, authWindowMs);

    const decoder = createFrameDecoder((frame) => {
      if (frame.opcode === WS_OPCODE.close) {
        close(socket, 1000);
        return;
      }

      if (frame.opcode === WS_OPCODE.ping) {
        socket.write(encodeFrame(WS_OPCODE.pong, frame.payload));
        return;
      }

      if (frame.opcode !== WS_OPCODE.text) {
        return;
      }

      if (frame.payload.length > MCP_MAX_MESSAGE_BYTES) {
        close(socket, 1009);
        return;
      }

      const message = parseMcpPageMessage(frame.payload.toString("utf8"));

      if (!message) {
        return;
      }

      if (!paired) {
        // the first frame must be the pairing code, and nothing else will do
        if (
          message.type !== "mcp:auth" ||
          !pairingCodesMatch(message.code, code)
        ) {
          log(`connection ${id} presented a wrong code`);
          close(socket, MCP_CLOSE_UNAUTHORIZED);
          return;
        }

        paired = true;
        clearTimeout(authTimer);

        if (page) {
          // the page that pairs later takes over from the one before it
          const before = page.socket;

          clearInterval(page.ping);
          page = null;
          failAll("Another page paired with the server.");
          close(before, 1000);
        }

        page = {
          socket,
          state: null,
          ping: setInterval(
            () => send(socket, { v: 1, type: "ping" }),
            PING_EVERY_MS,
          ),
        };
        send(socket, { v: 1, type: "mcp:ready", server: serverName, version });
        log(`page ${id} paired`);
        return;
      }

      if (!page || page.socket !== socket) {
        return;
      }

      if (message.type === "mcp:state") {
        page.state = {
          allowChanges: message.allowChanges,
          ...(message.allowInternet !== undefined
            ? { allowInternet: message.allowInternet }
            : {}),
          app: message.app,
          features: message.features,
        };
      } else if (message.type === "mcp:result") {
        const waiting = pending.get(message.id);

        if (!waiting) {
          return;
        }

        pending.delete(message.id);
        clearTimeout(waiting.timer);

        if (message.ok) {
          waiting.resolve(message.result);
        } else {
          waiting.reject(new McpCallError(message.error));
        }
      }
    });

    socket.on("data", (chunk) => decoder.push(chunk as Buffer));
    // the page went away: an http socket stays half open until this end closes too
    socket.on("end", () => {
      clearTimeout(authTimer);
      forget(socket);
      socket.end();
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      forget(socket);
    });
    socket.on("error", () => {
      clearTimeout(authTimer);
      forget(socket);
    });
  };

  let httpServer: Server | null = null;

  return {
    start: () =>
      new Promise<number>((resolve, reject) => {
        httpServer = createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("excalidraw mcp server\n");
        });
        httpServer.on("upgrade", (req, socket) => handleUpgrade(req, socket));
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          const address = httpServer!.address();

          resolve(typeof address === "object" && address ? address.port : port);
        });
      }),

    stop: () =>
      new Promise<void>((resolve) => {
        failAll("The server is stopping.");

        for (const socket of sockets) {
          socket.destroy();
        }

        sockets.clear();

        if (!httpServer) {
          resolve();
          return;
        }

        httpServer.close(() => resolve());
      }),

    call: (tool, args, timeoutMs = MCP_CALL_TIMEOUT_MS) =>
      new Promise((resolve, reject) => {
        if (!page) {
          reject(
            new McpCallError({
              code: "not-connected",
              message:
                "The whiteboard is not connected. Ask the person to open it and enter the pairing code in the Assistant panel (the status tool tells the code).",
            }),
          );
          return;
        }

        const callId = `call-${++counter}`;
        const timer = setTimeout(() => {
          pending.delete(callId);
          reject(
            new McpCallError({
              code: "timeout",
              message: `The page did not answer ${tool} in ${Math.round(
                timeoutMs / 1000,
              )} seconds.`,
            }),
          );
        }, timeoutMs);

        pending.set(callId, { resolve, reject, timer });
        send(page.socket, { v: 1, type: "mcp:call", id: callId, tool, args });
      }),

    status: () => ({ connected: !!page, state: page?.state ?? null }),
  };
};
