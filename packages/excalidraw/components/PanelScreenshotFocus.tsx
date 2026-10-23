import React, { useRef, useSyncExternalStore } from "react";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import {
  WHOLE_PICTURE,
  getAnyPendingScreenshot,
  revertPendingScreenshotCrop,
  setPendingScreenshotCrop,
  subscribePendingScreenshots,
} from "../scene/panelScreenshot";

import { t } from "../i18n";

import type { PanelScreenshotCrop } from "../scene/panelScreenshot";

/**
 * The **focus state** of a screenshot (D-116).
 *
 * The owner asked for the picture to come forward: "after clicking this button
 * the preview of the screenshot should appear as if it has moved up in the z
 * axis and the canvas/editor has moved back in the z - axis (visual effect only
 * darkens background, leaving the screenshot to become the thing in focus with
 * those 3 options i mentioned, also add a cropping tool that is turned on by
 * default so we can crop the screenshot and revert the crop back one step
 * aswell)".
 *
 * So the capture does not merely produce a picture: it opens a **focus state**.
 * The canvas behind is dimmed, the picture is presented in front of it, and the
 * three choices act on **that** picture.
 *
 * ## The crop
 *
 * The crop is **on by default**: the picture arrives with the crop tool on it,
 * so the teacher can take the part they want straight away - and leave the
 * picture whole, which is a choice too.
 *
 * The crop is the **picture's own state** (D-116): it is measured in fractions
 * of the picture, so it is the same crop at any size, and it travels with the
 * picture when the teacher moves it. And it can be taken back **one step** -
 * to the uncropped capture - and there is no second step: a crop that has been
 * reverted has nothing to revert to.
 *
 * The preview is a **picture**, not a control: only the crop handles take the
 * pointer, so the picture in front never swallows the click of a choice that
 * lies behind it.
 */
export const PanelScreenshotFocus = ({
  panels,
  viewport,
}: {
  /** the panels on the canvas: a focus whose panel is gone goes with it */
  panels: readonly ExcalidrawPanelElement[];
  /** the viewport the picture is presented in */
  viewport: { width: number; height: number };
}) => {
  const pending = useSyncExternalStore(
    subscribePendingScreenshots,
    getAnyPendingScreenshot,
    getAnyPendingScreenshot,
  );

  /**
   * The drag of a crop handle.
   *
   * The pointer's last position is kept here, not in the store: the store
   * holds the **crop**, and a pointer position is not a crop.
   */
  const dragRef = useRef<{
    pointerId: number;
    handle: string;
    startX: number;
    startY: number;
    crop: PanelScreenshotCrop;
    displayWidth: number;
    displayHeight: number;
  } | null>(null);

  if (!pending) {
    return null;
  }

  // the panel is gone: the picture it was taken from is gone too
  if (!panels.some((panel) => panel.id === pending.panelId)) {
    return null;
  }

  const crop = pending.crop ?? WHOLE_PICTURE;

  /**
   * The picture's size on the screen.
   *
   * The picture keeps its own proportions and fits the viewport, so the teacher
   * sees the picture as it is - big enough to crop, small enough to leave
   * room around it.
   */
  const pictureWidth = pending.width || 1;
  const pictureHeight = pending.height || 1;

  const fit = Math.min(
    (viewport.width * 0.9) / pictureWidth,
    (viewport.height * 0.8) / pictureHeight,
  );

  const displayWidth = pictureWidth * fit;
  const displayHeight = pictureHeight * fit;

  const onPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    handle: string,
  ) => {
    // the handle is a control: it takes the pointer, unlike the picture
    event.preventDefault();
    event.stopPropagation();

    dragRef.current = {
      pointerId: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      crop,
      displayWidth,
      displayHeight,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = (event.clientX - drag.startX) / drag.displayWidth;
    const dy = (event.clientY - drag.startY) / drag.displayHeight;

    const next = moveCropEdge(drag.crop, drag.handle, dx, dy);

    if (!next) {
      return;
    }

    setPendingScreenshotCrop(pending.panelId, next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="excalidraw__panel-screenshot-focus"
      data-testid="panel-screenshot-focus"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        // the focus state is **visual** (D-116): it dims what is behind and
        // brings the picture forward, and it does not change the document.
        pointerEvents: "none",
      }}
    >
      {/* the dimming: everything behind the picture steps back (D-116) */}
      <div
        className="excalidraw__panel-screenshot-focus-scrim"
        data-testid="panel-screenshot-focus-scrim"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0, 0, 0, 0.55)",
          // the dimming does not take the pointer: the three choices behind it
          // stay the teacher's to press
          pointerEvents: "none",
        }}
      />

      {/* the picture in front, with the crop on it (D-116) */}
      <div
        className="excalidraw__panel-screenshot-focus-preview"
        data-testid="panel-screenshot-focus-preview"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: displayWidth,
          height: displayHeight,
          // the picture is a picture: only the crop handles take the pointer
          pointerEvents: "none",
        }}
      >
        <img
          src={pending.dataURL}
          alt=""
          data-testid="panel-screenshot-focus-image"
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            display: "block",
            pointerEvents: "none",
          }}
        />

        {/* the crop: the part of the picture that will be placed */}
        <div
          className="excalidraw__panel-screenshot-crop"
          data-testid="panel-screenshot-crop"
          style={{
            position: "absolute",
            left: crop.x * displayWidth,
            top: crop.y * displayHeight,
            width: crop.width * displayWidth,
            height: crop.height * displayHeight,
            border: "1px solid var(--color-primary)",
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        >
          {CROP_HANDLES.map((handle) => (
            <div
              key={handle}
              className="excalidraw__panel-screenshot-crop-handle"
              data-testid={`panel-screenshot-crop-handle-${handle}`}
              role="button"
              tabIndex={-1}
              aria-label={t("labels.panel.screenshot.cropHandle")}
              onPointerDown={(event) => onPointerDown(event, handle)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                position: "absolute",
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: "var(--color-primary)",
                borderRadius: 2,
                // the handles are the one control of the picture
                pointerEvents: "auto",
                cursor: "crosshair",
                ...handleStyle(handle),
              }}
            />
          ))}
        </div>
      </div>

      {pending.cropUndo ? (
        /* The revert: one step, back to the uncropped capture (D-116). */
        <button
          type="button"
          className="excalidraw__panel-screenshot-crop-revert"
          data-testid="panel-screenshot-crop-revert"
          onClick={() => revertPendingScreenshotCrop(pending.panelId)}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, 0)",
            marginTop: displayHeight / 2 + 16,
            pointerEvents: "auto",
            cursor: "pointer",
          }}
        >
          {t("labels.panel.screenshot.revertCrop")}
        </button>
      ) : null}
    </div>
  );
};

