import React, {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import {
  WHOLE_PICTURE,
  clearPendingScreenshot,
  getAnyPendingScreenshot,
  revertPendingScreenshotCrop,
  setPendingScreenshotCrop,
  subscribePendingScreenshots,
} from "../scene/panelScreenshot";

import { t } from "../i18n";

import { useFullscreenElement } from "./useFullscreenElement";

import type { ExcalidrawPage } from "../types";
import type {
  PanelScreenshotChoice,
  PanelScreenshotCrop,
} from "../scene/panelScreenshot";

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
 *
 * ## The z-plane (D-139, D-140)
 *
 * The focus state is **two** planes. The dimming steps the **canvas** back, and
 * the picture comes **forward**: over the interactive canvas and over the
 * panels. The owner saw the crop handles and could not move them - "i can see
 * the handles to crop the image but not do anything to it" - because the whole
 * focus state was drawn *under* the interactive canvas, which took the pointer.
 * The dimming stays **under** the panels on purpose: a panel dims its own
 * content, and its own chrome - the three choices - stays bright.
 *
 * ## The steps (D-140)
 *
 * The crop is the **first** step and the target is the **last** one. The
 * picture in front is there for the whole flow, so the teacher may crop it
 * again at any point - which is what the owner's own flows describe.
 */
export const PanelScreenshotFocus = ({
  panels,
  viewport,
  pages,
  currentPageId,
  onPageChoice,
  onChoice,
}: {
  /** the panels on the canvas: a focus whose panel is gone goes with it */
  panels: readonly ExcalidrawPanelElement[];
  /** the viewport the picture is presented in */
  viewport: { width: number; height: number };
  /** the document's pages: the page selector ribbon offers them (D-140) */
  pages: readonly ExcalidrawPage[];
  /** the page the teacher is on: where the picture goes unless they say else (D-349) */
  currentPageId?: string;
  /** the teacher picked a page in the ribbon (D-140) */
  onPageChoice?: (panelId: string, pageId: string | null) => void;
  /** the teacher chose what to do with the picture (D-277) */
  onChoice?: (panelId: string, choice: PanelScreenshotChoice) => void;
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

  /**
   * Esc leaves the focus state (D-278): the teacher can always get out of it,
   * whatever step the picture is in.
   */
  const pendingPanelId = pending?.panelId ?? null;

  useEffect(() => {
    if (!pendingPanelId) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearPendingScreenshot(pendingPanelId);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingPanelId]);

  const fullscreen = useFullscreenElement();

  /** the page the teacher chose to put the picture on; none yet is the current one (D-349) */
  const [chosenPage, setChosenPage] = useState<string | null>(null);

  if (!pending) {
    return null;
  }

  // the panel is gone: the picture it was taken from is gone too
  if (!panels.some((panel) => panel.id === pending.panelId)) {
    return null;
  }

  const crop = pending.crop ?? WHOLE_PICTURE;
  const stage = pending.stage ?? "crop";

  /**
   * The picture's size on the screen.
   *
   * The picture keeps its own proportions and fits the viewport, so the teacher
   * sees the picture as it is - big enough to crop, small enough to leave
   * room around it.
   *
   * In the **last** step the picture steps back into the corner: the canvas is
   * the teacher's now - the wireframe is standing on it, and the picture must
   * not stand on top of it (D-140).
   */
  const pictureWidth = pending.width || 1;
  const pictureHeight = pending.height || 1;

  // the crop window is the whole viewport - or the whole full-screen element -
  // and its bar is on top (D-339)
  const room = fullscreen
    ? {
        width: fullscreen.clientWidth || viewport.width,
        height: fullscreen.clientHeight || viewport.height,
      }
    : viewport;

  const below = Math.max(room.height - CROP_BAR_HEIGHT, 1);

  const fit = Math.min(
    (room.width * 0.9) / pictureWidth,
    (below * 0.86) / pictureHeight,
  );

  const displayWidth = pictureWidth * fit;
  const displayHeight = pictureHeight * fit;

  const pictureLeft = (room.width - displayWidth) / 2;
  const pictureTop = CROP_BAR_HEIGHT + (below - displayHeight) / 2;

  /** the page the picture goes on, and what the button says it is (D-349) */
  const targetPage =
    pages.find((page) => page.id === chosenPage)?.id ?? currentPageId;
  const targetName = pages.find((page) => page.id === targetPage)?.name;
  const insertLabel =
    targetPage && targetPage !== currentPageId && targetName
      ? t("labels.panel.screenshot.pageNamed", { name: targetName })
      : t("labels.panel.screenshot.page");

  /** whether the teacher has cropped the picture: the read says what it reads */
  const cropped = crop.x > 0 || crop.y > 0 || crop.width < 1 || crop.height < 1;

  /**
   * What the teacher chose (D-339).
   *
   * The placement is on the canvas, so a panel that is full screen is left
   * before the choice is made; a new page needs no ribbon - it is made when
   * the picture is placed.
   */
  const choose = async (value: PanelScreenshotChoice) => {
    const panelId = pending.panelId;

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.();
      } catch {
        // the browser kept it full screen: the flow goes on all the same
      }
    }

    onChoice?.(panelId, value);

    if (value === "new-page") {
      // a new page needs no ribbon: it is made when the picture is placed
      onPageChoice?.(panelId, null);
    } else if (value === "page" && targetPage && targetPage !== currentPageId) {
      // another page than the one the teacher is on (D-349)
      onPageChoice?.(panelId, targetPage);
    }
  };

  /**
   * The cropped part of the picture, in the picture's own screen box.
   *
   * The preview shows **only** that part (D-139): a crop that is drawn over
   * the whole picture is a promise the panel does not keep - the teacher
   * cannot see what they are about to place.
   */
  const cropLeft = crop.x * displayWidth;
  const cropTop = crop.y * displayHeight;
  const cropWidth = crop.width * displayWidth;
  const cropHeight = crop.height * displayHeight;

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

    // the capture keeps the drag alive when the pointer leaves the handle -
    // and it is optional, because a browser without it still drags (D-139)
    event.currentTarget.setPointerCapture?.(event.pointerId);
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

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  if (stage === "place") {
    // The canvas is the teacher's now (D-140): the rectangle follows the
    // pointer and a click places it, so all that is drawn is a hint and the way
    // out.
    return (
      <div
        className="excalidraw__panel-screenshot-focus"
        data-testid="panel-screenshot-focus"
        data-stage="place"
        style={{
          position: "absolute",
          top: 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: "var(--zIndex-cropWindow)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px",
          borderRadius: 8,
          background: CROP_BAR_BACKGROUND,
          color: "#fff",
          fontSize: 15,
          pointerEvents: "auto",
          ["--panel-scale" as string]: 1,
        }}
      >
        <span data-testid="panel-screenshot-place-hint">
          {t("labels.panel.screenshot.placeHint")}
        </span>
        <button
          type="button"
          className="excalidraw__panel-screenshot-choice"
          data-testid="panel-screenshot-cancel"
          data-panel-id={pending.panelId}
          onClick={() => clearPendingScreenshot(pending.panelId)}
          style={{ ...CROP_BUTTON, flexShrink: 0 }}
        >
          {t("labels.panel.screenshot.cancel")}
        </button>
      </div>
    );
  }

  const node = (
    <div
      className="excalidraw__panel-screenshot-focus"
      data-testid="panel-screenshot-focus"
      data-stage={stage}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        // The crop window is its own window (D-339): opaque, so nothing of the
        // canvas or of a panel shows through it, and it takes the pointer.
        background: "#111113",
        pointerEvents: "auto",
        zIndex: "var(--zIndex-cropWindow)",
      }}
    >
      {/* the picture in front, with the crop on it (D-116) */}
      <div
        className="excalidraw__panel-screenshot-focus-preview"
        data-testid="panel-screenshot-focus-preview"
        style={{
          position: "absolute",
          left: pictureLeft,
          top: pictureTop,
          width: displayWidth,
          height: displayHeight,
          // the picture is a picture: only the crop handles take the pointer
          pointerEvents: "none",
        }}
      >
        {/* the **cropped part** of the picture - and only that (D-139) */}
        <div
          className="excalidraw__panel-screenshot-focus-cropped"
          data-testid="panel-screenshot-focus-cropped"
          style={{
            position: "absolute",
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
            overflow: "hidden",
          }}
        >
          <img
            src={pending.dataURL}
            alt=""
            data-testid="panel-screenshot-focus-image"
            draggable={false}
            style={{
              position: "absolute",
              // the picture is drawn whole, and the crop window looks at the
              // part of it the teacher kept
              left: -cropLeft,
              top: -cropTop,
              width: displayWidth,
              height: displayHeight,
              objectFit: "contain",
              display: "block",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* the crop: the part of the picture that will be placed */}
        <div
          className="excalidraw__panel-screenshot-crop"
          data-testid="panel-screenshot-crop"
          style={{
            position: "absolute",
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
            border: "1px solid #fff",
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
              aria-label={t("labels.crop.handle")}
              onPointerDown={(event) => onPointerDown(event, handle)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{
                position: "absolute",
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: "#fff",
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

      {/*
        What to do with the picture, in a bar on top of the window (D-339): the
        three choices, the revert and a way out. It is on the window itself, so
        it is always on the screen - and in the full-screen panel too.
      */}
      <div
        className="excalidraw__panel-screenshot-actions"
        data-testid="panel-screenshot-actions"
        role="group"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: CROP_BAR_HEIGHT,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "0 12px",
          background: CROP_BAR_BACKGROUND,
          borderBottom: "1px solid #2e2e34",
          zIndex: "var(--zIndex-cropWindow)",
          pointerEvents: "auto",
          ["--panel-scale" as string]: 1,
        }}
      >
        {pages.length > 1 ? (
          /* which page the picture goes on (D-349) */
          <select
            data-testid="panel-screenshot-page-select"
            aria-label={t("labels.panel.screenshot.pageChoice")}
            value={targetPage ?? ""}
            onChange={(event) => setChosenPage(event.target.value)}
            style={{ ...CROP_BUTTON, flexShrink: 0 }}
          >
            {pages.map((page, index) => (
              <option key={page.id} value={page.id}>
                {page.name || `${index + 1}`}
                {page.id === currentPageId
                  ? ` (${t("labels.panel.screenshot.here")})`
                  : ""}
              </option>
            ))}
          </select>
        ) : null}

        {(
          [
            ["page", "page", insertLabel],
            ["new-page", "new-page", t("labels.panel.screenshot.newPage")],
            [
              "ocr",
              "ocr",
              cropped
                ? t("labels.panel.screenshot.readCrop")
                : t("labels.panel.screenshot.readWhole"),
            ],
          ] as const
        ).map(([name, value, label]) => (
          <button
            key={name}
            type="button"
            className="excalidraw__panel-screenshot-choice"
            data-testid={`panel-screenshot-action-${name}`}
            data-panel-id={pending.panelId}
            data-crop={
              name === "ocr" ? (cropped ? "crop" : "whole") : undefined
            }
            onClick={() => void choose(value)}
            style={{
              ...CROP_BUTTON,
              ...(name === "page" ? { background: "#4f46e5" } : {}),
              flexShrink: 0,
            }}
          >
            {label}
          </button>
        ))}

        {pending.cropUndo ? (
          /* The revert: one step, back to the uncropped capture (D-116). */
          <button
            type="button"
            className="excalidraw__panel-screenshot-crop-revert"
            data-testid="panel-screenshot-crop-revert"
            onClick={() => revertPendingScreenshotCrop(pending.panelId)}
            style={{ ...CROP_BUTTON, flexShrink: 0 }}
          >
            {t("labels.crop.revert")}
          </button>
        ) : null}

        <span style={{ flex: "1 1 0" }} />

        <button
          type="button"
          className="excalidraw__panel-screenshot-choice"
          data-testid="panel-screenshot-cancel"
          data-panel-id={pending.panelId}
          onClick={() => clearPendingScreenshot(pending.panelId)}
          style={{ ...CROP_BUTTON, flexShrink: 0 }}
        >
          {t("labels.panel.screenshot.cancel")}
        </button>
      </div>

      {stage === "page" ? (
        /* The **page selector ribbon** (D-140): the third flow goes through it
         * before the picture is placed. */
        <div
          className="excalidraw__panel-screenshot-choices"
          data-testid="panel-screenshot-pages"
          role="group"
          aria-label={t("labels.crop.pageRibbon")}
          style={{
            position: "absolute",
            left: pictureLeft + displayWidth / 2,
            top: pictureTop + displayHeight + 16,
            transform: "translateX(-50%)",
            zIndex: "var(--zIndex-cropWindow)",
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 4,
            padding: 6,
            pointerEvents: "auto",
            // the ribbon is **not** on a panel, so it carries the chrome's scale
            // itself: the sizes are the screen sizes (D-92)
            ["--panel-scale" as string]: 1,
          }}
        >
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className="excalidraw__panel-screenshot-choice"
              data-testid={`panel-screenshot-page-${page.id}`}
              data-panel-id={pending.panelId}
              onClick={() => onPageChoice?.(pending.panelId, page.id)}
              style={{ flexShrink: 0 }}
            >
              {page.name}
            </button>
          ))}
          <button
            type="button"
            className="excalidraw__panel-screenshot-choice"
            data-testid="panel-screenshot-page-new"
            data-panel-id={pending.panelId}
            onClick={() => onPageChoice?.(pending.panelId, null)}
            style={{ flexShrink: 0 }}
          >
            {t("labels.crop.newPage")}
          </button>
        </div>
      ) : null}
    </div>
  );

  return fullscreen ? createPortal(node, fullscreen) : node;
};

/** the height of the bar that holds the choices, in screen pixels (D-339) */
const CROP_BAR_HEIGHT = 72;

const CROP_BAR_BACKGROUND = "#1a1a1e";

/** a button of the crop window: large, so it can be pressed and read from afar */
const CROP_BUTTON: React.CSSProperties = {
  padding: "10px 18px",
  fontSize: 16,
  lineHeight: 1.2,
  color: "#fff",
  background: "#2a2a31",
  border: "1px solid #3a3a44",
  borderRadius: 8,
  cursor: "pointer",
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
 * Every handle is placed on the edge it belongs to: a corner handle sits on the
 * corner, an edge handle sits in the middle of its edge. The handle's own
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
