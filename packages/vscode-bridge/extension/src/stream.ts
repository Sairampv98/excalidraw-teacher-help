import { randomBytes } from "node:crypto";

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The **MJPEG stream** - the live view of the editor's own window (D-85).
 *
 * Wave 5g sent every frame over the websocket as a base64 PNG, and the app
 * paid for it: 154,512 bytes on the wire for a 115,884-byte picture, a JSON
 * parse, a ~154 KB data URL, a DOM swap and a layout - 3.3 ms of main thread
 * and five React re-renders of the panel a second.
 *
 * The idea worth taking from WindowStream is its **transport**: the frames are
 * served as `multipart/x-mixed-replace` and the browser plays them in a plain
 * `<img>`. The browser decodes the JPEG natively, so the app does **nothing**
 * per frame.
 *
 * The stream is served by the **same** `node:http` server that carries the
 * websocket upgrade - the same fixed loopback port (D-67), a different path -
 * so there is no second port and no second process.
 *
 * The rules this module keeps:
 *
 *  - **the capability is the authorisation** (D-86). The session token is
 *    never in a URL (D-50); the URL carries a single-purpose, per-connection
 *    capability instead, and a request that does not carry a live one gets a
 *    404.
 *  - **the last frame goes out immediately**, so a panel that opens the live
 *    view is never blank.
 *  - **the stream is never silent for long**: if the picture has not changed
 *    for five seconds the last frame is re-sent, because the browser's
 *    watchdog gives up on a silent stream after twelve.
 */

/** The boundary of the multipart stream. */
export const MJPEG_BOUNDARY = "frame";

/** The path the stream is served at. The capability sits in the middle. */
export const STREAM_PATH_PREFIX = "/s";

/** The last segment of the stream's path. */
export const STREAM_PATH_SUFFIX = "frame";

/**
 * How long the picture may stay unchanged before the last frame is re-sent.
 *
 * The browser's watchdog on a multipart stream gives up after twelve seconds,
 * so five leaves room for two misses.
 */
export const STREAM_KEEPALIVE_MS = 5000;

/** How many bytes of randomness the capability has. */
export const STREAM_CAPABILITY_BYTES = 16;

/** One frame of the editor's window, ready to be written to the stream. */
export interface MjpegFrame {
  /** the JPEG bytes, exactly as the helper wrote them */
  bytes: Buffer;
  /** the frame's number: 1, 2, 3 ... */
  seq: number;
}

export interface MjpegStreamOptions {
  /**
   * The port the server ended up on.
   *
   * It is a function because the port is only known once the server listens,
   * and the capability's URL is written when a connection authenticates -
   * which is always after that.
   */
  port: () => number;
  /** the loopback host. Never bind this to anything but 127.0.0.1. */
  host?: string;
  /** how long an unchanged picture waits before the last frame is re-sent */
  keepAliveMs?: number;
}

export interface MjpegStream {
  /**
   * A capability for a new connection.
   *
   * It is **per connection**: the caller revokes it when the connection
   * closes, and a capability that was never issued is refused.
   */
  createCapability: () => string;
  /** the URL the panel points its `<img>` at */
  urlFor: (capability: string) => string;
  /** the capability stops working, and every stream it opened is closed */
  revoke: (capability: string) => void;
  /** a frame arrived */
  publish: (frame: MjpegFrame) => void;
  /**
   * Serve a request.
   *
   * It answers `true` when the request was for the stream - including a
   * request that was refused with a 404 - and `false` when the request was
   * for something else entirely.
   */
  handle: (req: IncomingMessage, res: ServerResponse) => boolean;
  /** close every open stream */
  close: () => void;
}

/** The path of a stream, with the capability in it. */
export const streamPath = (capability: string): string =>
  `${STREAM_PATH_PREFIX}/${capability}/${STREAM_PATH_SUFFIX}`;

const STREAM_ROUTE = new RegExp(
  `^${STREAM_PATH_PREFIX}/([^/]+)/${STREAM_PATH_SUFFIX}$`,
);

