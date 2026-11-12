import React, { useEffect, useRef, useState } from "react";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { editorJotaiStore } from "../../editor-jotai";
import { readFlowLook } from "../../scene/flowLook";
import { flowClassOf, withFlowClass } from "../../scene/flowClass";
import {
  FLOW_ARROW_STYLES,
  FLOW_NODE_STYLES,
  clampFlowSpeed,
} from "../../scene/flowStyles";
import {
  flowAnimationStateAtom,
  updateFlowAnimationSettings,
} from "../FlowAnimationState";
import { FlowColorPad } from "../FlowColorPad";

import { FlowExpandedWindow } from "./FlowExpandedWindow";
import { FlowChartPreview } from "./FlowChartPreview";

import type { FlowAnimationSettings } from "../FlowAnimationState";
import type { FlowGraph } from "../../scene/flowOrder";
import type { AppClassProperties } from "../../types";

export const panelAnimationOf = (
  value: unknown,
  fallback: FlowAnimationSettings,
): FlowAnimationSettings & {
  spacing?: number;
  dashGap?: number;
  marchingStyle?: string;
} => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const data = value as Partial<FlowAnimationSettings> & {
    spacing?: number;
    dashGap?: number;
    marchingStyle?: string;
  };
  return {
    dashGap:
      typeof data.dashGap === "number" &&
      Number.isFinite(data.dashGap) &&
      data.dashGap >= 2
        ? data.dashGap
        : 10,
    spacing:
      typeof data.spacing === "number" &&
      Number.isFinite(data.spacing) &&
      data.spacing >= 16
        ? data.spacing
        : 150,
    marchingStyle: ["marching", "marching-beam", "marching-token"].includes(
      data.marchingStyle ?? "",
    )
      ? data.marchingStyle
      : "none",
    ...readFlowLook(data),
    nodeStyle: FLOW_NODE_STYLES.some((style) => style.id === data.nodeStyle)
      ? data.nodeStyle!
      : fallback.nodeStyle,
    arrowStyle: FLOW_ARROW_STYLES.some((style) => style.id === data.arrowStyle)
      ? data.arrowStyle!
      : fallback.arrowStyle,
    durationMs:
      typeof data.durationMs === "number" && Number.isFinite(data.durationMs)
        ? Math.min(60000, Math.max(100, data.durationMs))
        : fallback.durationMs,
    speed:
      typeof data.speed === "number" && Number.isFinite(data.speed)
        ? clampFlowSpeed(data.speed)
        : fallback.speed,
    loop: typeof data.loop === "boolean" ? data.loop : fallback.loop,
    camera: typeof data.camera === "boolean" ? data.camera : fallback.camera,
  };
};

/** Saved expanded choices follow document undo/redo; legacy charts retain their preferences. */
export const useFlowPanelAnimation = (
  anchor: ExcalidrawElement | undefined,
) => {
  const previous = useRef<
    { id: string; json: string; fallback: FlowAnimationSettings } | undefined
  >(undefined);
  const data = anchor?.customData?.flowPanelAnimation;
  const json = JSON.stringify(data ?? null);
  useEffect(() => {
    if (!anchor) {
      return;
    }
    const current = editorJotaiStore.get(flowAnimationStateAtom);
    if (previous.current?.id !== anchor.id) {
      previous.current = {
        id: anchor.id,
        json,
        fallback: panelAnimationOf(current, current),
      };
      if (data) {
        updateFlowAnimationSettings(panelAnimationOf(data, current));
      }
    } else if (previous.current.json !== json) {
      previous.current.json = json;
      updateFlowAnimationSettings(
        panelAnimationOf(data, previous.current.fallback),
      );
    }
  }, [anchor, data, json]);
};

/**
 * Saves the panel's animation choices on the chart as one undo step, and on a
 * chart marked for class as its class look too. Returns what to tell the
 * teacher when it could not be done, and `null` when it was.
 */
