import React, { useEffect, useMemo, useRef } from "react";

import { getCommonBounds, isTextElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
} from "@excalidraw/element/types";

import { AnimationController } from "../renderer/animation";
import {
  flowBoundsTransform,
  flowFocusTransform,
} from "../scene/flowAnimation";
import { FLOW_FLIGHT_MS, cameraAt, flightTarget } from "../scene/flowCamera";
import {
  FLOW_DRAW_ON_MS,
  choicesAt,
  drawOnProgress,
  isEndStep,
  reachedIndices,
} from "../scene/flowPresent";
import { flowMarksFor, getArrowPath } from "../scene/flowStyles";

import { editorJotaiStore, useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import { CloseIcon } from "./icons";
import {
  flowAnimationStateAtom,
  playFromCurrentStep,
  presentPickBranch,
  presentStepBack,
  presentStepForward,
  stopFlowAnimation,
} from "./FlowAnimationState";

import "./FlowAnimationOverlay.scss";

import type { FlowAnimationCamera } from "../scene/flowAnimation";
import type { FlowCameraState, FlowViewport } from "../scene/flowCamera";
import type { FlowGraph, FlowStep } from "../scene/flowOrder";
import type { FlowMarks, FlowStyle, PathPoint } from "../scene/flowStyles";
import type { PageRect } from "../types";

const ANIMATION_KEY = "flow-animation";
const MARKS_KEY = "flow-animation-marks";
const DRAW_ON_KEY = "flow-animation-draw-on";
const CAMERA_KEY = "flow-animation-camera";

const HOST_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  // above the canvases it draws on, and below the editor's own chrome
  zIndex: "var(--zIndex-flowAnimation)",
  // the overlay takes the pointer while it plays, so the canvas cannot be
  // edited mid-animation; the close button is the way out
  pointerEvents: "auto",
};

type FlowAnimationOverlayProps = {
  camera: FlowAnimationCamera;
  elementsMap: ElementsMap;
  /** the editor's size: the camera flight fits a step into it (D-170) */
  viewport?: FlowViewport;
  /** the page the flight has to stay on (D-170) */
  pageRect?: PageRect;
  /** moves the view; only the camera flight calls it, and only when it is on */
  onCamera?: (camera: FlowCameraState) => void;
};

/* --------------------------------------------------------------------- marks */

type MarkedArrow = { id: string; path: PathPoint[] };

/**
 * The arrows a style draws on (D-166): the beam and the token travel the arrows
 * that **leave the current step**; the marching dashes and the pipe are the
 * look of **every** arrow of the flow.
 */
const arrowsFor = (
  style: FlowStyle,
  graph: FlowGraph | null,
  step: FlowStep | undefined,
  elementsMap: ElementsMap,
): MarkedArrow[] => {
  if (!graph || !step) {
    return [];
  }

  let edgeArrows = graph.edgeArrows;

  if (style === "beam" || style === "token") {
    edgeArrows = edgeArrows.filter((edge) => edge.from === step.containerId);
  } else if (style !== "marching" && style !== "pipe") {
    return [];
  }

  const arrows: MarkedArrow[] = [];

  for (const edge of edgeArrows) {
    const element = elementsMap.get(edge.arrowId);

    if (element && !element.isDeleted) {
      arrows.push({
        id: edge.arrowId,
        path: getArrowPath(element as ExcalidrawLinearElement),
      });
    }
  }

  return arrows;
};

const pointsAttr = (points: readonly PathPoint[]) =>
  points.map((p) => `${p.x},${p.y}`).join(" ");

const dashAttr = (dash: readonly [number, number] | undefined) =>
  dash ? `${dash[0]} ${dash[1]}` : undefined;

