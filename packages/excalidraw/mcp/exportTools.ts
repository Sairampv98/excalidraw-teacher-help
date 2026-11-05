/**
 * The bytes of the files the page makes (D-438): the animation of a chart, and
 * the handout of the document's pages.
 *
 * The page makes the bytes and the **server** writes them into an allowed
 * folder - the mirror image of the other way round, where the server sends
 * bytes and the page puts them on a page. So what is here is what the server
 * asks the page for, and the tools the assistant sees are the server's own.
 *
 * The bytes travel in **one** message, and a message has a size: a file over
 * 20 MB is refused here, with the reason, before anything is made.
 *
 * Nothing is a second set of rules: the animation is made by the same exporter
 * the Flow tab's panel uses, and the handout by the same writer the app's own
 * "export all pages" uses - so the file the assistant writes is the file the
 * teacher would have got.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { flowAnimationStateAtom } from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { chartElementsOf, readChartId } from "../scene/flowChart";
import { createVideoEncoder, webpSupport } from "../scene/flowExport/browser";
import { chartToExport, refreshSteps } from "../scene/flowExport/chart";
import { exportFlowAnimation } from "../scene/flowExport/exportAnimation";
import {
  FLOW_EXPORT_DEFAULT_SIZE,
  FLOW_EXPORT_FORMATS,
  FLOW_EXPORT_MAX_MS,
  FLOW_EXPORT_SHAPES,
  FLOW_EXPORT_SIZES,
  exportProblem,
  exportSizeOf,
  fpsChoicesOf,
} from "../scene/flowExport/plan";
import { flowOfSelection } from "../scene/flowSelection";
import { buildPagesPdf } from "../scene/pdf";

import { MCP_MAX_EXPORT_BYTES, exportTooLargeMessage } from "./protocol";

import {
  allPages,
  argsOf,
  fail,
  readBoolean,
  readInteger,
  readString,
} from "./common";

import type {
  FlowExportFormat,
  FlowExportShape,
} from "../scene/flowExport/plan";
import type { FlowGraph } from "../scene/flowOrder";
import type { McpApp } from "./common";

/** the rate an export starts at when the caller does not say */
const DEFAULT_FPS = 10;

/** the name an animation gets when the document has none */
const DEFAULT_ANIMATION_NAME = "animation";

/** the name a handout gets when neither the caller nor the document has one */
const DEFAULT_HANDOUT_NAME = "handout";

/**
 * The bytes as text, in pieces: a whole 20 MB in one `String.fromCharCode`
 * would be a call with twenty million arguments, and no browser would answer it.
 */
const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const PIECE = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += PIECE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + PIECE));
  }

  return btoa(binary);
};

/** a file name the disk will take, from the document's own name */
const slugOf = (value: string | null | undefined, fallback: string) =>
  (value ?? "")
    .trim()
    .replace(/[^\w\d\-. ]+/g, "")
    .replace(/\s+/g, "-") || fallback;

/* ---------------------------------------------------------------- the limits */

/**
 * A file that is too big to travel from the page to the server in one message
 * is refused here, with the reason, before it is sent (D-438).
 *
 * The server refuses the same file with the same words, so the two halves of
 * the answer are one answer.
 */
export const refuseTooLarge = (bytes: number): void => {
  if (bytes > MCP_MAX_EXPORT_BYTES) {
    fail("too-large", exportTooLargeMessage(bytes));
  }
};

/* ---------------------------------------------------------------- the options */

const formatOf = (value: string | undefined): FlowExportFormat => {
  if (value === undefined) {
    return "gif";
  }

  const format = FLOW_EXPORT_FORMATS.find((each) => each.id === value);

  return (
    format?.id ??
    fail(
      "bad-arguments",
      `format must be one of ${FLOW_EXPORT_FORMATS.map((each) => each.id).join(
        ", ",
      )}.`,
    )
  );
};

const fpsOf = (value: number | undefined, format: FlowExportFormat): number => {
  if (value === undefined) {
    return DEFAULT_FPS;
  }

  const choices = fpsChoicesOf(format);

  return choices.includes(value)
    ? value
    : fail(
        "bad-arguments",
        `fps must be one of ${choices.join(
          ", ",
        )} for a ${format.toUpperCase()}.`,
      );
};

const sizeOf = (value: number | undefined): number => {
  if (value === undefined) {
    return FLOW_EXPORT_DEFAULT_SIZE;
  }

  return FLOW_EXPORT_SIZES.includes(value)
    ? value
    : fail(
        "bad-arguments",
        `size must be one of ${FLOW_EXPORT_SIZES.join(", ")} pixels.`,
      );
};

