import React from "react";
import { describe, expect, it } from "vitest";

import {
  Scene,
  updateBoundElements,
  syncInvalidIndices,
} from "@excalidraw/element";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { actionFlowLayout } from "../actions/actionFlowLayout";

import { buildFlowPreset, flowRoutePoints } from "../scene/flowPresets";

import { getArrowPath } from "../scene/flowStyles";

import { applyFlowScript } from "../scene/flowApply";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, render } from "./test-utils";

const build = (words: string) => {
  const made = buildFlowPreset("network", `A -> B ${words}`, { seed: 81 });
  if (!made.ok) {
    throw new Error(made.error);
  }
  return made.elements.find(
    (element) => element.type === "arrow",
  ) as ExcalidrawArrowElement;
};

describe("AC-580 route construction", () => {
  it("layout reroutes a bound chart, and undo and redo restore the whole action", async () => {
    const made = buildFlowPreset(
      "network",
      "A -> B @elbow:left @curve:right\nB -> C",
      { seed: 84, chartId: "layout-route", direction: "LR" },
    );
    if (!made.ok) {
      throw new Error(made.error);
    }
    await render(
      <Excalidraw
        handleKeyboardGlobally
        initialData={{ elements: made.elements }}
      />,
    );
    const snapshot = () =>
      JSON.stringify(
        window.h.elements
          .filter((element) => !element.isDeleted && element.type !== "arrow")
          .map((element) => [element.id, element.x, element.y]),
      );
    const source = window.h.elements.find(
      (element) => element.customData?.flow.role === "node",
    )!;
    act(() => API.setSelectedElements([source]));
    const before = snapshot();
    act(() => window.h.app.actionManager.executeAction(actionFlowLayout, "ui"));
    const after = snapshot();
    expect(after).not.toBe(before);
    const verifyRoute = () => {
      const arrow = window.h.elements.find(
        (element) =>
          !element.isDeleted &&
          element.type === "arrow" &&
          element.customData?.flow.route,
      ) as ExcalidrawArrowElement;
      const path = getArrowPath(arrow);
      const nodes = window.h.elements.filter(
        (element) =>
          !element.isDeleted && element.customData?.flow.role === "node",
      );
      const centre = {
        x:
          nodes.reduce((sum, node) => sum + node.x + node.width / 2, 0) /
          nodes.length,
        y:
          nodes.reduce((sum, node) => sum + node.y + node.height / 2, 0) /
          nodes.length,
      };
      const expected = flowRoutePoints(
        path[0],
        path[path.length - 1],
        arrow.customData!.flow.route,
        centre,
      );
      expect(path).toHaveLength(expected.length);
      path.forEach((point, index) => {
        expect(point.x).toBeCloseTo(expected[index].x, 6);
        expect(point.y).toBeCloseTo(expected[index].y, 6);
      });
      expect(
        nodes.some((node) => node.id === arrow.startBinding?.elementId),
      ).toBe(true);
      expect(
        nodes.some((node) => node.id === arrow.endBinding?.elementId),
      ).toBe(true);
    };
    verifyRoute();
    Keyboard.undo();
    expect(snapshot()).toBe(before);
    verifyRoute();
    Keyboard.redo();
    expect(snapshot()).toBe(after);
    verifyRoute();
  });
  it("script edits clear removed routes while preserving arrow identity and looks", () => {
    const made = buildFlowPreset("network", "A -> B @elbow:left @curve:right", {
      seed: 80,
      chartId: "route-edit",
    });
    if (!made.ok) {
      throw new Error(made.error);
    }
    const old = made.elements.find((element) => element.type === "arrow")!;
    const elements = made.elements.map((element) =>
      element.id === old.id
        ? { ...element, strokeColor: "#c92a2a", strokeWidth: 4 }
        : element,
    );
    const changed = applyFlowScript({
      elements,
      chartId: "route-edit",
      preset: "network",
      script: "A -> B",
      fit: "page",
      shape: "own",
      page: { x: 0, y: 0, width: 1680, height: 1000 },
    });
    if (!changed.ok) {
      throw new Error(changed.error);
    }
    const arrow = changed.elements.find((element) => element.id === old.id)!;
    expect(arrow.customData?.flow.route).toBeUndefined();
    expect(arrow.strokeColor).toBe("#c92a2a");
    expect(arrow.strokeWidth).toBe(4);
    expect((arrow as ExcalidrawArrowElement).points).toHaveLength(2);
  });
  it("recomputes interior points when a bound node moves and resizes", () => {
    const built = buildFlowPreset(
      "network",
      "A -> B @elbow:left @curve:right",
      { seed: 81, chartId: "route" },
    );
    if (!built.ok) {
      throw new Error(built.error);
    }
    const scene = new Scene();
    scene.replaceAllElements(syncInvalidIndices(built.elements));
    const arrow = scene
      .getNonDeletedElements()
      .find((element) => element.type === "arrow") as ExcalidrawArrowElement;
    const target = scene.getElement(arrow.endBinding!.elementId)!;
    const before = getArrowPath(arrow);
    scene.mutateElement(target, {
      x: target.x + 300,
      height: target.height * 2,
    });
    updateBoundElements(target, scene);
    const after = getArrowPath(arrow);
    expect(after[1]).not.toEqual(before[1]);
    expect(after[after.length - 1]).not.toEqual(before[before.length - 1]);
    expect(arrow.endBinding?.elementId).toBe(target.id);
    expect(target.boundElements?.some((bound) => bound.id === arrow.id)).toBe(
      true,
    );
    scene.destroy();
  });
  it("uses native elbows only for one elbow", () => {
    expect(build("@elbow").elbowed).toBe(true);
    const mixed = build("@elbow @curve");
    expect(mixed.elbowed).toBe(false);
    expect(mixed.points.length).toBeGreaterThan(3);
    expect(mixed.startBinding?.elementId).toBeTruthy();
    expect(mixed.endBinding?.elementId).toBeTruthy();
    expect(mixed.customData?.flow.route).toEqual([
      { kind: "elbow" },
      { kind: "curve" },
    ]);
  });

  it("sides change geometry and straight stays straight", () => {
    const nativeLeft = build("@elbow:left");
    const nativeRight = build("@elbow:right");
    expect([nativeLeft.x, nativeLeft.y, nativeLeft.points]).not.toEqual([
      nativeRight.x,
      nativeRight.y,
      nativeRight.points,
    ]);
    expect(
      nativeLeft.points
        .slice(1)
        .every(
          (point, index) =>
            point[0] === nativeLeft.points[index][0] ||
            point[1] === nativeLeft.points[index][1],
        ),
    ).toBe(true);
    expect(build("@elbow:left @elbow:left").points).not.toEqual(
      build("@elbow:right @elbow:right").points,
    );
    expect(build("@straight").points).toHaveLength(2);
    expect(build("").points).toHaveLength(2);
  });
  it("each sharp bend is orthogonal and the requested side changes the step", () => {
    for (const count of [1, 2, 3, 5]) {
      const points = flowRoutePoints(
        { x: 0, y: 0 },
        { x: 300, y: 200 },
        Array.from({ length: count }, () => ({ kind: "elbow" as const })),
      );
      expect(points).toHaveLength(count + 2);
      expect(
        points
          .slice(1)
          .every(
            (point, index) =>
              point.x === points[index].x || point.y === points[index].y,
          ),
      ).toBe(true);
    }
    const left = flowRoutePoints({ x: 0, y: 0 }, { x: 300, y: 0 }, [
      { kind: "elbow", side: "left" },
      { kind: "elbow" },
    ]);
    const right = flowRoutePoints({ x: 0, y: 0 }, { x: 300, y: 0 }, [
      { kind: "elbow", side: "right" },
      { kind: "elbow" },
    ]);
    expect(left[1].y).toBeLessThan(0);
    expect(right[1].y).toBeGreaterThan(0);
  });
});
