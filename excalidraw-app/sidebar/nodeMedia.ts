/**
 * Media in a node (D-246): a picture, a GIF or a video that fills a node and is
 * cut to the node's own shape.
 *
 * The media is an element of its own over the node (an image, or a video
 * panel), grouped with the node and its words so that it moves, resizes and is
 * copied with them. The words stay under it, hidden, and come back when the
 * media is taken out.
 */

import { randomId } from "@excalidraw/common";
import {
  canHoldMedia,
  coverCrop,
  customDataWithMedia,
  getBoundTextElement,
  getCornerRadius,
  mediaOf,
  mediaShapeOfNode,
  newElementWith,
  nodeSignature,
  newImageElement,
} from "@excalidraw/element";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { NodeMedia } from "@excalidraw/element";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { appendElements, getImageSize } from "./insertIntoScene";
import { insertVideoPanel } from "./videoPanel";

/** what a file can be as media: a picture (a GIF is one), a video, or nothing */
export const mediaKindOf = (file: {
  type: string;
}): "image" | "video" | null => {
  if (file.type.startsWith("video/")) {
    return "video";
  }

  return file.type.startsWith("image/") ? "image" : null;
};

/**
 * The live media elements of a node: a picture is one, and a video is two (its
 * first frame, which is what an export shows, and the panel that plays it).
 */
export const mediaElementsOfNode = (
  elements: readonly ExcalidrawElement[],
  nodeId: string,
): ExcalidrawElement[] =>
  elements.filter(
    (element) => !element.isDeleted && mediaOf(element)?.of === nodeId,
  );

/** whether a point (in scene units) is inside the node's shape */
export const nodeContainsPoint = (
  node: Pick<ExcalidrawElement, "type" | "x" | "y" | "width" | "height">,
  point: { x: number; y: number },
) => {
  const dx = point.x - (node.x + node.width / 2);
  const dy = point.y - (node.y + node.height / 2);
  const hw = node.width / 2;
  const hh = node.height / 2;

  if (hw <= 0 || hh <= 0) {
    return false;
  }

  switch (node.type) {
    case "ellipse":
      return (dx / hw) ** 2 + (dy / hh) ** 2 <= 1;
    case "diamond":
      return Math.abs(dx) / hw + Math.abs(dy) / hh <= 1;
    default:
      return Math.abs(dx) <= hw && Math.abs(dy) <= hh;
  }
};

/** the top-most node of a chart under a point of the scene: where a dropped file goes */
export const nodeAtPoint = (
  elements: readonly ExcalidrawElement[],
  point: { x: number; y: number },
): ExcalidrawElement | null => {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];

    if (
      !element.isDeleted &&
      canHoldMedia(element) &&
      element.customData?.flow?.role === "node" &&
      nodeContainsPoint(element, point)
    ) {
      return element;
    }
  }

  return null;
};

/** the media data that fits a node: its shape, its radius and what it looks like now */
const nodeMediaOf = (node: ExcalidrawElement): NodeMedia => {
  const shape = mediaShapeOfNode(node);
  const radius = node.roundness
    ? getCornerRadius(Math.min(node.width, node.height), node)
    : 0;

  return {
    of: node.id,
    shape,
    radius,
    sig: nodeSignature(node, shape, radius),
  };
};

/**
 * The scene with the media of every node fitted to its node, or null when all
 * of it is. A node whose shape or size was changed (by the script, by Apply, by
 * its own handles) changes the cut and the box of its media; a node that was
 * only moved needs nothing but the media's place. What the teacher did to the
 * media itself is left alone while its node is as it was.
 */
export const fitMediaToNodes = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] | null => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  let changed = false;

  const next = elements.map((element) => {
    const media = element.isDeleted ? null : mediaOf(element);
    const node = media ? byId.get(media.of) : undefined;

    if (!media || !node || node.isDeleted) {
      return element;
    }

    const fitted = nodeMediaOf(node);

    if (media.sig === fitted.sig) {
      // the same shape and size: the media only follows the node's place
      if (
        Math.abs(element.x - node.x) < 0.01 &&
        Math.abs(element.y - node.y) < 0.01
      ) {
        return element;
      }

      changed = true;

      return newElementWith(element, { x: node.x, y: node.y });
    }

    changed = true;

    const box = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
    const refit: Record<string, unknown> = {
      ...box,
      angle: node.angle,
      customData: customDataWithMedia(element.customData, fitted),
    };

    // a picture is cut again to the box's shape
    if (element.type === "image" && element.crop) {
      refit.crop = coverCrop(box, {
        width: element.crop.naturalWidth,
        height: element.crop.naturalHeight,
      });
    }

    return newElementWith(element, refit);
  });

  return changed ? next : null;
};

