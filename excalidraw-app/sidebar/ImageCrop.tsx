import { useCallback, useEffect, useRef, useState } from "react";

import { isImageElement, mediaOf, newElementWith } from "@excalidraw/element";
import { CaptureUpdateAction, useExcalidrawAPI } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  IMAGE_CROP_MIN,
  clampImagePart,
  currentImagePart,
  imageCropUpdates,
} from "./imageCropMath";
import {
  closeImageCrop,
  openImageCrop,
  useImageCropElement,
} from "./imageCropState";
import { sceneAtClientPoint } from "./insertIntoScene";

import "./MediaCrop.scss";

import type { ImagePart } from "./imageCropMath";

/**
 * Keeps the pointer with the element it went down on, so a drag that leaves it
 * goes on. A browser that cannot (or a pointer it does not know) still drags.
 */
const capturePointer = (event: React.PointerEvent) => {
  try {
    (event.target as Element).setPointerCapture?.(event.pointerId);
  } catch {
    // the drag works without it
  }
};

/** the room round the picture on the screen, and the height of the bar above it */
const MARGIN = 48;
const BAR = 64;

const HANDLE_SIZE = 12;

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * A part, with the edges a handle holds moved by what it was dragged by - in the
 * picture's own pixels. An edge stops at the picture's edge and at the least a
 * box may be, and does not slide the box with it.
 */
