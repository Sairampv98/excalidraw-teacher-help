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
  captionOf,
  customDataWithMedia,
  getBoundTextElement,
  getCornerRadius,
  mediaOf,
  mediaShapeOfNode,
  newElementWith,
  nodeSignature,
  viewAsCrop,
  viewForFit,
  newImageElement,
} from "@excalidraw/element";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type {
  MediaFit,
  MediaView,
  NodeMedia,
  Size,
  WordsMode,
} from "@excalidraw/element";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import { appendElements, getImageSize } from "./insertIntoScene";
import { ensureWords, withWords } from "./nodeWords";
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

/**
 * The node a selection is about, or null. The node, its picture, its caption (or
 * its words) and a group of them all are about the one node, so that clicking
 * any of them - or the whole group, which selects them together - is clicking
 * the node.
 */
export const nodeOfSelection = (
  elements: readonly ExcalidrawElement[],
  selectedIds: readonly string[],
): ExcalidrawElement | null => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const owners = new Set<string>();

  for (const id of selectedIds) {
    const element = byId.get(id);

    if (!element || element.isDeleted) {
      continue;
    }

    const media = mediaOf(element);
    const caption = element.type === "text" ? captionOf(element) : null;
    const bound = element.type === "text" ? element.containerId : null;
    const owner = media
      ? media.of
      : caption
      ? caption.of
      : bound
      ? bound
      : canHoldMedia(element)
      ? element.id
      : null;

    if (owner) {
      owners.add(owner);
    }
  }

  if (owners.size !== 1) {
    return null;
  }

  const node = byId.get([...owners][0]);

  return node && !node.isDeleted && canHoldMedia(node) ? node : null;
};

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
 * The update that fits one piece of media to its node with a fit (D-247): the
 * box of the node, the media data (shape, view, fit) and, for a picture, the
 * crop that is the view when the view is wholly in the picture.
 */
const fitUpdates = (
  element: ExcalidrawElement,
  node: ExcalidrawElement,
  fit: MediaFit,
  chosen?: MediaView | null,
): Record<string, unknown> => {
  const media = mediaOf(element);
  const fitted = nodeMediaOf(node);
  const box = {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
  const natural =
    media?.natural ??
    (element.type === "image" && element.crop
      ? {
          width: element.crop.naturalWidth,
          height: element.crop.naturalHeight,
        }
      : undefined);
  const updates: Record<string, unknown> = { ...box, angle: node.angle };

  if (!natural) {
    updates.customData = customDataWithMedia(element.customData, {
      ...fitted,
      ...(media?.words ? { words: media.words } : {}),
    });

    return updates;
  }

  const view = viewForFit(
    fit,
    box,
    natural,
    fitted.shape,
    chosen ?? media?.view,
  );

  updates.customData = customDataWithMedia(element.customData, {
    ...fitted,
    fit,
    natural,
    view,
    ...(media?.words ? { words: media.words } : {}),
  });

  if (element.type === "image") {
    updates.crop = viewAsCrop(view, natural);
  }

  return updates;
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

    // the media keeps its fit, worked out again for the node's new shape and size
    return newElementWith(
      element,
      fitUpdates(element, node, media.fit ?? "auto") as never,
    );
  });

  const fitted = changed ? next : null;

  // the words of the nodes and their captions are kept as the choice says
  return ensureWords(fitted ?? elements) ?? fitted;
};

/**
 * Sets what the words of a node are while it holds media (D-248): a caption
 * under it, or hidden under the media. It is kept on the media.
 */
export const applyMediaWords = (
  api: ExcalidrawImperativeAPI,
  nodeId: string,
  words: WordsMode,
) => {
  const elements = api.getSceneElementsIncludingDeleted();
  const media = mediaElementsOfNode(elements, nodeId);

  if (!media.length) {
    return false;
  }

  const ids = new Set(media.map((element) => element.id));
  const marked = elements.map((element) => {
    const data = ids.has(element.id) ? mediaOf(element) : null;

    return data
      ? newElementWith(element, {
          customData: customDataWithMedia(element.customData, {
            ...data,
            words,
          }),
        })
      : element;
  });

  api.updateScene({ elements: ensureWords(marked) ?? marked });

  return true;
};

