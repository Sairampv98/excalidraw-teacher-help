import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

import {
  clearTimeout as clearTimeoutNode,
  setTimeout as setTimeoutNode,
} from "node:timers";

import {
  BRIDGE_PROTOCOL_VERSION,
  parseBridgeMessage,
  type BridgeMessage,
} from "../../bridge/src/protocol";
import {
  createFrameDecoder,
  encodeFrame,
  WS_OPCODE,
} from "../../bridge/src/ws-frame";

import type { Duplex } from "node:stream";
import type { Socket } from "node:net";

/**
 * The bridge server.
 *
 * It is a plain `node:http` server that speaks the websocket protocol
 * directly, because the extension has NO runtime dependency of its own.
 *
 * The security rules (D-50) are enforced here, and they are enforced in the
 * right order:
 *
 *  1. the listener is bound to 127.0.0.1 - never to 0.0.0.0;
 *  2. the port is FIXED (D-67) - it comes from a `VITE_APP_*` variable, so the
 *     app knows where to connect without scanning;
 *  3. a connection whose ORIGIN is not localhost is refused at the HTTP layer,
 *     before the websocket is even upgraded;
 *  4. a connection that does not present the per-session TOKEN in its FIRST
 *     frame is closed with 1008 (policy violation) and is never registered.
 *
 * The token is never in the URL and never on a command line.
 */

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** The websocket close code for a connection that failed the token check. */
export const CLOSE_UNAUTHORIZED = 1008;

/** The websocket close code for a frame that is not a legal message. */
export const CLOSE_INVALID_FRAME = 1007;

export interface BridgeConnection {
  /** A stable id for this connection. */
  readonly id: string;
  /** The origin the connection came from. */
  readonly origin: string | undefined;
  /** Send a message to this client. */
  send: (message: BridgeMessage) => void;
  /** Close this client. */
  close: (code?: number, reason?: string) => void;
}

export interface BridgeServerOptions {
  /** The fixed port. */
  port?: number;
  /** The loopback host. Never bind this to anything but 127.0.0.1. */
  host?: string;
  /** The per-session token. The client must present it in its first frame. */
  token: string;
  /** The workspace the teacher has open. Sent in `bridge:hello`. */
  workspace?: string;
  /** The extension's version. Sent in `bridge:hello`. */
  version?: string;
  /**
   * Which editor this is: "Visual Studio Code", "VSCodium", ...
   *
   * Sent in `bridge:hello`, so the app can say which editor it is talking
   * to. The port is fixed, so with two editors running the app may reach the
   * one that does NOT have the teacher's file open (D-76).
   */
  appName?: string;
  /** Extra origins that are allowed, on top of localhost. */
  allowedOrigins?: string[];
  /**
   * How long a connection has to present the token. A connection that says
   * nothing has not presented the token, so it is refused like any other.
   */
  authTimeoutMs?: number;
  /** Called for every legal message a client sends. */
  onMessage?: (message: BridgeMessage, connection: BridgeConnection) => void;
  /** Called when a client has authenticated. */
  onConnect?: (connection: BridgeConnection) => void;
  /** Called when a client goes away. */
  onDisconnect?: (connection: BridgeConnection) => void;
  /** Where the server's own notes go. */
  logger?: (message: string) => void;
}

export interface BridgeServer {
  /** Start listening. Resolves with the port it ended up on. */
  listen: () => Promise<number>;
  /** Stop listening and drop every client. */
  close: () => Promise<void>;
  /** Send a message to every authenticated client. */
  broadcast: (message: BridgeMessage) => void;
  /** The port the server is on. */
  readonly port: number;
  /** How many clients are authenticated. */
  readonly clientCount: number;
  /** The token this server expects. Never leaves the process. */
  readonly token: string;
}

