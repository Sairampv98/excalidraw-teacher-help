import React, { useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { useAtomValue } from "../editor-jotai";
import { chartToExport } from "../scene/flowExport/chart";
import { webpSupport, createVideoEncoder } from "../scene/flowExport/browser";
import { exportFlowAnimation } from "../scene/flowExport/exportAnimation";
import { animatedFileIdsOf, canReadFrames } from "../scene/flowExport/media";
import {
  FLOW_EXPORT_DEFAULT_FPS,
  FLOW_EXPORT_DEFAULT_SIZE,
  FLOW_EXPORT_FORMATS,
  FLOW_EXPORT_SHAPES,
  FLOW_EXPORT_SIZES,
  backgroundChoicesOf,
  clampFps,
  clampStepMs,
  exportLengthMs,
  exportProblem,
  exportSizeOf,
  fpsChoicesOf,
  frameCountOf,
  sizeHint,
} from "../scene/flowExport/plan";
import { FlowExportStopped } from "../scene/flowExport/runner";
import { FLOW_ARROW_STYLES, FLOW_NODE_STYLES } from "../scene/flowStyles";

import { flowAnimationStateAtom } from "./FlowAnimationState";

import "./FlowExportPanel.scss";

import type { FlowGraph } from "../scene/flowOrder";
import type { FlowExportOptions } from "../scene/flowExport/exportAnimation";
import type { FlowExportFormat } from "../scene/flowExport/plan";
import type { AppClassProperties } from "../types";

export const FLOW_EXPORT_STORAGE_KEY = "excalidraw-flow-export-options";

const DEFAULT_OPTIONS: FlowExportOptions = {
  format: "gif",
  fps: FLOW_EXPORT_DEFAULT_FPS.gif,
  longest: FLOW_EXPORT_DEFAULT_SIZE,
  shape: "chart",
  withBackground: true,
  camera: false,
};

/** what the browser's storage holds, kept to what is valid; never throws */
const readOptions = (): FlowExportOptions => {
  try {
    const raw = window.localStorage.getItem(FLOW_EXPORT_STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : null;

    if (!stored || typeof stored !== "object") {
      return DEFAULT_OPTIONS;
    }

    const format = FLOW_EXPORT_FORMATS.some((f) => f.id === stored.format)
      ? (stored.format as FlowExportFormat)
      : DEFAULT_OPTIONS.format;

    return {
      format,
      fps: clampFps(format, Number(stored.fps)),
      longest: FLOW_EXPORT_SIZES.includes(stored.longest)
        ? stored.longest
        : DEFAULT_OPTIONS.longest,
      shape: FLOW_EXPORT_SHAPES.some((s) => s.id === stored.shape)
        ? stored.shape
        : DEFAULT_OPTIONS.shape,
      withBackground:
        typeof stored.withBackground === "boolean"
          ? stored.withBackground
          : DEFAULT_OPTIONS.withBackground,
      // the camera is the bar's own setting each time the panel opens
      camera: false,
    };
  } catch {
    return DEFAULT_OPTIONS;
  }
};

const writeOptions = (options: FlowExportOptions) => {
  try {
    window.localStorage.setItem(
      FLOW_EXPORT_STORAGE_KEY,
      JSON.stringify(options),
    );
  } catch {
    // the choice is only a convenience
  }
};

type Props = {
  app: AppClassProperties;
  graph: FlowGraph;
  elements: readonly ExcalidrawElement[];
  onClose: () => void;
  /** in the flow of a window, and not floating over the bar (D-388) */
  inline?: boolean;
};

/**
 * The panel that exports the chart's animation as a GIF, a WebP or an MP4
 * (D-374 to D-379). It says what the file will be before it is made, offers
 * only what this browser can write, shows how far it is, and can be stopped.
 */
export const FlowExportPanel = ({
  app,
  graph,
  elements,
  onClose,
  inline,
}: Props) => {
  const state = useAtomValue(flowAnimationStateAtom);
  const [options, setOptions] = useState<FlowExportOptions>(() => ({
    ...readOptions(),
    camera: state.camera,
  }));
  // what is animated in the file: the bar's settings to begin with, and the
  // export's own from then on - the bar is not changed (D-390)
  const [animation, setAnimation] = useState(() => ({
    nodeStyle: state.nodeStyle,
    arrowStyle: state.arrowStyle,
    durationMs: state.durationMs,
  }));
  const [webp, setWebp] = useState<boolean | null>(null);
  const [video, setVideo] = useState<
    { supported: true } | { supported: false; reason: string } | null
  >(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const stopped = useRef(false);

  const steps = graph.steps;
  const chart = useMemo(
    () => chartToExport(graph, steps, elements),
    [graph, steps, elements],
  );
  const size = useMemo(
    () =>
      chart
        ? exportSizeOf(chart.box, options.shape, options.longest)
        : { width: 0, height: 0 },
    [chart, options.shape, options.longest],
  );

  const lengthMs = exportLengthMs(steps.length, animation.durationMs);
  const frames = frameCountOf(lengthMs, options.fps);
  const problem = exportProblem({
    stepCount: steps.length,
    durationMs: animation.durationMs,
    fps: options.fps,
  });
  // the GIFs and animated WebPs in the chart: they play in the file where this
  // browser can read their frames (D-391)
  const movingPictures = useMemo(
    () => (chart ? animatedFileIdsOf(chart.elements, app.files).length : 0),
    [chart, app.files],
  );
  const picturesPlay = movingPictures > 0 && canReadFrames();
  // nothing moves: no highlight, nothing along the arrows, no camera, no GIF
  const nothingMoves =
    animation.nodeStyle === "none" &&
    animation.arrowStyle === "none" &&
    !options.camera &&
    !picturesPlay;
  const background = backgroundChoicesOf(options.format);
  const running = progress !== null;

  // what this browser can write, asked before anything is offered (D-378)
  useEffect(() => {
    let alive = true;

    void webpSupport().then((ok) => alive && setWebp(ok));

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const encoder = createVideoEncoder();

    if (!encoder) {
      setVideo({
        supported: false,
        reason: "This browser cannot write MP4 video.",
      });

      return;
    }

    setVideo(null);
    void encoder
      .support(size.width || 2, size.height || 2, options.fps)
      .then((result) => alive && setVideo(result));

    return () => {
      alive = false;
    };
  }, [size.width, size.height, options.fps]);

  const change = (patch: Partial<FlowExportOptions>) => {
    setOptions((current) => {
      const next = { ...current, ...patch };

      // a format that does not offer the rate has the nearest one it does
      next.fps = clampFps(next.format, next.fps);

      if (patch.format && patch.format !== current.format) {
        next.fps = FLOW_EXPORT_DEFAULT_FPS[patch.format];
      }

      writeOptions(next);

      return next;
    });
    setSaved(null);
    setError(null);
  };

  const unavailable =
    options.format === "webp" && webp === false
      ? "This browser cannot write WebP pictures."
      : options.format === "mp4" && video && !video.supported
      ? video.reason
      : null;

  const waiting =
    (options.format === "webp" && webp === null) ||
    (options.format === "mp4" && video === null);

  const go = async () => {
    stopped.current = false;
    setError(null);
    setSaved(null);
    setProgress({ done: 0, total: frames });

    try {
      const result = await exportFlowAnimation({
        graph,
        steps,
        elements,
        appState: app.state,
        files: app.files,
        animation: { ...state, ...animation },
        options,
        name: app.state.name || "animation",
        onProgress: (done, total) => setProgress({ done, total }),
        isStopped: () => stopped.current,
      });

      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      setSaved(
        `${result.filename} - ${result.width}x${result.height}, ${Math.max(
          1,
          Math.round(result.blob.size / 1024),
        )} KB`,
      );
    } catch (failure) {
      if (!(failure instanceof FlowExportStopped)) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setProgress(null);
    }
  };

  return (
    <div
      className={`excalidraw__flow-export${
        inline ? " excalidraw__flow-export--inline" : ""
      }`}
      data-testid="flow-export-panel"
      role="dialog"
      aria-label="Export the animation"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="excalidraw__flow-export-row"
        role="group"
        aria-label="Format"
      >
        {FLOW_EXPORT_FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            data-testid={`flow-export-format-${format.id}`}
            aria-pressed={options.format === format.id}
            disabled={running}
            onClick={() => change({ format: format.id })}
          >
            {format.label}
          </button>
        ))}
      </div>

      <div className="excalidraw__flow-export-row">
        <label>
          <span>Nodes</span>
          <select
            data-testid="flow-export-nodes"
            value={animation.nodeStyle}
            disabled={running}
            onChange={(event) =>
              setAnimation((current) => ({
                ...current,
                nodeStyle: event.target.value as typeof current.nodeStyle,
              }))
            }
          >
            {FLOW_NODE_STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Arrows</span>
          <select
            data-testid="flow-export-arrows"
            value={animation.arrowStyle}
            disabled={running}
            onChange={(event) =>
              setAnimation((current) => ({
                ...current,
                arrowStyle: event.target.value as typeof current.arrowStyle,
              }))
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
          <span>Step (ms)</span>
          <input
            type="number"
            data-testid="flow-export-step"
            min={100}
            max={60000}
            step={100}
            value={animation.durationMs}
            disabled={running}
            onChange={(event) =>
              setAnimation((current) => ({
                ...current,
                durationMs: clampStepMs(Number(event.target.value)),
              }))
            }
          />
        </label>
      </div>

      <div className="excalidraw__flow-export-row">
        <label>
          <span>Frames a second</span>
          <select
            data-testid="flow-export-fps"
            value={options.fps}
            disabled={running}
            onChange={(event) => change({ fps: Number(event.target.value) })}
          >
            {fpsChoicesOf(options.format).map((fps) => (
              <option key={fps} value={fps}>
                {fps}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Size</span>
          <select
            data-testid="flow-export-size"
            value={options.longest}
            disabled={running}
            onChange={(event) =>
              change({ longest: Number(event.target.value) })
            }
          >
            {FLOW_EXPORT_SIZES.map((longest) => (
              <option key={longest} value={longest}>
                {longest} px
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Shape</span>
          <select
            data-testid="flow-export-shape"
            value={options.shape}
            disabled={running}
            onChange={(event) =>
              change({
                shape: event.target.value as FlowExportOptions["shape"],
              })
            }
          >
            {FLOW_EXPORT_SHAPES.map((shape) => (
              <option key={shape.id} value={shape.id}>
                {shape.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label
        className="excalidraw__flow-export-check"
        title={background.transparent ? undefined : background.reason}
      >
        <input
          type="checkbox"
          data-testid="flow-export-background"
          checked={background.transparent ? options.withBackground : true}
          disabled={running || !background.transparent}
          onChange={(event) => change({ withBackground: event.target.checked })}
        />
        <span>On the page's background</span>
        {!background.transparent && (
          <em data-testid="flow-export-background-note">{background.reason}</em>
        )}
      </label>

      <label
        className="excalidraw__flow-export-check"
        title="The picture zooms to each step, as the view does when the camera is on"
      >
        <input
          type="checkbox"
          data-testid="flow-export-camera"
          checked={options.camera}
          disabled={running}
          onChange={(event) => change({ camera: event.target.checked })}
        />
        <span>Fly the camera to each step</span>
      </label>

      <p
        className="excalidraw__flow-export-note"
        data-testid="flow-export-note"
      >
        {problem ??
          `${(lengthMs / 1000).toFixed(1)} s, ${frames} pictures, ${
            size.width
          }x${size.height}`}
      </p>

      {nothingMoves && (
        <p
          className="excalidraw__flow-export-hint"
          data-testid="flow-export-still"
        >
          Nothing is animated: the file would be one picture. Choose a highlight
          for the nodes, something along the arrows, or the camera.
        </p>
      )}

      {movingPictures > 0 && (
        <p
          className="excalidraw__flow-export-hint"
          data-testid="flow-export-media"
        >
          {picturesPlay
            ? "The GIFs in the chart play in the file."
            : "This browser cannot read the frames of the GIFs: each one shows a single picture in the file."}
        </p>
      )}

      {!options.camera && chart && sizeHint(size) && (
        <p
          className="excalidraw__flow-export-hint"
          data-testid="flow-export-hint"
        >
          {sizeHint(size)}
        </p>
      )}

      {unavailable && (
        <p
          className="excalidraw__flow-export-problem"
          data-testid="flow-export-problem"
        >
          {unavailable}
        </p>
      )}
      {error && (
        <p
          className="excalidraw__flow-export-problem"
          data-testid="flow-export-error"
        >
          {error}
        </p>
      )}
      {saved && (
        <p
          className="excalidraw__flow-export-saved"
          data-testid="flow-export-saved"
        >
          Saved {saved}
        </p>
      )}

      {running && (
        <progress
          data-testid="flow-export-progress"
          value={progress.done}
          max={Math.max(1, progress.total)}
        />
      )}

      <div className="excalidraw__flow-export-row">
        {running ? (
          <button
            type="button"
            data-testid="flow-export-stop"
            onClick={() => {
              stopped.current = true;
            }}
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            data-testid="flow-export-go"
            disabled={!!problem || !!unavailable || waiting || !chart}
            onClick={() => void go()}
          >
            Export {options.format.toUpperCase()}
          </button>
        )}
        <button type="button" disabled={running} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
};