/** the eight handles of the crop: the four corners and the four edges */
const CROP_HANDLES = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
] as const;

/** the size of a crop handle, in screen pixels */
const HANDLE_SIZE = 10;

/**
 * Where a handle sits on the crop.
 *
 * Every handle is placed on the edge it belongs to: a corner handle sits on
 * the corner, an edge handle sits in the middle of its edge. The handle's own
 * size is subtracted from the middle of an edge, so the handle is **on** the
 * edge and not half outside it.
 */
const handleStyle = (handle: string): React.CSSProperties => {
  const half = HANDLE_SIZE / 2;

  const onTop = { top: -half };
  const onBottom = { bottom: -half };
  const onLeft = { left: -half };
  const onRight = { right: -half };
  const inMiddle = { left: `calc(50% - ${half}px)` };
  const inMiddleV = { top: `calc(50% - ${half}px)` };

  switch (handle) {
    case "top-left":
      return { ...onTop, ...onLeft };
    case "top":
      return { ...onTop, ...inMiddle };
    case "top-right":
      return { ...onTop, ...onRight };
    case "right":
      return { ...inMiddleV, ...onRight };
    case "bottom-right":
      return { ...onBottom, ...onRight };
    case "bottom":
      return { ...onBottom, ...inMiddle };
    case "bottom-left":
      return { ...onBottom, ...onLeft };
    case "left":
      return { ...inMiddleV, ...onLeft };
    default:
      return {};
  }
};

/**
 * The crop a handle's drag produces.
 *
 * The crop is measured in fractions of the picture, so it is clamped to the
 * picture and it keeps a minimum size: a crop with no area is not a crop.
 */
export const moveCropEdge = (
  crop: PanelScreenshotCrop,
  handle: string,
  dx: number,
  dy: number,
): PanelScreenshotCrop | null => {
  const MIN = 0.05;

  let { x, y, width, height } = crop;

  if (handle.includes("left")) {
    const next = Math.min(Math.max(0, x + dx), x + width - MIN);

    width += x - next;
    x = next;
  }

  if (handle.includes("right")) {
    width = Math.min(Math.max(MIN, width + dx), 1 - x);
  }

  if (handle.includes("top")) {
    const next = Math.min(Math.max(0, y + dy), y + height - MIN);

    height += y - next;
    y = next;
  }

  if (handle.includes("bottom")) {
    height = Math.min(Math.max(MIN, height + dy), 1 - y);
  }

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
};
