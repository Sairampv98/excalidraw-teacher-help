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
 * The last segment of the **snapshot's** path.
 *
 * One more segment under the same capability: the capability that authorises
 * the stream authorises the snapshot too, because it is the same picture of
 * the same window (D-86, D-102).
 */
export const SNAPSHOT_PATH_SUFFIX = "snapshot";

/**
 * How long the picture may stay unchanged before the last frame is re-sent.
 *
 * The browser's watchdog on a multipart stream gives up after twelve seconds,
 * so five leaves room for two misses.
 */
export const STREAM_KEEPALIVE_MS = 5000;

/** How many bytes of randomness the capability has. */
export const STREAM_CAPABILITY_BYTES = 16;

/**
 * The headers that carry the picture's own size (D-102).
 *
 * They are named here because the browser HIDES a header that is not
 * CORS-safelisted from the page's JavaScript - so the answer has to say that
 * these two may be read (D-151).
 */
export const FRAME_WIDTH_HEADER = "x-frame-width";
export const FRAME_HEIGHT_HEADER = "x-frame-height";
export const FRAME_SIZE_HEADERS = [FRAME_WIDTH_HEADER, FRAME_HEIGHT_HEADER];

/** One frame of the editor's window, ready to be written to the stream. */
export interface MjpegFrame {
  /** the JPEG bytes, exactly as the helper wrote them */
  bytes: Buffer;
  /** the frame's number: 1, 2, 3 ... */
  seq: number;
  /**
   * The frame's own size, in pixels.
   *
   * The stream does not need it - the browser decodes the JPEG itself - but a
   * **snapshot** does: the app has to know how big the picture is before it
   * draws it, and it must not decode an image to learn its size (D-102).
   */
  width?: number;
  height?: number;
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
  /**
   * The rule that decides whether an origin may read the picture.
   *
   * It is the **same** rule the websocket's upgrade uses - `isAllowedOrigin` -
   * and it is passed in rather than written here twice: the extension's HTTP
   * server answers the **same loopback origins** its websocket answers
   * (D-151). Without it the snapshot is refused by the browser as a
   * cross-origin read, and "take a screenshot of the editor's window" fails
   * with "Failed to fetch" in a **stock** browser.
   */
  isAllowedOrigin?: (origin: string | undefined) => boolean;
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

/**
 * The path of a snapshot, with the capability in it.
 *
 * It is the stream's path with one more segment, so the same capability
 * authorises it (D-86, D-102). The app derives the whole URL from the
 * connection's stream URL, so this is the shape the derivation must produce.
 */
export const snapshotPath = (capability: string): string =>
  `${STREAM_PATH_PREFIX}/${capability}/${SNAPSHOT_PATH_SUFFIX}`;

const STREAM_ROUTE = new RegExp(
  `^${STREAM_PATH_PREFIX}/([^/]+)/${STREAM_PATH_SUFFIX}$`,
);

const SNAPSHOT_ROUTE = new RegExp(
  `^${STREAM_PATH_PREFIX}/([^/]+)/${SNAPSHOT_PATH_SUFFIX}$`,
);

/**
 * How much a client may be behind before frames are not written to it (D-338):
 * about two frames. Past it the client is skipped and gets the newest frame
 * when its socket drains, so the delay of a slow client is bounded.
 */
export const STREAM_BACKLOG_BYTES = 256 * 1024;

export const createMjpegStream = (options: MjpegStreamOptions): MjpegStream => {
  const host = options.host ?? "127.0.0.1";
  const keepAliveMs = options.keepAliveMs ?? STREAM_KEEPALIVE_MS;
  const originIsAllowed = options.isAllowedOrigin ?? (() => false);

  /** the capability -> the streams it has opened */
  const capabilities = new Map<string, Set<ServerResponse>>();

  /** the last frame, so a client that connects is never blank */
  let lastFrame: MjpegFrame | null = null;

  /** when the last frame was published, so a silent stream can be refreshed */
  let lastFrameAt = 0;

  /**
   * The clients that are behind (D-338): a frame was **not** written to them
   * because they had not taken the last ones yet. A client that is slow - a
   * window behind another, a tab that is busy - must see the NEWEST picture
   * when it catches up and not a queue of old ones, so it is skipped and the
   * newest frame is sent when its socket drains.
   */
  const behind = new Set<ServerResponse>();

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
        if (res.writableLength > STREAM_BACKLOG_BYTES) {
          behind.add(res);
          continue;
        }

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

  /**
   * The CORS headers of a request.
   *
   * The app is on `http://localhost:3001` and this server is on
   * `http://127.0.0.1:47511`, so the picture the app fetches with a plain
   * `fetch()` is a **cross-origin** read - and a stock browser refuses it
   * unless the answer says which origin may read it (D-151).
   *
   * The rule is the **same** rule the websocket's upgrade uses: a loopback
   * origin gets **its own origin echoed back**, and a foreign origin gets no
   * header at all, so the browser refuses to hand it the picture. The
   * capability is still the authorisation (D-86) - this only decides who may
   * READ a picture they are already entitled to.
   */
  const corsHeaders = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;

    // the answer depends on the origin, so a cache must not reuse it
    const headers: Record<string, string> = { vary: "Origin" };

    if (origin && originIsAllowed(origin)) {
      headers["access-control-allow-origin"] = origin;
      // The picture's own size travels in the headers (D-102), and a header
      // that is not CORS-safelisted is HIDDEN from the page's JavaScript
      // unless the answer says it may be read - so without this the app would
      // read a size of zero for a picture it can see.
      headers["access-control-expose-headers"] = FRAME_SIZE_HEADERS.join(", ");
    }

    return headers;
  };

