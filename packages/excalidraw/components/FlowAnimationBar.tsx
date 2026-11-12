import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import {
  FLOW_GLOW_CORES,
  glowCoreKey,
  glowStrengthKey,
  glowWidthKey,
  readGlowCore,
  readGlowStrength,
  readGlowWidth,
} from "../scene/flowLook";
import { actionFlowClass } from "../actions/actionFlowClass";
import {
  actionFlowLayout,
  actionFlowResetLayout,
  flowResetLayoutPredicate,
} from "../actions/actionFlowLayout";
import {
  FLOW_BAR_HEIGHT,
  FLOW_BAR_LOOK_EXTRA,
  FLOW_BAR_PILL_HEIGHT,
  flowBarPosition,
  flowBoxOf,
} from "../scene/flowBar";
import {
  FLOW_BAR_DRAG_THRESHOLD,
  clampFlowBarPlace,
  readFlowBarPlace,
  snapFlowBarPlace,
  usableFlowBarPlace,
  writeFlowBarPlace,
} from "../scene/flowBarPlace";
import { flowClassOf } from "../scene/flowClass";
import { FLOW_ACCENT_COLOR, FLOW_HIGHLIGHT_TARGETS } from "../scene/flowLook";
import { flowOfSelection } from "../scene/flowSelection";
import {
  FLOW_ARROW_STYLES,
  FLOW_NODE_STYLES,
  FLOW_SPEED_MAX,
  FLOW_SPEED_MIN,
} from "../scene/flowStyles";

import { useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import { swatchOf } from "../scene/flowPalette";

import { chartToExport } from "../scene/flowExport/chart";

import {
  openFlowScriptEditor,
  closeFlowScriptEditor,
  flowScriptEditorAtom,
} from "./FlowScriptEditorState";

import { FlowColorPad } from "./FlowColorPad";

import { FlowExportPanel } from "./FlowExportPanel";
import {
  FlowPanelTabs,
  readFlowPanelTab,
  writeFlowPanelTab,
} from "./flowPanel/FlowPanelTabs";
import {
  FlowAnimationOptions,
  applyPanelAnimation,
  panelAnimationOf,
  useFlowPanelAnimation,
} from "./flowPanel/FlowAnimationOptions";
import { FlowHexInput } from "./flowPanel/FlowHexInput";
import { FlowEmbeddedScriptEditor } from "./FlowScriptEditor";
import {
  DEFAULT_FLOW_STEP_DURATION_MS,
  flowAnimationStateAtom,
  flowClassPreviewAtom,
  setFlowClassPreview,
  startFlowAnimation,
  stopFlowAnimation,
  stopFlowEverything,
  updateFlowAnimationSettings,
} from "./FlowAnimationState";

import "./FlowAnimationBar.scss";

import type { FlowAnimationCamera } from "../scene/flowAnimation";
import type { FlowBarPlace } from "../scene/flowBarPlace";
import type { FlowViewport } from "../scene/flowCamera";
import type { AppClassProperties, AppState } from "../types";
import type { FlowPanelTab } from "./flowPanel/FlowPanelTabs";

type FlowAnimationBarProps = {
  app: AppClassProperties;
  /** every element on the canvas: the flow is found among them (D-180) */
  elements: readonly ExcalidrawElement[];
  elementsMap: ElementsMap;
  /**
   * Changes whenever the scene does, as a node resized in place does not change
   * the list of elements (D-389): the flow is read again then, so the sizes of
   * its steps are the ones they have now.
   */
  sceneNonce?: number;
  selectedElementIds: AppState["selectedElementIds"];
  camera: FlowAnimationCamera;
  viewport: FlowViewport;
  /** a view-only editor (the presenter) has no controls to show */
  hidden?: boolean;
};

/** a press on the grip or the pill, until it is released */
type Press = {
  kind: "grip" | "pill";
  startX: number;
  startY: number;
  /** where the bar was when it was pressed: its top-left */
  origin: { x: number; y: number };
  size: { width: number; height: number };
  moved: boolean;
};

// the same six dots as the grip of the other panels
const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <g fill="currentColor">
      <circle cx="4.6" cy="2.6" r="1.35" />
      <circle cx="9.4" cy="2.6" r="1.35" />
      <circle cx="4.6" cy="7" r="1.35" />
      <circle cx="9.4" cy="7" r="1.35" />
      <circle cx="4.6" cy="11.4" r="1.35" />
      <circle cx="9.4" cy="11.4" r="1.35" />
    </g>
  </svg>
);

const PlusIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 4v16M4 12h16" />
  </svg>
);

/** the parts that take a colour, each with its neon switch (D-535, Look tab) */
const FLOW_LOOK_ROWS = [
  {
    id: "shape",
    name: "Shape",
    colorKey: "nodeColor",
    glowKey: "glowShape",
    neon: "Neon shape",
  },
  {
    id: "text",
    name: "Text",
    colorKey: "textColor",
    glowKey: "glowText",
    neon: "Neon text",
  },
  {
    id: "animation",
    name: "Animation",
    colorKey: "markColor",
    glowKey: "glowMark",
    neon: "Neon animation",
  },
  {
    id: "arrow",
    name: "Arrow",
    colorKey: "arrowColor",
    glowKey: "glowArrow",
    neon: "Neon arrows",
  },
] as const;

const CollapseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

/** the tabs that hold the script editor: the panel stays on its chart there */
const PINNED_TABS: readonly FlowPanelTab[] = ["Script", "Save as preset"];

/**
 * The floating bar that drives the flow animation (D-177).
 *
 * It replaces the properties-panel section: the same controls, in a bar that
 * sits just below the chart and follows it. It is shown while a shape or an
 * arrow of a flow is selected, and while a flow plays (D-180), and the whole
 * connected flow is what it controls.
 *
 * It is also a **movable pill**, like the toolbar and the properties panel
 * (D-197, D-198): a grip to move it, a collapse button to turn it into a pill,
 * and a place that is remembered. Moving it never touches the canvas (D-199).
 *
 * Nothing it does touches `appState`: the settings and the playing state live
 * in a jotai atom, so nothing about the animation reaches the saved document
 * (D-63).
 */

