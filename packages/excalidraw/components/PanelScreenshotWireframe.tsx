import React, { useRef, useSyncExternalStore } from "react";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import {
  getAnyPendingScreenshot,
  movePendingScreenshot,
  subscribePendingScreenshots,
} from "../scene/panelScreenshot";

import { t } from "../i18n";

import type { PanelCamera } from "../scene/panelContent";

/**
 * The **wireframe** that stands where a screenshot will land (D-104).
 *
 * The owner asked for the affordance the sidebar's images already have: "a
 * wire frame of where to place the image similiar to the draggablity of gif and
 * images from the sidebar". So the picture that has been taken and has not been
 * placed yet is shown as a **rectangle of its own size**, standing on the
 * canvas where it will land, and the teacher **moves** it and **clicks** to
 * place it.
 *
 * The position comes from the library's own `sceneCoordsToViewportCoords` — the
 * oracle (D-34) — exactly as the panel's own placement does, so the wireframe
 * and the panel cannot drift apart.
 *
 * The wireframe is chrome: it is sized in **screen** pixels, so it stays
 * readable at any zoom (D-92), and it wears the chrome's own style.
 */
export const PanelScreenshotWireframe = ({
  panels,
  camera,
  onPlace,
}: {
  /** the panels on the canvas: a wireframe whose panel is gone goes with it */
  panels: readonly ExcalidrawPanelElement[];
  camera: PanelCamera;
  /** the teacher clicked the wireframe: the picture lands here */
  onPlace?: (panelId: string, at: { x: number; y: number }) => void;
}) => {
  const pending = useSyncExternalStore(
    subscribePendingScreenshots,
    getAnyPendingScreenshot,
    getAnyPendingScreenshot,
  );

  /**
   * The drag in progress.
   *
   * The pointer's last position is kept here, not in the store: the store holds
   * the **picture's** position, and a pointer position is not a picture.
   */
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  if (!pending) {
    return null;
  }

  // the panel is gone: the picture it was taken from is gone too, so the
  // wireframe goes with it (D-104)
  if (!panels.some((panel) => panel.id === pending.panelId)) {
    return null;
  }

  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX: pending.x, sceneY: pending.y },
    camera,
  );

  const zoom = camera.zoom.value || 1;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // the wireframe is a control: it takes the pointer, unlike the canvas
    event.preventDefault();
    event.stopPropagation();

    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;

    // a click is not a drag: below this the pointer is still on the same spot
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) {
      return;
    }

    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;

    movePendingScreenshot(
      pending.panelId,
      pending.x + dx / zoom,
      pending.y + dy / zoom,
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    dragRef.current = null;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    // a drag moved the wireframe; it did not place the picture (D-104)
    if (drag.moved) {
      return;
    }

    onPlace?.(pending.panelId, { x: pending.x, y: pending.y });
  };

  return (
    <div
      className="excalidraw__panel-screenshot-wireframe"
      data-testid="panel-screenshot-wireframe"
      data-panel-id={pending.panelId}
      role="button"
      tabIndex={0}
      aria-label={t("labels.panel.screenshot.wireframe")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        left: x - camera.offsetLeft,
        top: y - camera.offsetTop,
        width: pending.canvasWidth * zoom,
        height: pending.canvasHeight * zoom,
        pointerEvents: "auto",
        cursor: "move",
      }}
    >
      <span className="excalidraw__panel-screenshot-wireframe-label">
        {t("labels.panel.screenshot.wireframe")}
      </span>
    </div>
  );
};
