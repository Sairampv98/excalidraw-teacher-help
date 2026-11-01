/**
 * The tools of pictures that come from outside the whiteboard (D-409, D-410): a
 * file that has come in pieces is put on a page, a picture is cropped, and what
 * came from the internet says where from.
 *
 * `place_image` is the page's half of `insert_image`: the server reads the file
 * (from a folder the person listed, or from the internet) and sends it in pieces;
 * what is here decides what the bytes are, how large the picture is, and where it
 * goes.
 */

import { IMAGE_MIME_TYPES } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  getUncroppedImageElement,
  getUncroppedWidthAndHeight,
  isImageElement,
  newImageElement,
} from "@excalidraw/element";

import {
  blobToArrayBuffer,
  generateIdFromFile,
  getDataURL,
} from "../data/blob";
import { stampCurrentPage } from "../scene/pages";

import {
  McpToolError,
  argsOf,
  elementsFor,
  fail,
  isRecord,
  liveElementsById,
  pageOfElement,
  readBoolean,
  readInteger,
  readNumber,
  readString,
  resolvePage,
  summarize,
} from "./common";
import { imageSizeOf, sniffType } from "./imageSize";
import { UploadError, addUploadPiece, dropUpload, takeUpload } from "./uploads";

import type { McpApp } from "./common";
import type { BinaryFileData } from "../types";

const IMAGE_TYPES = Object.values(IMAGE_MIME_TYPES) as string[];

/** an upload's error is the call's error */
const uploading = <T>(run: () => T): T => {
  try {
    return run();
  } catch (error) {
    if (error instanceof UploadError) {
      throw new McpToolError(error.code, error.message);
    }

    throw error;
  }
};

export const uploadChunk = (_app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);

  return uploading(() =>
    addUploadPiece({
      id: readString(args, "id", { required: true })!,
      index: readInteger(args, "index", { min: 0 }) ?? 0,
      total: readInteger(args, "total", { min: 1 }) ?? 1,
      data: readString(args, "data", { required: true })!,
      name: readString(args, "name"),
      mimeType: readString(args, "mimeType"),
    }),
  );
};

export const uploadDrop = (_app: McpApp, rawArgs: unknown) => ({
  dropped: dropUpload(readString(argsOf(rawArgs), "id", { required: true })!),
});

/** where a picture came from: kept on the element, and listed by list_sources */
const sourceOf = (raw: unknown) => {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!isRecord(raw)) {
    return fail("bad-arguments", "source must be an object.");
  }

  const text = (key: string) => {
    const value = raw[key];

    return typeof value === "string" ? value.slice(0, 500) : undefined;
  };

  return {
    ...(text("url") ? { url: text("url") } : {}),
    ...(text("licence") ? { licence: text("licence") } : {}),
    ...(text("attribution") ? { attribution: text("attribution") } : {}),
    ...(text("file") ? { file: text("file") } : {}),
    fetchedAt: Date.now(),
  };
};

export const placeImage = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const upload = readString(args, "upload", { required: true })!;
  const file = uploading(() => takeUpload(upload));
  const bytes = new Uint8Array(await blobToArrayBuffer(file));
  // what the bytes are decides, not the name or the type that came with them
  const type = sniffType(bytes);

  if (!type || !IMAGE_TYPES.includes(type)) {
    return fail(
      "bad-arguments",
      `${file.name} is not a picture the whiteboard can show (png, jpg, gif, webp, svg, bmp, avif).`,
    );
  }

  const natural = imageSizeOf(bytes);

  if (!natural) {
    return fail("bad-arguments", `The size of ${file.name} cannot be read.`);
  }

  const typed = new File([bytes], file.name, { type });
  const dataURL = await getDataURL(typed);
  const fileId = await generateIdFromFile(typed);
  const size = readNumber(args.size, "size");
  const longest = Math.max(natural.width, natural.height);
  const target = size ?? Math.min(longest, 600);

  if (target < 8 || target > 4000) {
    return fail("bad-arguments", "size must be a number from 8 to 4000.");
  }

  const width = Math.max(1, (natural.width * target) / longest);
  const height = Math.max(1, (natural.height * target) / longest);
  const x =
    entry.rect.x + (readNumber(args.x, "x") ?? (entry.rect.width - width) / 2);
  const y =
    entry.rect.y +
    (readNumber(args.y, "y") ?? (entry.rect.height - height) / 2);
  const source = sourceOf(args.source);
  const image = newImageElement({
    type: "image",
    x,
    y,
    width,
    height,
    fileId,
    status: "saved",
    ...(source ? { customData: { source } } : {}),
  } as Parameters<typeof newImageElement>[0]);
  const now = Date.now();
  const stored: BinaryFileData = {
    id: fileId,
    mimeType: type as BinaryFileData["mimeType"],
    dataURL,
    created: now,
    lastRetrieved: now,
    version: 1,
  };

  stampCurrentPage([image], entry.page.id);
  app.addFiles([stored]);
  app.updateScene({
    elements: [...app.scene.getElementsIncludingDeleted(), image],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    page: entry.number,
    type,
    natural,
    created: [summarize(app, image)],
  };
};

