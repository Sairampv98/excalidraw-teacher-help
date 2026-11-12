import React from "react";

import { describe, expect, it } from "vitest";
import { LinearElementEditor } from "@excalidraw/element";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import { Excalidraw, sceneCoordsToViewportCoords } from "../index";
import { buildFlowPreset } from "../scene/flowPresets";

import { API } from "./helpers/api";
import { UI, Keyboard, Pointer } from "./helpers/ui";
import { act, fireEvent, render, screen } from "./test-utils";

describe("AC-599 fork properties", () => {
  it("changes a reverse fork's count without reversing or losing its bound connections", async () => {
    const made = buildFlowPreset("network", "B, C -> A @fork-3", {
      seed: 21,
      direction: "TB",
    });
    if (!made.ok) {
      throw new Error(made.error);
    }
    await render(<Excalidraw initialData={{ elements: made.elements }} />);
    const original = window.h.elements.filter(
      (element) => element.type === "arrow" && !element.isDeleted,
    ) as ExcalidrawArrowElement[];
    const root = original[0].endBinding!.elementId;
    const sources = original
      .flatMap((arrow) =>
        arrow.startBinding ? [arrow.startBinding.elementId] : [],
      )
      .sort();
    act(() => API.setSelectedElements([original[0]]));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Fork branches" }),
      { target: { value: "4" } },
    );
    const arrows = window.h.elements.filter(
      (element) => element.type === "arrow" && !element.isDeleted,
    ) as ExcalidrawArrowElement[];
    expect(arrows).toHaveLength(4);
    expect(arrows.every((arrow) => arrow.endBinding?.elementId === root)).toBe(
      true,
    );
    expect(
      arrows
        .flatMap((arrow) =>
          arrow.startBinding ? [arrow.startBinding.elementId] : [],
        )
        .sort(),
    ).toEqual(sources);
  });
  it("the arrow tool draws a fork, and one undo removes the whole action", async () => {
    await render(<Excalidraw handleKeyboardGlobally />);
    act(() => UI.clickTool("arrow"));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Fork branches" }),
      { target: { value: "3" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Fork" }));
    // Compact properties unmount when their popup closes. Switching tools
    // exercises the same lifecycle without depending on viewport measurement.
    act(() => UI.clickTool("rectangle"));
    act(() => UI.clickTool("arrow"));
    expect(
      screen.getByRole("button", { name: "Fork" }).getAttribute("aria-pressed"),
    ).toBe("true");
    act(() =>
      UI.createElement("arrow", { x: 100, y: 100, width: 300, height: 150 }),
    );
    expect(
      window.h.elements.filter(
        (element) => element.type === "arrow" && !element.isDeleted,
      ),
    ).toHaveLength(3);
    Keyboard.undo();
    expect(
      window.h.elements.filter(
        (element) => element.type === "arrow" && !element.isDeleted,
      ),
    ).toHaveLength(0);
    Keyboard.redo();
    expect(
      window.h.elements.filter(
        (element) => element.type === "arrow" && !element.isDeleted,
      ),
    ).toHaveLength(3);
  });
  it("offers Fork and a branch count for a selected ordinary arrow", async () => {
    const made = buildFlowPreset("network", "A -> B", { seed: 19 });
    if (!made.ok) {
      throw new Error(made.error);
    }
    await render(<Excalidraw initialData={{ elements: made.elements }} />);
    act(() =>
      API.setSelectedElements(
        window.h.elements.filter((element) => element.type === "arrow"),
      ),
    );
    const input = screen.getByRole("spinbutton", { name: "Fork branches" });
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Fork" }));
    expect(
      window.h.elements.filter(
        (element) => element.type === "arrow" && !element.isDeleted,
      ),
    ).toHaveLength(3);
    fireEvent.change(input, { target: { value: "2" } });
    expect(
      window.h.elements.filter(
        (element) => element.type === "arrow" && !element.isDeleted,
      ),
    ).toHaveLength(2);
    expect(
      window.h.elements
        .filter((element) => element.type === "arrow" && !element.isDeleted)
        .every((element) => element.customData?.flow.fork.count === 2),
    ).toBe(true);
    // AC-598: a loose branch still uses native endpoint binding when dragged.
    const loose = window.h.elements.find(
      (element) =>
        element.type === "arrow" && !element.isDeleted && !element.endBinding,
    ) as ExcalidrawArrowElement;
    const last = loose.points[loose.points.length - 1];
    const target = API.createElement({
      type: "rectangle",
      x: loose.x + last[0] + 200,
      y: loose.y + last[1] + 80,
      width: 100,
      height: 80,
    });
    act(() => API.setElements([...window.h.elements, target]));
    act(() => API.setSelectedElements([loose]));
    act(() =>
      API.setAppState({
        selectedLinearElement: new LinearElementEditor(
          loose,
          window.h.app.scene.getNonDeletedElementsMap(),
        ),
      }),
    );
    const from = sceneCoordsToViewportCoords(
      { sceneX: loose.x + last[0], sceneY: loose.y + last[1] },
      window.h.state,
    );
    const to = sceneCoordsToViewportCoords(
      { sceneX: target.x + 10, sceneY: target.y + 40 },
      window.h.state,
    );
    const mouse = new Pointer("mouse");
    act(() => mouse.downAt(from.x, from.y));
    act(() => mouse.moveTo(to.x, to.y));
    act(() => mouse.up());
    expect(
      (window.h.app.scene.getElement(loose.id) as ExcalidrawArrowElement)
        .endBinding?.elementId,
    ).toBe(target.id);
    expect(
      window.h.app.scene
        .getElement(target.id)
        ?.boundElements?.some((element) => element.id === loose.id),
    ).toBe(true);
  });

  it("Make fork combines selected arrows leaving one node", async () => {
    const made = buildFlowPreset("network", "A -> B, C", { seed: 19 });
    if (!made.ok) {
      throw new Error(made.error);
    }
    await render(<Excalidraw initialData={{ elements: made.elements }} />);
    act(() =>
      API.setSelectedElements(
        window.h.elements.filter((element) => element.type === "arrow"),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Make fork" }));
    const arrows = window.h.elements.filter(
      (element) => element.type === "arrow" && !element.isDeleted,
    );
    expect(arrows).toHaveLength(2);
    expect(arrows[0].customData?.flow.fork.id).toBe(
      arrows[1].customData?.flow.fork.id,
    );
    expect(arrows[0].x).toBe(arrows[1].x);
    expect(arrows[0].y).toBe(arrows[1].y);
  });
});