export const applyPanelAnimation = (
  app: AppClassProperties,
  graph: FlowGraph,
  initial: unknown,
  draft: ReturnType<typeof panelAnimationOf>,
): string | null => {
  const anchorId = graph.steps[0]?.containerId;
  const current = app.scene.getElementsIncludingDeleted();
  const anchor = current.find(
    (element) => element.id === anchorId && !element.isDeleted,
  );
  if (!anchor) {
    return "This chart changed while the window was open. Close it, select a remaining chart or add a new one, and open options again.";
  }
  if (JSON.stringify(draft) === JSON.stringify(initial)) {
    return null;
  }
  const marked = !!flowClassOf(
    graph,
    app.scene.getNonDeletedElementsMap() as ElementsMap,
  );
  const nodes = new Set(graph.steps.map((step) => step.containerId));
  const settings = {
    ...readFlowLook(draft),
    node: draft.nodeStyle,
    arrow: draft.arrowStyle,
    speed: draft.speed,
    stepMs: draft.durationMs,
    loop: draft.loop,
  };
  const updated = current.map((element) => {
    if (element.isDeleted) {
      return element;
    }
    let customData = element.customData;
    if (marked && nodes.has(element.id)) {
      customData = withFlowClass(element, settings);
    }
    if (element.id === anchorId) {
      customData = { ...customData, flowPanelAnimation: draft };
    }
    return customData !== element.customData
      ? newElementWith(element, { customData })
      : element;
  });
  app.api.updateScene({
    elements: updated,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  updateFlowAnimationSettings(draft);
  return null;
};

export const FlowAnimationOptions = ({
  app,
  graph,
  elements,
  onClose,
}: {
  app: AppClassProperties;
  graph: FlowGraph;
  elements: readonly ExcalidrawElement[];
  onClose: () => void;
}) => {
  const [initial] = useState(() => {
    const current = editorJotaiStore.get(flowAnimationStateAtom);
    return panelAnimationOf(current, current);
  });
  const [snapshot] = useState(() => structuredClone(elements));
  const [message, setMessage] = useState("");
  return (
    <FlowExpandedWindow
      title="Animation options"
      initial={initial}
      onClose={onClose}
      onApply={(draft) => {
        const problem = applyPanelAnimation(app, graph, initial, draft);
        if (problem) {
          setMessage(problem);
          return;
        }
        onClose();
      }}
      preview={(draft) => (
        <>
          {message && <p role="alert">{message}</p>}
          <FlowChartPreview
            elements={snapshot.map((element) =>
              element.id === graph.steps[0]?.containerId
                ? {
                    ...element,
                    customData: {
                      ...element.customData,
                      flowPanelAnimation: draft,
                    },
                  }
                : element,
            )}
            graph={graph}
            appState={app.state}
            files={app.files}
            animation={draft}
            loop
          />
        </>
      )}
      tabs={[
        {
          id: "nodes",
          label: "Nodes",
          render: (draft, update) => (
            <>
              <label>
                Node animation
                <select
                  aria-label="Preview node animation"
                  value={draft.nodeStyle}
                  onChange={(event) =>
                    update({
                      ...draft,
                      nodeStyle: event.target.value as typeof draft.nodeStyle,
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
              <FlowColorPad
                label="Preview shape colour"
                value={draft.nodeColor}
                onChange={(nodeColor) => update({ ...draft, nodeColor })}
              />
              <label>
                Step (ms)
                <input
                  aria-label="Preview step duration"
                  type="number"
                  min={100}
                  max={60000}
                  value={draft.durationMs}
                  onChange={(event) =>
                    update({
                      ...draft,
                      durationMs: Math.max(
                        100,
                        Math.min(60000, Number(event.target.value) || 100),
                      ),
                    })
                  }
                />
              </label>
              <p>
                {graph.steps.length} nodes in this chart. These choices affect
                the whole animation.
              </p>
            </>
          ),
        },
        {
          id: "meta",
          label: "Meta node",
          render: () => (
            <>
              <h3>Parts of this chart</h3>
              <p>
                {graph.steps.length} steps contain{" "}
                {new Set(graph.steps.flatMap((step) => step.elementIds)).size}{" "}
                shapes, labels and pictures.
              </p>
              <p>
                Each step's parts stay together in this preview. Select a node
                on the board to edit its text or picture.
              </p>
            </>
          ),
        },
        {
          id: "arrow",
          label: "Arrow",
          render: (draft, update) => (
            <>
              <label>
                Arrow animation
                <select
                  aria-label="Preview arrow animation"
                  value={draft.arrowStyle}
                  onChange={(event) =>
                    update({
                      ...draft,
                      arrowStyle: event.target.value as typeof draft.arrowStyle,
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
              <label>
                Speed
                <input
                  aria-label="Preview animation speed"
                  type="range"
                  min={30}
                  max={900}
                  step={10}
                  value={draft.speed}
                  onChange={(event) =>
                    update({
                      ...draft,
                      speed: clampFlowSpeed(Number(event.target.value)),
                    })
                  }
                />
              </label>
              <FlowColorPad
                label="Preview animation colour"
                value={draft.markColor}
                onChange={(markColor) => update({ ...draft, markColor })}
              />
              <label>
                Marching marks alongside the step
                <select
                  aria-label="Marching marks alongside the step"
                  value={draft.marchingStyle ?? "none"}
                  onChange={(event) =>
                    update({ ...draft, marchingStyle: event.target.value })
                  }
                >
                  <option value="none">None</option>
                  <option value="marching">Marching dashes</option>
                  <option value="marching-beam">Marching beams</option>
                  <option value="marching-token">Marching tokens</option>
                </select>
              </label>
              <label>
                Gap between dashes
                <input
                  aria-label="Gap between dashes"
                  type="number"
                  min={2}
                  step={2}
                  defaultValue={draft.dashGap ?? 10}
                  onBlur={(event) => {
                    event.target.value = String(draft.dashGap ?? 10);
                  }}
                  onChange={(event) => {
                    const dashGap = Number(event.target.value);
                    if (Number.isFinite(dashGap) && dashGap >= 2) {
                      update({ ...draft, dashGap });
                    }
                  }}
                />
              </label>
              <label>
                Marching spacing
                <input
                  aria-label="Marching spacing"
                  type="number"
                  min={16}
                  step={10}
                  defaultValue={draft.spacing ?? 150}
                  onBlur={(event) => {
                    event.target.value = String(draft.spacing ?? 150);
                  }}
                  onChange={(event) => {
                    const spacing = Number(event.target.value);
                    if (Number.isFinite(spacing) && spacing >= 16) {
                      update({ ...draft, spacing });
                    }
                  }}
                />
              </label>
            </>
          ),
        },
        {
          id: "connect",
          label: "Connect / remove arrows",
          render: () => (
            <>
              <h3>Connections</h3>
              <p>
                {graph.edgeArrows.length} arrows connect this chart. Close this
                window and use Select arrows in Look to edit their line and
                arrowheads on the board.
              </p>
              <p>The preview uses the chart's current connections.</p>
            </>
          ),
        },
        {
          id: "background",
          label: "Background",
          render: () => (
            <>
              <h3>Page background</h3>
              <p>
                This chart currently uses the page's background (
                {app.state.viewBackgroundColor}). The preview fits the whole
                chart, independently of the board's camera.
              </p>
            </>
          ),
        },
      ]}
    />
  );
};