  const handle = (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = (req.url ?? "").split("?")[0] ?? "";
    const snapshotMatch = SNAPSHOT_ROUTE.exec(path);

    if (snapshotMatch) {
      // The **snapshot**: ONE JPEG of the last frame the extension already
      // holds (it computes that frame's CRC on every publish anyway, D-88).
      // The app fetches it with a plain GET, so a screenshot costs no base64 on
      // the websocket and no new protocol message (D-102).
      const capability = snapshotMatch[1] ?? "";
      const responses = capabilities.get(capability);

      if (!responses) {
        // The capability is the authorisation (D-86): a request that does not
        // carry a live one is refused, and it is a 404 so that the endpoint
        // does not say what it is.
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found\n");
        return true;
      }

      if (!lastFrame) {
        // there is no frame yet, so there is no picture to hand over
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found\n");
        return true;
      }

      const headers: Record<string, string> = {
        "content-type": "image/jpeg",
        "content-length": String(lastFrame.bytes.length),
        "cache-control": "no-store, no-cache, must-revalidate",
        // The app fetches this picture with a plain `fetch()`, and the app and
        // this server are on **different origins** - so the browser needs to be
        // told that this origin may read it (D-151).
        ...corsHeaders(req),
      };

      // The picture's own size travels in the headers: the app has to know how
      // big it is before it draws it, and it must not decode an image to learn
      // its size (D-102).
      if (lastFrame.width && lastFrame.height) {
        headers[FRAME_WIDTH_HEADER] = String(lastFrame.width);
        headers[FRAME_HEIGHT_HEADER] = String(lastFrame.height);
      }

      res.writeHead(200, headers);
      res.end(lastFrame.bytes);
      return true;
    }

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
      // the live view is an <img>, so it is fetched in "no-cors" mode and does
      // not need this - but the same rule answers it all the same (D-151)
      ...corsHeaders(req),
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

    // a client that was behind has caught up: it gets the NEWEST frame (D-338)
    res.on("drain", () => {
      if (behind.delete(res) && lastFrame) {
        writePart(res, lastFrame);
      }
    });

    const cleanup = () => {
      clearInterval(keepAlive);
      behind.delete(res);
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

  return {
    createCapability,
    urlFor,
    revoke,
    publish,
    handle,
    close,
  };
};
