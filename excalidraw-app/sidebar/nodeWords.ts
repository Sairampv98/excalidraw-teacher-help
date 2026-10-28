/**
 * The words of a node that holds media (D-248).
 *
 * The words are in one of three states. They are **shown** in the node, as they
 * are when it holds no media; a **caption** under the node, a free text of its
 * own that can be selected and edited, grouped with the node and its media; or
 * **hidden** under the media, locked so that a click does not find them. The
 * state a node's words are in while it holds media is a choice (`caption` is the
 * one it starts with), kept on its media; without media they are always shown.
 *
 * What is here works on the list of elements and changes nothing else: it
 * returns the new list, or null when there is nothing to change, so that it can
 * be used by the scene's one change and by the check that keeps the words as
 * the choice says whatever changed the chart.
 */

import {
  captionOf,
  customDataWithCaption,
  mediaOf,
  newElementWith,
} from "@excalidraw/element";

import type { WordsMode } from "@excalidraw/element";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

export type WordsState = "shown" | WordsMode;

/** the room between a node and its caption, in scene units */
export const CAPTION_GAP = 8;

/** the text of a node: the text bound to it, or the caption under it */
export const wordsOf = (
  elements: readonly ExcalidrawElement[],
  node: ExcalidrawElement,
): ExcalidrawTextElement | null => {
  const bound = (node.boundElements ?? []).find((b) => b.type === "text");

  if (bound) {
    const found = elements.find(
      (element) => element.id === bound.id && !element.isDeleted,
    );

    if (found && found.type === "text") {
      return found;
    }
  }

  return (
    (elements.find(
      (element) =>
        element.type === "text" &&
        !element.isDeleted &&
        captionOf(element)?.of === node.id,
    ) as ExcalidrawTextElement | undefined) ?? null
  );
};

export const wordsStateOf = (text: ExcalidrawElement): WordsState => {
  if (captionOf(text)) {
    return "caption";
  }

  return text.customData?.mediaWords ? "hidden" : "shown";
};

/** where a caption goes: centred under its node */
const captionPlace = (node: ExcalidrawElement, text: ExcalidrawElement) => ({
  x: node.x + node.width / 2 - text.width / 2,
  y: node.y + node.height + CAPTION_GAP,
});

/**
 * The elements with the words of a node in this state, or null when they are
 * in it already (or the node has no words).
 */
export const withWords = (
  elements: readonly ExcalidrawElement[],
  nodeId: string,
  state: WordsState,
): ExcalidrawElement[] | null => {
  const node = elements.find((element) => element.id === nodeId);
  const found = node && !node.isDeleted ? wordsOf(elements, node) : null;

  if (!node || !found || wordsStateOf(found) === state) {
    return null;
  }

  let text: ExcalidrawElement = found;
  let shape: ExcalidrawElement = node;
  const current = wordsStateOf(found);

  // first back to where the words are when there is no media
  if (current === "caption") {
    text = newElementWith(text, {
      containerId: node.id,
      textAlign: "center",
      verticalAlign: "middle",
      x: node.x + (node.width - text.width) / 2,
      y: node.y + (node.height - text.height) / 2,
      customData: customDataWithCaption(text.customData, null),
    } as never);
    shape = newElementWith(shape, {
      boundElements: [
        ...(shape.boundElements ?? []),
        { id: text.id, type: "text" as const },
      ],
    });
  } else if (current === "hidden") {
    const saved = text.customData!.mediaWords as {
      opacity: number;
      locked: boolean;
    };
    const { mediaWords: _saved, ...rest } = text.customData!;

    text = newElementWith(text, {
      opacity: saved.opacity,
      locked: saved.locked,
      customData: Object.keys(rest).length ? rest : undefined,
    } as never);
  }

  // and then to the state that is wanted
  if (state === "caption") {
    const at = captionPlace(shape, text);

    text = newElementWith(text, {
      containerId: null,
      textAlign: "center",
      verticalAlign: "top",
      ...at,
      customData: customDataWithCaption(text.customData, {
        of: node.id,
        at: {
          nx: shape.x,
          ny: shape.y,
          cx: at.x,
          cy: at.y,
          nw: shape.width,
          nh: shape.height,
        },
      }),
    } as never);
    shape = newElementWith(shape, {
      boundElements: (shape.boundElements ?? []).filter(
        (b) => b.id !== text.id,
      ),
    });
  } else if (state === "hidden") {
    text = newElementWith(text, {
      opacity: 0,
      locked: true,
      customData: {
        ...text.customData,
        mediaWords: { opacity: text.opacity, locked: text.locked },
      },
    } as never);
  }

  return elements.map((element) =>
    element.id === shape.id ? shape : element.id === text.id ? text : element,
  );
};

