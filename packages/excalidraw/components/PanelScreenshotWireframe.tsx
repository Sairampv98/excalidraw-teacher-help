import React, { useEffect, useRef, useSyncExternalStore } from "react";

import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import {
  WHOLE_PICTURE,
  getAnyPendingScreenshot,
  movePendingScreenshot,
  subscribePendingScreenshots,
} from "../scene/panelScreenshot";

import { t } from "../i18n";

import type { PanelCamera } from "../scene/panelContent";
import type { PanelScreenshot } from "../scene/panelScreenshot";

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

  /** where the pointer was last seen, in the page's own coordinates */
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  /** the latest of what the follow needs, read by the listener */
  const latest = useRef({ pending, camera });

  latest.current = { pending, camera };

  const stage = pending?.stage ?? "crop";
  const placing = pending ? stage === "place" : false;
  const pendingId = pending?.panelId ?? null;

  // The pointer is followed all the time, so the rectangle starts under it when
  // the teacher chooses and not where the picture was taken from (D-339).
  useEffect(() => {
    const follow = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };

      const { pending: current, camera: view } = latest.current;

      if (!current || (current.stage ?? "crop") !== "place") {
        return;
      }

      standUnder(current, view, event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", follow);

    return () => window.removeEventListener("pointermove", follow);
  }, []);

  // and it stands under the pointer the moment the placement begins
  useEffect(() => {
    const { pending: current, camera: view } = latest.current;
    const at = pointerRef.current;

    if (placing && current && at) {
      standUnder(current, view, at.x, at.y);
    }
  }, [placing, pendingId]);

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

  // a left click anywhere places the picture where the rectangle stands (D-339)
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

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
    <>
      {/* the click catcher: the whole canvas, so a click anywhere places it */}
      <div
        className="excalidraw__panel-screenshot-wireframe-catcher"
        data-testid="panel-screenshot-wireframe-catcher"
        onPointerDown={onPointerDown}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "auto",
          cursor: "crosshair",
          // over the interactive canvas, which would take the click
          zIndex: "var(--zIndex-screenshotWireframe)",
        }}
      />
      <div
        className="excalidraw__panel-screenshot-wireframe"
        data-testid="panel-screenshot-wireframe"
        data-panel-id={pending.panelId}
        aria-label={label}
        style={{
          position: "absolute",
          left: x - camera.offsetLeft,
          top: y - camera.offsetTop,
          width,
          height,
          // the rectangle is a hover effect: the pointer goes through it
          pointerEvents: "none",
        }}
      >
        <span className="excalidraw__panel-screenshot-wireframe-label">
          {label}
        </span>
      </div>
    </>
  );
};

/**
 * Stand the rectangle's middle under the pointer (D-339).
 *
 * The rectangle is the **cropped part** of the picture at the size it will have
 * on the canvas, so its middle is what follows the pointer, and the picture's
 * own corner is worked out from it.
 */
const standUnder = (
  pending: PanelScreenshot,
  camera: PanelCamera,
  clientX: number,
  clientY: number,
) => {
  const crop = pending.crop ?? WHOLE_PICTURE;

  const at = viewportCoordsToSceneCoords({ clientX, clientY }, camera);

  movePendingScreenshot(
    pending.panelId,
    at.x - pending.canvasWidth * (crop.x + crop.width / 2),
    at.y - pending.canvasHeight * (crop.y + crop.height / 2),
  );
};