/** puts a frame's marks on the arrow's own elements - no React state (D-63) */
const applyMarks = (group: Element, marks: FlowMarks) => {
  const strokes = group.querySelectorAll("polyline");
  const dots = group.querySelectorAll("circle");

  marks.strokes.forEach((stroke, i) => {
    const el = strokes[i];

    if (el) {
      el.setAttribute("points", pointsAttr(stroke.points));

      if (stroke.dashOffset !== undefined) {
        el.setAttribute("stroke-dashoffset", String(stroke.dashOffset));
      }
    }
  });

  marks.dots.forEach((dot, i) => {
    const el = dots[i];

    if (el) {
      el.setAttribute("cx", String(dot.x));
      el.setAttribute("cy", String(dot.y));
    }
  });
};

/** the text a step shows, for a button's name */
const stepLabel = (step: FlowStep, index: number, map: ElementsMap) => {
  for (const id of step.elementIds) {
    const element = map.get(id);

    if (element && isTextElement(element) && element.originalText) {
      return element.originalText;
    }
  }

  return `step ${index + 1}`;
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
 * Wave 7q adds what travels along the arrows (D-166, D-171), the present
 * controls, the dimming of steps not reached yet, the branches that can be
 * clicked (D-172), the end that is drawn on, and the camera that flies to the
 * step (D-170). None of it writes into the document: the overlay only reads the
 * elements, and the one thing it writes - the view, when the flight is on - is
 * put back when it ends.
 *
 * The clock is the `AnimationController`, never React state (D-63): a
 * `setState` per frame would re-render the whole app sixty times a second.
 * What moves along an arrow is moved by setting attributes on its elements; the
 * step that is focused is the only thing that changes in React, and it changes
 * once per step, not once per frame.
 */
export const FlowAnimationOverlay = ({
  camera,
  elementsMap,
  viewport,
  pageRect,
  onCamera,
}: FlowAnimationOverlayProps) => {
  const state = useAtomValue(flowAnimationStateAtom);
  const marksRef = useRef<SVGSVGElement>(null);

  // the latest of these, for the effects that must not restart when they change
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const onCameraRef = useRef(onCamera);
  onCameraRef.current = onCamera;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const pageRectRef = useRef(pageRect);
  pageRectRef.current = pageRect;

  const presenting = state.active && state.mode === "present";
  const step = state.active ? state.steps[state.index] : undefined;

  const arrows = useMemo(
    () => arrowsFor(state.style, state.graph, step, elementsMap),
    [state.style, state.graph, step, elementsMap],
  );
  const arrowsRef = useRef(arrows);
  arrowsRef.current = arrows;
  const stepRef = useRef(step);
  stepRef.current = step;
  const stepId = step?.containerId;
  const arrowKey = arrows.map((a) => a.id).join("|");

  const atEnd =
    presenting && !!state.graph && isEndStep(state.graph, state.index);

  /* --------------------------------------------------- the step clock (wave 6c) */

  useEffect(() => {
    // presenting has no clock: the teacher moves from step to step
    if (!state.active || state.mode !== "play" || !state.steps.length) {
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
  }, [state.active, state.mode, state.steps]);

  /* --------------------------------------------- what travels along the arrows */

  useEffect(() => {
    if (!state.active || arrowsRef.current.length === 0) {
      return;
    }

    AnimationController.start<{ elapsed: number }>(
      MARKS_KEY,
      ({ deltaTime, state: clock }) => {
        const now = (clock?.elapsed ?? 0) + deltaTime;
        const svg = marksRef.current;

        if (!svg) {
          return { elapsed: now };
        }

        const groups = svg.querySelectorAll("[data-flow-arrow]");

        for (const arrow of arrowsRef.current) {
          const group = [...groups].find(
            (g) => g.getAttribute("data-flow-arrow") === arrow.id,
          );

          if (group) {
            applyMarks(group, flowMarksFor(state.style, arrow.path, now));
          }
        }

        return { elapsed: now };
      },
    );

    return () => {
      AnimationController.cancel(MARKS_KEY);
    };
    // the arrows are read through the ref: a new map must not restart the clock
  }, [state.active, state.style, state.index, state.mode, arrowKey]);

  /* ------------------------------------------------------- the end drawn on */

  useEffect(() => {
    if (!atEnd) {
      return;
    }

    AnimationController.start<{ elapsed: number }>(
      DRAW_ON_KEY,
      ({ deltaTime, state: clock }) => {
        const now = (clock?.elapsed ?? 0) + deltaTime;
        const outline = marksRef.current?.querySelector(
          '[data-flow-mark="draw-on"]',
        );
        const progress = drawOnProgress(now);

        if (outline) {
          outline.setAttribute("stroke-dashoffset", String(progress.remaining));
          outline.setAttribute("fill-opacity", String(progress.fill * 0.25));
        }

        // finished: nothing more to move
        return now >= FLOW_DRAW_ON_MS + 600 ? null : { elapsed: now };
      },
    );

    return () => {
      AnimationController.cancel(DRAW_ON_KEY);
    };
  }, [atEnd, state.index]);

  /* ------------------------------------------------------ the camera flight */

  const startViewRef = useRef<FlowCameraState | null>(null);

  useEffect(() => {
    if (state.active) {
      return;
    }

    // the flow is over: the view goes back exactly where it was
    AnimationController.cancel(CAMERA_KEY);

    if (startViewRef.current) {
      onCameraRef.current?.(startViewRef.current);
      startViewRef.current = null;
    }
  }, [state.active]);

  useEffect(() => {
    const step = stepRef.current;
    const viewport = viewportRef.current;
    const pageRect = pageRectRef.current;

    if (!state.active || !state.camera || !step || !viewport || !pageRect) {
      return;
    }

    // an editor with no size has nothing to fit a step into
    if (!(viewport.width > 0) || !(viewport.height > 0)) {
      return;
    }

    const now = cameraRef.current;
    const from: FlowCameraState = {
      scrollX: now.scrollX,
      scrollY: now.scrollY,
      zoom: now.zoom.value,
    };

    if (!startViewRef.current) {
      startViewRef.current = from;
    }

    const to = flightTarget({ box: step.box, viewport, pageRect });

    // the view the editor was last given: it is only set again when it changes,
    // so a frame that moves nothing does not re-render the whole editor
    let applied: FlowCameraState = from;

    AnimationController.start<{ elapsed: number }>(
      CAMERA_KEY,
      ({ deltaTime, state: clock }) => {
        const next = (clock?.elapsed ?? 0) + deltaTime;
        const progress = next / FLOW_FLIGHT_MS;
        const view = cameraAt(from, to, progress, viewport);

        if (
          view.scrollX !== applied.scrollX ||
          view.scrollY !== applied.scrollY ||
          view.zoom !== applied.zoom
        ) {
          applied = view;
          onCameraRef.current?.(view);
        }

        return progress >= 1 ? null : { elapsed: next };
      },
    );

    return () => {
      AnimationController.cancel(CAMERA_KEY);
    };
    // the step is the trigger: the viewport, the page and the camera are read
    // through refs, so a new object for any of them does not restart the flight
  }, [state.active, state.camera, state.index, stepId]);

  /* ------------------------------------------------------------------ the keys */

  useEffect(() => {
    // the arrow keys are the overlay's only while it is presenting
    if (!presenting) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        presentStepForward();
      } else if (event.key === "ArrowLeft") {
        presentStepBack();
      } else if (event.key === "Escape") {
        stopFlowAnimation();
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [presenting]);

  /* ---------------------------------------------------------------- the picture */

  if (!step) {
    return null;
  }

  const stepElements = step.elementIds
    .map((id) => elementsMap.get(id))
    .filter((element): element is ExcalidrawElement => Boolean(element));

  const reached = presenting ? reachedIndices(state.path) : null;
  const choices =
    presenting && state.graph ? choicesAt(state.graph, state.index) : [];

  // the origin of the scene on the screen, and the zoom: the one transform
  // everything that is drawn in scene units sits under
  const sceneTransform = flowBoundsTransform(
    { x: 0, y: 0, width: 0, height: 0 },
    camera,
  );

  return (
    <div
      className="excalidraw__flow-animation"
      data-flow-style={state.style}
      data-flow-mode={state.mode}
      style={HOST_STYLE}
    >
      {/* steps not reached yet are dimmed while presenting (D-167) */}
      {reached &&
        state.steps.map(
          (other, index) =>
            !reached.has(index) && (
              <div
                key={`dim-${other.containerId}`}
                className="excalidraw__flow-animation-dim"
                data-flow-dim={other.containerId}
                style={{
                  width: other.box.width,
                  height: other.box.height,
                  transform: flowBoundsTransform(other.box, camera),
                  transformOrigin: "0 0",
                }}
              />
            ),
        )}

      {/* what travels along the arrows, and an end being drawn on */}
      <svg
        ref={marksRef}
        className="excalidraw__flow-marks"
        width="100%"
        height="100%"
      >
        <g style={{ transform: sceneTransform }} data-flow-scene="">
          {arrows.map((arrow) => {
            const marks = flowMarksFor(state.style, arrow.path, 0);

            return (
              <g key={`${state.index}-${arrow.id}`} data-flow-arrow={arrow.id}>
                {marks.strokes.map((stroke, i) => (
                  <polyline
                    key={i}
                    data-flow-mark={stroke.role}
                    className={`excalidraw__flow-mark excalidraw__flow-mark--${stroke.role}`}
                    points={pointsAttr(stroke.points)}
                    fill="none"
                    strokeWidth={stroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={dashAttr(stroke.dash)}
                    strokeDashoffset={stroke.dashOffset}
                  />
                ))}
                {marks.dots.map((dot, i) => (
                  <circle
                    key={i}
                    data-flow-mark={dot.role}
                    className={`excalidraw__flow-mark excalidraw__flow-mark--${dot.role}`}
                    cx={dot.x}
                    cy={dot.y}
                    r={dot.radius}
                  />
                ))}
              </g>
            );
          })}

          {atEnd && (
            <rect
              key={`end-${state.index}`}
              data-flow-mark="draw-on"
              className="excalidraw__flow-mark excalidraw__flow-mark--draw-on"
              x={step.box.x}
              y={step.box.y}
              width={step.box.width}
              height={step.box.height}
              rx={8}
              // the outline is measured as 1, so "how much is left" is a fraction
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1}
              fillOpacity={0}
            />
          )}
        </g>
      </svg>

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
              className={`excalidraw__flow-animation-focus excalidraw__flow-animation-focus--${state.style}`}
              style={{
                // only the focus style enlarges the step: the others leave it
                // its own size so that what travels along its arrows is seen
                transform: flowFocusTransform(
                  step.box,
                  elementBox,
                  state.style === "focus" ? undefined : 1,
                ),
                transformOrigin: "0 0",
              }}
            >
              <div className="excalidraw__flow-animation-pulse" />
            </div>
          </div>
        );
      })}

      {/* at a question, its branches can be clicked (D-172) */}
      {choices.map((targetIndex) => {
        const target = state.steps[targetIndex];

        return (
          <button
            key={`choice-${target.containerId}`}
            type="button"
            className="excalidraw__flow-animation-choice"
            data-flow-choice={target.containerId}
            aria-label={`Choose ${stepLabel(target, targetIndex, elementsMap)}`}
            style={{
              width: target.box.width,
              height: target.box.height,
              transform: flowBoundsTransform(target.box, camera),
              transformOrigin: "0 0",
            }}
            onClick={() => presentPickBranch(targetIndex)}
          />
        );
      })}

      {presenting && (
        <div className="excalidraw__flow-animation-controls">
          <button
            type="button"
            onClick={() => presentStepBack()}
            disabled={state.path.length <= 1}
            aria-label="Previous step"
          >
            ‹
          </button>
          <span className="excalidraw__flow-animation-counter">
            {state.path.length} / {state.steps.length}
          </span>
          <button
            type="button"
            onClick={() => presentStepForward()}
            disabled={state.index >= state.steps.length - 1}
            aria-label="Next step"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => playFromCurrentStep()}
            aria-label="Play from here"
          >
            Play from here
          </button>
        </div>
      )}

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
