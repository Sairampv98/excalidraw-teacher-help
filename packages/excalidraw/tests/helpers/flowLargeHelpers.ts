/**
 * What the tests of large charts share (D-226, D-227): scripts of any size for
 * every preset, and the checks that a built chart is sound.
 */

import { expect } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { FlowPageRect } from "../../scene/flowPresets";
import type { FlowPresetId } from "../../scene/flowScript";

/** a script of `count` nodes for a preset */
export const scriptOfSize = (
  preset: FlowPresetId,
  count: number,
  wordy = false,
) => {
  const items = Array.from(
    { length: count },
    (_, i) => `Item ${i + 1}${wordy ? " of the long lesson plan" : ""}`,
  );

  switch (preset) {
    case "decision": {
      const questions = Math.floor(count / 3);

      return Array.from(
        { length: questions },
        (_, i) => `? Question ${i + 1}\nYes ${i + 1}\nNo ${i + 1}`,
      ).join("\n");
    }
    case "tiers": {
      const tiers = 15;
      const per = Math.ceil(count / tiers);

      return Array.from({ length: tiers }, (_, t) =>
        Array.from({ length: per }, (_, j) => `T${t + 1}.${j + 1}`).join(" | "),
      ).join("\n");
    }
    case "network":
      return [
        ...items.slice(0, -1).map((item, i) => `${item} -> ${items[i + 1]}`),
        ...items
          .slice(0, -5)
          .filter((_, i) => i % 7 === 0)
          .map((item, i) => `${item} -> ${items[i * 7 + 5]}`),
      ].join("\n");
    default:
      return items.join("\n");
  }
};

/** the number of nodes a script of this size really has */
export const nodeCountOf = (preset: FlowPresetId, count: number) =>
  preset === "decision" ? Math.floor(count / 3) * 3 : count;

export const nodesOf = (elements: readonly ExcalidrawElement[]) =>
  elements.filter(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      element.customData?.flow?.role === "node",
  );

/** the page of a chart that is spread (0 for the first, and for one that is not) */
export const pageIndexOf = (element: ExcalidrawElement) =>
  (element.customData?.flow?.pageIndex as number | undefined) ?? 0;

/** no two shapes on a page overlap: their boxes keep apart */
export const expectNoOverlap = (elements: readonly ExcalidrawElement[]) => {
  const byPage = new Map<number, ExcalidrawElement[]>();

  for (const node of nodesOf(elements)) {
    byPage.set(pageIndexOf(node), [
      ...(byPage.get(pageIndexOf(node)) ?? []),
      node,
    ]);
  }

  for (const [page, nodes] of byPage) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const apart =
          a.x + a.width <= b.x + 0.5 ||
          b.x + b.width <= a.x + 0.5 ||
          a.y + a.height <= b.y + 0.5 ||
          b.y + b.height <= a.y + 0.5;

        if (!apart) {
          throw new Error(`page ${page}: ${a.id} and ${b.id} overlap`);
        }
      }
    }
  }
};

/** every arrow between two shapes is bound at both of its ends */
export const expectArrowsBound = (elements: readonly ExcalidrawElement[]) => {
  const ids = new Set(elements.map((element) => element.id));

  for (const arrow of elements) {
    if (arrow.type !== "arrow" || arrow.customData?.flow?.role !== "edge") {
      continue;
    }

    expect(arrow.startBinding && ids.has(arrow.startBinding.elementId)).toBe(
      true,
    );
    expect(arrow.endBinding && ids.has(arrow.endBinding.elementId)).toBe(true);
  }
};

/** a shape lies inside the rect of the page it is on */
export const insideRect = (element: ExcalidrawElement, rect: FlowPageRect) =>
  element.x >= rect.x - 0.5 &&
  element.y >= rect.y - 0.5 &&
  element.x + element.width <= rect.x + rect.width + 0.5 &&
  element.y + element.height <= rect.y + rect.height + 0.5;
