import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { randomId } from "@excalidraw/common";
import { CaptureUpdateAction } from "@excalidraw/element";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { checkFlowScript } from "../scene/flowCheck";
import { applyFlowScript } from "../scene/flowApply";
import { isBuiltInPreset } from "../scene/flowChart";
import { resolveChart } from "../scene/flowChartOf";
import {
  BUILT_IN_OF_LAYOUT,
  buildSettingsOfCustom,
  readStoredCustomPresets,
} from "../scene/flowCustomPresets";
import {
  FLOW_EDITOR_SIZE,
  flowEditorPosition,
  readFlowEditorPlace,
  usableFlowEditorPlace,
  writeFlowEditorPlace,
} from "../scene/flowEditorPlace";
import {
  FLOW_BAR_DRAG_THRESHOLD,
  clampFlowBarPlace,
} from "../scene/flowBarPlace";
import { flowPagesOf, planChartPages } from "../scene/flowPagesFor";
import { listFlowPresets } from "../scene/flowPresets";
import { FLOW_FIT_MODES } from "../scene/flowChart";
import { FLOW_NODE_SHAPES } from "../scene/flowScript";
import {
  getPageIndex,
  getPageRect,
  translateContentForPageLayout,
} from "../scene/pages";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../types";

import { useAtomValue } from "../editor-jotai";

import {
  clearFlowScriptDraft,
  closeFlowScriptEditor,
  flowScriptEditorAtom,
  getFlowScriptDraft,
  setFlowScriptDraft,
} from "./FlowScriptEditorState";

import "./FlowScriptEditor.scss";

import type { FlowAnimationCamera } from "../scene/flowAnimation";
import type { FlowViewport } from "../scene/flowCamera";
import type { FlowFitMode } from "../scene/flowChart";
import type { ResolvedChart } from "../scene/flowChartOf";
import type { FlowCustomPreset } from "../scene/flowCustomPresets";
import type { FlowChartShape } from "../scene/flowPresets";
import type { FlowPresetId } from "../scene/flowScript";
import type { AppClassProperties } from "../types";

type FlowScriptEditorProps = {
  app: AppClassProperties;
  elements: readonly ExcalidrawElement[];
  elementsMap: ElementsMap;
  camera: FlowAnimationCamera;
  viewport: FlowViewport;
  /** a view-only editor (the presenter) has no panel to show */
  hidden?: boolean;
};

/** the ids that legacy charts are given, so that a chart keeps the id it will have */
const legacyIds = new Map<string, string>();

const idForLegacy = (key: string) => {
  let id = legacyIds.get(key);

  if (!id) {
    id = `chart-${randomId()}`;
    legacyIds.set(key, id);
  }

  return id;
};

const FIT_LABELS: Record<FlowFitMode, string> = {
  page: "Fit to page",
  spread: "Spread over pages",
  larger: "Allow larger than page",
};

