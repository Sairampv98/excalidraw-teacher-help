import { useRef, useState } from "react";

import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";

import type { OcrRegion } from "../../packages/vscode-bridge/bridge/src/ocr";

export type OcrPicture = { dataURL: string; width: number; height: number };

/** the part of the picture, as fractions of it, between 0 and 1 */
type Area = { x: number; y: number; width: number; height: number };

/** an area smaller than this, as a fraction of the picture, is a click, not a choice */
const MIN_AREA = 0.02;

/** the area as pixels of the picture, the way an OCR read wants it */
export const areaToRegion = (area: Area, picture: OcrPicture): OcrRegion => ({
  x: Math.round(area.x * picture.width),
  y: Math.round(area.y * picture.height),
  width: Math.max(1, Math.round(area.width * picture.width)),
  height: Math.max(1, Math.round(area.height * picture.height)),
});

/**
 * Chooses what part of a picture is read (D-291).
 *
 * The whole picture is shown before anything is read, and the teacher drags
 * out the area they want read - a paragraph, a table, a line of code - or reads
 * the whole page. Only that area goes to the engine, so the read is faster and
 * the text is only the text they wanted.
 */
export const OcrAreaDialog = ({
  picture,
  onRead,
  onClose,
}: {
  picture: OcrPicture;
  /** the area to read, in pixels of the picture, or null for the whole picture */
  onRead: (region: OcrRegion | null) => void;
  onClose: () => void;
}) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const pointAt = (event: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();

    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    startRef.current = pointAt(event);
    setArea(null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;

    if (!start) {
      return;
    }

    const now = pointAt(event);

    setArea({
      x: Math.min(start.x, now.x),
      y: Math.min(start.y, now.y),
      width: Math.abs(now.x - start.x),
      height: Math.abs(now.y - start.y),
    });
  };

  const onPointerUp = () => {
    startRef.current = null;

    // a click without a drag is no area
    setArea((current) =>
      current && current.width > MIN_AREA && current.height > MIN_AREA
        ? current
        : null,
    );
  };

  return (
    <Dialog title="What should be read?" onCloseRequest={onClose} size="wide">
      <div
        data-testid="ocr-area"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ opacity: 0.75, fontSize: 13 }}>
          Drag over the part of the page to read, or read the whole page.
        </div>
        <div
          ref={boxRef}
          data-testid="ocr-area-picture"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            position: "relative",
            alignSelf: "center",
            maxWidth: "100%",
            cursor: "crosshair",
            touchAction: "none",
            userSelect: "none",
            lineHeight: 0,
          }}
        >
          <img
            src={picture.dataURL}
            alt="The page"
            draggable={false}
            style={{ maxWidth: "100%", maxHeight: "55vh", display: "block" }}
          />
          {area ? (
            <div
              data-testid="ocr-area-box"
              style={{
                position: "absolute",
                left: `${area.x * 100}%`,
                top: `${area.y * 100}%`,
                width: `${area.width * 100}%`,
                height: `${area.height * 100}%`,
                border: "2px solid #1971c2",
                background: "rgba(25, 113, 194, 0.18)",
                pointerEvents: "none",
              }}
            />
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <FilledButton
            variant="filled"
            disabled={!area}
            onClick={() => area && onRead(areaToRegion(area, picture))}
          >
            Read this area
          </FilledButton>
          <FilledButton variant="outlined" onClick={() => onRead(null)}>
            Read the whole page
          </FilledButton>
          <FilledButton
            variant="outlined"
            disabled={!area}
            onClick={() => setArea(null)}
          >
            Clear the area
          </FilledButton>
          <FilledButton variant="outlined" onClick={onClose}>
            Cancel
          </FilledButton>
        </div>
      </div>
    </Dialog>
  );
};
