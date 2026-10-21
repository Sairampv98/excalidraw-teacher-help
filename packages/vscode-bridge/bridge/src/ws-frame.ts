/**
 * A minimal RFC 6455 frame codec.
 *
 * The extension has NO runtime dependency of its own, so the websocket server
 * is written on top of `node:http` and this codec. It is deliberately small:
 * text frames, fragmentation, and the three control frames.
 *
 * The browser side needs none of this - it uses the browser's own `WebSocket`.
 * This module exists so that the server can speak the wire format, and so that
 * the tests can speak it too, without a dependency.
 */

/** The websocket opcodes this codec understands. */
export const WS_OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

export interface WsFrame {
  /** True when this frame completes a message. */
  fin: boolean;
  /** The opcode of the message this frame belongs to. */
  opcode: number;
  /** The (unmasked) payload. */
  payload: Buffer;
}

const randomBytes = (length: number): Buffer => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
};

/**
 * Encode one frame.
 *
 * A server MUST NOT mask; a client MUST. `mask` exists for the client side.
 */
export function encodeFrame(
  opcode: number,
  payload: Buffer,
  mask = false,
): Buffer {
  const length = payload.length;
  const header: number[] = [0x80 | opcode];
  const maskBit = mask ? 0x80 : 0x00;

  if (length < 126) {
    header.push(maskBit | length);
  } else if (length < 65536) {
    header.push(maskBit | 126, (length >> 8) & 0xff, length & 0xff);
  } else {
    header.push(maskBit | 127);
    for (let shift = 56; shift >= 0; shift -= 8) {
      header.push(Math.floor(length / 2 ** shift) & 0xff);
    }
  }

  const frame = Buffer.from(header);
  if (!mask) {
    return Buffer.concat([frame, payload]);
  }

  const key = randomBytes(4);
  const masked = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++) {
    masked[i] = payload[i] ^ key[i % 4];
  }
  return Buffer.concat([frame, key, masked]);
}

/**
 * A decoder that turns a byte stream into whole messages.
 *
 * It handles a frame that arrives in pieces, and a message that arrives as
 * several fragments.
 */
export function createFrameDecoder(onMessage: (message: WsFrame) => void): {
  push: (chunk: Buffer) => void;
} {
  let buffer: Buffer = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let fragmentOpcode = 0;

  const handle = (frame: WsFrame) => {
    if (frame.opcode === WS_OPCODE.continuation) {
      fragments.push(frame.payload);
      if (frame.fin) {
        onMessage({
          fin: true,
          opcode: fragmentOpcode,
          payload: Buffer.concat(fragments),
        });
        fragments = [];
        fragmentOpcode = 0;
      }
      return;
    }

    if (
      (frame.opcode === WS_OPCODE.text || frame.opcode === WS_OPCODE.binary) &&
      !frame.fin
    ) {
      fragmentOpcode = frame.opcode;
      fragments = [frame.payload];
      return;
    }

    onMessage(frame);
  };

  const push = (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;

    for (;;) {
      if (buffer.length < 2) {
        return;
      }
      const first = buffer[0];
      const second = buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < offset + 2) {
          return;
        }
        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) {
          return;
        }
        const big = buffer.readBigUInt64BE(offset);
        offset += 8;
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error("websocket frame is too large");
        }
        length = Number(big);
      }

      let maskKey: Buffer | null = null;
      if (masked) {
        if (buffer.length < offset + 4) {
          return;
        }
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }

      if (buffer.length < offset + length) {
        return;
      }

      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);

      if (maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      handle({ fin, opcode, payload });
    }
  };

  return { push };
}
