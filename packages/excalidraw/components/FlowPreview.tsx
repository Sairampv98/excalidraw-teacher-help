import React from "react";

import type { FlowPreview as FlowPreviewData } from "../scene/flowPreview";

type FlowPreviewProps = {
  preview: FlowPreviewData | null;
  className?: string;
};

/**
 * The small picture of a kind of chart (D-239), drawn from the shapes and lines
 * of `flowKindPreview`. It has no words: the name is beside it.
 */
export const FlowPreview = ({ preview, className }: FlowPreviewProps) => {
  if (!preview) {
    return null;
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${preview.width} ${preview.height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-flow-preview=""
    >
      {preview.items.map((item, index) => {
        switch (item.kind) {
          case "rect":
            return (
              <rect
                key={index}
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                rx={item.radius}
                fill={item.fill}
                stroke={item.stroke}
                strokeWidth={1}
                opacity={item.opacity}
              />
            );
          case "ellipse":
            return (
              <ellipse
                key={index}
                cx={item.cx}
                cy={item.cy}
                rx={item.rx}
                ry={item.ry}
                fill={item.fill}
                stroke={item.stroke}
                strokeWidth={1}
                opacity={item.opacity}
              />
            );
          case "diamond":
            return (
              <polygon
                key={index}
                points={item.points}
                fill={item.fill}
                stroke={item.stroke}
                strokeWidth={1}
                opacity={item.opacity}
              />
            );
          default:
            return (
              <g key={index}>
                <polyline
                  points={item.points}
                  fill="none"
                  stroke={item.stroke}
                  strokeWidth={1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {item.head && (
                  <polyline
                    points={item.head}
                    fill="none"
                    stroke={item.stroke}
                    strokeWidth={1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </g>
            );
        }
      })}
    </svg>
  );
};
