import React, { useEffect, useMemo, useRef, useState } from "react";

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { getSceneVersion } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { AnimationController } from "../renderer/animation";
import {
  flowBoundsTransform,
  flowFocusTransform,
} from "../scene/flowAnimation";
import { flowBoxOf } from "../scene/flowBar";
import { arrowLooksFor } from "../scene/flowArrowLooks";

import { classStepAt, markedFlowsOnPage } from "../scene/flowClass";
import {
  drawnLabelIds,
  highlightBoxOf,
  highlightShapeOf,
  arrowLabelsOf,
  nodeHighlightParts,
} from "../scene/flowHighlight";
import { chartScaleOf } from "../scene/flowScale";
import { flowMarksFor } from "../scene/flowStyles";

import { useAtomValue } from "../editor-jotai";

import {
  applyMarks,
  arrowsFor,
  dashAttr,
  pointsAttr,
} from "./FlowAnimationOverlay";
import { setFlowArrowLooks } from "./FlowArrowLooksState";
import {
  flowAnimationStateAtom,
  flowClassPreviewAtom,
  startFlowAnimation,
} from "./FlowAnimationState";
import {
  ArrowTubes,
  LabelText,
  NodeOutline,
  lookAttrs,
  lookVars,
} from "./FlowLookParts";

import "./FlowAnimationOverlay.scss";

import type { ArrowLook } from "../scene/flowArrowLooks";

import type { FlowAnimationCamera } from "../scene/flowAnimation";
import type { MarkedFlow } from "../scene/flowClass";

const CLASS_KEY = "flow-class";

const HOST_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  zIndex: "var(--zIndex-flowAnimation)",
  // the class loop is the picture: it never takes the pointer. Only the Steps
  // buttons do, and they say so themselves.
  pointerEvents: "none",
};

type FlowClassOverlayProps = {
  elements: readonly ExcalidrawElement[];
  elementsMap: ElementsMap;
  camera: FlowAnimationCamera;
  /** the page being shown; `undefined` when the document has no pages */
  pageId?: string;
  /** the class view: view mode, or a display-only window (D-182) */
  active: boolean;
  /** a window that is shown and not operated has no Steps button (D-187) */
  displayOnly: boolean;
};

/**
 * The class loop (D-184): every flow marked for class, on the page being shown,
 * plays by itself - with nothing selected and no bar.
 *
 * Each flow has its **own clock**, so several charts animate at once; the clock
 * is the `AnimationController` and never React state (D-63) - what moves along
 * an arrow is moved by setting attributes, and React only hears of a step
 * changing. When there is no marked flow the component draws nothing and runs
 * nothing.
 *
 * A chart that the animation overlay is drawing - being stepped here, or
 * mirrored from the editor (D-186) - is left to that overlay: a chart is never
 * drawn twice.
 */
