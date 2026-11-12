import { describe, expect, it } from "vitest";

import { newArrowElement } from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type {
  ElementsMap,
  ExcalidrawArrowElement,
} from "@excalidraw/element/types";

import type { LocalPoint } from "@excalidraw/math";

import { buildFlowPreset, makeFlowFork } from "../scene/flowPresets";
import { buildFlowGraph } from "../scene/flowOrder";
import { flowMarksFor, getArrowPath, pathLength } from "../scene/flowStyles";

describe("AC-598 ordinary fork branches", () => {
  it.each([2, 3, 8])(
    "builds %s branches on a shared trunk and bar",
    (count) => {
      const names = Array.from(
        { length: count },
        (_, index) => `Branch ${index + 1}`,
      );
      const made = buildFlowPreset(
        "network",
        `Root -> ${names.join(", ")} @fork-${count}`,
        { seed: 81 },
      );
      if (!made.ok) {
        throw new Error(made.error);
      }
      const arrows = made.elements.filter(
        (element) => element.type === "arrow",
      ) as ExcalidrawArrowElement[];
      expect(arrows).toHaveLength(count);
      expect(
        arrows.every((arrow) => arrow.startBinding && arrow.endBinding),
      ).toBe(true);
      expect(
        arrows.every(
          (arrow) =>
            arrow.x === arrows[0].x &&
            arrow.y === arrows[0].y &&
            JSON.stringify(arrow.points[1]) ===
              JSON.stringify(arrows[0].points[1]),
        ),
      ).toBe(true);
      expect(arrows.every((arrow) => arrow.points.length >= 4)).toBe(true);
      const map = new Map(
        made.elements.map((element) => [element.id, element]),
      ) as ElementsMap;
      const graph = buildFlowGraph(made.elements, map);
      expect(graph.edgeArrows).toHaveLength(count);
      for (const arrow of arrows) {
        const path = getArrowPath(arrow);
        const length = pathLength(path);
        const token = flowMarksFor("token", path, ((length - 1) / 240) * 1000);
        const end = path[path.length - 1];
        expect(
          Math.hypot(token.dots[0].x - end.x, token.dots[0].y - end.y),
        ).toBeLessThan(1.01);
        const beams = flowMarksFor("marching-beam", path, 125);
        expect(beams.strokes.length).toBeGreaterThan(0);
      }
    },
  );

  it("loose drops have no false binding or flow step", () => {
    const nested = buildFlowPreset(
      "network",
      "Root -> A, B @fork-2\nA -> C, D, E @fork-3",
      { seed: 85 },
    );
    if (!nested.ok) {
      throw new Error(nested.error);
    }
    const nestedMap = new Map(
      nested.elements.map((element) => [element.id, element]),
    ) as ElementsMap;
    expect(buildFlowGraph(nested.elements, nestedMap).edgeArrows).toHaveLength(
      5,
    );
    const incoming = buildFlowPreset("network", "B -> A @fork-3", {
      seed: 82,
      direction: "TB",
    });
    const reverse = buildFlowPreset("network", "B, C -> A @fork-3", {
      seed: 83,
      direction: "TB",
    });
    expect(incoming.ok).toBe(true);
    if (!reverse.ok) {
      throw new Error(reverse.error);
    }
    const reverseArrows = reverse.elements.filter(
      (element) => element.type === "arrow",
    ) as ExcalidrawArrowElement[];
    expect(reverseArrows.filter((arrow) => !arrow.startBinding)).toHaveLength(
      1,
    );
    for (const arrow of reverseArrows) {
      expect(arrow.points).toHaveLength(4);
      const target = reverse.elements.find(
        (element) => element.id === arrow.endBinding!.elementId,
      )!;
      expect(arrow.y + arrow.points[arrow.points.length - 1][1]).toBe(target.y);
      expect(arrow.y + arrow.points[arrow.points.length - 2][1]).toBeLessThan(
        target.y,
      );
    }
    const made = buildFlowPreset("network", "Root -> B @fork-3", { seed: 81 });
    if (!made.ok) {
      throw new Error(made.error);
    }
    const arrows = made.elements.filter(
      (element) => element.type === "arrow",
    ) as ExcalidrawArrowElement[];
    expect(arrows).toHaveLength(3);
    expect(arrows.filter((arrow) => !arrow.endBinding)).toHaveLength(2);
    expect(
      made.elements.filter(
        (element) => element.customData?.flow.role === "node",
      ),
    ).toHaveLength(2);
  });
});

describe("AC-598 a fork goes the way its trunk was drawn", () => {
  const forkOf = (end: [number, number]) => {
    const trunk = newArrowElement({
      type: "arrow",
      x: 500,
      y: 500,
      points: [pointFrom<LocalPoint>(0, 0), pointFrom<LocalPoint>(...end)],
    });
    const made = makeFlowFork([trunk], { [trunk.id]: true }, 3).filter(
      (element) => !element.isDeleted,
    ) as ExcalidrawArrowElement[];
    return made;
  };
  const reach = (arrow: ExcalidrawArrowElement) =>
    arrow.points.map((point) => [arrow.x + point[0], arrow.y + point[1]]);

  it.each([
    ["right", [100, 0], 0, 1],
    ["left", [-100, 0], 0, -1],
    ["down", [0, 100], 1, 1],
    ["up", [0, -100], 1, -1],
  ] as const)("drawn %s the drops go %s", (_name, end, axis, sign) => {
    const arrows = forkOf([end[0], end[1]]);
    expect(arrows).toHaveLength(3);
    for (const arrow of arrows) {
      const points = reach(arrow);
      const far = points[points.length - 1][axis] - 500;
      expect(Math.sign(far)).toBe(sign);
      // the bar is on the same side
      expect(Math.sign(points[1][axis] - 500)).toBe(sign);
    }
  });

  it("puts the branches of a fork in one group", () => {
    const arrows = forkOf([0, 100]);
    expect(new Set(arrows.map((arrow) => arrow.groupIds[0])).size).toBe(1);
    expect(arrows[0].groupIds).toHaveLength(1);
  });
});
