/**
 * Files that come to the page in pieces (D-409).
 *
 * The server reads a file from a folder the person listed and sends it to the page
 * in pieces, because a message has a size and a video has none; the page keeps
 * the pieces until the tool that uses the file asks for it, then the file is gone.
 * What is kept is bounded - in how much, and in how long - so a call that never
 * finishes leaves nothing behind.
 */

import { MCP_MAX_MESSAGE_BYTES } from "./protocol";

/** the most a file may be, in bytes */
export const UPLOAD_MAX_BYTES = 450 * 1024 * 1024;

/** the most the page keeps of files that are not used yet, in bytes */
export const UPLOAD_MAX_TOTAL_BYTES = 600 * 1024 * 1024;

/** how long a file that is not used is kept, in milliseconds */
export const UPLOAD_KEEP_MS = 10 * 60 * 1000;

/** the most pieces a file may come in */
export const UPLOAD_MAX_PIECES = 4096;

type Upload = {
  pieces: (Uint8Array | undefined)[];
  total: number;
  bytes: number;
  name: string;
  mimeType: string;
  touched: number;
};

const uploads = new Map<string, Upload>();

export class UploadError extends Error {
  readonly code: "bad-arguments" | "too-large" | "not-found";

  constructor(code: UploadError["code"], message: string) {
    super(message);
    this.name = "UploadError";
    this.code = code;
  }
}

const kept = () =>
  [...uploads.values()].reduce((sum, upload) => sum + upload.bytes, 0);

/** a file that was not used in time is dropped */
const sweep = (now: number) => {
  for (const [id, upload] of uploads) {
    if (now - upload.touched > UPLOAD_KEEP_MS) {
      uploads.delete(id);
    }
  }
};

const decode = (base64: string): Uint8Array => {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes;
};

export const addUploadPiece = (
  {
    id,
    index,
    total,
    data,
    name = "file",
    mimeType = "application/octet-stream",
  }: {
    id: string;
    index: number;
    total: number;
    data: string;
    name?: string;
    mimeType?: string;
  },
  now = Date.now(),
  limits = { file: UPLOAD_MAX_BYTES, total: UPLOAD_MAX_TOTAL_BYTES },
) => {
  sweep(now);

  if (
    !/^[A-Za-z0-9_-]{4,64}$/.test(id) ||
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    total > UPLOAD_MAX_PIECES ||
    index < 0 ||
    index >= total ||
    typeof data !== "string"
  ) {
    throw new UploadError("bad-arguments", "That piece of a file is not one.");
  }

  // a piece is a message, and a message is never longer than the protocol says
  if (data.length > MCP_MAX_MESSAGE_BYTES) {
    throw new UploadError("too-large", "A piece of a file is too large.");
  }

  let upload = uploads.get(id);

  if (!upload) {
    upload = {
      pieces: new Array(total),
      total,
      bytes: 0,
      name,
      mimeType,
      touched: now,
    };
    uploads.set(id, upload);
  }

  if (upload.total !== total) {
    throw new UploadError(
      "bad-arguments",
      "The pieces do not agree how many there are.",
    );
  }

  const bytes = decode(data);

  // a piece that arrives twice is the same piece
  upload.bytes += bytes.length - (upload.pieces[index]?.length ?? 0);
  upload.pieces[index] = bytes;
  upload.touched = now;

  if (upload.bytes > limits.file || kept() > limits.total) {
    uploads.delete(id);
    throw new UploadError(
      "too-large",
      "The file is larger than the page keeps in memory.",
    );
  }

  return {
    id,
    received: upload.pieces.filter(Boolean).length,
    total,
    bytes: upload.bytes,
  };
};

/** the file, once, whole; it is gone from the page after */
export const takeUpload = (id: string): File => {
  const upload = uploads.get(id);

  if (!upload) {
    throw new UploadError(
      "not-found",
      `There is no file ${id} on the page: it may have been used, or it expired.`,
    );
  }

  if (upload.pieces.filter(Boolean).length !== upload.total) {
    throw new UploadError("bad-arguments", "The file has not all come yet.");
  }

  uploads.delete(id);

  return new File(upload.pieces as BlobPart[], upload.name, {
    type: upload.mimeType,
  });
};

export const dropUpload = (id: string) => uploads.delete(id);

/** what is kept now, for the test and for the person who asks */
export const uploadsKept = () => ({ files: uploads.size, bytes: kept() });

export const clearUploads = () => uploads.clear();
