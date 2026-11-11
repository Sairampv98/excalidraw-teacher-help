import React, { useEffect, useRef, useState } from "react";

import { arrayToMap } from "@excalidraw/common";

import type { ElementsMap, ExcalidrawElement } from "@excalidraw/element/types";

import { exportToCanvas } from "../../scene/export";
import { arrowLooksFor, elementForCanvas } from "../../scene/flowArrowLooks";
import { chartToExport, refreshSteps } from "../../scene/flowExport/chart";
import { drawFlowFrame } from "../../scene/flowExport/compose";
import { sceneRectOf } from "../../scene/flowExport/camera";
import { placeChart } from "../../scene/flowExport/plan";
import { chartScaleOf } from "../../scene/flowScale";

import type { FlowExportAnimation } from "../../scene/flowExport/exportAnimation";
import type { FlowGraph } from "../../scene/flowOrder";
import type { AppState, BinaryFiles } from "../../types";

const SIZE = { width: 480, height: 300 };

/** D-537: a private scene/camera, the canvas renderer and the export's animation oracle.
 * The base is rendered only when inputs change; moving overlays run at 15 fps.
 */
export const FlowChartPreview = React.memo(
  ({
    elements,
    graph,
    appState,
    files,
    animation,
    loop = false,
  }: {
    elements: readonly ExcalidrawElement[];
    graph: FlowGraph;
    appState: AppState;
    files: BinaryFiles;
    animation: FlowExportAnimation;
    loop?: boolean;
  }) => {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState<string | null>(null);
    const background = appState.viewBackgroundColor;
    useEffect(() => {
      let disposed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const steps = refreshSteps(graph.steps, elements);
      const chart = chartToExport(graph, steps, elements);
      setError(null);
      if (!chart) {
        setError("There is nothing to preview. Add a node to this chart.");
        return;
      }
      const transform = placeChart(chart.box, SIZE);
      const looks = new Map(arrowLooksFor(graph, animation));
      const drawn = chart.elements
        .map((element) => elementForCanvas(element, looks))
        .filter((element): element is ExcalidrawElement => element !== null);
      const elementsMap = arrayToMap(elements) as ElementsMap;
      const scene = {
        steps,
        graph,
        elementsMap,
        arrowStyle: animation.arrowStyle,
        nodeStyle: animation.nodeStyle,
        look: animation,
        speed: animation.speed,
        durationMs: Math.max(100, animation.durationMs),
        chartScale: chartScaleOf(graph, elementsMap),
      };
      void exportToCanvas(
        drawn as never,
        {
          ...appState,
          exportWithDarkMode: false,
          offsetTop: 0,
          offsetLeft: 0,
          width: 0,
          height: 0,
        },
        files,
        {
          exportBackground: true,
          viewBackgroundColor: background,
          pageRect: sceneRectOf(transform, SIZE),
        },
        () => {
          const base = document.createElement("canvas");
          base.width = SIZE.width;
          base.height = SIZE.height;
          return { canvas: base, scale: transform.scale };
        },
      )
        .then((base) => {
          if (disposed) {
            return;
          }
          const ctx = canvas.current?.getContext("2d");
          if (!ctx) {
            return;
          }
          const started = performance.now();
          const draw = () => {
            const time = loop
              ? (performance.now() - started + 400) %
                (steps.length * scene.durationMs)
              : 400;
            drawFlowFrame(ctx, scene, time, transform, base, SIZE);
          };
          draw();
          if (
            loop &&
            (animation.nodeStyle !== "none" || animation.arrowStyle !== "none")
          ) {
            timer = setInterval(() => {
              if (!document.hidden) {
                draw();
              }
            }, 1000 / 15);
          }
        })
        .catch(() => {
          if (!disposed) {
            setError(
              "The preview could not be drawn. Close this window and open it again.",
            );
          }
        });
      return () => {
        disposed = true;
        clearInterval(timer);
      };
      // Camera and selection changes on the board must not redraw this private view.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [elements, graph, files, animation, loop, background]);
    return (
      <figure className="flow-chart-preview">
        <canvas
          ref={canvas}
          width={SIZE.width}
          height={SIZE.height}
          role="img"
          aria-label="Chart preview"
        />
        <figcaption>
          {error ??
            (loop
              ? "Animation preview loops here; the board stays unchanged."
              : "Preview of the whole chart.")}
        </figcaption>
      </figure>
    );
  },
);
