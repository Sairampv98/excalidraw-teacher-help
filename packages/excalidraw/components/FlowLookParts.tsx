import React from "react";

import { coverColor } from "../scene/flowLook";

import type { HighlightShape } from "../scene/flowHighlight";
import type { PathPoint } from "../scene/flowStyles";

/** how far an arrowhead reaches back from the end of an arrow, in scene units */
const ARROWHEAD_REACH = 14;

/**
 * Where the cover of an arrowhead is centred: **back along the arrow** from its
 * tip, so that it covers the head and not the border of the node the arrow ends
 * on.
 */
const arrowheadCover = (path: readonly { x: number; y: number }[]) => {
  const end = path[path.length - 1];
  const before = path[path.length - 2] ?? end;
  const length = Math.hypot(end.x - before.x, end.y - before.y) || 1;
  const back = ARROWHEAD_REACH * 0.85;

  return {
    x: end.x - ((end.x - before.x) / length) * back,
    y: end.y - ((end.y - before.y) / length) * back,
    r: ARROWHEAD_REACH * 1.05,
  };
};

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

export type CoverArrow = { id: string; path: PathPoint[]; width: number };

/**
 * The arrows drawn over while the animation plays (D-190): in a colour of
 * their own, or - when hidden - in the page's background colour, so that only
 * what travels along them is seen.
 *
 * It is drawn by the overlay, over the arrow and under the marks: the arrow in
 * the document is not touched, and it is back the moment the overlay is gone.
 */
export const ArrowCovers = ({
  arrows,
  arrowColor,
  hideArrow,
  background,
}: {
  arrows: readonly CoverArrow[];
  arrowColor: string | null;
  hideArrow: boolean;
  background?: string | null;
}) => {
  if (!hideArrow && !arrowColor) {
    return null;
  }

  const color = hideArrow ? coverColor(background) : arrowColor!;

  return (
    <g data-flow-covers="" data-flow-covers-hidden={hideArrow ? "" : undefined}>
      {arrows.map((arrow) => {
        const end = arrow.path[arrow.path.length - 1];

        return (
          <g key={arrow.id} data-flow-cover={arrow.id}>
            <polyline
              data-flow-mark="arrow-cover"
              points={arrow.path.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke={color}
              // a hidden arrow is covered a little wider than it is drawn
              strokeWidth={arrow.width + (hideArrow ? 4 : 1)}
              // butt ends: a round cap would reach onto the border of the node
              strokeLinecap="butt"
              strokeLinejoin="round"
            />
            {hideArrow && end && (
              <circle
                data-flow-mark="arrow-cover-head"
                cx={arrowheadCover(arrow.path).x}
                cy={arrowheadCover(arrow.path).y}
                r={arrowheadCover(arrow.path).r}
                fill={color}
              />
            )}
          </g>
        );
      })}
    </g>
  );
};

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
