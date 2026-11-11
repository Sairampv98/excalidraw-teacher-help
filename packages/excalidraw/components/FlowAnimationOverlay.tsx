import React, { useEffect, useMemo, useRef } from "react";

import { isTextElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
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
import { chartScaleOf } from "../scene/flowScale";
import {
  highlightBoxOf,
  stepHoldsMedia,
  drawnLabelIds,
  highlightShapeOf,
  arrowLabelsOf,
  nodeHighlightParts,
} from "../scene/flowHighlight";
import { arrowLooksFor } from "../scene/flowArrowLooks";

import {
  FLOW_ARROW_STYLES,
  flowMarksFor,
  getArrowPath,
} from "../scene/flowStyles";

import { editorJotaiStore, useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import {
  ArrowTubes,
  LabelText,
  NodeOutline,
  lookAttrs,
  lookVars,
} from "./FlowLookParts";
import { setFlowArrowLooks } from "./FlowArrowLooksState";
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

import type { ArrowLook } from "../scene/flowArrowLooks";
import type { FlowAnimationCamera } from "../scene/flowAnimation";
import type { FlowCameraState, FlowViewport } from "../scene/flowCamera";
import type { FlowGraph, FlowStep } from "../scene/flowOrder";
import type {
  FlowArrowStyle,
  FlowMarkOptions,
  FlowMarks,
  PathPoint,
} from "../scene/flowStyles";
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

export type MarkedArrow = {
  id: string;
  path: PathPoint[];
  styles?: FlowArrowStyle[];
  spacing?: number;
  look?: Record<string, unknown>;
};

export const marksForArrow = (
  arrow: MarkedArrow,
  fallback: FlowArrowStyle,
  elapsedMs: number,
  options: FlowMarkOptions,
): FlowMarks => {
  const result: FlowMarks = { strokes: [], dots: [] };
  for (const style of arrow.styles ?? [fallback]) {
    const marks = flowMarksFor(style, arrow.path, elapsedMs, {
      ...options,
      spacing: arrow.spacing ?? options.spacing,
    });
    result.strokes.push(...marks.strokes);
    result.dots.push(...marks.dots);
  }
  return result;
};

/**
 * The arrows a style draws on (D-166): the beam and the token travel the arrows
 * that **leave the current step**; the marching dashes and the pipe are the
 * look of **every** arrow of the flow.
 */
/**
 * The path of a timeline's hop from one box to the next (D-240): up from the
 * first box's edge to its dot, along the line, and to the next box's edge. A
 * stem is drawn from its dot to its box, so the first one is walked backwards.
 */
const timelineHop = (
  segment: PathPoint[],
  edge: { from: string; to: string },
  elementsMap: ElementsMap,
): PathPoint[] => {
  const stems = new Map<string, PathPoint[]>();

  for (const element of elementsMap.values()) {
    const flow = element.customData?.flow;

    if (
      !element.isDeleted &&
      flow?.role === "timeline-stem" &&
      typeof flow.box === "string" &&
      (flow.box === edge.from || flow.box === edge.to)
    ) {
      stems.set(flow.box, getArrowPath(element as ExcalidrawLinearElement));
    }
  }

  const out = stems.get(edge.from);
  const into = stems.get(edge.to);

  const whole = [
    ...(out ? [...out].reverse() : []),
    ...segment,
    ...(into ?? []),
  ];

  // the end of one piece is the start of the next: it is one point of the path
  return whole.filter(
    (p, i) =>
      i === 0 ||
      Math.abs(p.x - whole[i - 1].x) > 0.001 ||
      Math.abs(p.y - whole[i - 1].y) > 0.001,
  );
};

export const arrowsFor = (
  style: FlowArrowStyle,
  graph: FlowGraph | null,
  step: FlowStep | undefined,
  elementsMap: ElementsMap,
  all = false,
): MarkedArrow[] => {
  if (!graph || !step) {
    return [];
  }

  const arrows: MarkedArrow[] = [];
  const panel = graph.steps
    .map(
      (entry) =>
        elementsMap.get(entry.containerId)?.customData?.flowPanelAnimation,
    )
    .find(Boolean);

  for (const edge of graph.edgeArrows) {
    const element = elementsMap.get(edge.arrowId);

    if (element && !element.isDeleted) {
      const look = element.customData?.flow?.look;
      const ownStyle =
        !all && FLOW_ARROW_STYLES.some((entry) => entry.id === look?.arrowStyle)
          ? (look.arrowStyle as FlowArrowStyle)
          : style;
      const styles = [ownStyle, panel?.marchingStyle].filter(
        (entry): entry is FlowArrowStyle =>
          FLOW_ARROW_STYLES.some((candidate) => candidate.id === entry) &&
          entry !== "none" &&
          (!(entry === "beam" || entry === "token") ||
            edge.from === step.containerId),
      );
      if (!styles.length) {
        continue;
      }
      const path = getArrowPath(element as ExcalidrawLinearElement);

      arrows.push({
        id: edge.arrowId,
        styles: [...new Set(styles)],
        spacing: typeof panel?.spacing === "number" ? panel.spacing : undefined,
        look,
        path:
          (style === "beam" || style === "token") &&
          element.customData?.flow?.role === "timeline-segment"
            ? timelineHop(path, edge, elementsMap)
            : path,
      });
    }
  }

  return arrows;
};

export const glowingArrowsFor = (
  graph: FlowGraph | null,
  step: FlowStep | undefined,
  map: ElementsMap,
  glow: boolean,
) =>
  arrowsFor("marching", graph, step, map, true).filter(
    (arrow) => glow || arrow.look?.glowArrow,
  );

export const pointsAttr = (points: readonly PathPoint[]) =>
  points.map((p) => `${p.x},${p.y}`).join(" ");

export const dashAttr = (dash: readonly [number, number] | undefined) =>
  dash ? `${dash[0]} ${dash[1]}` : undefined;

/** puts a frame's marks on the arrow's own elements - no React state (D-63) */
export const applyMarks = (group: Element, marks: FlowMarks) => {
  const strokes = group.querySelectorAll("polyline");
  const dots = group.querySelectorAll("circle");

  marks.strokes.forEach((stroke, i) => {
    const el = strokes[i];

    if (el) {
      el.setAttribute("points", pointsAttr(stroke.points));
      el.setAttribute("stroke-width", String(stroke.width));

      if (stroke.dash) {
        el.setAttribute("stroke-dasharray", dashAttr(stroke.dash)!);
      }

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
      el.setAttribute("r", String(dot.radius));
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
  const elementsMapRef = useRef(elementsMap);
  elementsMapRef.current = elementsMap;

  /**
   * What the marks are drawn with, read **each frame**: the chart's size (D-175)
   * follows a resize at once, and the speed (D-179) follows the slider without
   * the animation being restarted.
   */
  const markOptions = (): FlowMarkOptions => {
    const current = editorJotaiStore.get(flowAnimationStateAtom);

    return {
      scale: current.graph
        ? chartScaleOf(current.graph, elementsMapRef.current)
        : 1,
      speed: current.speed,
    };
  };

  const presenting = state.active && state.mode === "present";
  // a mirror shows the picture and nothing to press (D-181)
  const interactive = !state.mirror;
  const step = state.active ? state.steps[state.index] : undefined;
  const scriptedNodeStyle =
    step &&
    elementsMap.get(step.containerId)?.customData?.flow?.look?.nodeStyle;
  const nodeStyle = ["none", "focus", "pulse"].includes(scriptedNodeStyle)
    ? scriptedNodeStyle
    : state.nodeStyle;

  const arrows = useMemo(
    () => arrowsFor(state.arrowStyle, state.graph, step, elementsMap),
    [state.arrowStyle, state.graph, step, elementsMap],
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
    // presenting has no clock: the teacher moves from step to step. A mirror
    // has none either: the window it mirrors moves the steps (D-181).
    if (
      !state.active ||
      state.mirror ||
      state.mode !== "play" ||
      !state.steps.length
    ) {
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
  }, [state.active, state.mirror, state.mode, state.steps]);

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
            applyMarks(
              group,
              marksForArrow(arrow, state.arrowStyle, now, markOptions()),
            );
          }
        }

        return { elapsed: now };
      },
    );

    return () => {
      AnimationController.cancel(MARKS_KEY);
    };
    // the arrows are read through the ref: a new map must not restart the clock
  }, [state.active, state.arrowStyle, state.index, state.mode, arrowKey]);

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

    if (
      !state.active ||
      state.mirror ||
      !state.camera ||
      !step ||
      !viewport ||
      !pageRect
    ) {
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
  }, [state.active, state.mirror, state.camera, state.index, stepId]);

  /* ------------------------------------------------------------------ the keys */

  useEffect(() => {
    // the arrow keys are the overlay's only while it is presenting - and only
    // in the window that is presenting, never in its mirror
    if (!presenting || !interactive) {
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
  }, [presenting, interactive]);

  /* ------------------------------------------------- the arrows, in the canvas */

  // what this flow does to its arrows - hide them, recolour them - is told to
  // the editor, whose canvas draws them so (D-204); nothing is painted over
  const arrowLooks = useMemo(
    () =>
      state.active && state.graph
        ? [
            ...arrowLooksFor(state.graph, state),
            // a label the overlay draws again is not drawn by the canvas (D-213)
            ...drawnLabelIds({
              graph: state.graph,
              step: state.steps[state.index],
              elementsMap,
              nodeStyle: state.nodeStyle,
              nodeTarget: state.nodeTarget,
              arrowsAnimated:
                state.arrowStyle !== "none" ||
                state.hideArrow ||
                state.glowArrow ||
                !!state.arrowColor,
            }).map((id): [string, ArrowLook] => [
              id,
              { hidden: true, color: null },
            ]),
          ]
        : [],
    // the look is the part of the state that decides it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.active,
      state.graph,
      state.steps,
      state.index,
      state.hideArrow,
      state.arrowColor,
      state.glowArrow,
      state.arrowStyle,
      state.nodeStyle,
      state.nodeTarget,
      elementsMap,
    ],
  );

  useEffect(() => {
    setFlowArrowLooks("animation", arrowLooks);

    return () => setFlowArrowLooks("animation", []);
  }, [arrowLooks]);

  /* ---------------------------------------------------------------- the picture */

  if (!step) {
    return null;
  }

  // what is highlighted: the outline, the box of the label, its letters (D-201)
  const parts = nodeHighlightParts(step, elementsMap, state.nodeTarget);
  const outlined = [parts.outline, parts.box].filter(
    (element): element is ExcalidrawElement => Boolean(element),
  );

  // a step that holds media (D-246) is only outlined: a wash of the colour over
  // the picture would change it
  const stepHasMedia = stepHoldsMedia(step, elementsMap);

  // the box and the outline of a step's container, for what is drawn on a whole
  // step - the dimming and the choices (D-192)
  const containerShape = (step: FlowStep) => {
    const container = elementsMap.get(step.containerId);

    return container
      ? { box: highlightBoxOf(container), shape: highlightShapeOf(container) }
      : {
          box: step.box,
          shape: { kind: "rect" as const, radius: 0, angle: 0 },
        };
  };

  const reached = presenting ? reachedIndices(state.path) : null;
  const choices =
    presenting && interactive && state.graph
      ? choicesAt(state.graph, state.index)
      : [];

  // the origin of the scene on the screen, and the zoom: the one transform
  // everything that is drawn in scene units sits under
  const sceneTransform = flowBoundsTransform(
    { x: 0, y: 0, width: 0, height: 0 },
    camera,
  );

  return (
    <div
      className="excalidraw__flow-animation"
      data-flow-node-style={nodeStyle}
      data-flow-arrow-style={state.arrowStyle}
      data-flow-mode={state.mode}
      data-flow-mirror={state.mirror ? "" : undefined}
      {...lookAttrs(state)}
      style={{
        ...(interactive
          ? HOST_STYLE
          : { ...HOST_STYLE, pointerEvents: "none" }),
        ...lookVars(state),
      }}
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
                  width: containerShape(other).box.width,
                  height: containerShape(other).box.height,
                  transform: flowBoundsTransform(
                    containerShape(other).box,
                    camera,
                  ),
                  transformOrigin: "0 0",
                }}
              >
                <NodeOutline
                  shape={containerShape(other).shape}
                  width={containerShape(other).box.width}
                  height={containerShape(other).box.height}
                />
              </div>
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
          {/* the arrows as neon tubes, under what travels (D-217) */}
          {glowingArrowsFor(
            state.graph,
            state.steps[state.index],
            elementsMap,
            state.glowArrow,
          ).map((arrow) => (
            <g
              key={`tube-${arrow.id}`}
              style={lookVars({
                ...state,
                ...arrow.look,
                arrowColor:
                  typeof arrow.look?.outline === "string"
                    ? arrow.look.outline
                    : state.arrowColor,
              })}
            >
              <ArrowTubes arrows={[arrow]} />
            </g>
          ))}
          {arrows.map((arrow) => {
            const marks = marksForArrow(
              arrow,
              state.arrowStyle,
              0,
              markOptions(),
            );

            return (
              <g
                key={`${state.index}-${arrow.id}`}
                data-flow-arrow={arrow.id}
                style={lookVars({ ...state, ...arrow.look })}
                {...lookAttrs({ ...state, ...arrow.look })}
              >
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

      {nodeStyle !== "none" &&
        [
          ...outlined.map((element) => ({ element, letters: false })),
          ...(parts.letters ? [{ element: parts.letters, letters: true }] : []),
        ].map(({ element, letters }) => {
          // the node's own box and outline, rotated about its centre (D-192)
          const elementBox = highlightBoxOf(element);

          return (
            <div
              // the index is part of the key so that the entrance animation
              // restarts on every step, the loop included
              key={`${state.index}-${element.id}-${
                letters ? "letters" : "outline"
              }`}
              className="excalidraw__flow-animation-shape"
              data-flow-media={stepHasMedia ? "" : undefined}
              {...lookAttrs({ ...state, ...element.customData?.flow?.look })}
              style={{
                width: elementBox.width,
                height: elementBox.height,
                transform: flowBoundsTransform(elementBox, camera),
                transformOrigin: "0 0",
                ...lookVars({ ...state, ...element.customData?.flow?.look }),
              }}
            >
              <div
                className={`excalidraw__flow-animation-focus excalidraw__flow-animation-focus--${nodeStyle}`}
                style={{
                  // only the focus style enlarges the step: the others leave it
                  // its own size so that what travels along its arrows is seen
                  transform: flowFocusTransform(
                    element.type === "text" ? elementBox : step.box,
                    elementBox,
                    nodeStyle === "focus" ? undefined : 1,
                  ),
                  transformOrigin: "0 0",
                }}
              >
                {letters ? (
                  // the label's letters, lit as letters (D-202)
                  <LabelText
                    element={element as ExcalidrawTextElement}
                    className="excalidraw__flow-label excalidraw__flow-label--letters"
                  />
                ) : (
                  <NodeOutline
                    shape={highlightShapeOf(element)}
                    part={element.type === "text" ? "box" : "shape"}
                    width={elementBox.width}
                    height={elementBox.height}
                    className="excalidraw__flow-animation-pulse"
                  />
                )}
              </div>
            </div>
          );
        })}

      {/* the labels of the arrows are drawn above what is animated (D-203) */}
      {(state.arrowStyle !== "none" ||
        state.hideArrow ||
        state.glowArrow ||
        !!state.arrowColor) &&
        arrowLabelsOf(state.graph, elementsMap).map((label) => (
          <div
            key={`arrow-label-${label.id}`}
            className="excalidraw__flow-animation-shape"
            data-flow-arrow-label={label.id}
            style={{
              width: label.width,
              height: label.height,
              transform: flowBoundsTransform(highlightBoxOf(label), camera),
              transformOrigin: "0 0",
            }}
          >
            <LabelText element={label} color={label.strokeColor} />
          </div>
        ))}

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
              width: containerShape(target).box.width,
              height: containerShape(target).box.height,
              transform: flowBoundsTransform(
                containerShape(target).box,
                camera,
              ),
              transformOrigin: "0 0",
            }}
            onClick={() => presentPickBranch(targetIndex)}
          >
            <NodeOutline
              shape={containerShape(target).shape}
              width={containerShape(target).box.width}
              height={containerShape(target).box.height}
            />
          </button>
        );
      })}

      {presenting && interactive && (
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

      {interactive && (
        <button
          type="button"
          className="excalidraw__flow-animation-close"
          onClick={() => stopFlowAnimation()}
          title={t("buttons.close")}
          aria-label={t("buttons.close")}
        >
          {CloseIcon}
        </button>
      )}
    </div>
  );
};