export const FlowClassOverlay = ({
  elements,
  elementsMap,
  camera,
  pageId,
  active,
  displayOnly,
}: FlowClassOverlayProps) => {
  const animation = useAtomValue(flowAnimationStateAtom);
  // the editor can preview what the class gets, in the edit view (D-193)
  const preview = useAtomValue(flowClassPreviewAtom);
  const playing = active || preview;
  // the Steps buttons are the class view's, never the preview's (D-185, D-193)
  const showSteps = active && !displayOnly;
  const marksRef = useRef<SVGSVGElement>(null);

  // an element is changed in place (a mark put on or taken off, a setting
  // brought up to date), so the array alone does not say that it changed
  const sceneVersion = getSceneVersion(elements);

  const marked = useMemo(
    () => (playing ? markedFlowsOnPage(elements, elementsMap, pageId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playing, elements, elementsMap, pageId, sceneVersion],
  );

  // the chart the animation overlay has is not ours to draw
  const flows = useMemo(() => {
    if (!animation.active) {
      return marked;
    }

    const busy = new Set(animation.steps.map((step) => step.containerId));

    return marked.filter(
      (flow) => !flow.graph.steps.some((step) => busy.has(step.containerId)),
    );
  }, [marked, animation.active, animation.steps]);

  // the step each flow is on: it changes once in `stepMs`, not once a frame
  const [indices, setIndices] = useState<Record<string, number>>({});

  const flowsRef = useRef(flows);
  flowsRef.current = flows;
  const mapRef = useRef(elementsMap);
  mapRef.current = elementsMap;
  const indicesRef = useRef(indices);
  indicesRef.current = indices;

  const flowKeys = flows.map((flow) => flow.key).join("\n");

  // when each flow's own clock started, on the page's clock. It outlives the
  // effect: a chart that is stepped must not send the other charts back to
  // their first step.
  const startedRef = useRef(new Map<string, number>());

  useEffect(() => {
    const started = startedRef.current;

    if (!flowKeys) {
      started.clear();
      return;
    }

    AnimationController.start<{ elapsed: number }>(CLASS_KEY, () => {
      const now = performance.now();
      const current = flowsRef.current;
      const next: Record<string, number> = {};
      let changed = false;

      // a flow that is gone (or being stepped) starts again from its first
      // step when it comes back
      const keys = new Set(current.map((flow) => flow.key));

      for (const key of [...started.keys()]) {
        if (!keys.has(key)) {
          started.delete(key);
        }
      }

      const groups = marksRef.current?.querySelectorAll(
        "[data-flow-class-arrow]",
      );

      for (const flow of current) {
        if (!started.has(flow.key)) {
          started.set(flow.key, now);
        }

        const sinceStart = now - started.get(flow.key)!;
        const { index } = classStepAt({
          elapsedMs: sinceStart,
          stepCount: flow.graph.steps.length,
          stepMs: flow.settings.stepMs,
          loop: flow.settings.loop,
        });

        next[flow.key] = index;

        if (indicesRef.current[flow.key] !== index) {
          changed = true;
        }

        // the marks of the step it is on, moved without React
        const step = flow.graph.steps[index];
        const options = {
          scale: chartScaleOf(flow.graph, mapRef.current),
          speed: flow.settings.speed,
        };

        for (const arrow of arrowsFor(
          flow.settings.arrow,
          flow.graph,
          step,
          mapRef.current,
        )) {
          const group = [...(groups ?? [])].find(
            (g) =>
              g.getAttribute("data-flow-class-arrow") ===
              `${flow.key}:${arrow.id}`,
          );

          if (group) {
            applyMarks(
              group,
              flowMarksFor(
                flow.settings.arrow,
                arrow.path,
                sinceStart % flow.settings.stepMs,
                options,
              ),
            );
          }
        }
      }

      if (changed) {
        setIndices(next);
      }

      return { elapsed: now };
    });

    return () => {
      AnimationController.cancel(CLASS_KEY);
    };
    // the flows are read through a ref: a moved chart must not restart the clock
  }, [flowKeys]);

  // what the flows of the class loop do to their arrows is told to the
  // editor's canvas (D-204)
  const arrowLooks = useMemo(
    () =>
      flows.flatMap((flow) => [
        ...arrowLooksFor(flow.graph, flow.settings),
        // a label the overlay draws again is not drawn by the canvas (D-213)
        ...drawnLabelIds({
          graph: flow.graph,
          step: flow.graph.steps[indices[flow.key] ?? 0],
          elementsMap,
          nodeStyle: flow.settings.node,
          nodeTarget: flow.settings.nodeTarget,
          arrowsAnimated:
            flow.settings.arrow !== "none" ||
            flow.settings.hideArrow ||
            flow.settings.glowArrow ||
            !!flow.settings.arrowColor,
        }).map((id): [string, ArrowLook] => [
          id,
          { hidden: true, color: null },
        ]),
      ]),
    [flows, indices, elementsMap],
  );

  useEffect(() => {
    setFlowArrowLooks("class", arrowLooks);

    return () => setFlowArrowLooks("class", []);
  }, [arrowLooks]);

  if (!flows.length) {
    return null;
  }

  const sceneTransform = flowBoundsTransform(
    { x: 0, y: 0, width: 0, height: 0 },
    camera,
  );

  return (
    <div
      className="excalidraw__flow-class"
      data-flow-class=""
      style={HOST_STYLE}
    >
      <svg
        ref={marksRef}
        className="excalidraw__flow-marks"
        width="100%"
        height="100%"
      >
        <g style={{ transform: sceneTransform }} data-flow-scene="">
          {flows.map((flow) => (
            <g
              key={flow.key}
              data-flow-class-flow={flow.key}
              data-flow-class-index={indices[flow.key] ?? 0}
              // the flow's own colours (D-195)
              style={lookVars(flow.settings)}
              {...lookAttrs(flow.settings)}
            >
              {flow.settings.glowArrow && (
                <ArrowTubes
                  arrows={arrowsFor(
                    "marching",
                    flow.graph,
                    flow.graph.steps[indices[flow.key] ?? 0],
                    elementsMap,
                  )}
                />
              )}
              <ClassMarks
                flow={flow}
                index={indices[flow.key] ?? 0}
                elementsMap={elementsMap}
              />
            </g>
          ))}
        </g>
      </svg>

      {flows.map((flow) => (
        <ClassNodes
          key={flow.key}
          flow={flow}
          index={indices[flow.key] ?? 0}
          elementsMap={elementsMap}
          camera={camera}
        />
      ))}

      {showSteps &&
        flows.map((flow) => (
          <StepsButton
            key={flow.key}
            flow={flow}
            elementsMap={elementsMap}
            camera={camera}
          />
        ))}
    </div>
  );
};

/* ------------------------------------------------------------------- parts */

/** the arrows' marks for the step a flow is on */
const ClassMarks = ({
  flow,
  index,
  elementsMap,
}: {
  flow: MarkedFlow;
  index: number;
  elementsMap: ElementsMap;
}) => {
  const arrows = arrowsFor(
    flow.settings.arrow,
    flow.graph,
    flow.graph.steps[index],
    elementsMap,
  );
  const options = {
    scale: chartScaleOf(flow.graph, elementsMap),
    speed: flow.settings.speed,
  };

  return (
    <>
      {arrows.map((arrow) => {
        const marks = flowMarksFor(flow.settings.arrow, arrow.path, 0, options);

        return (
          <g
            key={`${index}-${arrow.id}`}
            data-flow-class-arrow={`${flow.key}:${arrow.id}`}
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
    </>
  );
};

/** the treatment of the shapes of the step a flow is on */
const ClassNodes = ({
  flow,
  index,
  elementsMap,
  camera,
}: {
  flow: MarkedFlow;
  index: number;
  elementsMap: ElementsMap;
  camera: FlowAnimationCamera;
}) => {
  const step = flow.graph.steps[index];

  if (!step) {
    return null;
  }

  // what is highlighted: the outline, the box of the label, its letters (D-201)
  const parts =
    flow.settings.node === "none"
      ? { outline: null, box: null, letters: null }
      : nodeHighlightParts(step, elementsMap, flow.settings.nodeTarget);

  return (
    <>
      {[
        ...[parts.outline, parts.box]
          .filter((element): element is ExcalidrawElement => Boolean(element))
          .map((element) => ({ element, letters: false })),
        ...(parts.letters ? [{ element: parts.letters, letters: true }] : []),
      ].map(({ element, letters }) => {
        // the node's own box and outline, rotated about its centre (D-192)
        const box = highlightBoxOf(element);

        return (
          <div
            // the index is in the key so the entrance restarts on every step
            key={`${index}-${element.id}-${letters ? "letters" : "outline"}`}
            className="excalidraw__flow-animation-shape"
            data-flow-class-node={flow.settings.node}
            {...lookAttrs(flow.settings)}
            style={{
              width: box.width,
              height: box.height,
              transform: flowBoundsTransform(box, camera),
              transformOrigin: "0 0",
              ...lookVars(flow.settings),
            }}
          >
            <div
              className={`excalidraw__flow-animation-focus excalidraw__flow-animation-focus--${flow.settings.node}`}
              style={{
                transform: flowFocusTransform(
                  element.type === "text" ? box : step.box,
                  box,
                  flow.settings.node === "focus" ? undefined : 1,
                ),
                transformOrigin: "0 0",
              }}
            >
              {letters ? (
                <LabelText
                  element={element as ExcalidrawTextElement}
                  className="excalidraw__flow-label excalidraw__flow-label--letters"
                />
              ) : (
                <NodeOutline
                  shape={highlightShapeOf(element)}
                  part={element.type === "text" ? "box" : "shape"}
                  width={box.width}
                  height={box.height}
                  className="excalidraw__flow-animation-pulse"
                />
              )}
            </div>
          </div>
        );
      })}

      {/* the labels of the arrows are drawn above what is animated (D-203) */}
      {(flow.settings.arrow !== "none" ||
        flow.settings.hideArrow ||
        flow.settings.glowArrow ||
        !!flow.settings.arrowColor) &&
        arrowLabelsOf(flow.graph, elementsMap).map((label) => (
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
    </>
  );
};

/** the button on a chart's corner that turns it into keyboard steps (D-185) */
const StepsButton = ({
  flow,
  elementsMap,
  camera,
}: {
  flow: MarkedFlow;
  elementsMap: ElementsMap;
  camera: FlowAnimationCamera;
}) => {
  const box = flowBoxOf(flow.graph, elementsMap);

  if (!box) {
    return null;
  }

  // the chart's top-right corner, where the canvas draws it
  const { x, y } = sceneCoordsToViewportCoords(
    { sceneX: box.x + box.width, sceneY: box.y },
    camera,
  );

  return (
    <button
      type="button"
      className="excalidraw__flow-class-steps"
      aria-label="Steps"
      data-flow-class-steps={flow.key}
      style={{
        left: x - camera.offsetLeft,
        top: y - camera.offsetTop,
      }}
      onClick={() =>
        // this chart leaves the loop and is stepped by the animation overlay;
        // the others keep looping
        startFlowAnimation(flow.graph.steps, {
          mode: "present",
          graph: flow.graph,
          nodeStyle: flow.settings.node,
          arrowStyle: flow.settings.arrow,
          speed: flow.settings.speed,
          durationMs: flow.settings.stepMs,
          nodeColor: flow.settings.nodeColor,
          textColor: flow.settings.textColor,
          glowShape: flow.settings.glowShape,
          glowText: flow.settings.glowText,
          glowMark: flow.settings.glowMark,
          glowArrow: flow.settings.glowArrow,
          markColor: flow.settings.markColor,
          arrowColor: flow.settings.arrowColor,
          hideArrow: flow.settings.hideArrow,
          nodeTarget: flow.settings.nodeTarget,
        })
      }
    >
      Steps
    </button>
  );
};