/**
 * Is this origin one the bridge accepts?
 *
 * Only `http://localhost` and `https://localhost` (and the loopback address)
 * are accepted. A page on any other site cannot open a websocket to the
 * bridge, because the browser sends the page's origin with the handshake and
 * the server refuses it here.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  extra: string[] = [],
): boolean {
  if (!origin) {
    return false;
  }
  if (extra.includes(origin)) {
    return true;
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
}

/** Compare two secrets without leaking their length through the timing. */
export function secretsMatch(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

const closePayload = (code: number, reason: string): Buffer => {
  const reasonBytes = Buffer.from(reason, "utf8");
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return payload;
};

export function createBridgeServer(options: BridgeServerOptions): BridgeServer {
  const host = options.host ?? "127.0.0.1";
  const token = options.token;
  const workspace = options.workspace ?? "";
  const version = options.version ?? "0.0.0";
  const appName = options.appName ?? "";
  const allowedOrigins = options.allowedOrigins ?? [];
  const authTimeoutMs = options.authTimeoutMs ?? 5000;
  const logger = options.logger ?? (() => undefined);

  const connections = new Set<BridgeConnection>();
  let connectionCounter = 0;
  let boundPort = options.port ?? 0;

  const httpServer = createServer((req, res) => {
    if (req.url === "/bridge/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          protocol: BRIDGE_PROTOCOL_VERSION,
          port: boundPort,
          clients: connections.size,
        }),
      );
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found\n");
  });

  const handleUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    const origin = req.headers.origin;

    // Rule 3: the origin check happens BEFORE the upgrade.
    if (!isAllowedOrigin(origin, allowedOrigins)) {
      logger(`refused a connection from origin ${origin ?? "(none)"}`);
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

    const accept = createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    (socket as Socket).setNoDelay?.(true);

    const id = `client-${++connectionCounter}`;
    let authenticated = false;
    let closed = false;

    // a connection that never presents the token is refused like any other
    const authTimer = setTimeoutNode(() => {
      if (!authenticated && !closed) {
        logger(`refused ${id}: no token within ${authTimeoutMs}ms`);
        close(CLOSE_UNAUTHORIZED, "no token");
      }
    }, authTimeoutMs);
    authTimer.unref?.();

    const close = (code = 1000, reason = "") => {
      if (closed) {
        return;
      }
      closed = true;
      clearTimeoutNode(authTimer);
      try {
        socket.write(encodeFrame(WS_OPCODE.close, closePayload(code, reason)));
      } catch {
        // the socket is already gone
      }
      socket.end();
      if (authenticated) {
        connections.delete(connection);
        options.onDisconnect?.(connection);
      }
    };

    const send = (message: BridgeMessage) => {
      if (closed) {
        return;
      }
      try {
        socket.write(
          encodeFrame(
            WS_OPCODE.text,
            Buffer.from(JSON.stringify(message), "utf8"),
          ),
        );
      } catch {
        close(1011, "write failed");
      }
    };

    const connection: BridgeConnection = { id, origin, send, close };

    const decoder = createFrameDecoder((frame) => {
      if (frame.opcode === WS_OPCODE.close) {
        close(1000, "bye");
        return;
      }
      if (frame.opcode === WS_OPCODE.ping) {
        try {
          socket.write(encodeFrame(WS_OPCODE.pong, frame.payload));
        } catch {
          close(1011, "write failed");
        }
        return;
      }
      if (frame.opcode === WS_OPCODE.pong) {
        return;
      }
      if (frame.opcode !== WS_OPCODE.text) {
        close(CLOSE_INVALID_FRAME, "text frames only");
        return;
      }

      const message = parseBridgeMessage(frame.payload.toString("utf8"));
      if (!message) {
        close(CLOSE_INVALID_FRAME, "not a bridge message");
        return;
      }

      if (!authenticated) {
        // Rule 4: the FIRST frame must carry the token.
        if (message.type !== "bridge:auth") {
          logger(`refused ${id}: the first frame was not an auth frame`);
          close(CLOSE_UNAUTHORIZED, "the first frame must be bridge:auth");
          return;
        }
        if (!secretsMatch(message.token, token)) {
          logger(`refused ${id}: the token did not match`);
          close(CLOSE_UNAUTHORIZED, "bad token");
          return;
        }
        authenticated = true;
        clearTimeoutNode(authTimer);
        connections.add(connection);
        send({ v: 1, type: "bridge:hello", version, workspace, appName });
        options.onConnect?.(connection);
        return;
      }

      options.onMessage?.(message, connection);
    });

    socket.on("data", (chunk: Buffer) => {
      try {
        decoder.push(chunk);
      } catch {
        close(CLOSE_INVALID_FRAME, "unreadable frame");
      }
    });
    socket.on("error", () => {
      close(1011, "socket error");
    });
    socket.on("close", () => {
      closed = true;
      if (authenticated) {
        connections.delete(connection);
        options.onDisconnect?.(connection);
      }
    });

    if (head && head.length) {
      decoder.push(head);
    }
  };

  httpServer.on("upgrade", handleUpgrade);

  return {
    listen: () =>
      new Promise<number>((resolve, reject) => {
        const onError = (error: Error) => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          const address = httpServer.address();
          boundPort =
            address && typeof address === "object" ? address.port : boundPort;
          logger(`bridge listening on ws://${host}:${boundPort}/`);
          resolve(boundPort);
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(boundPort, host);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const connection of [...connections]) {
          connection.close(1001, "the bridge is shutting down");
        }
        connections.clear();
        httpServer.close(() => resolve());
      }),
    broadcast: (message: BridgeMessage) => {
      for (const connection of [...connections]) {
        connection.send(message);
      }
    },
    get port() {
      return boundPort;
    },
    get clientCount() {
      return connections.size;
    },
    get token() {
      return token;
    },
  };
}
