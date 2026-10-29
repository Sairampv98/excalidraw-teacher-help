/**
 * A page's paper as SVG (D-243): the same sheet, rules, fibres, edges and grain
 * that the canvas draws, made of SVG's own elements, for the SVG export.
 */

import { SVG_NS } from "@excalidraw/common";

import { ageEdge, ageTint, grainStrength, paperFibres } from "./paperRender";

import type { PagePaperDraw } from "../scene/paper";

const make = (
  doc: Document,
  tag: string,
  attrs: Record<string, string | number>,
) => {
  const node = doc.createElementNS(SVG_NS, tag);

  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, String(value));
  }

  return node;
};

/**
 * The paper as a group, to put under the elements. `offsetX` and `offsetY` move
 * the page to where it is in the exported picture; `defs` takes what the group
 * refers to.
 */
export const paperToSvg = (
  doc: Document,
  defs: SVGDefsElement,
  draw: PagePaperDraw,
  offsetX: number,
  offsetY: number,
): SVGElement => {
  const x = draw.rect.x + offsetX;
  const y = draw.rect.y + offsetY;
  const { width, height } = draw.rect;
  const id = `paper-${draw.seed}`;
  const group = make(doc, "g", { "data-paper": draw.paper.type });
  const clip = make(doc, "clipPath", { id: `${id}-clip` });

  clip.appendChild(make(doc, "rect", { x, y, width, height }));
  defs.appendChild(clip);
  group.setAttribute("clip-path", `url(#${id}-clip)`);

  if (draw.color) {
    group.appendChild(
      make(doc, "rect", { x, y, width, height, fill: draw.color }),
    );
  }

  if (draw.paper.age > 0) {
    group.appendChild(
      make(doc, "rect", { x, y, width, height, fill: ageTint(draw) }),
    );
  }

  const lines = draw.marks.filter((mark) => mark.kind === "line");

  for (const heavy of [false, true]) {
    const d = lines
      .filter((mark) => mark.kind === "line" && mark.heavy === heavy)
      .map(
        (mark) =>
          mark.kind === "line" &&
          `M${mark.x1 + offsetX} ${mark.y1 + offsetY}L${mark.x2 + offsetX} ${
            mark.y2 + offsetY
          }`,
      )
      .join("");

    if (d) {
      group.appendChild(
        make(doc, "path", {
          d,
          fill: "none",
          stroke: draw.ruleColor,
          "stroke-width": draw.ruleWidth * (heavy ? 1.8 : 1),
        }),
      );
    }
  }

  // a dot is a line of no length with a round cap
  const dots = draw.marks
    .map(
      (mark) =>
        mark.kind === "dot" && `M${mark.x + offsetX} ${mark.y + offsetY}l0 0`,
    )
    .filter(Boolean)
    .join("");

  if (dots) {
    group.appendChild(
      make(doc, "path", {
        d: dots,
        fill: "none",
        stroke: draw.ruleColor,
        "stroke-width": draw.ruleWidth * 2.2,
        "stroke-linecap": "round",
      }),
    );
  }

  if (draw.paper.age > 0) {
    const fibres = paperFibres(draw)
      .map(
        (f) =>
          `M${f.x1 + offsetX} ${f.y1 + offsetY}Q${f.cx + offsetX} ${
            f.cy + offsetY
          } ${f.x2 + offsetX} ${f.y2 + offsetY}`,
      )
      .join("");

    if (fibres) {
      group.appendChild(
        make(doc, "path", {
          d: fibres,
          fill: "none",
          stroke: draw.dark ? "rgba(255,255,255,0.14)" : "rgba(110,76,36,0.28)",
          "stroke-width": 1,
        }),
      );
    }

    const radius = Math.hypot(width, height) / 2;
    const gradient = make(doc, "radialGradient", {
      id: `${id}-edge`,
      gradientUnits: "userSpaceOnUse",
      cx: x + width / 2,
      cy: y + height / 2,
      r: radius,
    });

    gradient.appendChild(
      make(doc, "stop", {
        offset: 0.55,
        "stop-color": "rgb(0,0,0)",
        "stop-opacity": 0,
      }),
    );
    gradient.appendChild(
      make(doc, "stop", { offset: 1, "stop-color": ageEdge(draw) }),
    );
    defs.appendChild(gradient);
    group.appendChild(
      make(doc, "rect", { x, y, width, height, fill: `url(#${id}-edge)` }),
    );
  }

  if (draw.paper.grain > 0) {
    const filter = make(doc, "filter", {
      id: `${id}-grain`,
      x,
      y,
      width,
      height,
      filterUnits: "userSpaceOnUse",
    });

    filter.appendChild(
      make(doc, "feTurbulence", {
        type: "fractalNoise",
        baseFrequency: 0.9,
        numOctaves: 1,
        seed: draw.seed % 10000,
        result: "noise",
      }),
    );
    filter.appendChild(
      make(doc, "feColorMatrix", {
        in: "noise",
        type: "matrix",
        values: `0 0 0 0 ${draw.dark ? 1 : 0}  0 0 0 0 ${
          draw.dark ? 1 : 0
        }  0 0 0 0 ${draw.dark ? 1 : 0}  0 0 0 ${grainStrength(
          draw.paper.grain,
        ).toFixed(3)} 0`,
      }),
    );
    defs.appendChild(filter);
    group.appendChild(
      make(doc, "rect", {
        x,
        y,
        width,
        height,
        filter: `url(#${id}-grain)`,
        fill: "#000",
      }),
    );
  }

  return group;
};