const SHAPE_LABELS: Record<FlowChartShape, string> = {
  own: "Preset's own",
  rectangle: "Rectangle",
  rounded: "Rounded",
  ellipse: "Ellipse",
  circle: "Circle",
  diamond: "Diamond",
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

const CloseIcon = () => (
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
 * The script editor (D-222): a panel beside the chart that is edited, with its
 * script, its preset, its fit mode and its shape, the live check (D-224) and
 * **Apply** (D-223). It is the toolbox's own kind of panel - a grip to move it
 * and a close button - and a change goes into the scene in one step, so one
 * undo takes it back.
 */
export const FlowScriptEditor = ({
  app,
  elements,
  elementsMap,
  camera,
  viewport,
  hidden,
}: FlowScriptEditorProps) => {
  const { anchorId } = useAtomValue(flowScriptEditorAtom);
  const anchor = anchorId ? elementsMap.get(anchorId) : undefined;

  const chart =
    anchor && !anchor.isDeleted && !hidden
      ? resolveChart(anchor, elements, elementsMap, () =>
          idForLegacy(`legacy-${anchor.id}`),
        )
      : null;

  if (!anchor || !chart) {
    return null;
  }

  return (
    <EditorPanel
      key={chart.key}
      app={app}
      chart={chart}
      anchor={anchor}
      camera={camera}
      viewport={viewport}
    />
  );
};

type EditorPanelProps = {
  app: AppClassProperties;
  chart: ResolvedChart;
  anchor: ExcalidrawElement;
  camera: FlowAnimationCamera;
  viewport: FlowViewport;
};

type Press = {
  startX: number;
  startY: number;
  origin: { x: number; y: number };
  moved: boolean;
};

const EditorPanel = ({
  app,
  chart,
  anchor,
  camera,
  viewport,
}: EditorPanelProps) => {
  const { record } = chart;
  const draft = getFlowScriptDraft(chart.key);

  const [script, setScript] = useState(draft?.script ?? record.script);
  const [presetId, setPresetId] = useState(draft?.presetId ?? record.preset);
  const [fit, setFit] = useState<FlowFitMode>(draft?.fit ?? record.fit);
  const [shape, setShape] = useState<FlowChartShape>(
    draft?.shape ?? record.shape,
  );
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [place, setPlace] = useState(readFlowEditorPlace);
  const [dragging, setDragging] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<Press | null>(null);
  const placeRef = useRef(place);
  placeRef.current = place;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // what was typed is kept for this chart, so that closing the panel loses nothing
  useEffect(() => {
    setFlowScriptDraft(chart.key, { script, presetId, fit, shape });
  }, [chart.key, script, presetId, fit, shape]);

  const customs = useMemo(() => readStoredCustomPresets(), []);
  const choices = useMemo(() => {
    // the chart's own preset is offered even on a machine that does not have it
    const own =
      record.custom && !customs.some((c) => c.id === record.custom!.id)
        ? [...customs, record.custom]
        : customs;

    return { list: listFlowPresets(own), customs: own };
  }, [customs, record.custom]);

  const custom: FlowCustomPreset | undefined = choices.customs.find(
    (c) => c.id === presetId,
  );
  const builtIn: FlowPresetId = custom
    ? BUILT_IN_OF_LAYOUT[custom.layout]
    : isBuiltInPreset(presetId)
    ? presetId
    : "process";

  // the page the chart is on, and its number
  const statePages = app.state.pages;
  const pages = useMemo(() => statePages ?? [], [statePages]);
  const pageId = anchor.pageId;
  const pageRect = useMemo(
    () =>
      pages.length && pageId
        ? getPageRect(pages, pageId)
        : { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT },
    [pages, pageId],
  );
  const pageNumber =
    pages.length && pageId ? getPageIndex(pages, pageId) + 1 : 1;

  const options = useMemo(
    () => ({
      page: pageRect,
      fit,
      shape,
      ...(custom ? buildSettingsOfCustom(custom).options : {}),
    }),
    // the rect is a value: only what it says matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      pageRect.x,
      pageRect.y,
      pageRect.width,
      pageRect.height,
      fit,
      shape,
      custom,
    ],
  );
  // the shape the teacher chose wins over the preset's own default
  options.shape = shape;

  const check = useMemo(
    () => checkFlowScript(builtIn, script, options),
    [builtIn, script, options],
  );

  const apply = useCallback(() => {
    if (!check.ok) {
      return;
    }

    const sceneElements = app.scene.getElementsIncludingDeleted();
    let base: readonly ExcalidrawElement[] = sceneElements;
    let plan: ReturnType<typeof planChartPages> | null = null;

    // a chart spread over pages goes on the pages that follow, made when missing
    if (fit === "spread" && pageId && pages.length) {
      plan = planChartPages({
        pages,
        currentPageId: pageId,
        count: check.pages,
      });

      if (plan.created > 0) {
        base = translateContentForPageLayout({
          elements: sceneElements,
          previousPages: pages,
          nextPages: plan.pages,
        });
      }
    }

    const result = applyFlowScript({
      elements: base,
      chartId: chart.chartId,
      preset: builtIn,
      script,
      fit,
      shape,
      custom,
      page: pageRect,
      pageId,
      pageNumber,
      pages: plan ? flowPagesOf(plan) : undefined,
      legacyElementIds: chart.legacyElementIds,
    });

    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }

    // one step: the change and the pages it needed are one undo
    app.api.updateScene({
      elements: result.elements,
      appState: plan && plan.created > 0 ? { pages: plan.pages } : undefined,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    clearFlowScriptDraft(chart.key);

    setMessage({
      kind: "ok",
      text: result.rebuilt
        ? "The chart was made again from the script."
        : `Applied: ${result.kept} kept, ${result.added} added, ${result.removed} removed.`,
    });
  }, [
    app,
    builtIn,
    chart,
    check,
    custom,
    fit,
    pageId,
    pageNumber,
    pageRect,
    pages,
    script,
    shape,
  ]);

  /* ------------------------------------------------------------- the place */

  const placed = usableFlowEditorPlace(place, viewport);
  const follow = flowEditorPosition({ box: chart.box, camera, viewport });
  const at = placed ?? follow;

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

      setPlace(
        clampFlowBarPlace(
          {
            x: press.origin.x + (event.clientX - press.startX),
            y: press.origin.y + (event.clientY - press.startY),
          },
          FLOW_EDITOR_SIZE,
          viewportRef.current,
        ),
      );
    };

    const onUp = () => {
      const press = pressRef.current;

      pressRef.current = null;
      setDragging(false);

      if (press?.moved && placeRef.current) {
        writeFlowEditorPlace(placeRef.current);
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
  }, []);

  const startPress = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    pressRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: at.x, y: at.y },
      moved: false,
    };
  };

  return (
    <div
      ref={panelRef}
      className="excalidraw__flow-editor"
      role="dialog"
      aria-label="Edit script"
      data-testid="flow-editor"
      data-dragging={dragging ? "" : undefined}
      data-flow-editor-placed={placed ? "" : undefined}
      style={{ left: at.x, top: at.y, width: FLOW_EDITOR_SIZE.width }}
      // the panel is not part of the canvas: a click on it is not a click on the scene
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="excalidraw__flow-editor-header">
        <button
          type="button"
          className="excalidraw__flow-editor-grip"
          aria-label="Move the script editor"
          title="Drag to move"
          onPointerDown={startPress}
        >
          <GripIcon />
        </button>
        <strong>Edit script</strong>
        <button
          type="button"
          className="excalidraw__flow-editor-close"
          aria-label="Close the script editor"
          title="Close - what you typed is kept"
          onClick={closeFlowScriptEditor}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="excalidraw__flow-editor-row">
        <label>
          <span>Kind of chart</span>
          <select
            aria-label="Kind of chart"
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
          >
            {choices.list.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Fit</span>
          <select
            aria-label="Fit mode"
            value={fit}
            onChange={(event) => setFit(event.target.value as FlowFitMode)}
          >
            {FLOW_FIT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {FIT_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Shape</span>
          <select
            aria-label="Node shape"
            value={shape}
            onChange={(event) => setShape(event.target.value as FlowChartShape)}
          >
            {(["own", ...FLOW_NODE_SHAPES] as FlowChartShape[]).map((s) => (
              <option key={s} value={s}>
                {SHAPE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <textarea
        className="excalidraw__flow-editor-script"
        aria-label="Script"
        rows={10}
        value={script}
        spellCheck={false}
        onChange={(event) => {
          setScript(event.target.value);
          setMessage(null);
        }}
        // the canvas has single-key shortcuts; typing a script must not use them
        onKeyDown={(event) => event.stopPropagation()}
      />

      <div className="excalidraw__flow-editor-check" aria-live="polite">
        {check.problems.length > 0 ? (
          <ul aria-label="Problems">
            {check.problems.map((problem, index) => (
              <li key={index} data-line={problem.line}>
                Line {problem.line}: {problem.message}
              </li>
            ))}
          </ul>
        ) : null}
        <p data-testid="flow-editor-counts">
          {check.nodes} nodes, {check.arrows} arrows
          {check.fontSize !== null ? `, text size ${check.fontSize}` : ""}
          {check.pages > 1 ? `, ${check.pages} pages` : ""}
        </p>
        {!check.ok && check.reason && check.problems.length === 0 ? (
          <p className="excalidraw__flow-editor-reason" role="alert">
            {check.reason}
          </p>
        ) : null}
      </div>

      <div className="excalidraw__flow-editor-footer">
        <button
          type="button"
          className="excalidraw__flow-editor-apply"
          disabled={!check.ok}
          title={
            check.ok ? "Apply the script to the chart" : check.reason ?? ""
          }
          onClick={apply}
        >
          Apply
        </button>
        {message && (
          <p
            className="excalidraw__flow-editor-message"
            data-kind={message.kind}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
};
