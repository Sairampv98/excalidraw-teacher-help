import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

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
import { FLOW_HIGHLIGHT_TARGETS } from "../scene/flowLook";
import { flowOfSelection } from "../scene/flowSelection";
import {
  FLOW_ARROW_STYLES,
  FLOW_NODE_STYLES,
  FLOW_SPEED_MAX,
  FLOW_SPEED_MIN,
} from "../scene/flowStyles";

import { useAtomValue } from "../editor-jotai";
import { t } from "../i18n";

import { presetLook } from "../scene/flowPalette";

import { chartToExport } from "../scene/flowExport/chart";

import { openFlowScriptEditor } from "./FlowScriptEditorState";

import { FlowColorPad, FlowColorPresets } from "./FlowColorPad";

import { FlowExportPanel } from "./FlowExportPanel";
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

  const [lookOpen, setLookOpen] = useState(false);
  // the panel that exports the animation as a file (D-374)
  const [exportOpen, setExportOpen] = useState(false);
  const [place, setPlace] = useState<FlowBarPlace>(readFlowBarPlace);
  const [dragging, setDragging] = useState(false);

  const barRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<Press | null>(null);
  // the latest of these, for the window listeners that outlive a render
  const placeRef = useRef(place);
  placeRef.current = place;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const selectedFlow = useMemo(
    () => flowOfSelection(selectedElementIds, elements, elementsMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedElementIds, elements, elementsMap, sceneNonce],
  );

  // a flow that is playing stays the bar's flow whatever is selected (D-180)
  const graph = state.active && state.graph ? state.graph : selectedFlow;
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
  }, [viewport.width, viewport.height]);

  if (hidden || !graph || !box) {
    return null;
  }

  const barHeight = place.collapsed
    ? FLOW_BAR_PILL_HEIGHT
    : lookOpen
    ? FLOW_BAR_HEIGHT + FLOW_BAR_LOOK_EXTRA
    : FLOW_BAR_HEIGHT;

  const follow = flowBarPosition({ box, camera, viewport, barHeight });
  const marked = !!flowClassOf(graph, elementsMap);

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
      }
    : {
        left: follow.left,
        top: follow.top,
        maxWidth: Math.max(240, viewport.width - 16),
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
      {exportOpen && (
        <FlowExportPanel
          app={app}
          graph={graph}
          elements={elements}
          onClose={() => setExportOpen(false)}
        />
      )}
      <div className="excalidraw__flow-bar-row">
        <button
          type="button"
          className="excalidraw__flow-bar-grip"
          aria-label="Move the animation bar"
          title="Drag to move, double-click to follow the chart"
          onPointerDown={(event) => startPress(event, "grip")}
          onDoubleClick={() => remember({ ...place, placed: null })}
        >
          <GripIcon />
        </button>
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
          onClick={() => updateFlowAnimationSettings({ camera: !state.camera })}
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
        <button
          type="button"
          className="excalidraw__flow-bar-collapse"
          aria-label="Collapse the animation bar into a pill"
          title="Minimise - the animation keeps running; Stop ends it"
          onClick={() => remember({ ...place, collapsed: true })}
        >
          <CollapseIcon />
        </button>
      </div>
      <div className="excalidraw__flow-bar-row">
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
            const ids = new Set(graph.steps.flatMap((step) => step.elementIds));

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
      <div className="excalidraw__flow-bar-row">
        <button
          type="button"
          data-testid="flow-bar-export"
          aria-expanded={exportOpen}
          title="Export the animation as a GIF, WebP or MP4"
          onClick={() => setExportOpen((open) => !open)}
        >
          Export
        </button>
        <button
          type="button"
          className="excalidraw__flow-bar-edit-script"
          title="Edit the chart's script"
          onClick={() => openFlowScriptEditor(graph.steps[0].containerId)}
        >
          Edit chart
        </button>
        <button
          type="button"
          aria-expanded={lookOpen}
          onClick={() => setLookOpen((open) => !open)}
        >
          Look
        </button>
      </div>

      <div className="excalidraw__flow-bar-row">
        <label className="excalidraw__flow-bar-field">
          <span>Nodes</span>
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
          <span>Arrows</span>
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
            onChange={(event) => change({ speed: Number(event.target.value) })}
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
              change({
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
            checked={marked}
            onChange={(event) => {
              app.actionManager.executeAction(actionFlowClass, "ui", {
                enabled: event.target.checked,
              });

              // marking a chart has a visible effect: the class loop is
              // previewed in the editor, once (D-193)
              if (event.target.checked) {
                setFlowClassPreview(true);
              }
            }}
          />
          <span>{t("labels.flowAnimationClass")}</span>
        </label>
        <label className="excalidraw__flow-bar-field">
          <input
            type="checkbox"
            checked={state.loop}
            onChange={(event) => change({ loop: event.target.checked })}
          />
          <span>{t("labels.flowAnimationLoop")}</span>
        </label>
      </div>

      {lookOpen && (
        <div
          className="excalidraw__flow-bar-look"
          role="group"
          aria-label="Look"
        >
          <FlowColorPresets
            look={state}
            background={app.state.viewBackgroundColor}
            onPick={(colors) => change(presetLook(colors))}
          />
          <div className="excalidraw__flow-bar-row">
            <span className="excalidraw__flow-bar-label">Shape</span>
            <FlowColorPad
              label="Shape colour"
              value={state.nodeColor}
              onChange={(nodeColor) => change({ nodeColor })}
            />
          </div>
          <div className="excalidraw__flow-bar-row">
            <span className="excalidraw__flow-bar-label">Text</span>
            <FlowColorPad
              label="Text colour"
              value={state.textColor}
              onChange={(textColor) => change({ textColor })}
            />
          </div>
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
          </div>
          <div className="excalidraw__flow-bar-row">
            <span className="excalidraw__flow-bar-label">Animation</span>
            <FlowColorPad
              label="Animation colour"
              value={state.markColor}
              onChange={(markColor) => change({ markColor })}
            />
          </div>
          <div className="excalidraw__flow-bar-row">
            <span className="excalidraw__flow-bar-label">Arrow</span>
            <FlowColorPad
              label="Arrow colour"
              value={state.arrowColor}
              onChange={(arrowColor) => change({ arrowColor })}
            />
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
              <input
                type="checkbox"
                checked={state.glowShape}
                onChange={(event) =>
                  change({ glowShape: event.target.checked })
                }
              />
              <span>Neon shape</span>
            </label>
            <label className="excalidraw__flow-bar-field">
              <input
                type="checkbox"
                checked={state.glowText}
                onChange={(event) => change({ glowText: event.target.checked })}
              />
              <span>Neon text</span>
            </label>
            <label className="excalidraw__flow-bar-field">
              <input
                type="checkbox"
                checked={state.glowMark}
                onChange={(event) => change({ glowMark: event.target.checked })}
              />
              <span>Neon animation</span>
            </label>
            <label className="excalidraw__flow-bar-field">
              <input
                type="checkbox"
                checked={state.glowArrow}
                onChange={(event) =>
                  change({ glowArrow: event.target.checked })
                }
              />
              <span>Neon arrows</span>
            </label>
            <label className="excalidraw__flow-bar-field">
              <input
                type="checkbox"
                checked={preview}
                onChange={(event) => setFlowClassPreview(event.target.checked)}
              />
              <span>Preview class loop</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
};
