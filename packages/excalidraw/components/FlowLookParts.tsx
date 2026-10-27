import React from "react";

import { getFontFamilyString } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import type { HighlightShape } from "../scene/flowHighlight";

/**
 * An outline in the shape of a node (D-192): a rectangle with its own corner
 * roundness, an ellipse or a diamond, at the node's own angle. It is drawn in
 * scene units inside a box of the node's size, so it scales with the canvas.
 *
 * What it looks like (colour, fill, dash) is the stylesheet's, through the
 * classes it is given; the geometry is all that is decided here.
 */
export const NodeOutline = ({
  shape,
  width,
  height,
  className,
}: {
  shape: HighlightShape;
  width: number;
  height: number;
  className?: string;
}) => {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      data-flow-outline={shape.kind}
      data-flow-outline-radius={
        shape.kind === "rect" ? shape.radius : undefined
      }
      style={{
        display: "block",
        overflow: "visible",
        transform: shape.angle ? `rotate(${shape.angle}rad)` : undefined,
        transformOrigin: "50% 50%",
      }}
    >
      {shape.kind === "ellipse" && (
        <ellipse
          className="excalidraw__flow-node-outline"
          cx={w / 2}
          cy={h / 2}
          rx={w / 2}
          ry={h / 2}
        />
      )}
      {shape.kind === "diamond" && (
        <polygon
          className="excalidraw__flow-node-outline"
          points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`}
        />
      )}
      {shape.kind === "rect" && (
        <rect
          className="excalidraw__flow-node-outline"
          x={0}
          y={0}
          width={w}
          height={h}
          rx={shape.radius}
          ry={shape.radius}
        />
      )}
    </svg>
  );
};

/**
 * A label's letters, drawn again in the overlay (D-202, D-203): in the label's
 * own font, size, line height, alignment and angle, so they land on the letters
 * the canvas drew. `color` is the highlight's, or the label's own when none is
 * given. The box it is drawn in is the label's own, and the caller places it.
 */
export const LabelText = ({
  element,
  color,
  className,
}: {
  element: ExcalidrawTextElement;
  color?: string | null;
  className?: string;
}) => (
  <div
    className={className}
    data-flow-label={element.id}
    style={{
      width: element.width,
      height: element.height,
      fontFamily: getFontFamilyString({ fontFamily: element.fontFamily }),
      fontSize: element.fontSize,
      lineHeight: element.lineHeight,
      textAlign: element.textAlign as "left" | "center" | "right",
      color: color ?? undefined,
      whiteSpace: "pre",
      overflow: "visible",
      transform: element.angle ? `rotate(${element.angle}rad)` : undefined,
      transformOrigin: "50% 50%",
      pointerEvents: "none",
    }}
  >
    {element.text}
  </div>
);

/**
 * The colours of the look as CSS variables, for the stylesheet to use: unset
 * means the stylesheet's own default, which is the accent colour (D-189).
 */
export const lookVars = (look: {
  nodeColor: string | null;
  markColor: string | null;
}): React.CSSProperties =>
  ({
    "--flow-node-color": look.nodeColor ?? undefined,
    "--flow-mark-color": look.markColor ?? undefined,
  } as React.CSSProperties);
