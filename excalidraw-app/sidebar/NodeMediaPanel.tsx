import { useEffect, useRef, useState } from "react";

import { canHoldMedia, mediaOf } from "@excalidraw/element";
import { setFlowEditorExtra } from "@excalidraw/excalidraw/components/FlowScriptEditorState";
import { CaptureUpdateAction, useExcalidrawAPI } from "@excalidraw/excalidraw";

import type { WordsMode } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { sceneAtClientPoint } from "./insertIntoScene";
import { openMediaCrop } from "./mediaCropState";
import { setNodeDrop } from "./nodeDropHook";
import {
  addMediaToNode,
  applyMediaWords,
  fitMediaToNodes,
  mediaElementsOfNode,
  mediaKindOf,
  nodeAtPoint,
  nodeContainsPoint,
  removeMediaFromNode,
} from "./nodeMedia";

/**
 * The picture, GIF or video of the selected node (D-246): the buttons that put
 * a file in it and take it out. They are there when exactly one shape is
 * selected, and say what they do to it.
 */
export const NodeMediaSection = () => {
  const api = useExcalidrawAPI();
  const input = useRef<HTMLInputElement>(null);
  const [node, setNode] = useState<ExcalidrawElement | null>(null);
  const [hasMedia, setHasMedia] = useState(false);
  const [words, setWords] = useState<WordsMode>("caption");
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
      const held = next ? mediaElementsOfNode(elements, next.id) : [];

      setHasMedia(held.length > 0);
      setWords(held.length ? mediaOf(held[0])?.words ?? "caption" : "caption");
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
      <p className="flow-tab__hint">Picture in this node</p>
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
        className="flow-tab__media-button"
        data-testid="node-media-add"
        onClick={() => input.current?.click()}
      >
        {hasMedia ? "Replace picture or video" : "Add picture or video"}
      </button>
      {hasMedia && (
        <label className="flow-tab__media-words">
          Words of the node
          <select
            data-testid="node-media-words"
            value={words}
            onChange={(event) =>
              applyMediaWords(api, node.id, event.target.value as WordsMode)
            }
          >
            <option value="caption">A caption below the node</option>
            <option value="hidden">Hidden under the picture</option>
          </select>
        </label>
      )}
      {hasMedia && (
        <button
          type="button"
          className="flow-tab__media-button"
          data-testid="node-media-crop"
          onClick={() => openMediaCrop(node.id)}
        >
          Crop picture
        </button>
      )}
      {hasMedia && (
        <button
          type="button"
          className="flow-tab__media-button"
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

  // the media follows its node when the node's shape or size is changed by the
  // script, by Apply or by its own handles (D-246). It is part of the change
  // that caused it, so it is not a step of its own in the undo history.
  useEffect(() => {
    if (!api) {
      return;
    }

    return api.onChange(() => {
      const fitted = fitMediaToNodes(api.getSceneElementsIncludingDeleted());

      if (fitted) {
        api.updateScene({
          elements: fitted,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
      }
    });
  }, [api]);

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

    // the picture of a node is edited in the Edit chart panel (D-247)
    setFlowEditorExtra(NodeMediaSection);

    // a double click on the media of a node opens the crop screen, and not the
    // library's own crop (D-247)
    const onDoubleClick = (event: MouseEvent) => {
      const target = event.target;

      if (
        !(target instanceof Element) ||
        !target.closest("canvas.excalidraw__canvas, .excalidraw__panel")
      ) {
        return;
      }

      const at = sceneAtClientPoint(api, event.clientX, event.clientY);

      if (!at) {
        return;
      }

      const hit = [...api.getSceneElements()].reverse().find((element) => {
        const media = mediaOf(element);

        return (
          !!media &&
          nodeContainsPoint(
            {
              ...element,
              type:
                media.shape === "ellipse" || media.shape === "diamond"
                  ? media.shape
                  : "rectangle",
            },
            at,
          )
        );
      });

      if (hit) {
        event.preventDefault();
        event.stopPropagation();
        openMediaCrop(mediaOf(hit)!.of);
      }
    };

    document.addEventListener("dblclick", onDoubleClick, true);

    // the other roads to a node - a file from the sidebar, a sticker from the
    // emoji bar - ask here (D-246)
    setNodeDrop({
      claims: (at) => !!nodeAtPoint(api.getSceneElements(), at),
      add: async (file, at) => {
        const node = nodeAtPoint(api.getSceneElements(), at);

        return node ? addMediaToNode(api, node.id, file) : null;
      },
    });

    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
      document.removeEventListener("dblclick", onDoubleClick, true);
      setFlowEditorExtra(null);
      setNodeDrop(null);
    };
  }, [api]);

  return null;
};
