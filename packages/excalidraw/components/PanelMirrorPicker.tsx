import React, { useRef, useState, useSyncExternalStore } from "react";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import {
  closePanelMirrorPicker,
  getAnyPanelMirrorPicker,
  setPanelMirrorPickerRegion,
  subscribePanelMirrorPickers,
} from "../scene/panelMirror";

import { t } from "../i18n";

import { moveCropEdge } from "./PanelScreenshotFocus";

import type { PanelMirrorRegion } from "../scene/panelMirror";

/**
 * The **picker**: the teacher's own control for what is mirrored (D-143).
 *
 * The owner asked for the whole editor's window to be there when they choose:
 * _"it should show me the full vscode window ... only when i click change what
 * is mirrored button"_ - so the picker shows the **whole** window, exactly as a
 * screenshot of it would look, with the crop on it.
 *
 * The crop is the teacher's own: they draw it, and they can draw it again as
 * often as they like (D-143). The choice is only made when they say so - the
 * button at the bottom - so a picker that is closed without a choice leaves the
 * panel mirroring what it mirrored.
 *
 * The picker is drawn over the canvas, in front of everything the canvas draws
 * - the same way the screenshot's focus state is (D-116) - because a choice
 * that is behind the canvas cannot be made.
 */
export const PanelMirrorPicker = ({
  panels,
  viewport,
  onChoose,
}: {
  /** the panels on the canvas: a picker whose panel is gone goes with it */
  panels: readonly ExcalidrawPanelElement[];
  /** the viewport the picture is presented in */
  viewport: { width: number; height: number };
  /** the teacher made a choice */
  onChoose?: (panelId: string, region: PanelMirrorRegion | null) => void;
}) => {
  const picker = useSyncExternalStore(
    subscribePanelMirrorPickers,
    getAnyPanelMirrorPicker,
    getAnyPanelMirrorPicker,
  );

  /**
   * The drag of the crop.
   *
   * It is kept here and not in the store: the store holds the **region**, and
   * a pointer position is not a region.
   */
  const dragRef = useRef<{
    pointerId: number;
    kind: "new" | "move" | "edge";
    handle?: string;
    startX: number;
    startY: number;
    region: PanelMirrorRegion | null;
  } | null>(null);

  /** the whole editor's window, as it is on the screen */
  const pictureRef = useRef<HTMLDivElement | null>(null);

  /**
   * The picture's own size, when the browser has it.
   *
   * The capture descriptor says how big the picture is (D-143), but the
   * browser knows it too - and the browser's answer is the one that counts
   * when the picture on the screen is the one being cropped.
   */
  const [natural, setNatural] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  /**
   * The picker of **any** panel.
   *
   * The picker does not care which panel it is for - it cares that a choice is
   * waiting to be made.
   */
  const open = picker;

  // the panel is gone: the choice it was for is gone too
  if (!open || !panels.some((panel) => panel.id === open.panelId)) {
    return null;
  }

  const pictureWidth = open.picture.width || natural.width || 1;
  const pictureHeight = open.picture.height || natural.height || 1;

  /**
   * The picture's size on the screen.
   *
   * The picture keeps its own proportions and fits the viewport, so the teacher
   * sees the editor's window as it is - big enough to crop, small enough to
   * leave room around it.
   */
  const fit = Math.min(
    (viewport.width * 0.9) / pictureWidth,
    (viewport.height * 0.8) / pictureHeight,
  );

  const displayWidth = pictureWidth * fit;
  const displayHeight = pictureHeight * fit;

  const pictureLeft = (viewport.width - displayWidth) / 2;
  const pictureTop = (viewport.height - displayHeight) / 2;

  /** the crop, in the picture's own fractions */
  const region = open.region;

  const cropLeft = (region?.x ?? 0) * displayWidth;
  const cropTop = (region?.y ?? 0) * displayHeight;
  const cropWidth = (region?.width ?? 1) * displayWidth;
  const cropHeight = (region?.height ?? 1) * displayHeight;

  /** where the pointer is, in the picture's own fractions */
  const at = (event: React.PointerEvent) => {
    // the picture's own place on the screen is read when the pointer moves:
    // the picker does not know where the canvas sits on the screen, and the
    // pointer is read against the picture itself
    const rect = pictureRef.current?.getBoundingClientRect();

    if (!rect || !rect.width || !rect.height) {
      return { x: 0, y: 0 };
    }

    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  };

  const onPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    kind: "new" | "move" | "edge",
    handle?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    dragRef.current = {
      pointerId: event.pointerId,
      kind,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      region,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = (event.clientX - drag.startX) / displayWidth;
    const dy = (event.clientY - drag.startY) / displayHeight;

    if (drag.kind === "edge" && drag.handle && drag.region) {
      const next = moveCropEdge(drag.region, drag.handle, dx, dy);

      if (next) {
        setPanelMirrorPickerRegion(open.panelId, next);
      }

      return;
    }
    if (drag.kind === "move" && drag.region) {
      // the whole crop moves: it keeps its size and stays inside the picture
      const width = drag.region.width;
      const height = drag.region.height;

      const x = Math.min(Math.max(drag.region.x + dx, 0), 1 - width);
      const y = Math.min(Math.max(drag.region.y + dy, 0), 1 - height);

      setPanelMirrorPickerRegion(open.panelId, { x, y, width, height });

      return;
    }

    // a new crop is drawn: it goes from the point the drag started at to the
    // point the pointer is at now
    const rect = pictureRef.current?.getBoundingClientRect();

    const start = rect
      ? {
          x: (drag.startX - rect.left) / rect.width,
          y: (drag.startY - rect.top) / rect.height,
        }
      : { x: 0, y: 0 };

    const now = at(event);

    const x = Math.min(start.x, now.x);
    const y = Math.min(start.y, now.y);

    setPanelMirrorPickerRegion(open.panelId, {
      x: Math.min(Math.max(x, 0), 1),
      y: Math.min(Math.max(y, 0), 1),
      width: Math.min(Math.abs(now.x - start.x), 1 - Math.max(x, 0)),
      height: Math.min(Math.abs(now.y - start.y), 1 - Math.max(y, 0)),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const choose = (next: PanelMirrorRegion | null) => {
    closePanelMirrorPicker(open.panelId);

    onChoose?.(open.panelId, next);
  };

  return (
    <div
      className="excalidraw__panel-mirror-picker"
      data-testid="panel-mirror-picker"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        // The picker's choices are drawn at the foot of the picture, and the
        // app's bottom page bar is drawn over the editor - so a picker in the
        // library's own plane was covered by it, and the three buttons could
        // not be worked with the MOUSE (D-151).
        zIndex: "var(--zIndex-panelPicker)",
      }}
    >
      {/* the dimming: the canvas behind steps back, so the choice is in front */}
      <div
        className="excalidraw__panel-mirror-picker-scrim"
        data-testid="panel-mirror-picker-scrim"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0, 0, 0, 0.55)",
          pointerEvents: "none",
        }}
      />

      {/* the whole editor's window: the teacher chooses a part of what they
          can see (D-143) */}
      <div
        className="excalidraw__panel-mirror-picker-picture"
        data-testid="panel-mirror-picker-picture"
        ref={pictureRef}
        onPointerDown={(event) => onPointerDown(event, "new")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: "absolute",
          left: pictureLeft,
          top: pictureTop,
          width: displayWidth,
          height: displayHeight,
          overflow: "hidden",
          cursor: "crosshair",
          pointerEvents: "auto",
        }}
      >
        <img
          src={open.picture.src}
          alt=""
          data-testid="panel-mirror-picker-image"
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;

            setNatural({
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          }}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "fill",
            display: "block",
            pointerEvents: "none",
          }}
        />

        {/* the crop: the part of the window that will be mirrored */}
        <div
          className="excalidraw__panel-mirror-picker-crop"
          data-testid="panel-mirror-picker-crop"
          onPointerDown={(event) => onPointerDown(event, "move")}
          style={{
            position: "absolute",
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
            border: "1px solid var(--color-primary)",
            boxSizing: "border-box",
            cursor: "move",
            pointerEvents: "auto",
          }}
        >
          {CROP_HANDLES.map((handle) => (
            <div
              key={handle}
              className="excalidraw__panel-mirror-picker-handle"
              data-testid={`panel-mirror-picker-handle-${handle}`}
              role="button"
              tabIndex={-1}
              aria-label={t("labels.mirror.handle")}
              onPointerDown={(event) => onPointerDown(event, "edge", handle)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                position: "absolute",
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: "var(--color-primary)",
                borderRadius: 2,
                pointerEvents: "auto",
                cursor: "crosshair",
                ...handleStyle(handle),
              }}
            />
          ))}
        </div>
      </div>

      {/* the choices: what the teacher does with the crop they drew */}
      <div
        className="excalidraw__panel-mirror-picker-choices"
        data-testid="panel-mirror-picker-choices"
        role="group"
        aria-label={t("labels.mirror.picker")}
        style={{
          position: "absolute",
          left: pictureLeft + displayWidth / 2,
          top: pictureTop + displayHeight + 16,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 6,
          pointerEvents: "auto",
          ["--panel-scale" as string]: 1,
        }}
      >
        <button
          type="button"
          className="excalidraw__panel-mirror-picker-choice"
          data-testid="panel-mirror-picker-apply"
          onClick={() => choose(region)}
          style={{ flexShrink: 0 }}
        >
          {t("labels.mirror.apply")}
        </button>
        <button
          type="button"
          className="excalidraw__panel-mirror-picker-choice"
          data-testid="panel-mirror-picker-whole"
          onClick={() => choose(null)}
          style={{ flexShrink: 0 }}
        >
          {t("labels.mirror.wholeWindow")}
        </button>
        <button
          type="button"
          className="excalidraw__panel-mirror-picker-choice"
          data-testid="panel-mirror-picker-cancel"
          onClick={() => choose(null)}
          style={{ flexShrink: 0 }}
        >
          {t("labels.mirror.cancel")}
        </button>
      </div>
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
 * The same rule the screenshot's crop uses (D-116): a corner handle sits on
 * the corner and an edge handle sits in the middle of its edge.
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
