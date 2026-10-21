import React, { useEffect } from "react";

import { getCommonBounds } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { AnimationController } from "../renderer/animation";
import {
  flowBoundsTransform,
  flowFocusTransform,
} from "../scene/flowAnimation";

import { editorJotaiStore, useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import { CloseIcon } from "./icons";
import {
  flowAnimationStateAtom,
  stopFlowAnimation,
} from "./FlowAnimationState";

import "./FlowAnimationOverlay.scss";

import type { FlowAnimationCamera } from "../scene/flowAnimation";

const ANIMATION_KEY = "flow-animation";

const HOST_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  // the overlay takes the pointer while it plays, so the canvas cannot be
  // edited mid-animation; the close button is the way out
  pointerEvents: "auto",
};

type FlowAnimationOverlayProps = {
  camera: FlowAnimationCamera;
  elementsMap: ElementsMap;
};

/**
 * The focus treatment the flow animation draws over the canvas.
 *
 * The canvas keeps drawing the flowchart — the overlay does **not** replace it
 * (D-44). Every shape of the focused step gets a box of its own, positioned
 * with the library's own `sceneCoordsToViewportCoords`, so it lands on exactly
 * the pixels the canvas would have used, and enlarged about the centre of the
 * step's own bounds.
 *
 * The clock is the `AnimationController`, never React state (D-63): a
 * `setState` per frame would re-render the whole app sixty times a second.
 * The step that is focused is the only thing that changes, and it changes once
 * per step, not once per frame.
 */
export const FlowAnimationOverlay = ({
  camera,
  elementsMap,
}: FlowAnimationOverlayProps) => {
  const state = useAtomValue(flowAnimationStateAtom);

  useEffect(() => {
    if (!state.active || !state.steps.length) {
      return;
    }

    AnimationController.start<{ index: number; elapsed: number }>(
      ANIMATION_KEY,
      ({ deltaTime, state: clock }) => {
        const current = editorJotaiStore.get(flowAnimationStateAtom);

        if (!current.active) {
          return null;
        }

        if (!clock) {
          return { index: current.index, elapsed: 0 };
        }

        const elapsed = clock.elapsed + deltaTime;

        if (elapsed < current.durationMs) {
          return { index: clock.index, elapsed };
        }

        const nextIndex = clock.index + 1;

        if (nextIndex >= current.steps.length) {
          if (!current.loop) {
            editorJotaiStore.set(flowAnimationStateAtom, {
              ...current,
              active: false,
              index: 0,
            });

            return null;
          }

          // the loop the owner asked for: back to the first step
          editorJotaiStore.set(flowAnimationStateAtom, {
            ...current,
            index: 0,
          });

          return { index: 0, elapsed: elapsed - current.durationMs };
        }

        editorJotaiStore.set(flowAnimationStateAtom, {
          ...current,
          index: nextIndex,
        });

        return { index: nextIndex, elapsed: elapsed - current.durationMs };
      },
    );

    return () => {
      AnimationController.cancel(ANIMATION_KEY);
    };
  }, [state.active, state.steps]);

  const step = state.active ? state.steps[state.index] : undefined;

  if (!step) {
    return null;
  }

  const stepElements = step.elementIds
    .map((id) => elementsMap.get(id))
    .filter((element): element is ExcalidrawElement => Boolean(element));

  return (
    <div className="excalidraw__flow-animation" style={HOST_STYLE}>
      {stepElements.map((element) => {
        const [minX, minY, maxX, maxY] = getCommonBounds(
          [element],
          elementsMap,
        );

        const elementBox = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };

        return (
          <div
            // the index is part of the key so that the entrance animation
            // restarts on every step, the loop included
            key={`${state.index}-${element.id}`}
            className="excalidraw__flow-animation-shape"
            style={{
              width: elementBox.width,
              height: elementBox.height,
              transform: flowBoundsTransform(elementBox, camera),
              transformOrigin: "0 0",
            }}
          >
            <div
              className="excalidraw__flow-animation-focus"
              style={{
                transform: flowFocusTransform(step.box, elementBox),
                transformOrigin: "0 0",
              }}
            >
              <div className="excalidraw__flow-animation-pulse" />
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="excalidraw__flow-animation-close"
        onClick={() => stopFlowAnimation()}
        title={t("buttons.close")}
        aria-label={t("buttons.close")}
      >
        {CloseIcon}
      </button>
    </div>
  );
};
