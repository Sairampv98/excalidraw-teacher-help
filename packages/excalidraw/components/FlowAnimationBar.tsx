import React, { useMemo } from "react";

import { getCommonBounds } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import {
  actionFlowLayout,
  actionFlowResetLayout,
  flowResetLayoutPredicate,
} from "../actions/actionFlowLayout";
import { flowBarPosition, unionOfBoxes } from "../scene/flowBar";
import { flowOfSelection } from "../scene/flowSelection";
import {
  FLOW_ARROW_STYLES,
  FLOW_NODE_STYLES,
  FLOW_SPEED_MAX,
  FLOW_SPEED_MIN,
} from "../scene/flowStyles";

import { useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import {
  DEFAULT_FLOW_STEP_DURATION_MS,
  flowAnimationStateAtom,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "./FlowAnimationState";

import "./FlowAnimationBar.scss";

import type { FlowAnimationCamera } from "../scene/flowAnimation";
import type { FlowViewport } from "../scene/flowCamera";
import type { FlowGraph } from "../scene/flowOrder";
import type { AppClassProperties, AppState } from "../types";

type FlowAnimationBarProps = {
  app: AppClassProperties;
  /** every element on the canvas: the flow is found among them (D-180) */
  elements: readonly ExcalidrawElement[];
  elementsMap: ElementsMap;
  selectedElementIds: AppState["selectedElementIds"];
  camera: FlowAnimationCamera;
  viewport: FlowViewport;
  /** a view-only editor (the presenter) has no controls to show */
  hidden?: boolean;
};

/** the box a flow fills now, read from its elements and not from the graph */
const flowBox = (graph: FlowGraph, elementsMap: ElementsMap) =>
  unionOfBoxes(
    graph.steps.flatMap((step) => {
      const elements = step.elementIds
        .map((id) => elementsMap.get(id))
        .filter((element): element is ExcalidrawElement => Boolean(element));

      if (!elements.length) {
        return [];
      }

      const [minX, minY, maxX, maxY] = getCommonBounds(elements, elementsMap);

      return [{ x: minX, y: minY, width: maxX - minX, height: maxY - minY }];
    }),
  );

/**
 * The floating bar that drives the flow animation (D-177).
 *
 * It replaces the properties-panel section: the same controls, in a bar that
 * sits just below the chart and follows it. It is shown while a shape or an
 * arrow of a flow is selected, and while a flow plays (D-180), and the whole
 * connected flow is what it controls.
 *
 * Nothing it does touches `appState`: the settings and the playing state live
 * in a jotai atom, so nothing about the animation reaches the saved document
 * (D-63).
 */
export const FlowAnimationBar = ({
  app,
  elements,
  elementsMap,
  selectedElementIds,
  camera,
  viewport,
  hidden,
}: FlowAnimationBarProps) => {
  const state = useAtomValue(flowAnimationStateAtom);

  const selectedFlow = useMemo(
    () => flowOfSelection(selectedElementIds, elements, elementsMap),
    [selectedElementIds, elements, elementsMap],
  );

  // a flow that is playing stays the bar's flow whatever is selected (D-180)
  const graph = state.active && state.graph ? state.graph : selectedFlow;
  const box = graph ? flowBox(graph, elementsMap) : null;

  if (hidden || !graph || !box) {
    return null;
  }

  const { left, top } = flowBarPosition({ box, camera, viewport });
  const playing = state.active && state.mode === "play";
  const presenting = state.active && state.mode === "present";

  return (
    <div
      className="excalidraw__flow-bar"
      role="toolbar"
      aria-label={t("labels.flowAnimation")}
      data-testid="flow-bar"
      style={{ left, top }}
      // the bar is not part of the canvas: a click on it is not a click on the
      // scene, so nothing under it is deselected
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="excalidraw__flow-bar-row">
        <button
          type="button"
          onClick={() => {
            if (state.active) {
              stopFlowAnimation();
              return;
            }

            startFlowAnimation(graph.steps, {
              durationMs: state.durationMs,
              loop: state.loop,
              mode: "play",
              graph,
            });
          }}
        >
          {playing
            ? t("labels.flowAnimationStop")
            : t("labels.flowAnimationPlay")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (presenting) {
              stopFlowAnimation();
              return;
            }

            startFlowAnimation(graph.steps, { mode: "present", graph });
          }}
        >
          {presenting ? "Stop presenting" : "Present steps"}
        </button>
        <button
          type="button"
          onClick={() =>
            app.actionManager.executeAction(actionFlowLayout, "ui")
          }
        >
          {t("labels.flowAnimationLayout")}
        </button>
        {flowResetLayoutPredicate(app.state, app) && (
          <button
            type="button"
            onClick={() =>
              app.actionManager.executeAction(actionFlowResetLayout, "ui")
            }
          >
            {t("labels.flowAnimationResetLayout")}
          </button>
        )}
      </div>

      <div className="excalidraw__flow-bar-row">
        <label className="excalidraw__flow-bar-field">
          <span>Nodes</span>
          <select
            aria-label="Node animation"
            value={state.nodeStyle}
            onChange={(event) =>
              updateFlowAnimationSettings({
                nodeStyle: event.target.value as typeof state.nodeStyle,
              })
            }
          >
            {FLOW_NODE_STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <label className="excalidraw__flow-bar-field">
          <span>Arrows</span>
          <select
            aria-label="Arrow animation"
            value={state.arrowStyle}
            onChange={(event) =>
              updateFlowAnimationSettings({
                arrowStyle: event.target.value as typeof state.arrowStyle,
              })
            }
          >
            {FLOW_ARROW_STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <label className="excalidraw__flow-bar-field">
          <span>Speed</span>
          <input
            type="range"
            aria-label="Animation speed"
            min={FLOW_SPEED_MIN}
            max={FLOW_SPEED_MAX}
            step={10}
            value={state.speed}
            onChange={(event) =>
              updateFlowAnimationSettings({ speed: Number(event.target.value) })
            }
          />
          <span
            className="excalidraw__flow-bar-value"
            aria-label="Animation speed value"
          >
            {state.speed}
          </span>
        </label>
      </div>

      <div className="excalidraw__flow-bar-row">
        <label className="excalidraw__flow-bar-field">
          <span>{t("labels.flowAnimationDuration")}</span>
          <input
            type="number"
            min={100}
            step={100}
            value={state.durationMs}
            onChange={(event) =>
              updateFlowAnimationSettings({
                durationMs:
                  Number(event.target.value) || DEFAULT_FLOW_STEP_DURATION_MS,
              })
            }
          />
        </label>
        <label className="excalidraw__flow-bar-field">
          <input
            type="checkbox"
            checked={state.camera}
            onChange={(event) =>
              updateFlowAnimationSettings({ camera: event.target.checked })
            }
          />
          <span>Fly the view to each step</span>
        </label>
        <label className="excalidraw__flow-bar-field">
          <input
            type="checkbox"
            checked={state.loop}
            onChange={(event) =>
              updateFlowAnimationSettings({ loop: event.target.checked })
            }
          />
          <span>{t("labels.flowAnimationLoop")}</span>
        </label>
      </div>
    </div>
  );
};
