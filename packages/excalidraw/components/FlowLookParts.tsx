import React from "react";

import { getFontFamilyString, getVerticalOffset } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import { flowLookVars } from "../scene/flowLook";

import type { HighlightShape } from "../scene/flowHighlight";
import type { FlowGlowLevels, FlowLook } from "../scene/flowLook";

/** the width of the outline's stroke, in scene units: the stylesheet's (D-211) */
export const OUTLINE_STROKE = 2;

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
  part,
}: {
  shape: HighlightShape;
  width: number;
  height: number;
  className?: string;
  /** whose outline this is: the node's, or the rectangle on the label's box */
  part?: "shape" | "box";
}) => {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  // the stroke is centred on the line it follows, so the line is drawn half a
  // stroke inside the box and the stroke does not reach past the edge (D-211)
  const inset = OUTLINE_STROKE / 2;

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      data-flow-outline={shape.kind}
      data-flow-part={part}
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
          rx={Math.max(w / 2 - inset, 0)}
          ry={Math.max(h / 2 - inset, 0)}
        />
      )}
      {shape.kind === "diamond" && (
        <polygon
          className="excalidraw__flow-node-outline"
          points={`${w / 2},${inset} ${w - inset},${h / 2} ${w / 2},${
            h - inset
          } ${inset},${h / 2}`}
        />
      )}
      {shape.kind === "rect" && (
        <rect
          className="excalidraw__flow-node-outline"
          x={inset}
          y={inset}
          width={Math.max(w - OUTLINE_STROKE, 0)}
          height={Math.max(h - OUTLINE_STROKE, 0)}
          rx={Math.max(shape.radius - inset, 0)}
          ry={Math.max(shape.radius - inset, 0)}
        />
      )}
    </svg>
  );
};

/**
 * A label's letters, drawn again in the overlay (D-202, D-203, D-211): as SVG
 * text, with the **canvas's own rule** - the same font, size and line height,
 * and for every line the same baseline offset the canvas uses - so each letter
 * lands on the letter the canvas would have drawn. `color` is the highlight's,
 * or the label's own when none is given. The box it is drawn in is the label's
 * own, and the caller places it.
 */
export const LabelText = ({
  element,
  color,
  className,
}: {
  element: ExcalidrawTextElement;
  color?: string | null;
  className?: string;
}) => {
  const lines = element.text.replace(/\r\n?/g, "\n").split("\n");
  const lineHeightPx = element.fontSize * element.lineHeight;
  const verticalOffset = getVerticalOffset(
    element.fontFamily,
    element.fontSize,
    lineHeightPx,
  );
  const x =
    element.textAlign === "center"
      ? element.width / 2
      : element.textAlign === "right"
      ? element.width
      : 0;

  return (
    <svg
      className={className}
      data-flow-label={element.id}
      width={element.width}
      height={element.height}
      viewBox={`0 0 ${element.width} ${element.height}`}
      style={{
        display: "block",
        overflow: "visible",
        color: color ?? undefined,
        transform: element.angle ? `rotate(${element.angle}rad)` : undefined,
        transformOrigin: "50% 50%",
        pointerEvents: "none",
      }}
    >
      <text
        fill="currentColor"
        style={{
          fontFamily: getFontFamilyString({ fontFamily: element.fontFamily }),
          fontSize: element.fontSize,
          whiteSpace: "pre",
        }}
        textAnchor={
          element.textAlign === "center"
            ? "middle"
            : element.textAlign === "right"
            ? "end"
            : "start"
        }
      >
        {lines.map((line, index) => (
          <tspan key={index} x={x} y={index * lineHeightPx + verticalOffset}>
            {line}
          </tspan>
        ))}
      </text>
    </svg>
  );
};

/**
 * The colours of the look as CSS variables, for the stylesheet to use: unset
 * means the stylesheet's own default, which is the accent colour (D-189). The
 * cores of the neon tubes and the pipe's shades are made from the colours here
 * (D-208, D-210).
 */
export const lookVars = (
  look: Pick<FlowLook, "nodeColor" | "textColor" | "markColor"> &
    Partial<Pick<FlowLook, "arrowColor">> &
    FlowGlowLevels,
): React.CSSProperties => flowLookVars(look) as React.CSSProperties;

/**
 * The arrows of a flow drawn as neon tubes (D-217): the canvas does not draw
 * them while this does, a thin bright core with a halo in the arrow's colour.
 */
export const ArrowTubes = ({
  arrows,
}: {
  arrows: readonly {
    id: string;
    path: readonly { x: number; y: number }[];
    heads?: readonly (readonly { x: number; y: number }[])[];
  }[];
}) => (
  <>
    {arrows.map((arrow) => (
      <React.Fragment key={arrow.id}>
        <polyline
          data-flow-arrow-tube={arrow.id}
          className="excalidraw__flow-arrow-tube"
          points={arrow.path.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {(arrow.heads ?? []).map((head, i) => (
          <polyline
            key={i}
            data-flow-arrow-head={arrow.id}
            className="excalidraw__flow-arrow-tube"
            points={head.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </React.Fragment>
    ))}
  </>
);

/** the attribute that turns the neon glow on for what it is put on (D-208) */
export const lookAttrs = (
  look: Pick<FlowLook, "glowShape" | "glowText" | "glowMark" | "glowArrow">,
) => ({
  "data-flow-glow-shape": look.glowShape ? "" : undefined,
  "data-flow-glow-text": look.glowText ? "" : undefined,
  "data-flow-glow-mark": look.glowMark ? "" : undefined,
  "data-flow-glow-arrow": look.glowArrow ? "" : undefined,
});
