import { randomBytes } from "node:crypto";
import { createConnection, type Socket } from "node:net";

import {
  createFrameDecoder,
  encodeFrame,
  WS_OPCODE,
  type WsFrame,
} from "../../bridge/src/ws-frame";

/**
 * A raw websocket client, written by hand.
 *
 * The browser's `WebSocket` cannot set the `Origin` header, so a test that
 * has to prove the origin check works needs a client that can. This one
 * speaks the wire protocol directly, which also means the tests do not need a
 * websocket dependency.
 */

export interface RawWsClientOptions {
  port: number;
  host?: string;
  path?: string;
  /** The Origin header. `null` sends no Origin header at all. */
  origin?: string | null;
}

export interface CloseInfo {
  code: number | null;
  reason: string;
}

type FrameWaiter = {
  predicate: (frame: WsFrame) => boolean;
  resolve: (frame: WsFrame) => void;
};

export class RawWsClient {
  /** The HTTP request this client sent. The AC-63 test reads it. */
  readonly request: string;
  /** The handshake's status code. 101 when the upgrade happened. */
  status = 0;
  /** Every frame the server sent. */
  readonly frames: WsFrame[] = [];

  private readonly socket: Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private upgraded = false;
  private closedInfo: CloseInfo | null = null;
  private decoder: { push: (chunk: Buffer) => void } = {
    push: () => undefined,
  };
  private handshakeWaiters: ((status: number) => void)[] = [];
  private frameWaiters: FrameWaiter[] = [];
  private closeWaiters: ((info: CloseInfo) => void)[] = [];

  constructor(options: RawWsClientOptions) {
    const host = options.host ?? "127.0.0.1";
    const path = options.path ?? "/";
    const key = randomBytes(16).toString("base64");
    const lines = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}:${options.port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
    ];
    if (options.origin !== null) {
      lines.push(
        `Origin: ${options.origin ?? `http://localhost:${options.port}`}`,
      );
    }
    this.request = `${lines.join("\r\n")}\r\n\r\n`;

    this.socket = createConnection({ host, port: options.port });
    this.socket.on("connect", () => {
      this.socket.write(this.request);
    });
    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", () => undefined);
    this.socket.on("close", () => {
      this.notifyClose(this.closedInfo ?? { code: null, reason: "" });
    });

    const decoder = createFrameDecoder((frame) => {
      if (frame.opcode === WS_OPCODE.close) {
        const code =
          frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : null;
        const reason =
          frame.payload.length > 2
            ? frame.payload.subarray(2).toString("utf8")
            : "";
        this.closedInfo = { code, reason };
        this.notifyClose(this.closedInfo);
        return;
      }
      this.frames.push(frame);
      for (const waiter of [...this.frameWaiters]) {
        if (waiter.predicate(frame)) {
          this.frameWaiters = this.frameWaiters.filter((w) => w !== waiter);
          waiter.resolve(frame);
        }
      }
    });
    this.decoder = decoder;
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.upgraded) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end === -1) {
        return;
      }
      const head = this.buffer.subarray(0, end).toString("utf8");
      const statusLine = head.split("\r\n")[0] ?? "";
      const match = statusLine.match(/^HTTP\/1\.\d\s+(\d+)/);
      this.status = match ? Number(match[1]) : 0;
      this.buffer = this.buffer.subarray(end + 4);
      this.upgraded = true;
      for (const waiter of this.handshakeWaiters.splice(0)) {
        waiter(this.status);
      }
      if (this.status !== 101) {
        return;
      }
    }
    if (this.buffer.length) {
      const rest = this.buffer;
      this.buffer = Buffer.alloc(0);
      this.decoder.push(rest);
    }
  }

  private notifyClose(info: CloseInfo) {
    for (const waiter of this.closeWaiters.splice(0)) {
      waiter(info);
    }
  }

  /** Wait for the handshake and return its status code. */
  waitForHandshake(timeoutMs = 5000): Promise<number> {
    if (this.status) {
      return Promise.resolve(this.status);
    }
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no handshake")),
        timeoutMs,
      );
      this.handshakeWaiters.push((status) => {
        clearTimeout(timer);
        resolve(status);
      });
    });
  }

  /** Send a text frame. A client must mask, and this one does. */
  send(text: string): void {
    this.socket.write(
      encodeFrame(WS_OPCODE.text, Buffer.from(text, "utf8"), true),
    );
  }

  /** Wait for a frame that matches. */
  waitForMessage(
    predicate: (frame: WsFrame) => boolean,
    timeoutMs = 5000,
  ): Promise<WsFrame> {
    const existing = this.frames.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise<WsFrame>((resolve, reject) => {
      let done = false;
      const waiter: FrameWaiter = {
        predicate,
        resolve: (frame) => {
          if (done) {
            return;
          }
          done = true;
          clearTimeout(timer);
          this.frameWaiters = this.frameWaiters.filter((w) => w !== waiter);
          resolve(frame);
        },
      };
      const timer = setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        this.frameWaiters = this.frameWaiters.filter((w) => w !== waiter);
        reject(new Error("no matching frame arrived"));
      }, timeoutMs);
      this.frameWaiters.push(waiter);
    });
  }

  /** Wait until the server closes the connection. */
  waitForClose(timeoutMs = 5000): Promise<CloseInfo> {
    if (this.closedInfo) {
      return Promise.resolve(this.closedInfo);
    }
    return new Promise<CloseInfo>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the connection was not closed")),
        timeoutMs,
      );
      this.closeWaiters.push((info) => {
        clearTimeout(timer);
        resolve(info);
      });
    });
  }

  /** The text of every text frame received so far. */
  textFrames(): string[] {
    return this.frames
      .filter((frame) => frame.opcode === WS_OPCODE.text)
      .map((frame) => frame.payload.toString("utf8"));
  }

  close(): void {
    this.socket.destroy();
  }
}
