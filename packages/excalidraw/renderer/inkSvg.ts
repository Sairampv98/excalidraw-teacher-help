/**
 * The ink look of an element in an SVG export (D-241).
 *
 * What the element draws is wrapped in a group with the filter of its look, made
 * from the same plan the canvas follows (`inkSvgPrimitives`), so an export looks
 * as the editor does.
 */

import { applyDarkModeFilter, SVG_NS, THEME } from "@excalidraw/common";
import {
  getCommonBounds,
  inkOf,
  inkPadding,
  inkSvgPrimitives,
} from "@excalidraw/element";

import type { InkSvgPrimitive } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { RenderableElementsMap, SVGRenderConfig } from "../scene/types";

const primitiveNode = (doc: Document, primitive: InkSvgPrimitive): Element => {
  const node = doc.createElementNS(SVG_NS, primitive.tag);

  for (const [name, value] of Object.entries(primitive.attrs)) {
    node.setAttribute(name, value);
  }

  for (const child of primitive.children ?? []) {
    node.appendChild(primitiveNode(doc, child));
  }

  return node;
};

/**
 * Renders an element with `render` and, when it has an ink look, puts what it
 * rendered in a group with the look's filter.
 */
export const renderWithInk = (
  element: ExcalidrawElement,
  elementsMap: RenderableElementsMap,
  svgRoot: SVGElement,
  renderConfig: SVGRenderConfig,
  render: () => void,
) => {
  const ink = inkOf(element);

  if (ink.look === "normal") {
    render();
    return;
  }

  const before = svgRoot.childNodes.length;

  render();

  const added = [...svgRoot.childNodes].slice(before);

  if (added.length === 0) {
    return;
  }

  const doc = svgRoot.ownerDocument;
  const container =
    element.type === "text" && element.containerId
      ? elementsMap.get(element.containerId)
      : null;
  const [x1, y1, x2, y2] = getCommonBounds(
    container ? [container, element] : [element],
  );
  const room = inkPadding(ink) + 4;
  const color =
    renderConfig.theme === THEME.DARK
      ? applyDarkModeFilter(element.strokeColor)
      : element.strokeColor;

  const id = `ink-${element.id}`;
  const filter = doc.createElementNS(SVG_NS, "filter");

  filter.setAttribute("id", id);
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.setAttribute("x", String(x1 + renderConfig.offsetX - room));
  filter.setAttribute("y", String(y1 + renderConfig.offsetY - room));
  filter.setAttribute("width", String(x2 - x1 + room * 2));
  filter.setAttribute("height", String(y2 - y1 + room * 2));

  for (const primitive of inkSvgPrimitives(ink, color, element.seed)) {
    filter.appendChild(primitiveNode(doc, primitive));
  }

  let defs = svgRoot.querySelector("defs");

  if (!defs) {
    defs = doc.createElementNS(SVG_NS, "defs");
    svgRoot.prepend(defs);
  }

  defs.appendChild(filter);

  const group = doc.createElementNS(SVG_NS, "g");

  group.setAttribute("filter", `url(#${id})`);
  group.setAttribute("data-ink", ink.look);
  added.forEach((node) => group.appendChild(node));
  svgRoot.appendChild(group);
};