/** a fraction of the picture, 0 to 1 */
const fraction = (value: unknown, name: string) => {
  const n = readNumber(value, name);

  return n === undefined || n < 0 || n > 1
    ? fail("bad-arguments", `${name} must be a number from 0 to 1.`)
    : n;
};

export const cropImage = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const id = readString(args, "id", { required: true })!;
  const reset = readBoolean(args, "reset") ?? false;
  const [element] = elementsFor(app, [id]);

  if (!isImageElement(element)) {
    return fail("bad-arguments", `${id} is a ${element.type}, not a picture.`);
  }

  if (element.angle !== 0) {
    return fail(
      "bad-arguments",
      "A picture that is turned is cropped after it is turned back: update_elements angle 0 first.",
    );
  }

  const map = liveElementsById(app);
  const whole = getUncroppedImageElement(element, map);
  const uncropped = getUncroppedWidthAndHeight(element);
  const file = element.fileId ? app.files[element.fileId] : undefined;
  let natural = element.crop
    ? {
        width: element.crop.naturalWidth,
        height: element.crop.naturalHeight,
      }
    : null;

  if (!natural && file?.dataURL) {
    const base64 = file.dataURL.slice(file.dataURL.indexOf(",") + 1);
    const raw = atob(base64.slice(0, 40000));

    natural = imageSizeOf(Uint8Array.from(raw, (char) => char.charCodeAt(0)));
  }

  if (!natural) {
    return fail("failed", "The size of the picture cannot be read.");
  }

  // how large a pixel of the picture is on the page
  const scaleX = uncropped.width / natural.width;
  const scaleY = uncropped.height / natural.height;

  if (reset) {
    app.scene.mutateElement(element, {
      x: whole.x,
      y: whole.y,
      width: uncropped.width,
      height: uncropped.height,
      crop: null,
    });
  } else {
    const left = fraction(args.left, "left");
    const top = fraction(args.top, "top");
    const width = fraction(args.width, "width");
    const height = fraction(args.height, "height");

    if (
      width <= 0 ||
      height <= 0 ||
      left + width > 1.0001 ||
      top + height > 1.0001
    ) {
      return fail(
        "bad-arguments",
        "The part must lie inside the picture: left + width and top + height are at most 1, and it has some size.",
      );
    }

    const crop = {
      x: left * natural.width,
      y: top * natural.height,
      width: width * natural.width,
      height: height * natural.height,
      naturalWidth: natural.width,
      naturalHeight: natural.height,
    };

    app.scene.mutateElement(element, {
      x: whole.x + crop.x * scaleX,
      y: whole.y + crop.y * scaleY,
      width: crop.width * scaleX,
      height: crop.height * scaleY,
      crop,
    });
  }

  // the change is one step for the history
  app.syncActionResult({
    elements: app.scene.getElementsIncludingDeleted(),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  const now = liveElementsById(app).get(id)!;

  return {
    ...summarize(app, now),
    cropped: !!(now as { crop?: unknown }).crop,
  };
};

export const listSources = (app: McpApp) => ({
  sources: app.scene
    .getNonDeletedElements()
    .filter(
      (element) =>
        isRecord(element.customData) && isRecord(element.customData.source),
    )
    .map((element) => ({
      id: element.id,
      page: pageOfElement(app, element)?.number ?? null,
      ...(element.customData!.source as Record<string, unknown>),
    })),
});