/**
 * The elements with every caption following its node (D-248): a node moved by
 * itself (by the script, a layout) takes its caption with it, while a caption
 * that was moved - alone, or with the node as a group - is left where it is.
 * Null when every caption is where it should be.
 */
export const followCaptions = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] | null => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  let changed = false;

  const next = elements.map((element) => {
    const caption =
      element.type === "text" && !element.isDeleted ? captionOf(element) : null;
    const node = caption ? byId.get(caption.of) : undefined;

    if (!caption || !caption.at || !node || node.isDeleted) {
      return element;
    }

    const { nx, ny, cx, cy, nw, nh } = caption.at;
    const nodeMoved =
      Math.abs(node.x - nx) > 0.01 || Math.abs(node.y - ny) > 0.01;
    const captionMoved =
      Math.abs(element.x - cx) > 0.01 || Math.abs(element.y - cy) > 0.01;
    const resized =
      nw !== undefined &&
      nh !== undefined &&
      (Math.abs(node.width - nw) > 0.01 || Math.abs(node.height - nh) > 0.01);

    if (!nodeMoved && !captionMoved && !resized) {
      return element;
    }

    changed = true;

    // the node changed its size (its shape was changed, say): a caption that was
    // where it was put is put under it again, and not left under the picture
    if (resized && !captionMoved && !caption.placed) {
      const place = captionPlace(node, element);

      return newElementWith(element, {
        ...place,
        customData: customDataWithCaption(element.customData, {
          of: caption.of,
          at: {
            nx: node.x,
            ny: node.y,
            cx: place.x,
            cy: place.y,
            nw: node.width,
            nh: node.height,
          },
        }),
      } as never);
    }

    // the node moved by itself: its caption goes with it
    const x = nodeMoved && !captionMoved ? cx + (node.x - nx) : element.x;
    const y = nodeMoved && !captionMoved ? cy + (node.y - ny) : element.y;

    return newElementWith(element, {
      x,
      y,
      customData: customDataWithCaption(element.customData, {
        of: caption.of,
        // moved by the teacher by itself: it stays where it is put
        ...(caption.placed || (captionMoved && !nodeMoved)
          ? { placed: true }
          : {}),
        at: {
          nx: node.x,
          ny: node.y,
          cx: x,
          cy: y,
          nw: node.width,
          nh: node.height,
        },
      }),
    } as never);
  });

  return changed ? next : null;
};

/** the state a node's words should be in: what its media says, a caption by default */
const wantedState = (
  elements: readonly ExcalidrawElement[],
  nodeId: string,
): WordsState => {
  const media = elements.find(
    (element) => !element.isDeleted && mediaOf(element)?.of === nodeId,
  );

  return media ? mediaOf(media)!.words ?? "caption" : "shown";
};

/**
 * Keeps the words of every node as the choice says, whatever changed the chart
 * (the script made its nodes again, the media was put in or taken out) and keeps
 * the captions with their nodes. Null when nothing needs to change.
 */
export const ensureWords = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] | null => {
  let current: readonly ExcalidrawElement[] = elements;
  let changed = false;
  const nodes = new Set<string>();

  for (const element of elements) {
    const media = element.isDeleted ? null : mediaOf(element);

    if (media) {
      nodes.add(media.of);
    }
  }

  for (const nodeId of nodes) {
    const next = withWords(current, nodeId, wantedState(current, nodeId));

    if (next) {
      current = next;
      changed = true;
    }
  }

  const followed = followCaptions(current);

  if (followed) {
    current = followed;
    changed = true;
  }

  return changed ? [...current] : null;
};