export const createMjpegStream = (options: MjpegStreamOptions): MjpegStream => {
  const host = options.host ?? "127.0.0.1";
  const keepAliveMs = options.keepAliveMs ?? STREAM_KEEPALIVE_MS;

  /** the capability -> the streams it has opened */
  const capabilities = new Map<string, Set<ServerResponse>>();

  /** the last frame, so a client that connects is never blank */
  let lastFrame: MjpegFrame | null = null;

  /** when the last frame was published, so a silent stream can be refreshed */
  let lastFrameAt = 0;

  /**
   * Write one part of the stream.
   *
   * A part is the boundary, the JPEG's headers and the bytes:
   *
   *   --frame\r\nContent-Type: image/jpeg\r\nContent-Length: <n>\r\n
   *   X-Seq: <seq>\r\n\r\n<bytes>\r\n
   */
  const writePart = (res: ServerResponse, frame: MjpegFrame): boolean => {
    if (res.writableEnded || res.destroyed) {
      return false;
    }

    try {
      res.write(
        `--${MJPEG_BOUNDARY}\r\n` +
          `Content-Type: image/jpeg\r\n` +
          `Content-Length: ${frame.bytes.length}\r\n` +
          `X-Seq: ${frame.seq}\r\n\r\n`,
      );
      res.write(frame.bytes);
      res.write("\r\n");
      return true;
    } catch {
      // the client is gone
      return false;
    }
  };

  const publish = (frame: MjpegFrame) => {
    lastFrame = frame;
    lastFrameAt = Date.now();

    for (const responses of [...capabilities.values()]) {
      for (const res of [...responses]) {
        writePart(res, frame);
      }
    }
  };

  const createCapability = () => {
    // 32 hex characters: unguessable, and per connection (D-86)
    const capability = randomBytes(STREAM_CAPABILITY_BYTES).toString("hex");
    capabilities.set(capability, new Set());
    return capability;
  };

  const urlFor = (capability: string) =>
    `http://${host}:${options.port()}${streamPath(capability)}`;

  const revoke = (capability: string) => {
    const responses = capabilities.get(capability);

    if (!responses) {
      return;
    }

    capabilities.delete(capability);

    for (const res of [...responses]) {
      try {
        res.end();
      } catch {
        // already gone
      }

      try {
        // and the socket with it: an open multipart response would keep the
        // server from shutting down
        res.destroy();
      } catch {
        // already gone
      }
    }

    responses.clear();
  };

  const handle = (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const match = STREAM_ROUTE.exec(path);

    if (!match) {
      return false;
    }

    const capability = match[1] ?? "";
    const responses = capabilities.get(capability);

    if (!responses) {
      // The capability is the authorisation (D-86): a request that does not
      // carry a live one is refused, and it is a 404 so that the endpoint
      // does not say what it is.
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found\n");
      return true;
    }

    res.writeHead(200, {
      "content-type": `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
      "cache-control": "no-store, no-cache, must-revalidate",
      connection: "close",
      // a proxy must not buffer the stream
      "x-accel-buffering": "no",
    });

    // The headers go out NOW, before there is a frame: the browser has to
    // know the stream is a multipart one even while the picture is still the
    // same as it was.
    res.flushHeaders();

    responses.add(res);

    // The LAST frame goes out immediately, so a panel that opens the live
    // view is never blank.
    if (lastFrame) {
      writePart(res, lastFrame);
    }

    const keepAlive = setInterval(() => {
      // The picture has not changed for long enough: re-send the last frame,
      // with the same X-Seq, so the browser's watchdog does not give up on a
      // silent stream.
      if (lastFrame && Date.now() - lastFrameAt >= keepAliveMs) {
        writePart(res, lastFrame);
      }
    }, keepAliveMs);

    keepAlive.unref?.();

    const cleanup = () => {
      clearInterval(keepAlive);
      responses.delete(res);
    };

    res.on("close", cleanup);
    res.on("error", cleanup);
    return true;
  };

  const close = () => {
    for (const capability of [...capabilities.keys()]) {
      revoke(capability);
    }
    capabilities.clear();
  };

  return { createCapability, urlFor, revoke, publish, handle, close };
};