const shapeOf = (value: string | undefined): FlowExportShape => {
  if (value === undefined) {
    return "chart";
  }

  const shape = FLOW_EXPORT_SHAPES.find((each) => each.id === value);

  return (
    shape?.id ??
    fail(
      "bad-arguments",
      `shape must be one of ${FLOW_EXPORT_SHAPES.map((each) => each.id).join(
        ", ",
      )}.`,
    )
  );
};

/** the page numbers a call names, from 1 as the person sees them */
const readPages = (
  args: Record<string, unknown>,
  key: string,
): number[] | undefined => {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    !value.every(
      (number) =>
        typeof number === "number" && Number.isInteger(number) && number >= 1,
    )
  ) {
    return fail(
      "bad-arguments",
      `${key} must be a list of page numbers, from 1 as the person sees them.`,
    );
  }

  return value as number[];
};

/* ---------------------------------------------------------------- the charts */

const chartIdsOf = (elements: readonly ExcalidrawElement[]): string[] => {
  const ids = new Set<string>();

  for (const element of elements) {
    const id = readChartId(element);

    if (id) {
      ids.add(id);
    }
  }

  return [...ids];
};

/**
 * Whether this browser can write the format at all (D-378).
 *
 * A GIF needs nothing of the browser: it is written here. A WebP and an MP4 are
 * the browser's own, so the browser is asked the way the Flow tab's panel asks
 * it, and a browser that cannot is refused with the reason.
 */
const mayWrite = async (
  format: FlowExportFormat,
  size: { width: number; height: number },
  fps: number,
) => {
  if (format === "webp") {
    const webp = await webpSupport();

    if (!webp) {
      return fail("bad-arguments", "This browser cannot write WebP pictures.");
    }

    return;
  }

  if (format === "mp4") {
    const encoder = createVideoEncoder();

    if (!encoder) {
      return fail("bad-arguments", "This browser cannot write MP4 video.");
    }

    const support = await encoder.support(
      size.width || 2,
      size.height || 2,
      fps,
    );

    if (!support.supported) {
      return fail("bad-arguments", support.reason);
    }
  }
};

/** the steps of a chart, read with the editor's own reader */
const graphOf = (
  app: McpApp,
  members: readonly ExcalidrawElement[],
  elements: readonly ExcalidrawElement[],
): FlowGraph | null => {
  const selected: Record<string, boolean> = {};

  for (const member of members) {
    selected[member.id] = true;
  }

  return flowOfSelection(
    selected,
    elements,
    app.scene.getElementsMapIncludingDeleted(),
  );
};

/**
 * The chart an export means: the one it names, the one that is selected, or -
 * when there is only one - the only chart of the document.
 */
const chartOf = (
  app: McpApp,
  chartId: string | undefined,
): { chartId: string; graph: FlowGraph | null } => {
  const elements = app.scene.getNonDeletedElements() as ExcalidrawElement[];

  if (chartId !== undefined) {
    const members = chartElementsOf(chartId, elements);

    if (!members.length) {
      return fail(
        "not-found",
        `No chart ${chartId}. list_flow_charts lists the charts.`,
      );
    }

    return { chartId, graph: graphOf(app, members, elements) };
  }

  // the chart that is selected, if the selection is one chart
  const selected = app.state.selectedElementIds;
  const chosen = new Set<string>();

  for (const element of elements) {
    if (!selected[element.id]) {
      continue;
    }

    const id = readChartId(element);

    if (id) {
      chosen.add(id);
    }
  }

  if (chosen.size === 1) {
    const id = [...chosen][0];

    return {
      chartId: id,
      graph: graphOf(app, chartElementsOf(id, elements), elements),
    };
  }

  // the only chart of the document
  const ids = chartIdsOf(elements);

  if (ids.length === 1) {
    const id = ids[0];

    return {
      chartId: id,
      graph: graphOf(app, chartElementsOf(id, elements), elements),
    };
  }

  return fail(
    "not-found",
    ids.length
      ? `There are ${ids.length} charts; name the one to export with chartId. list_flow_charts lists them.`
      : "There is no chart to export. list_flow_charts lists the charts.",
  );
};

/* --------------------------------------------------------------- the answers */

/**
 * The animation of a chart, as the bytes of the file (D-438).
 *
 * The file is made by the Flow tab's own exporter, so it is the same picture and
 * the same bytes the teacher would get from the panel.
 */
