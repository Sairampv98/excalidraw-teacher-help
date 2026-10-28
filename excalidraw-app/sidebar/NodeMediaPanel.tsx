import { useEffect, useRef, useState } from "react";

import { canHoldMedia, mediaOf } from "@excalidraw/element";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { sceneAtClientPoint } from "./insertIntoScene";
import {
  addMediaToNode,
  mediaElementsOfNode,
  mediaKindOf,
  nodeAtPoint,
  removeMediaFromNode,
} from "./nodeMedia";

/**
 * The picture, GIF or video of the selected node (D-246): the buttons that put
 * a file in it and take it out. They are there when exactly one shape is
 * selected, and say what they do to it.
 */
export const NodeMediaPanel = () => {
  const api = useExcalidrawAPI();
  const input = useRef<HTMLInputElement>(null);
  const [node, setNode] = useState<ExcalidrawElement | null>(null);
  const [hasMedia, setHasMedia] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!api) {
      return;
    }

    const read = () => {
      const selected = Object.keys(api.getAppState().selectedElementIds);
      const elements = api.getSceneElements();
      const only =
        selected.length === 1
          ? elements.find((element) => element.id === selected[0])
          : undefined;
      // the media of a node selected on its own counts as the node's
      const owner =
        only && mediaOf(only)
          ? elements.find((element) => element.id === mediaOf(only)!.of)
          : only;
      const next = owner && canHoldMedia(owner) ? owner : null;

      setNode((previous) => (previous?.id === next?.id ? previous : next));
      setHasMedia(!!next && mediaElementsOfNode(elements, next.id).length > 0);
    };

    read();

    return api.onChange(read);
  }, [api]);

  if (!api || !node) {
    return null;
  }

  const pick = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setMessage(null);

    try {
      const kind = await addMediaToNode(api, node.id, file);

      if (!kind) {
        setMessage("That file is not a picture or a video.");
      }
    } catch (error) {
      console.error("node media: could not add the file", error);
      setMessage("The file could not be read.");
    }
  };

  return (
    <div className="flow-tab__media" data-testid="node-media">
      <p className="flow-tab__hint">Picture in the selected node</p>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        hidden
        data-testid="node-media-input"
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className="flow-tab__edit"
        data-testid="node-media-add"
        onClick={() => input.current?.click()}
      >
        {hasMedia ? "Replace picture or video" : "Add picture or video"}
      </button>
      {hasMedia && (
        <button
          type="button"
          className="flow-tab__edit"
          data-testid="node-media-remove"
          onClick={() => removeMediaFromNode(api, node.id)}
        >
          Remove picture
        </button>
      )}
      {message && (
        <p className="flow-tab__message" data-kind="error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
};

/**
 * A picture, GIF or video dropped on a node of a chart goes into that node
 * (D-246). It listens in the capture phase, so it wins over the canvas's own
 * drop, and only claims a drop that is on a node and carries a file it can use.
 */
export const NodeMediaDrop = () => {
  const api = useExcalidrawAPI();

  useEffect(() => {
    if (!api) {
      return;
    }

    const target = (event: DragEvent) => {
      const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
        mediaKindOf(f),
      );
      const hasFile = Array.from(event.dataTransfer?.types ?? []).includes(
        "Files",
      );

      if (!hasFile) {
        return null;
      }

      const at = sceneAtClientPoint(api, event.clientX, event.clientY);
      const node = at ? nodeAtPoint(api.getSceneElements(), at) : null;

      return node ? { node, file } : null;
    };

    const onDragOver = (event: DragEvent) => {
      if (target(event)) {
        event.preventDefault();

        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      }
    };

    const onDrop = (event: DragEvent) => {
      const hit = target(event);

      if (!hit || !hit.file) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void addMediaToNode(api, hit.node.id, hit.file);
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);

    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [api]);

  return null;
};
