import React, { useCallback, useMemo, useRef, useState } from "react";

import { newImageElement } from "@excalidraw/element";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

/**
 * The crop of a **poster panel** — app-level new UI (D-68).
 *
 * The library's own crop is an **in-place crop mode on an image element**: it
 * rewrites the element's own `crop` field and it produces no new element. A
 * poster panel has no `crop` field, and a crop of a poster must leave the
 * panel **untouched** and produce a **new** image element instead. So the crop
 * of a poster is new UI, and it lives here, in the app.
 *
 * The crop rectangle is in the poster's **own pixels** — the poster's native
 * resolution — not in the panel's on-canvas size. That is what makes the
 * result a full-resolution crop rather than a thumbnail of one.
 */

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The size of the poster's own pixels. */
export const posterNaturalSize = (
  panel: ExcalidrawPanelElement,
): { width: number; height: number } => {
  const { naturalWidth, naturalHeight } = panel.panel.options;

  return {
    width: naturalWidth ?? panel.width,
    height: naturalHeight ?? panel.height,
  };
};

/**
 * The **new** image element a cropped poster produces.
 *
 * The panel is **not** touched: this returns a brand-new element, on the
 * current page, that points at the very same poster file and shows only the
 * cropped region of it.
 *
 * The new element is placed where the panel is, and it is scaled by the
 * poster's own scale on the canvas — so a crop of a poster that is shown at
 * 400×300 comes out at 400×300 on the canvas, while the file behind it stays
 * at its native resolution.
 */
export const cropPosterToImageElement = ({
  panel,
  crop,
  pageId,
  scale,
}: {
  /** the poster panel being cropped */
  panel: ExcalidrawPanelElement;
  /** the crop rectangle, in the poster's own pixels */
  crop: CropRect;
  /** the page the new element goes on */
  pageId: string;
  /** the scale of the poster on the canvas — the panel's own scale unless the caller says else */
  scale?: number;
}) => {
  if (!panel.posterFileId) {
    throw new Error("Only a poster panel can be cropped");
  }

  const natural = posterNaturalSize(panel);

  // the poster is drawn stretched to the panel's bounds, so the panel's own
  // scale is per axis: the crop must come out at the same size on the canvas
  // as the region it was taken from
  const scaleX = scale ?? panel.width / natural.width;
  const scaleY = scale ?? panel.height / natural.height;

  return newImageElement({
    type: "image",
    x: panel.x,
    y: panel.y,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
    fileId: panel.posterFileId,
    status: "saved",
    scale: [1, 1],
    crop: {
      x: crop.x,
      y: crop.y,
      width: crop.width,
      height: crop.height,
      naturalWidth: natural.width,
      naturalHeight: natural.height,
    },
    pageId,
  });
};

export type CropModalProps = {
  /** the poster panel being cropped */
  panel: ExcalidrawPanelElement;
  /** the poster's data URL */
  dataURL: string;
  /** the page the new element goes on */
  pageId: string;
  /** called with the new element when the crop is applied */
  onApply: (element: ReturnType<typeof cropPosterToImageElement>) => void;
  /** called when the crop is dismissed */
  onClose: () => void;
  /**
   * The **OCR option**: the teacher asks for the text of the crop (D-59).
   *
   * The read happens in the bridge's Node process; the crop travels with the
   * request, so only the picked part of the picture is read.
   */
  onOcr?: (crop: CropRect) => void;
  /** what the OCR option says. Never empty. */
  ocrMessage?: string;
  /** whether a read is running right now */
  ocrBusy?: boolean;
};

/**
 * The crop dialog for a poster panel.
 *
 * The user drags a rectangle over the poster; "Apply" produces the new image
 * element and hands it to `onApply`. The panel itself is never touched.
 */
export const CropModal = ({
  panel,
  dataURL,
  pageId,
  onApply,
  onClose,
  onOcr,
  ocrMessage,
  ocrBusy,
}: CropModalProps) => {
  const natural = posterNaturalSize(panel);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<CropRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = surfaceRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      dragStart.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      setSelection(null);
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStart.current;
      const rect = surfaceRef.current?.getBoundingClientRect();

      if (!start || !rect) {
        return;
      }

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      setSelection({
        x: Math.min(start.x, x),
        y: Math.min(start.y, y),
        width: Math.abs(x - start.x),
        height: Math.abs(y - start.y),
      });
    },
    [],
  );

  const onPointerUp = useCallback(() => {
    dragStart.current = null;
  }, []);

  // the selection is drawn in the poster's own pixels, so the rectangle the
  // user drags on screen has to be scaled into them
  const displayScale = useMemo(() => {
    const width = panel.width;
    const height = panel.height;

    return {
      x: natural.width / (width || 1),
      y: natural.height / (height || 1),
    };
  }, [natural.width, natural.height, panel.width, panel.height]);

  const apply = useCallback(() => {
    if (!selection || selection.width <= 0 || selection.height <= 0) {
      return;
    }

    onApply(
      cropPosterToImageElement({
        panel,
        crop: {
          x: Math.round(selection.x * displayScale.x),
          y: Math.round(selection.y * displayScale.y),
          width: Math.round(selection.width * displayScale.x),
          height: Math.round(selection.height * displayScale.y),
        },
        pageId,
      }),
    );
  }, [displayScale, onApply, pageId, panel, selection]);

  /**
   * The crop, in the poster's own pixels — the same rectangle the OCR request
   * carries (D-59).
   */
  const cropInOwnPixels = useMemo((): CropRect | null => {
    if (!selection || selection.width <= 0 || selection.height <= 0) {
      return null;
    }

    return {
      x: Math.round(selection.x * displayScale.x),
      y: Math.round(selection.y * displayScale.y),
      width: Math.round(selection.width * displayScale.x),
      height: Math.round(selection.height * displayScale.y),
    };
  }, [displayScale, selection]);

  return (
    <div
      className="excalidraw-modal excalidraw-modal--excalidraw"
      role="dialog"
    >
      <div className="excalidraw-modal__inner">
        <div className="excalidraw-modal__header">
          {`Crop poster — ${panel.panelKind}`}
        </div>
        <div className="excalidraw-modal__content">
          <div
            ref={surfaceRef}
            data-testid="panel-crop-surface"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
              position: "relative",
              width: panel.width,
              height: panel.height,
              overflow: "hidden",
              cursor: "crosshair",
              userSelect: "none",
            }}
          >
            <img
              src={dataURL}
              alt=""
              draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "fill" }}
            />
            {selection && (
              <div
                data-testid="panel-crop-selection"
                style={{
                  position: "absolute",
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height,
                  border: "1px solid var(--color-primary)",
                  background: "rgba(0, 0, 0, 0.25)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        </div>
        <div className="excalidraw-modal__footer">
          {onOcr && (
            <>
              <button
                type="button"
                data-testid="panel-crop-ocr"
                onClick={() => {
                  if (cropInOwnPixels) {
                    onOcr(cropInOwnPixels);
                  }
                }}
                disabled={!cropInOwnPixels || ocrBusy}
              >
                Read the text
              </button>
              <span data-testid="panel-crop-ocr-message">
                {ocrMessage ?? ""}
              </span>
            </>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="panel-crop-apply"
            onClick={apply}
            disabled={
              !selection || selection.width <= 0 || selection.height <= 0
            }
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
