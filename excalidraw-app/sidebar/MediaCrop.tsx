import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MEDIA_FITS,
  clampView,
  extentOf,
  mediaOf,
  moveView,
  resizeView,
  viewForFit,
} from "@excalidraw/element";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";

import type {
  CropHandle,
  MediaFit,
  MediaShape,
  MediaView,
} from "@excalidraw/element";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { closeMediaCrop, useMediaCropNode } from "./mediaCropState";
import { applyMediaFit, mediaElementsOfNode } from "./nodeMedia";

import "./MediaCrop.scss";

const FIT_LABELS: Record<MediaFit, string> = {
  auto: "Auto crop to shape",
  crop: "Crop in",
  best: "Best fit",
  inside: "Fit into the shape",
};

const HANDLES: readonly CropHandle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

/** the room round the picture on the screen, and the height of the bar above it */
const MARGIN = 48;
const BAR = 64;

const HANDLE_SIZE = 12;

/** the outline of a shape on a rectangle of the screen, as an SVG path */
const shapePath = (
  shape: MediaShape,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
) => {
  switch (shape) {
    case "ellipse":
      return `M ${x} ${y + h / 2} a ${w / 2} ${h / 2} 0 1 0 ${w} 0 a ${w / 2} ${
        h / 2
      } 0 1 0 ${-w} 0 Z`;
    case "diamond":
      return `M ${x + w / 2} ${y} L ${x + w} ${y + h / 2} L ${x + w / 2} ${
        y + h
      } L ${x} ${y + h / 2} Z`;
    case "rounded": {
      const r = Math.min(radius, w / 2, h / 2);

      return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${
        y + r
      } V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${
        x + r
      } A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${
        x + r
      } ${y} Z`;
    }
    default:
      return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
  }
};

type Drag =
  | { kind: "move"; start: { x: number; y: number }; view: MediaView }
  | { kind: "handle"; handle: CropHandle };

const CropScreen = ({
  api,
  nodeId,
}: {
  api: ExcalidrawImperativeAPI;
  nodeId: string;
}) => {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  // what the node and its media are when the screen opens
  const start = useMemo(() => {
    const elements = api.getSceneElements();
    const node = elements.find((element) => element.id === nodeId);
    const media = mediaElementsOfNode(elements, nodeId);
    // the picture, or the still of a video's first frame, is what is shown
    const picture = media.find((element) => element.type === "image");
    const data = mediaOf(picture ?? media[0] ?? { customData: undefined });

    if (!node || !data?.natural) {
      return null;
    }

    const box = { width: node.width, height: node.height };
    const natural = data.natural;
    const fit = data.fit ?? "auto";
    const view = data.view ?? viewForFit(fit, box, natural, data.shape, null);
    const file =
      picture && picture.type === "image" && picture.fileId
        ? api.getFiles()[picture.fileId]
        : undefined;

    return {
      box,
      natural,
      fit,
      view,
      shape: data.shape,
      radius: data.radius,
      file,
    };
  }, [api, nodeId]);

  const [fit, setFit] = useState<MediaFit>(start?.fit ?? "auto");
  const [view, setView] = useState<MediaView | null>(start?.view ?? null);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  // the screen holds the picture and every view a fit can choose, so that none
  // of them is cut off by the edge of the screen
  const extent = useMemo(() => {
    if (!start) {
      return null;
    }

    return extentOf(start.natural, [
      start.view,
      ...(["auto", "best", "inside"] as MediaFit[]).map((f) =>
        viewForFit(f, start.box, start.natural, start.shape),
      ),
    ]);
  }, [start]);

  const apply = useCallback(
    (chosen: MediaFit, chosenView: MediaView | null) => {
      applyMediaFit(api, nodeId, chosen, chosen === "crop" ? chosenView : null);
      closeMediaCrop();
    },
    [api, nodeId],
  );

  // Esc cancels and Enter applies; the editor's own shortcuts are not for this screen
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMediaCrop();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        apply(fit, view);
      }
    };

    window.addEventListener("keydown", onKey, true);

    return () => window.removeEventListener("keydown", onKey, true);
  }, [apply, fit, view]);

  // dragging: the pointer is followed on the window, so it can leave the box
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const active = drag.current;
      const host = stage.current;

      if (!active || !start || !extent || !host) {
        return;
      }

      const rect = host.getBoundingClientRect();
      const scale = Math.min(
        (size.width - MARGIN * 2) / extent.width,
        (size.height - BAR - MARGIN * 2) / extent.height,
        4,
      );
      const left =
        MARGIN + (size.width - MARGIN * 2 - extent.width * scale) / 2;
      const top =
        BAR +
        MARGIN +
        (size.height - BAR - MARGIN * 2 - extent.height * scale) / 2;
      // the pointer in the picture's own pixels
      const point = {
        x: extent.x + (event.clientX - rect.left - left) / scale,
        y: extent.y + (event.clientY - rect.top - top) / scale,
      };

      setFit("crop");
      setView((current) => {
        if (!current) {
          return current;
        }

        const next =
          active.kind === "move"
            ? moveView(
                active.view,
                point.x - active.start.x,
                point.y - active.start.y,
              )
            : resizeView(current, active.handle, point, start.box);

        return clampView(next, start.box, start.natural);
      });
    };
    const onUp = () => {
      drag.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [extent, size, start]);

  if (!start || !extent || !view) {
    // there is nothing to crop: the media has no size to measure a view in
    return null;
  }

  const area = {
    width: size.width - MARGIN * 2,
    height: size.height - BAR - MARGIN * 2,
  };
  const scale = Math.min(
    area.width / extent.width,
    area.height / extent.height,
    4,
  );
  const left = MARGIN + (area.width - extent.width * scale) / 2;
  const top = BAR + MARGIN + (area.height - extent.height * scale) / 2;
  const sx = (px: number) => left + (px - extent.x) * scale;
  const sy = (py: number) => top + (py - extent.y) * scale;

  // the crop box, on the screen
  const box = {
    x: sx(view.x),
    y: sy(view.y),
    w: view.width * scale,
    h: view.height * scale,
  };
  const outline = shapePath(
    start.shape,
    box.x,
    box.y,
    box.w,
    box.h,
    start.radius * (box.w / start.box.width),
  );
  const handleAt = (handle: CropHandle) => ({
    x:
      box.x +
      (handle.includes("w") ? 0 : handle.includes("e") ? box.w : box.w / 2),
    y:
      box.y +
      (handle.includes("n") ? 0 : handle.includes("s") ? box.h : box.h / 2),
  });

  const choose = (next: MediaFit) => {
    setFit(next);
    setView(viewForFit(next, start.box, start.natural, start.shape, view));
  };

  return (
    <div
      className="media-crop"
      role="dialog"
      aria-label="Crop the picture"
      data-testid="media-crop"
    >
      <div className="media-crop__bar" data-testid="media-crop-bar">
        <div className="media-crop__fits" role="group" aria-label="Fit">
          {MEDIA_FITS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              data-testid={`media-crop-fit-${candidate}`}
              aria-pressed={fit === candidate}
              onClick={() => choose(candidate)}
            >
              {FIT_LABELS[candidate]}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="media-crop-reset"
          onClick={() => choose("auto")}
        >
          Reset
        </button>
        <span className="media-crop__spacer" />
        <button
          type="button"
          data-testid="media-crop-cancel"
          onClick={closeMediaCrop}
        >
          Cancel
        </button>
        <button
          type="button"
          className="media-crop__apply"
          data-testid="media-crop-apply"
          onClick={() => apply(fit, view)}
        >
          Apply
        </button>
      </div>

      <div ref={stage} className="media-crop__stage">
        {start.file ? (
          <img
            src={start.file.dataURL}
            alt=""
            draggable={false}
            data-testid="media-crop-image"
            style={{
              left: sx(0),
              top: sy(0),
              width: start.natural.width * scale,
              height: start.natural.height * scale,
            }}
          />
        ) : (
          <p className="media-crop__note">
            There is no picture to show for this video, but the fits work.
          </p>
        )}

        <svg
          className="media-crop__overlay"
          width={size.width}
          height={size.height}
          data-testid="media-crop-overlay"
        >
          {/* everything outside the node's shape is dimmed */}
          <path
            d={`M 0 0 H ${size.width} V ${size.height} H 0 Z ${outline}`}
            fillRule="evenodd"
            className="media-crop__dim"
            data-testid="media-crop-dim"
          />
          <path d={outline} className="media-crop__outline" />

          {/* the rule of thirds */}
          {[1, 2].map((i) => (
            <g
              key={i}
              className="media-crop__grid"
              data-testid="media-crop-grid"
            >
              <line
                x1={box.x + (box.w * i) / 3}
                y1={box.y}
                x2={box.x + (box.w * i) / 3}
                y2={box.y + box.h}
              />
              <line
                x1={box.x}
                y1={box.y + (box.h * i) / 3}
                x2={box.x + box.w}
                y2={box.y + (box.h * i) / 3}
              />
            </g>
          ))}

          <rect
            className="media-crop__box"
            data-testid="media-crop-box"
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            onPointerDown={(event) => {
              event.preventDefault();

              const rect = stage.current!.getBoundingClientRect();

              drag.current = {
                kind: "move",
                view,
                start: {
                  x: extent.x + (event.clientX - rect.left - left) / scale,
                  y: extent.y + (event.clientY - rect.top - top) / scale,
                },
              };
            }}
          />

          {HANDLES.map((handle) => {
            const at = handleAt(handle);

            return (
              <rect
                key={handle}
                className="media-crop__handle"
                data-testid={`media-crop-handle-${handle}`}
                data-handle={handle}
                x={at.x - HANDLE_SIZE / 2}
                y={at.y - HANDLE_SIZE / 2}
                width={HANDLE_SIZE}
                height={HANDLE_SIZE}
                style={{ cursor: `${handle}-resize` }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  drag.current = { kind: "handle", handle };
                }}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
};

/**
 * The crop screen (D-247): the whole picture with a crop box over it, in the
 * shape of the node, the four fits across the top, and Reset, Cancel and Apply.
 */
export const MediaCropMode = () => {
  const api = useExcalidrawAPI();
  const nodeId = useMediaCropNode();

  if (!api || !nodeId) {
    return null;
  }

  return <CropScreen key={nodeId} api={api} nodeId={nodeId} />;
};