export const exportAnimationBytes = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const format = formatOf(readString(args, "format"));
  const fps = fpsOf(readInteger(args, "fps"), format);
  const longest = sizeOf(readInteger(args, "size"));
  const shape = shapeOf(readString(args, "shape"));
  const withBackground = readBoolean(args, "withBackground") ?? true;
  const camera = readBoolean(args, "camera") ?? false;

  const chart = chartOf(app, readString(args, "chartId"));

  if (!chart.graph || !chart.graph.steps.length) {
    return fail(
      "failed",
      `The chart ${chart.chartId} has no steps to walk. A chart of one shape has nothing to play.`,
    );
  }

  const state = editorJotaiStore.get(flowAnimationStateAtom);
  const steps = chart.graph.steps.length;
  const lengthMs = steps * state.durationMs;

  if (state.durationMs <= 0) {
    return fail("bad-arguments", "The animation has no length.");
  }

  // an animation that is longer than the most that may be made is refused
  // with the reason, before anything is drawn (D-438)
  if (lengthMs > FLOW_EXPORT_MAX_MS) {
    return fail(
      "too-large",
      `The animation would run ${Math.round(
        lengthMs / 1000,
      )} seconds; the most that can be made is ${Math.round(
        FLOW_EXPORT_MAX_MS / 1000,
      )} seconds. Choose a chart with fewer steps, or shorter steps.`,
    );
  }

  // the panel's own rule: too many pictures for the rate that was asked for
  const problem = exportProblem({
    stepCount: steps,
    durationMs: state.durationMs,
    fps,
  });

  if (problem) {
    return fail("too-large", problem);
  }

  const elements = app.scene.getNonDeletedElements();
  const chartBox = chartToExport(
    chart.graph,
    refreshSteps(chart.graph.steps, elements),
    elements,
  );

  if (!chartBox) {
    return fail("failed", "There is nothing of the chart to draw.");
  }

  // a format this browser cannot write is refused with the reason, as the
  // Flow tab's panel refuses it (D-378)
  await mayWrite(format, exportSizeOf(chartBox.box, shape, longest), fps);

  const name = slugOf(app.state.name, DEFAULT_ANIMATION_NAME);

  const result = await exportFlowAnimation({
    graph: chart.graph,
    steps: chart.graph.steps,
    elements,
    appState: app.state,
    files: app.files,
    animation: {
      nodeColor: state.nodeColor,
      textColor: state.textColor,
      markColor: state.markColor,
      arrowColor: state.arrowColor,
      hideArrow: state.hideArrow,
      glowShape: state.glowShape,
      glowText: state.glowText,
      glowMark: state.glowMark,
      glowArrow: state.glowArrow,
      nodeTarget: state.nodeTarget,
      durationMs: state.durationMs,
      nodeStyle: state.nodeStyle,
      arrowStyle: state.arrowStyle,
      speed: state.speed,
    },
    options: { format, fps, longest, shape, withBackground, camera },
    name,
    onProgress: () => undefined,
    isStopped: () => false,
  });

  // the exporter has the bytes in its hand already, so they are taken from
  // there rather than read back out of the blob (D-438)
  const bytes = result.bytes;

  refuseTooLarge(bytes.length);

  return {
    data: toBase64(bytes),
    mimeType: FLOW_EXPORT_FORMATS.find((each) => each.id === format)!.mime,
    filename: result.filename,
    width: result.width,
    height: result.height,
    bytes: bytes.length,
    steps: chart.graph.steps.length,
    chartId: chart.chartId,
    format,
  };
};

/**
 * The handout of the document's pages, as the bytes of one PDF (D-438).
 *
 * Every page is drawn at its own size, with its own frame and number, and the
 * pages are put in one file - the very file the app's own "export all pages"
 * makes.
 */
export const exportHandoutBytes = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const asked = readPages(args, "pages");
  const name = slugOf(
    readString(args, "name") ?? app.state.name,
    DEFAULT_HANDOUT_NAME,
  );
  const pages = allPages(app);

  const chosen =
    asked === undefined
      ? pages
      : asked.map(
          (number) =>
            pages[number - 1] ??
            fail(
              "not-found",
              `There is no page ${number}; the document has ${pages.length}.`,
            ),
        );

  const pdf = await buildPagesPdf({
    elements: app.scene.getNonDeletedElements(),
    appState: app.state,
    files: app.files,
    pages: chosen.map((entry) => entry.page),
  });

  refuseTooLarge(pdf.length);

  return {
    data: toBase64(pdf),
    mimeType: "application/pdf",
    filename: `${name}.pdf`,
    bytes: pdf.length,
    pages: chosen.length,
    pageNumbers: chosen.map((entry) => entry.number),
  };
};