/**
 * Sets how the media of a node sits in its shape (D-247): the fit, and for a
 * `crop` the part of the picture that is shown. It is set on everything the
 * media is made of (a video is its panel and the still of its first frame).
 */
export const applyMediaFit = (
  api: ExcalidrawImperativeAPI,
  nodeId: string,
  fit: MediaFit,
  view?: MediaView | null,
) => {
  const elements = api.getSceneElementsIncludingDeleted();
  const node = elements.find((element) => element.id === nodeId);
  const media = mediaElementsOfNode(elements, nodeId);

  if (!node || !media.length) {
    return false;
  }

  const ids = new Set(media.map((element) => element.id));

  api.updateScene({
    elements: elements.map((element) =>
      ids.has(element.id)
        ? newElementWith(element, fitUpdates(element, node, fit, view) as never)
        : element,
    ),
  });

  return true;
};

/** takes the media out of a node: its words come back */
export const removeMediaFromNode = (
  api: ExcalidrawImperativeAPI,
  nodeId: string,
) => {
  const scene = api.getSceneElementsIncludingDeleted();
  const media = mediaElementsOfNode(scene, nodeId);

  if (!media.length) {
    return false;
  }

  // the words come back into the node (D-248)
  const elements = withWords(scene, nodeId, "shown") ?? scene;
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

/**
 * The media data of a picture in a node, with the fit it starts with: the
 * picture fills the shape (D-247).
 */
const startingMedia = (
  base: NodeMedia,
  box: Size,
  natural: Size,
): NodeMedia => ({
  ...base,
  fit: "auto",
  natural,
  view: viewForFit("auto", box, natural, base.shape),
});

/** puts a picture on the scene, filling a box, cut to the shape of the media */
const addPictureToBox = async (
  api: ExcalidrawImperativeAPI,
  file: File,
  box: Box,
  angle: ExcalidrawElement["angle"],
  groupIds: readonly string[],
  base: NodeMedia,
): Promise<{ element: ExcalidrawElement; natural: Size }> => {
  const dataURL = await getDataURL(file);
  const fileId = await generateIdFromFile(file);
  const natural = await getImageSize(dataURL);
  const now = Date.now();
  const media = startingMedia(base, box, natural);

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
    crop: viewAsCrop(media.view!, natural),
    groupIds: [...groupIds],
    customData: customDataWithMedia(undefined, media),
  });

  appendElements(api, [picture]);

  return { element: picture, natural };
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
    ({ element: added } = await addPictureToBox(
      api,
      file,
      box,
      node.angle,
      groupIds,
      media,
    ));
  } else {
    // its first frame is a picture of its own, cut like the media: an export has
    // no video to play, and this is what it shows
    const frame = await captureFirstFrame(file);
    const poster = frame
      ? await addPictureToBox(api, frame.file, box, node.angle, groupIds, media)
      : null;
    const { panel } = await insertVideoPanel(api, { videoFile: file });
    const content = panel as unknown as {
      panel?: { naturalWidth?: number | null; naturalHeight?: number | null };
    };
    // the video's own size: its first frame's, or what the player read
    const natural =
      poster?.natural ??
      (content.panel?.naturalWidth && content.panel?.naturalHeight
        ? {
            width: content.panel.naturalWidth,
            height: content.panel.naturalHeight,
          }
        : null);
    const placed = {
      ...panel,
      ...box,
      angle: node.angle,
      groupIds,
      customData: customDataWithMedia(
        panel.customData,
        natural ? startingMedia(media, box, natural) : media,
      ),
    } as ExcalidrawElement;

    added = placed;

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

  const grouped = api
    .getSceneElementsIncludingDeleted()
    .map((element) =>
      element.id === node.id || element.id === text?.id
        ? newElementWith(element, { groupIds })
        : element,
    );

  api.updateScene({
    // the words of the node go under it as a caption (D-248)
    elements: ensureWords(grouped) ?? grouped,
    appState: { selectedElementIds: { [added.id]: true } },
  });

  return kind;
};