export const FlowAnimationBar = ({
  app,
  elements,
  elementsMap,
  sceneNonce,
  selectedElementIds,
  camera,
  viewport,
  hidden,
}: FlowAnimationBarProps) => {
  const state = useAtomValue(flowAnimationStateAtom);
  const preview = useAtomValue(flowClassPreviewAtom);
  const scriptEditor = useAtomValue(flowScriptEditorAtom);

  const [tab, setTab] = useState(readFlowPanelTab);
  const lookOpen = tab === "Look";
  // the one colour pad of the Look tab is for the part chosen in its table
  const [colourRow, setColourRow] =
    useState<typeof FLOW_LOOK_ROWS[number]["id"]>("shape");
  const lookRow =
    FLOW_LOOK_ROWS.find((row) => row.id === colourRow) ?? FLOW_LOOK_ROWS[0];
  // the glow and the width are each part's own: the row chosen is the part
  const glowPart = (
    { shape: "shape", text: "text", animation: "mark", arrow: "arrow" } as const
  )[lookRow.id];
  const glowStrengthOf = readGlowStrength(state[glowStrengthKey(glowPart)]);
  const glowWidthOf = readGlowWidth(state[glowWidthKey(glowPart)]);
  const glowCoreOf = readGlowCore(state[glowCoreKey(glowPart)]);
  const [expanded, setExpanded] = useState(false);
  const [comboNotice, setComboNotice] = useState(false);
  const chooseTab = (next: FlowPanelTab) => {
    setTab(next);
    writeFlowPanelTab(next);
    // the script tabs pin the panel to its chart, so that it stays on it when
    // applying the script makes the chart again; the others follow the selection
    if (!PINNED_TABS.includes(next)) {
      if (
        pinAnchor.current &&
        pinAnchor.current !== selectionAnchorRef.current
      ) {
        // the chart may have been made again by Apply, and nothing is selected:
        // select its first node so that the panel keeps following the chart
        app.api.updateScene({
          appState: { selectedElementIds: { [pinAnchor.current]: true } },
        });
      }
      closeFlowScriptEditor();
    } else if (pinAnchor.current) {
      openFlowScriptEditor(pinAnchor.current);
    }
  };
  const pinAnchor = useRef<string | null>(null);
  const selectionAnchorRef = useRef<string | null>(null);
  const [place, setPlace] = useState<FlowBarPlace>(readFlowBarPlace);
  const [dragging, setDragging] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const lastScriptAnchor = useRef<string | null>(null);
  useEffect(() => {
    if (scriptEditor.anchorId) {
      setTab((current) => (PINNED_TABS.includes(current) ? current : "Script"));
      setPlace((current) => ({ ...current, collapsed: false }));
    } else if (lastScriptAnchor.current) {
      setTab((current) =>
        PINNED_TABS.includes(current) ? "Animation" : current,
      );
    }
    lastScriptAnchor.current = scriptEditor.anchorId;
  }, [scriptEditor]);

  const barRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      if (bar.offsetHeight) {
        setMeasuredHeight(bar.offsetHeight);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [tab, place.collapsed, comboNotice, selectedElementIds]);
  const pressRef = useRef<Press | null>(null);
  // the latest of these, for the window listeners that outlive a render
  const placeRef = useRef(place);
  placeRef.current = place;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Applying a different preset may replace the original anchor. Keep the
  // panel on that chart, just as the former script window did.
  const editorChart = useRef<{ anchorId: string; chartId?: string } | null>(
    null,
  );
  let requestedAnchor = scriptEditor.anchorId;
  if (requestedAnchor) {
    const anchor = elementsMap.get(requestedAnchor);
    if (anchor && !anchor.isDeleted) {
      editorChart.current = {
        anchorId: requestedAnchor,
        chartId: anchor.customData?.flow?.chartId,
      };
    } else if (
      editorChart.current?.anchorId === requestedAnchor &&
      editorChart.current.chartId
    ) {
      requestedAnchor =
        elements.find(
          (element) =>
            !element.isDeleted &&
            element.customData?.flow?.chartId === editorChart.current?.chartId,
        )?.id ?? null;
    }
  }

  // the chart the selection points at
  const selectionFlow = useMemo(
    () => flowOfSelection(selectedElementIds, elements, elementsMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedElementIds, elements, elementsMap, sceneNonce],
  );
  // a pinned panel (the script tabs) stays on its chart, also when applying the
  // script makes the chart again and the selection is gone
  const selectedFlow = useMemo(
    () =>
      requestedAnchor
        ? flowOfSelection({ [requestedAnchor]: true }, elements, elementsMap)
        : selectionFlow,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectionFlow, elements, elementsMap, sceneNonce, requestedAnchor],
  );

  // a flow that is playing stays the bar's flow whatever is selected (D-180)
  const graph = state.active && state.graph ? state.graph : selectedFlow;
  const graphAnchor = graph?.steps[0]?.containerId ?? null;
  const selectionAnchor = selectionFlow?.steps[0]?.containerId ?? null;
  const pinnedTab = PINNED_TABS.includes(tab);
  pinAnchor.current = graphAnchor;
  selectionAnchorRef.current = selectionAnchor;
  // a panel that was left on a script tab opens pinned, once, when its chart is there
  const startedPinned = useRef(false);
  useEffect(() => {
    if (startedPinned.current || place.collapsed || !graphAnchor) {
      return;
    }
    startedPinned.current = true;
    if (pinnedTab && !scriptEditor.anchorId) {
      openFlowScriptEditor(graphAnchor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphAnchor, place.collapsed]);
  useEffect(() => {
    if (!scriptEditor.anchorId) {
      return;
    }
    if (selectionAnchor && selectionAnchor !== graphAnchor) {
      // another chart was selected: the pinned panel moves to it
      openFlowScriptEditor(selectionAnchor);
    } else if (!graphAnchor) {
      // the chart is gone: let go of it so that the next chart can be shown
      closeFlowScriptEditor();
    }
  }, [selectionAnchor, graphAnchor, scriptEditor.anchorId]);
  useFlowPanelAnimation(
    graph
      ? graph.steps
          .map((step) => elementsMap.get(step.containerId))
          .find((element) => element?.customData?.flowPanelAnimation) ??
          elementsMap.get(graph.steps[0]?.containerId)
      : undefined,
  );
  const box = graph ? flowBoxOf(graph, elementsMap) : null;

  // a remembered place that cannot be used in this window is ignored (D-197)
  const placed = usableFlowBarPlace(place.placed, viewport);

  const remember = useCallback((next: FlowBarPlace) => {
    setPlace(next);
    writeFlowBarPlace(next);
  }, []);

  // moving the bar, and dropping it (D-197, D-199): one set of listeners
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const press = pressRef.current;

      if (!press) {
        return;
      }

      if (!press.moved) {
        const travelled = Math.hypot(
          event.clientX - press.startX,
          event.clientY - press.startY,
        );

        if (travelled < FLOW_BAR_DRAG_THRESHOLD) {
          return;
        }

        press.moved = true;
        setDragging(true);
      }

      const next = clampFlowBarPlace(
        {
          x: press.origin.x + (event.clientX - press.startX),
          y: press.origin.y + (event.clientY - press.startY),
        },
        press.size,
        viewportRef.current,
      );

      setPlace((current) => ({ ...current, placed: next }));
    };

    const onUp = () => {
      const press = pressRef.current;

      if (!press) {
        return;
      }

      pressRef.current = null;
      setDragging(false);

      if (!press.moved) {
        // pressed and let go: on the pill that opens the bar
        if (press.kind === "pill") {
          remember({ ...placeRef.current, collapsed: false });
        }

        return;
      }

      const dropped = placeRef.current.placed;

      if (dropped) {
        remember({
          ...placeRef.current,
          placed: snapFlowBarPlace(dropped, press.size, viewportRef.current),
        });
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [remember]);

  // the window changed size: a placed bar is brought back inside it (D-199)
  useEffect(() => {
    if (!placed) {
      return;
    }

    const element = barRef.current;
    const size = {
      width: element?.offsetWidth ?? 0,
      height: element?.offsetHeight ?? 0,
    };
    const next = clampFlowBarPlace(placed, size, viewport);

    if (next.x !== placed.x || next.y !== placed.y) {
      remember({ ...placeRef.current, placed: next });
    }
    // only a change of the window's size brings it back; the place is the
    // teacher's the rest of the time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport.width, viewport.height, measuredHeight]);

  if (hidden || !graph || !box) {
    return null;
  }

  const barHeight = place.collapsed
    ? FLOW_BAR_PILL_HEIGHT
    : measuredHeight ||
      (lookOpen ? FLOW_BAR_HEIGHT + FLOW_BAR_LOOK_EXTRA : FLOW_BAR_HEIGHT);

  const follow = flowBarPosition({ box, camera, viewport, barHeight });
  const marked = !!flowClassOf(graph, elementsMap);
  // the distance between marching marks lives in the chart's saved animation
  // choices: the gap between dashes, or the spacing of beams and tokens
  const savedPanel = panelAnimationOf(
    {
      // what the bar shows now wins over what was saved earlier; only the
      // spacing and the dash gap come from the record
      ...(graph
        ? elementsMap.get(graph.steps[0]?.containerId)?.customData
            ?.flowPanelAnimation
        : undefined),
      ...state,
      spacing: (graph
        ? elementsMap.get(graph.steps[0]?.containerId)?.customData
            ?.flowPanelAnimation?.spacing
        : undefined) as number | undefined,
      dashGap: (graph
        ? elementsMap.get(graph.steps[0]?.containerId)?.customData
            ?.flowPanelAnimation?.dashGap
        : undefined) as number | undefined,
    },
    state,
  );
  const dashesOnly =
    state.arrowStyle === "marching" ||
    (state.arrowStyle === "none" && savedPanel.marchingStyle === "marching");
  const markSpacing = dashesOnly
    ? savedPanel.dashGap ?? 10
    : savedPanel.spacing ?? 150;

  // a setting the class plays is brought up to date in the chart as well, while
  // the chart is marked: what the bar shows is what the class gets (D-183)
  const change = (
    settings: Parameters<typeof updateFlowAnimationSettings>[0],
  ) => {
    updateFlowAnimationSettings(settings);

    if (marked) {
      app.actionManager.executeAction(actionFlowClass, "ui", {
        enabled: true,
        writeThrough: true,
      });
    }
  };

  /** presses the grip or the pill: not a click on the canvas (D-199) */
  const startPress = (
    event: React.PointerEvent<HTMLElement>,
    kind: Press["kind"],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    const element = barRef.current;
    const size = {
      width: element?.offsetWidth ?? 0,
      height: element?.offsetHeight ?? 0,
    };

    pressRef.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      // where the bar is now: its place, or where it follows the chart to
      origin: placed ?? { x: follow.left - size.width / 2, y: follow.top },
      size,
      moved: false,
    };
  };

  // the bar wraps inside the editor, whatever is docked beside it (D-395)
  const style = placed
    ? {
        left: placed.x,
        top: placed.y,
        maxWidth: Math.max(240, viewport.width - placed.x - 8),
        maxHeight: Math.max(160, viewport.height - 16),
      }
    : {
        left: follow.left,
        top: follow.top,
        maxWidth: Math.max(240, viewport.width - 16),
        maxHeight: Math.max(160, viewport.height - 16),
      };

  const playing = state.active && state.mode === "play";
  const presenting = state.active && state.mode === "present";
  const running = state.active || preview;
  const runningLabel = presenting
    ? "Stepping"
    : playing
    ? "Playing"
    : preview
    ? "Preview"
    : "";

  if (place.collapsed) {
    return (
      <div
        className="excalidraw__flow-bar-pill-wrap"
        data-flow-bar-placed={placed ? "" : undefined}
        style={style}
      >
        <button
          type="button"
          ref={(node) => {
            barRef.current = node;
          }}
          className="excalidraw__flow-bar-pill"
          data-testid="flow-bar-pill"
          data-flow-bar-placed={placed ? "" : undefined}
          data-dragging={dragging ? "" : undefined}
          aria-label="Animation, collapsed"
          title="Animation - click to open, drag to move"
          onPointerDown={(event) => startPress(event, "pill")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              remember({ ...place, collapsed: false });
            }
          }}
        >
          <GripIcon />
          <span>Animation{running ? ` · ${runningLabel}` : ""}</span>
        </button>
        {running && (
          <button
            type="button"
            className="excalidraw__flow-bar-pill-camera"
            data-testid="flow-bar-pill-camera"
            aria-pressed={state.camera}
            title={
              state.camera
                ? "The view flies to each step - click to keep the view still"
                : "The view stays still - click to fly the view to each step"
            }
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() =>
              updateFlowAnimationSettings({ camera: !state.camera })
            }
          >
            Fly: {state.camera ? "on" : "off"}
          </button>
        )}
        {running && (
          <button
            type="button"
            className="excalidraw__flow-bar-pill-stop"
            data-testid="flow-bar-pill-stop"
            aria-label="Stop the animation"
            title="Stop the animation"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={stopFlowEverything}
          >
            Stop
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={(node) => {
        barRef.current = node;
      }}
      className="excalidraw__flow-bar"
      role="toolbar"
      aria-label={t("labels.flowAnimation")}
      data-testid="flow-bar"
      data-flow-bar-placed={placed ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      style={style}
      // the bar is not part of the canvas: a click on it is not a click on the
      // scene, so nothing under it is deselected
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flow-panel-head">
        <FlowPanelTabs value={tab} onChange={chooseTab} />
        <select
          className="flow-panel-chart"
          aria-label="Chart or combo"
          title="The chart these tabs act on (a combo of charts comes with D-506)"
          value="this"
          onChange={() => setComboNotice(false)}
        >
          <option value="this">This chart</option>
        </select>
      </div>
      {comboNotice && (
        <p role="status">
          This chart is not in a combo. The plus adds another chart to a combo
          when combo charts are available. For now, insert another chart from
          the Flow sidebar; it remains independent.
        </p>
      )}
      {expanded && (
        <FlowAnimationOptions
          app={app}
          graph={graph}
          elements={elements}
          onClose={() => setExpanded(false)}
        />
      )}
      <div
        className="flow-panel-strip"
        data-side={
          // the buttons hang outside the panel; on the right edge they go left
          (barRef.current?.getBoundingClientRect().right ?? 0) + 56 >
          window.innerWidth
            ? "left"
            : "right"
        }
      >
        <button
          type="button"
          className="excalidraw__flow-bar-grip"
          aria-label="Move the animation bar"
          title="Drag to move or dock; double-click to follow the chart"
          onPointerDown={(event) => startPress(event, "grip")}
          onDoubleClick={() => remember({ ...place, placed: null })}
          onKeyDown={(event) => {
            const delta = {
              ArrowLeft: [-16, 0],
              ArrowRight: [16, 0],
              ArrowUp: [0, -16],
              ArrowDown: [0, 16],
            }[event.key];
            if (delta) {
              event.preventDefault();
              event.stopPropagation();
              const current = placed ?? {
                x: follow.left - (barRef.current?.offsetWidth ?? 0) / 2,
                y: follow.top,
              };
              remember({
                ...place,
                placed: clampFlowBarPlace(
                  { x: current.x + delta[0], y: current.y + delta[1] },
                  {
                    width: barRef.current?.offsetWidth ?? 0,
                    height: barRef.current?.offsetHeight ?? 0,
                  },
                  viewport,
                ),
              });
            }
          }}
        >
          <GripIcon />
        </button>
        <button
          type="button"
          aria-label="Collapse the animation bar into a pill"
          title="Close the panel into a pill - click the pill to open it again"
          onClick={() => {
            closeFlowScriptEditor();
            remember({ ...place, collapsed: true });
          }}
        >
          <CollapseIcon />
        </button>
        <button
          type="button"
          aria-label="Add a chart to a combo"
          aria-expanded={comboNotice}
          title="Add another chart to combine with this one"
          onClick={() => setComboNotice((open) => !open)}
        >
          <PlusIcon />
        </button>
      </div>
      <div
        role="tabpanel"
        aria-label={`${tab} options`}
        className="flow-panel-content"
        data-flow-tab={tab}
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
            className="excalidraw__flow-bar-camera-toggle"
            data-testid="flow-bar-camera"
            aria-pressed={state.camera}
            title={
              state.camera
                ? "The view flies to each step - click to keep the view still"
                : "The view stays still - click to fly the view to each step"
            }
            onClick={() =>
              updateFlowAnimationSettings({ camera: !state.camera })
            }
          >
            Fly: {state.camera ? "on" : "off"}
          </button>
          {running && (
            <button
              type="button"
              className="excalidraw__flow-bar-stop"
              data-testid="flow-bar-stop"
              title="Stop the animation (Esc)"
              onClick={stopFlowEverything}
            >
              Stop {runningLabel.toLowerCase()}
            </button>
          )}
        </div>
        {/* controls of the other tabs stay in the page, hidden: the older
            controls and their tests reach them by their labels */}
        <div className="excalidraw__flow-bar-row" hidden={tab !== "Look"}>
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
          <button
            type="button"
            data-testid="flow-bar-select-arrows"
            title="Select every arrow of this chart, to change them all at once: the arrowheads, a dashed line"
            onClick={() => {
              // the chart's own arrows, whatever else is selected now (D-392)
              const arrows = (
                chartToExport(graph, graph.steps, elements)?.elements ?? []
              ).filter((element) => element.type === "arrow");

              app.api.updateScene({
                appState: {
                  selectedElementIds: Object.fromEntries(
                    arrows.map((arrow) => [arrow.id, true as const]),
                  ),
                },
              });
            }}
          >
            Select arrows
          </button>
          <button
            type="button"
            data-testid="flow-bar-select-nodes"
            title="Select every node of this chart, to change them all at once: the colour, the shape, the size"
            onClick={() => {
              // the chart's own nodes with their words and pictures, and no arrow (D-393)
              const ids = new Set(
                graph.steps.flatMap((step) => step.elementIds),
              );

              app.api.updateScene({
                appState: {
                  selectedElementIds: Object.fromEntries(
                    [...ids].map((id) => [id, true as const]),
                  ),
                },
              });
            }}
          >
            Select nodes
          </button>
        </div>

        <div className="excalidraw__flow-bar-row" hidden={tab !== "Animation"}>
          <label className="excalidraw__flow-bar-field">
            <span>Node animation</span>
            <select
              aria-label="Node animation"
              value={state.nodeStyle}
              onChange={(event) =>
                change({
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
            <span>Arrow animation</span>
            <select
              aria-label="Arrow animation"
              value={state.arrowStyle}
              onChange={(event) =>
                change({
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
                change({ speed: Number(event.target.value) })
              }
            />
            <span
              className="excalidraw__flow-bar-value"
              aria-label="Animation speed value"
            >
              {state.speed}
            </span>
          </label>
          {graph && (
            <label className="excalidraw__flow-bar-field">
              <span>Mark spacing</span>
              <input
                type="number"
                aria-label="Mark spacing"
                title="The distance between two marching dashes (the gap), beams or tokens"
                min={dashesOnly ? 2 : 16}
                step={dashesOnly ? 2 : 10}
                key={`${dashesOnly}-${markSpacing}`}
                defaultValue={markSpacing}
                // the number is typed whole and saved when the box is left or
                // Enter is pressed; the digits are not shortcuts of the board
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (
                    !Number.isFinite(value) ||
                    value < (dashesOnly ? 2 : 16) ||
                    value === markSpacing
                  ) {
                    event.target.value = String(markSpacing);
                    return;
                  }
                  applyPanelAnimation(
                    app,
                    graph,
                    savedPanel,
                    dashesOnly
                      ? { ...savedPanel, dashGap: value }
                      : { ...savedPanel, spacing: value },
                  );
                }}
              />
            </label>
          )}
        </div>

        <div className="excalidraw__flow-bar-row">
          <label
            className="excalidraw__flow-bar-field"
            hidden={tab !== "Animation"}
          >
            <span>{t("labels.flowAnimationDuration")}</span>
            <input
              type="number"
              min={100}
              step={100}
              value={state.durationMs}
              onChange={(event) =>
                change({
                  durationMs:
                    Number(event.target.value) || DEFAULT_FLOW_STEP_DURATION_MS,
                })
              }
            />
          </label>
          <label
            className="excalidraw__flow-bar-field"
            hidden={tab !== "Camera"}
          >
            <input
              type="checkbox"
              checked={state.camera}
              onChange={(event) =>
                updateFlowAnimationSettings({
                  camera: event.target.checked,
                })
              }
            />
            <span>Fly the view to each step</span>
          </label>
          <label
            className="excalidraw__flow-bar-field"
            hidden={tab !== "Present in class"}
          >
            <input
              type="checkbox"
              checked={marked}
              onChange={(event) => {
                app.actionManager.executeAction(actionFlowClass, "ui", {
                  enabled: event.target.checked,
                });

                // marking does not start the preview: the editor shows the loop
                // only while Preview class loop is ticked (D-486)
              }}
            />
            <span>{t("labels.flowAnimationClass")}</span>
          </label>
          <label
            className="excalidraw__flow-bar-field"
            hidden={tab !== "Present in class"}
          >
            <input
              type="checkbox"
              checked={state.loop}
              onChange={(event) => change({ loop: event.target.checked })}
            />
            <span>{t("labels.flowAnimationLoop")}</span>
          </label>
        </div>

        {tab === "Animation" && (
          <button type="button" onClick={() => setExpanded(true)}>
            More animation options
          </button>
        )}
        {tab === "Script" && (
          <FlowEmbeddedScriptEditor
            app={app}
            elements={elements}
            elementsMap={elementsMap}
            anchorId={graph.steps[0].containerId}
            camera={camera}
            viewport={viewport}
          />
        )}
        {tab === "Save as preset" && (
          <FlowEmbeddedScriptEditor
            app={app}
            elements={elements}
            elementsMap={elementsMap}
            anchorId={graph.steps[0].containerId}
            camera={camera}
            viewport={viewport}
            presetOnly
          />
        )}
        {tab === "Export" && (
          <FlowExportPanel
            inline
            app={app}
            graph={graph}
            elements={elements}
            onClose={() => chooseTab("Animation")}
          />
        )}
        {tab === "Camera" && (
          <p>
            Fly follows each step. Turn it off to keep the board's current view.
          </p>
        )}
        {tab === "Present in class" && (
          <label className="excalidraw__flow-bar-field">
            <input
              type="checkbox"
              checked={preview}
              onChange={(event) => setFlowClassPreview(event.target.checked)}
            />
            Preview class loop
          </label>
        )}

        {lookOpen && (
          <div
            className="excalidraw__flow-bar-look"
            role="group"
            aria-label="Look"
          >
            <FlowEmbeddedScriptEditor
              app={app}
              elements={elements}
              elementsMap={elementsMap}
              anchorId={graph.steps[0].containerId}
              camera={camera}
              viewport={viewport}
              lookOnly
            />
            <table className="flow-look-table" aria-label="Colours and neon">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col">Colour</th>
                  <th scope="col">Neon</th>
                </tr>
              </thead>
              <tbody>
                {FLOW_LOOK_ROWS.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">{row.name}</th>
                    <td>
                      <button
                        type="button"
                        className="flow-look-chip"
                        aria-pressed={colourRow === row.id}
                        aria-label={`Choose the ${row.name.toLowerCase()} colour`}
                        title={`${row.name}: ${
                          swatchOf(state[row.colorKey])?.name ??
                          (state[row.colorKey] ? "custom" : "default")
                        }`}
                        onClick={() => setColourRow(row.id)}
                      >
                        <span
                          className="flow-look-chip-colour"
                          style={{
                            backgroundColor:
                              state[row.colorKey] ?? FLOW_ACCENT_COLOR,
                          }}
                        />
                      </button>
                    </td>
                    <td>
                      <label className="excalidraw__flow-bar-field">
                        <input
                          type="checkbox"
                          checked={state[row.glowKey]}
                          onChange={(event) =>
                            change({ [row.glowKey]: event.target.checked })
                          }
                        />
                        <span>{row.neon}</span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <FlowColorPad
              label={`${lookRow.name} colour`}
              value={state[lookRow.colorKey]}
              onChange={(color) => change({ [lookRow.colorKey]: color })}
            />
            <FlowHexInput
              label={`${lookRow.name} hex code`}
              value={state[lookRow.colorKey]}
              onChange={(color) => change({ [lookRow.colorKey]: color })}
            />
            <div className="excalidraw__flow-bar-row">
              <label className="excalidraw__flow-bar-field">
                <span>Highlight on</span>
                <select
                  aria-label="Highlight target"
                  value={state.nodeTarget}
                  onChange={(event) =>
                    change({
                      nodeTarget: event.target.value as typeof state.nodeTarget,
                    })
                  }
                >
                  {FLOW_HIGHLIGHT_TARGETS.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="excalidraw__flow-bar-field">
                <input
                  type="checkbox"
                  checked={state.hideArrow}
                  onChange={(event) =>
                    change({ hideArrow: event.target.checked })
                  }
                />
                <span>Hide arrow</span>
              </label>
            </div>
            <div className="excalidraw__flow-bar-row">
              <label className="excalidraw__flow-bar-field">
                <span>{lookRow.name} glow</span>
                <input
                  type="range"
                  aria-label="Neon glow"
                  min={1}
                  max={100}
                  step={1}
                  value={glowStrengthOf}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    change({
                      [glowStrengthKey(glowPart)]: Number(event.target.value),
                    })
                  }
                />
                <span
                  className="excalidraw__flow-bar-value"
                  aria-label="Neon glow value"
                >
                  {glowStrengthOf}
                </span>
              </label>
              <div
                className="excalidraw__flow-bar-field"
                role="group"
                aria-label="Neon width"
              >
                <span>{lookRow.name} width</span>
                {(["small", "normal", "large"] as const).map((width) => {
                  const chosen = glowWidthOf === width;

                  return (
                    <button
                      type="button"
                      key={width}
                      aria-pressed={chosen}
                      style={
                        chosen
                          ? {
                              background: "var(--color-primary, #6965db)",
                              color: "#fff",
                              fontWeight: 700,
                            }
                          : undefined
                      }
                      onClick={() =>
                        change({ [glowWidthKey(glowPart)]: width })
                      }
                    >
                      {chosen ? "✓ " : ""}
                      {width[0].toUpperCase() + width.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="excalidraw__flow-bar-row">
              <label className="excalidraw__flow-bar-field">
                <span>{lookRow.name} neon core</span>
                <select
                  aria-label="Neon core"
                  title="The bright middle of a neon line: the colour lightened, pure white, or the colour itself"
                  value={glowCoreOf}
                  onChange={(event) =>
                    change({
                      [glowCoreKey(glowPart)]: readGlowCore(event.target.value),
                    })
                  }
                >
                  {FLOW_GLOW_CORES.map((core) => (
                    <option key={core.id} value={core.id}>
                      {core.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
