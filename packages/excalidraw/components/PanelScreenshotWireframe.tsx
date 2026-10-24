import React, { useRef, useSyncExternalStore } from "react";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import {
  WHOLE_PICTURE,
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
 *
 * ## When it is there (D-140)
 *
 * The wireframe is the **last** step of the flow: the teacher chooses the
 * target after the crop and after the choice, so the wireframe stands only once
 * they have chosen. It is also **above the panels**: it is a guide on the
 * canvas, and a guide that shares a z-plane with the panels competes with them
 * instead of standing over them.
 *
 * And the flow that writes **text** asks where the **text** goes: the
 * wireframe says so, and the text lands where the teacher pointed.
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

  // the target is chosen **last** (D-140): before the teacher has chosen,
  // there is no target to point at
  if ((pending.stage ?? "crop") !== "place") {
    return null;
  }

  /**
   * The **cropped** part of the picture is what lands, so the wireframe is
   * that part's size and stands where that part stands (D-116, D-139).
   */
  const crop = pending.crop ?? WHOLE_PICTURE;

  const { x, y } = sceneCoordsToViewportCoords(
    {
      sceneX: pending.x + pending.canvasWidth * crop.x,
      sceneY: pending.y + pending.canvasHeight * crop.y,
    },
    camera,
  );

  const zoom = camera.zoom.value || 1;

  const width = pending.canvasWidth * crop.width * zoom;
  const height = pending.canvasHeight * crop.height * zoom;

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

    // the capture keeps the drag alive when the pointer leaves the wireframe -
    // and it is optional, because a browser without it still drags
    event.currentTarget.setPointerCapture?.(event.pointerId);
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

    // the wireframe stands where the **cropped part** of the picture lands, so
    // that is the place it reports (D-116, D-139)
    onPlace?.(pending.panelId, {
      x: pending.x + pending.canvasWidth * crop.x,
      y: pending.y + pending.canvasHeight * crop.y,
    });
  };

  const label =
    pending.placing === "text"
      ? t("labels.crop.wireframeText")
      : t("labels.crop.wireframePicture");

  return (
    <div
      className="excalidraw__panel-screenshot-wireframe"
      data-testid="panel-screenshot-wireframe"
      data-panel-id={pending.panelId}
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        left: x - camera.offsetLeft,
        top: y - camera.offsetTop,
        width,
        height,
        pointerEvents: "auto",
        cursor: "move",
      }}
    >
      <span className="excalidraw__panel-screenshot-wireframe-label">
        {label}
      </span>
    </div>
  );
};
