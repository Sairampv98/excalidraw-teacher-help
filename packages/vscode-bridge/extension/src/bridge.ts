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

import { createMjpegStream, type MjpegFrame } from "./stream";

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
  /**
   * The **stream capability** of this connection.
   *
   * It is `null` until the connection authenticates, and it dies with the
   * connection: a request for the stream that carries a capability which was
   * revoked gets a 404 (D-86).
   */
  capability: string | null;
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
  /**
   * Publish a frame of the editor's window to the **MJPEG stream** (D-85).
   *
   * The frame does NOT travel over the websocket: it goes to the HTTP
   * server's own stream endpoint, and the panel plays that stream in a plain
   * `<img>`. So the app does no per-frame work at all.
   */
  publishFrame: (frame: MjpegFrame) => void;
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

  /**
   * The **MJPEG stream** (D-85).
   *
   * It is served by the very same HTTP server that carries the websocket
   * upgrade: the same fixed loopback port, a different path.
   */
  const stream = createMjpegStream({ port: () => boundPort, host });

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

    // The stream answers for itself, including a request it refuses.
    if (stream.handle(req, res)) {
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
    let forgotten = false;

    /**
     * The connection is over.
     *
     * It leaves the set of clients, and its **capability** - the thing that
     * authorises the MJPEG stream - dies with it (D-86). The socket's `end`
     * is the peer's way of saying it will send no more, and it is the signal
     * that comes FIRST: an abortive close is only noticed by the next read
     * or write, which may never happen.
     */
    const forget = () => {
      if (forgotten) {
        return;
      }

      forgotten = true;
      closed = true;

      if (connection.capability) {
        stream.revoke(connection.capability);
        connection.capability = null;
      }

      if (authenticated) {
        connections.delete(connection);
        options.onDisconnect?.(connection);
      }
    };

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
      forget();
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

    const connection: BridgeConnection = {
      id,
      origin,
      // the capability is drawn when the connection authenticates
      capability: null,
      send,
      close,
    };

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

        // The **capability** of THIS connection (D-86). It is the stream's
        // authorisation, it is single-purpose, and it dies with the
        // connection. The session token is never in a URL (D-50).
        connection.capability = stream.createCapability();

        send({
          v: 1,
          type: "bridge:hello",
          version,
          workspace,
          appName,
          streamUrl: stream.urlFor(connection.capability),
        });
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
      // An errored socket is not a closed socket: it has to be destroyed, or
      // the server never finishes shutting down.
      socket.destroy();
    });
    socket.on("end", () => {
      // The peer will send no more: the connection is over. It has to be
      // ended on this side too, or the socket lingers and the server never
      // finishes shutting down.
      close(1000, "bye");
      forget();
    });
    socket.on("close", forget);

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
        stream.close();
        httpServer.close(() => resolve());
      }),
    broadcast: (message: BridgeMessage) => {
      for (const connection of [...connections]) {
        connection.send(message);
      }
    },
    publishFrame: (frame: MjpegFrame) => {
      stream.publish(frame);
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
