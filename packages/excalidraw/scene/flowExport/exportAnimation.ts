/**
 * Exports the animation of a chart as a file (D-374 to D-379): the one place
 * where the page's own pieces are put together - the chart's elements, the
 * canvas export that draws them, the animation's settings, the frame source and
 * the runner - and a file comes out.
 */

import { arrayToMap } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getPapersForExport } from "../../data";
import { restoreAppState } from "../../data/restore";
import { exportToCanvas } from "../export";
import { arrowLooksFor, elementForCanvas } from "../flowArrowLooks";
import { chartScaleOf } from "../flowScale";

import { createFrameSource, createVideoEncoder } from "./browser";
import { chartToExport } from "./chart";
import { FLOW_EXPORT_FORMATS, exportSizeOf, placeChart } from "./plan";
import { runFlowExport } from "./runner";

import type { AppState, BinaryFiles } from "../../types";
import type { FlowLook } from "../flowLook";
import type { FlowGraph, FlowStep } from "../flowOrder";
import type { FlowArrowStyle, FlowNodeStyle } from "../flowStyles";
import type { FlowExportFormat, FlowExportShape } from "./plan";

/** what the person chose in the panel */
export type FlowExportOptions = {
  format: FlowExportFormat;
  fps: number;
  /** the longest side of the picture, in pixels */
  longest: number;
  shape: FlowExportShape;
  /** on the page's own background, or without one (MP4 always has it) */
  withBackground: boolean;
};

/** the animation as it is set now: the bar's own settings */
export type FlowExportAnimation = FlowLook & {
  durationMs: number;
  nodeStyle: FlowNodeStyle;
  arrowStyle: FlowArrowStyle;
  speed: number;
};

export type FlowExportResult = {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
};

export const exportFlowAnimation = async (input: {
  graph: FlowGraph;
  steps: readonly FlowStep[];
  elements: readonly ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
  animation: FlowExportAnimation;
  options: FlowExportOptions;
  /** the name of the file, without its ending */
  name: string;
  onProgress: (done: number, total: number) => void;
  isStopped: () => boolean;
}): Promise<FlowExportResult> => {
  const { graph, steps, elements, appState, files, animation, options } = input;
  const chart = chartToExport(graph, steps, elements);

  if (!chart) {
    throw new Error("There is nothing of the chart to draw.");
  }

  // MP4 cannot be transparent: it is always on the page's background
  const withBackground =
    options.format === "mp4" ? true : options.withBackground;

  // the arrows the look hides or recolours are given to the canvas as the
  // animation gives them: without, or in the colour
  const looks = new Map(arrowLooksFor(graph, animation));
  const drawn = chart.elements
    .map((element) => elementForCanvas(element, looks))
    .filter((element): element is ExcalidrawElement => element !== null);

  const size = exportSizeOf(chart.box, options.shape, options.longest);
  const place = placeChart(chart.box, size);

  // the part of the page the picture is: the chart, centred, with its margin
  const rect = {
    x: -place.offsetX / place.scale,
    y: -place.offsetY / place.scale,
    width: size.width / place.scale,
    height: size.height / place.scale,
  };

  const restored = restoreAppState(
    {
      ...appState,
      exportBackground: withBackground,
      exportWithDarkMode: false,
      exportScale: place.scale,
    },
    null,
  );

  const base = await exportToCanvas(
    drawn as never,
    { ...restored, offsetTop: 0, offsetLeft: 0, width: 0, height: 0 },
    files,
    {
      exportBackground: withBackground,
      viewBackgroundColor: restored.viewBackgroundColor,
      pageRect: rect,
      // the page's paper is part of the background, and goes with it
      pagePapers: withBackground
        ? getPapersForExport(drawn as never, restored)
        : [],
      framePapers: true,
    },
    (width: number, height: number) => {
      const canvas = document.createElement("canvas");

      canvas.width = size.width;
      canvas.height = size.height;
      void width;
      void height;

      return { canvas, scale: place.scale };
    },
  );

  const elementsMap = arrayToMap(elements);

  const source = createFrameSource({
    base,
    scene: {
      steps,
      graph,
      elementsMap: elementsMap as never,
      arrowStyle: animation.arrowStyle,
      nodeStyle: animation.nodeStyle,
      look: animation,
      speed: animation.speed,
      durationMs: animation.durationMs,
      chartScale: chartScaleOf(graph, elementsMap as never),
    },
    transform: place,
    size,
  });

  const bytes = await runFlowExport({
    format: options.format,
    fps: options.fps,
    stepCount: steps.length,
    durationMs: animation.durationMs,
    withBackground,
    source,
    video: createVideoEncoder(),
    onProgress: input.onProgress,
    isStopped: input.isStopped,
  });

  const format = FLOW_EXPORT_FORMATS.find(
    (each) => each.id === options.format,
  )!;

  return {
    blob: new Blob([bytes as BlobPart], { type: format.mime }),
    filename: `${input.name || "animation"}.${format.extension}`,
    width: size.width,
    height: size.height,
  };
};