/** takes the media out of a node: its words come back */
export const removeMediaFromNode = (
  api: ExcalidrawImperativeAPI,
  nodeId: string,
) => {
  const elements = api.getSceneElementsIncludingDeleted();
  const media = mediaElementsOfNode(elements, nodeId);

  if (!media.length) {
    return false;
  }

  const ids = new Set(media.map((element) => element.id));

  // the group that tied the media to the node is taken apart
  const gid = media[0].groupIds[0];

  api.updateScene({
    elements: elements.map((element) => {
      if (ids.has(element.id)) {
        return newElementWith(element, { isDeleted: true });
      }

      if (gid && element.groupIds.includes(gid)) {
        return newElementWith(element, {
          groupIds: element.groupIds.filter((id) => id !== gid),
        });
      }

      return element;
    }),
    appState: { selectedElementIds: { [nodeId]: true } },
  });

  return true;
};

type Box = { x: number; y: number; width: number; height: number };

/** puts a picture on the scene, filling a box, cut to the shape of the media */
const addPictureToBox = async (
  api: ExcalidrawImperativeAPI,
  file: File,
  box: Box,
  angle: ExcalidrawElement["angle"],
  groupIds: readonly string[],
  media: NodeMedia,
): Promise<ExcalidrawElement> => {
  const dataURL = await getDataURL(file);
  const fileId = await generateIdFromFile(file);
  const natural = await getImageSize(dataURL);
  const now = Date.now();

  api.addFiles([
    {
      id: fileId,
      mimeType: (file.type || "image/png") as BinaryFileData["mimeType"],
      dataURL,
      created: now,
      lastRetrieved: now,
      version: 1,
    },
  ]);

  const picture = newImageElement({
    type: "image",
    ...box,
    angle,
    fileId,
    // the picture is cut to the box and not shrunk into it: no borders
    crop: coverCrop(box, natural),
    groupIds: [...groupIds],
    customData: customDataWithMedia(undefined, media),
  });

  appendElements(api, [picture]);

  return picture;
};

/**
 * The first frame of a video as a picture, or null when the browser cannot give
 * one (it cannot decode the video, or it takes too long).
 */
const captureFirstFrame = (file: File): Promise<{ file: File } | null> =>
  new Promise((resolve) => {
    if (typeof document === "undefined" || !URL.createObjectURL) {
      resolve(null);

      return;
    }

    let url: string;

    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);

      return;
    }

    const video = document.createElement("video");
    const done = (frame: { file: File } | null) => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(frame);
    };
    const timer = window.setTimeout(() => done(null), 4000);

    video.muted = true;
    video.preload = "auto";
    video.onerror = () => done(null);
    video.onloadeddata = () => {
      // a frame that is not the very first, which is often black
      video.currentTime = Math.min(0.1, (video.duration || 0.2) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext("2d");

      if (!context || !canvas.width || !canvas.height) {
        done(null);

        return;
      }

      context.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) =>
          done(
            blob
              ? { file: new File([blob], "frame.jpg", { type: "image/jpeg" }) }
              : null,
          ),
        "image/jpeg",
        0.85,
      );
    };
    video.src = url;
  });

/**
 * Puts a file in a node: it fills the node, cut to the node's shape, and the
 * media is grouped with the node and its words. A node that has media already
 * has it replaced. Returns what the file was, or null when it is neither a
 * picture nor a video.
 */
export const addMediaToNode = async (
  api: ExcalidrawImperativeAPI,
  nodeId: string,
  file: File,
): Promise<"image" | "video" | null> => {
  const kind = mediaKindOf(file);
  const node = api
    .getSceneElements()
    .find((element) => element.id === nodeId && canHoldMedia(element));

  if (!kind || !node) {
    return null;
  }

  removeMediaFromNode(api, nodeId);

  const media = nodeMediaOf(node);
  const gid = randomId();
  const groupIds = [gid, ...node.groupIds];
  const box = { x: node.x, y: node.y, width: node.width, height: node.height };

  let added: ExcalidrawElement;

  if (kind === "image") {
    added = await addPictureToBox(api, file, box, node.angle, groupIds, media);
  } else {
    // its first frame is a picture of its own, cut like the media: an export has
    // no video to play, and this is what it shows
    const frame = await captureFirstFrame(file);
    const poster = frame
      ? await addPictureToBox(api, frame.file, box, node.angle, groupIds, media)
      : null;
    const { panel } = await insertVideoPanel(api, { videoFile: file });
    const placed = {
      ...panel,
      ...box,
      angle: node.angle,
      groupIds,
      customData: customDataWithMedia(panel.customData, media),
    } as ExcalidrawElement;

    added = placed;
    void poster;

    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((element) => (element.id === panel.id ? placed : element)),
    });
  }

  // the node and its words are in the group too
  const text = getBoundTextElement(
    node,
    new Map(api.getSceneElements().map((element) => [element.id, element])),
  );

  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((element) => {
      if (element.id === node.id || element.id === text?.id) {
        return newElementWith(element, { groupIds });
      }

      return element;
    }),
    appState: { selectedElementIds: { [added.id]: true } },
  });

  return kind;
};