const dragPart = (
  part: ImagePart,
  handle: Handle,
  dx: number,
  dy: number,
  natural: { width: number; height: number },
): ImagePart => {
  const clamp = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), Math.max(low, high));

  let left = part.x;
  let right = part.x + part.width;
  let top = part.y;
  let bottom = part.y + part.height;

  if (handle.includes("w")) {
    left = clamp(left + dx, 0, right - IMAGE_CROP_MIN);
  }

  if (handle.includes("e")) {
    right = clamp(right + dx, left + IMAGE_CROP_MIN, natural.width);
  }

  if (handle.includes("n")) {
    top = clamp(top + dy, 0, bottom - IMAGE_CROP_MIN);
  }

  if (handle.includes("s")) {
    bottom = clamp(bottom + dy, top + IMAGE_CROP_MIN, natural.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * The crop window of an image (D-348): the picture whole, with a box on it that
 * the teacher drags and sizes, and Reset, Cancel and Apply in a bar above - the
 * look of the crop screen the flow's pictures have (D-247), for every picture
 * on the canvas, GIFs too.
 */
const ImageCropScreen = ({
  api,
  elementId,
}: {
  api: ExcalidrawImperativeAPI;
  elementId: string;
}) => {
  const element = api
    .getSceneElements()
    .find((candidate) => candidate.id === elementId);

  const image =
    element && isImageElement(element) && element.fileId ? element : null;
  const file = image?.fileId ? api.getFiles()[image.fileId] : null;

  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(
    image?.crop
      ? {
          width: image.crop.naturalWidth,
          height: image.crop.naturalHeight,
        }
      : null,
  );
  const [part, setPart] = useState<ImagePart | null>(null);
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    kind: "move" | "handle";
    handle?: Handle;
    part: ImagePart;
    x: number;
    y: number;
  } | null>(null);

  // the picture's own size, when the element does not say it
  useEffect(() => {
    if (!file || natural) {
      return;
    }

    const loader = new Image();

    loader.onload = () =>
      setNatural({ width: loader.naturalWidth, height: loader.naturalHeight });
    loader.src = file.dataURL;
  }, [file, natural]);

  // the box starts where the element's own crop is - the whole picture if none
  useEffect(() => {
    if (image && natural && !part) {
      setPart(currentImagePart(image, natural));
    }
  }, [image, natural, part]);

  useEffect(() => {
    const onResize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });

    window.addEventListener("resize", onResize);

    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc leaves, as it does every window
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeImageCrop();
      }
    };

    window.addEventListener("keydown", onKey, true);

    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const apply = useCallback(() => {
    if (!image || !natural || !part) {
      return;
    }

    const updates = imageCropUpdates(image, part, natural);

    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((candidate) =>
          candidate.id === image.id
            ? newElementWith(candidate, updates)
            : candidate,
        ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    closeImageCrop();
  }, [api, image, natural, part]);

  // Enter applies, as it does in the crop window of a poster
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        apply();
      }
    };

    window.addEventListener("keydown", onKey, true);

    return () => window.removeEventListener("keydown", onKey, true);
  }, [apply]);

  if (!image || !file || !natural || !part) {
    return (
      <div className="media-crop" data-testid="image-crop">
        <div className="media-crop__bar">
          <span className="media-crop__spacer" />
          <button
            type="button"
            data-testid="image-crop-cancel"
            onClick={closeImageCrop}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // the picture, fitted under the bar with room round it
  const room = {
    width: Math.max(size.width - MARGIN * 2, 1),
    height: Math.max(size.height - BAR - MARGIN * 2, 1),
  };
  const scale = Math.min(
    room.width / natural.width,
    room.height / natural.height,
  );
  const left = (size.width - natural.width * scale) / 2;
  const top = BAR + (size.height - BAR - natural.height * scale) / 2;

  const sx = (x: number) => left + x * scale;
  const sy = (y: number) => top + y * scale;

  const box = {
    x: sx(part.x),
    y: sy(part.y),
    w: part.width * scale,
    h: part.height * scale,
  };

  const handleAt = (handle: Handle) => ({
    x: handle.includes("w")
      ? box.x
      : handle.includes("e")
      ? box.x + box.w
      : box.x + box.w / 2,
    y: handle.includes("n")
      ? box.y
      : handle.includes("s")
      ? box.y + box.h
      : box.y + box.h / 2,
  });

  const onMove = (event: React.PointerEvent) => {
    const current = drag.current;

    if (!current) {
      return;
    }

    const dx = (event.clientX - current.x) / scale;
    const dy = (event.clientY - current.y) / scale;

    if (current.kind === "move") {
      setPart(
        clampImagePart(
          {
            ...current.part,
            x: current.part.x + dx,
            y: current.part.y + dy,
          },
          natural,
        ),
      );

      return;
    }

    setPart(dragPart(current.part, current.handle!, dx, dy, natural));
  };

  const end = () => {
    drag.current = null;
  };

  return (
    <div className="media-crop" data-testid="image-crop">
      <div className="media-crop__bar">
        <button
          type="button"
          data-testid="image-crop-reset"
          onClick={() =>
            setPart({
              x: 0,
              y: 0,
              width: natural.width,
              height: natural.height,
            })
          }
        >
          Reset
        </button>
        <span className="media-crop__spacer" />
        <button
          type="button"
          data-testid="image-crop-cancel"
          onClick={closeImageCrop}
        >
          Cancel
        </button>
        <button
          type="button"
          className="media-crop__apply"
          data-testid="image-crop-apply"
          onClick={apply}
        >
          Apply
        </button>
      </div>

      <div
        ref={stage}
        className="media-crop__stage"
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <img
          src={file.dataURL}
          alt=""
          draggable={false}
          data-testid="image-crop-image"
          style={{
            left: sx(0),
            top: sy(0),
            width: natural.width * scale,
            height: natural.height * scale,
          }}
        />

        <svg
          className="media-crop__overlay"
          width={size.width}
          height={size.height}
          data-testid="image-crop-overlay"
        >
          {/* everything outside the box is dimmed */}
          <path
            d={`M 0 0 H ${size.width} V ${size.height} H 0 Z M ${box.x} ${
              box.y
            } h ${box.w} v ${box.h} h ${-box.w} Z`}
            fillRule="evenodd"
            className="media-crop__dim"
          />
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            className="media-crop__outline"
          />

          {/* the rule of thirds */}
          {[1, 2].map((i) => (
            <g key={i} className="media-crop__grid">
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
            data-testid="image-crop-box"
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            onPointerDown={(event) => {
              event.preventDefault();
              capturePointer(event);
              drag.current = {
                kind: "move",
                part,
                x: event.clientX,
                y: event.clientY,
              };
            }}
          />

          {HANDLES.map((handle) => {
            const at = handleAt(handle);

            return (
              <rect
                key={handle}
                className="media-crop__handle"
                data-testid={`image-crop-handle-${handle}`}
                x={at.x - HANDLE_SIZE / 2}
                y={at.y - HANDLE_SIZE / 2}
                width={HANDLE_SIZE}
                height={HANDLE_SIZE}
                style={{ cursor: `${handle}-resize` }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  capturePointer(event);
                  drag.current = {
                    kind: "handle",
                    handle,
                    part,
                    x: event.clientX,
                    y: event.clientY,
                  };
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
 * The crop window of every image on the canvas (D-348).
 *
 * A double click on a picture opens it, and so do the crop button and Enter
 * (the app notices the library's crop mode being asked for and opens this
 * instead): the canvas's own in-place crop was drawn under the panels, which is
 * what the teacher saw as a layer under the canvas.
 */
export const ImageCropMode = () => {
  const api = useExcalidrawAPI();
  const elementId = useImageCropElement();

  useEffect(() => {
    if (!api) {
      return;
    }

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
        if (!isImageElement(element) || !element.fileId || mediaOf(element)) {
          return false;
        }

        // the picture may be turned: the point is put into its own frame
        const dx = at.x - (element.x + element.width / 2);
        const dy = at.y - (element.y + element.height / 2);
        const cos = Math.cos(-element.angle);
        const sin = Math.sin(-element.angle);

        return (
          Math.abs(dx * cos - dy * sin) <= element.width / 2 &&
          Math.abs(dx * sin + dy * cos) <= element.height / 2
        );
      });

      if (hit) {
        event.preventDefault();
        event.stopPropagation();
        openImageCrop(hit.id);
      }
    };

    document.addEventListener("dblclick", onDoubleClick, true);

    return () => document.removeEventListener("dblclick", onDoubleClick, true);
  }, [api]);

  if (!api || !elementId) {
    return null;
  }

  return <ImageCropScreen key={elementId} api={api} elementId={elementId} />;
};
