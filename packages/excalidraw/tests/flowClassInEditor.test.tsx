import React from "react";

import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";

import type { ElementsMap } from "@excalidraw/element/types";

import { FlowClassOverlay } from "../components/FlowClassOverlay";
import { AnimationController } from "../renderer/animation";
import { buildFlowPreset } from "../scene/flowPresets";
import { FLOW_CLASS_DEFAULTS, withFlowClass } from "../scene/flowClass";

import { EditorJotaiProvider, editorJotaiStore } from "../editor-jotai";
import { setFlowClassPreview } from "../components/FlowAnimationState";

describe("AC-583 the class loop in the editor", () => {
  it("Show in class alone does not play in the editor; Preview class loop does, takes no click, and its untick, a hidden tab and unmounting cancel the clock", async () => {
    const built = buildFlowPreset("process", "Teach\nPractise", { seed: 20 });
    if (!built.ok) {
      throw new Error(built.error);
    }
    const elements = built.elements.map((element) =>
      element.customData?.flow.role === "node"
        ? {
            ...element,
            customData: withFlowClass(element, {
              ...FLOW_CLASS_DEFAULTS,
              arrow: "token",
            }),
          }
        : element,
    );
    const map = new Map(
      elements.map((element) => [element.id, element]),
    ) as ElementsMap;
    const camera = { scrollX: 0, scrollY: 0, zoom: { value: 1 } } as never;
    const view = render(
      <FlowClassOverlay
        elements={elements}
        elementsMap={map}
        camera={camera}
        active={false}
        displayOnly={false}
      />,
      {
        wrapper: ({ children }) => (
          <EditorJotaiProvider store={editorJotaiStore}>
            {children}
          </EditorJotaiProvider>
        ),
      },
    );
    // marked for class, but the editor only shows it when asked to preview
    expect(view.container.querySelector("[data-flow-class]")).toBeNull();
    expect(AnimationController.running("flow-class")).toBe(false);
    act(() => setFlowClassPreview(true));
    expect(view.container.querySelector("[data-flow-class]")).not.toBeNull();
    expect(AnimationController.running("flow-class")).toBe(true);
    const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
    try {
      act(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(AnimationController.running("flow-class")).toBe(false);
      act(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: false,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(AnimationController.running("flow-class")).toBe(true);
    } finally {
      if (descriptor) {
        Object.defineProperty(document, "hidden", descriptor);
      } else {
        Reflect.deleteProperty(document, "hidden");
      }
    }
    expect(
      (view.container.querySelector("[data-flow-class]") as HTMLElement).style
        .pointerEvents,
    ).toBe("none");
    const unmarked = elements.map((element) => ({
      ...element,
      version: element.version + 1,
      customData: withFlowClass(element, null),
    }));
    view.rerender(
      <FlowClassOverlay
        elements={unmarked}
        elementsMap={
          new Map(
            unmarked.map((element) => [element.id, element]),
          ) as ElementsMap
        }
        camera={camera}
        active={false}
        displayOnly={false}
      />,
    );
    expect(AnimationController.running("flow-class")).toBe(false);
    view.rerender(
      <FlowClassOverlay
        elements={elements}
        elementsMap={map}
        camera={camera}
        active={false}
        displayOnly={false}
      />,
    );
    expect(AnimationController.running("flow-class")).toBe(true);
    act(() => setFlowClassPreview(false));
    expect(AnimationController.running("flow-class")).toBe(false);
    act(() => setFlowClassPreview(true));
    expect(AnimationController.running("flow-class")).toBe(true);
    view.unmount();
    expect(AnimationController.running("flow-class")).toBe(false);
  });
});
