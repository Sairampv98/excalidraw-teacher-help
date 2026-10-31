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
import { flightTransformAt, sceneRectOf } from "./camera";
import { chartToExport, refreshSteps } from "./chart";
import { FLOW_EXPORT_FORMATS, exportSizeOf, placeChart } from "./plan";
import {
  animatedFileIdsOf,
  atMoment,
  loadAnimatedMedia,
  mediaStateAt,
} from "./media";
import { runFlowExport } from "./runner";

import type { AppClassProperties, AppState, BinaryFiles } from "../../types";
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
  /** the picture flies to each step, as the view does with the camera on (D-385) */
  camera: boolean;
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
  const { graph, elements, appState, files, animation, options } = input;
  // the steps as they are on the page now, not as they were when the chart was read
  const steps = refreshSteps(input.steps, elements);
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

  const restored = restoreAppState(
    {
      ...appState,
      exportBackground: withBackground,
      exportWithDarkMode: false,
      exportScale: place.scale,
    },
    null,
  );

  // the page's paper is part of the background, and goes with it
  const pagePapers = withBackground
    ? getPapersForExport(drawn as never, restored)
    : [];

  // the GIFs and animated WebPs of the chart, read frame by frame, so each
  // picture of the file shows the frame that belongs to it (D-391)
  const media = await loadAnimatedMedia(animatedFileIdsOf(drawn, files), files);
  // the pictures the canvas has loaded, kept from one picture of the file to
  // the next, so only a frame it has not seen is loaded
  const imageCache: AppClassProperties["imageCache"] = new Map();

  /**
   * The chart as the canvas draws it, seen by a camera: the part of the page the
   * picture is, and the scale. With the camera still and nothing moving in it it
   * is drawn once; otherwise it is drawn again when a picture needs it (D-385,
   * D-391).
   */
  const renderBase = async (
    camera: {
      scale: number;
      offsetX: number;
      offsetY: number;
    },
    timeMs = 0,
  ) => {
    const moment = await atMoment(drawn, files, media, timeMs);

    return exportToCanvas(
      moment.elements as never,
      { ...restored, offsetTop: 0, offsetLeft: 0, width: 0, height: 0 },
      moment.files,
      {
        exportBackground: withBackground,
        viewBackgroundColor: restored.viewBackgroundColor,
        pageRect: sceneRectOf(camera, size),
        pagePapers,
        framePapers: true,
        imageCache,
      },
      () => {
        const canvas = document.createElement("canvas");

        canvas.width = size.width;
        canvas.height = size.height;

        return { canvas, scale: camera.scale };
      },
    );
  };

  const base = options.camera || media.length ? null : await renderBase(place);

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
    view:
      options.camera || media.length
        ? {
            transformAt: options.camera
              ? (timeMs) =>
                  flightTransformAt({
                    steps,
                    durationMs: animation.durationMs,
                    timeMs,
                    picture: size,
                    chart: chart.box,
                  })
              : undefined,
            stateAt: media.length
              ? (timeMs) => mediaStateAt(media, timeMs)
              : undefined,
            renderBase,
          }
        : undefined,
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
