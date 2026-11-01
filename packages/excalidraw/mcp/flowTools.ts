/**
 * Flow charts as tools (D-419 to D-423): the kinds, a script checked, a chart made
 * from a script, listed, changed in place and deleted.
 *
 * Nothing here is a second set of rules: the script is read, checked and built
 * by the same modules the Flow tab and the script editor use, so what the
 * assistant makes is what the teacher would make, and the teacher can open it in
 * the script editor and go on.
 */

import { randomId, randomInteger } from "@excalidraw/common";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  flowAnimationStateAtom,
  startFlowAnimation,
  stopFlowAnimation,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { applyFlowScript } from "../scene/flowApply";
import {
  chartElementsOf,
  chartRecordOf,
  isBuiltInPreset,
  readChartId,
  FLOW_FIT_MODES,
} from "../scene/flowChart";
import { checkFlowScript } from "../scene/flowCheck";
import { convertScript } from "../scene/flowConvert";
import {
  BUILT_IN_OF_LAYOUT,
  buildSettingsOfCustom,
  readStoredCustomPresets,
} from "../scene/flowCustomPresets";
import { FLOW_HIGHLIGHT_TARGETS, isFlowColor } from "../scene/flowLook";
import { flowPagesOf, planChartPages } from "../scene/flowPagesFor";
import {
  FLOW_PRESETS,
  buildFlowPreset,
  listFlowPresets,
} from "../scene/flowPresets";
import { FLOW_NODE_SHAPES } from "../scene/flowScript";
import { flowOfSelection } from "../scene/flowSelection";
import {
  FLOW_ARROW_STYLES,
  FLOW_NODE_STYLES,
  FLOW_SPEED_MAX,
  FLOW_SPEED_MIN,
} from "../scene/flowStyles";
import {
  stampCurrentPage,
  translateContentForPageLayout,
} from "../scene/pages";

import {
  argsOf,
  fail,
  isRecord,
  pageOfElement,
  readBoolean,
  readString,
  readInteger,
  readNumber,
  resolvePage,
  toPageSpace,
} from "./common";

import type { FlowHighlightTarget } from "../scene/flowLook";
import type { FlowAnimationSettings } from "../components/FlowAnimationState";

import type { FlowFitMode } from "../scene/flowChart";
import type { FlowCustomPreset } from "../scene/flowCustomPresets";
import type { FlowChartShape, FlowPresetId } from "../scene/flowPresets";
import type { FlowArrowStyle, FlowNodeStyle } from "../scene/flowStyles";
import type { McpApp, McpPage } from "./common";

/** the longest script that is made into a chart */
export const FLOW_MAX_SCRIPT = 20_000;

/** what a kind is called: a built-in kind, or the id of a custom one (D-228) */
export const kindOf = (
  value: string,
): { builtIn: FlowPresetId; custom?: FlowCustomPreset } => {
  const custom = readStoredCustomPresets().find(
    (preset) => preset.id === value,
  );

  if (custom) {
    return { builtIn: BUILT_IN_OF_LAYOUT[custom.layout], custom };
  }

  if (!isBuiltInPreset(value)) {
    return fail(
      "bad-arguments",
      `${value} is not a kind of chart. flow_kinds lists them: ${FLOW_PRESETS.map(
        (preset) => preset.id,
      ).join(", ")}, and the custom ones.`,
    );
  }

  return { builtIn: value };
};

const fitOf = (value: string | undefined, fallback: FlowFitMode) => {
  if (value === undefined) {
    return fallback;
  }

  return FLOW_FIT_MODES.includes(value as FlowFitMode)
    ? (value as FlowFitMode)
    : fail(
        "bad-arguments",
        `fit must be one of ${FLOW_FIT_MODES.join(
          ", ",
        )}: page makes the text smaller to fit, larger keeps it large and goes past the page, spread goes over the pages that follow.`,
      );
};

const shapeOf = (value: string | undefined, fallback: FlowChartShape) => {
  if (value === undefined) {
    return fallback;
  }

  return value === "own" ||
    FLOW_NODE_SHAPES.includes(value as typeof FLOW_NODE_SHAPES[number])
    ? (value as FlowChartShape)
    : fail(
        "bad-arguments",
        `shape must be own or one of ${FLOW_NODE_SHAPES.join(", ")}.`,
      );
};

const arrowsOf = (value: string | undefined, fallback: "own" | "none") => {
  if (value === undefined) {
    return fallback;
  }

  return value === "own" || value === "none"
    ? value
    : fail("bad-arguments", "arrows must be own or none.");
};

const scriptOf = (args: Record<string, unknown>) => {
  const script = readString(args, "script", { required: true })!;

  return script.length > FLOW_MAX_SCRIPT
    ? fail(
        "too-large",
        `The script is ${script.length} characters; at most ${FLOW_MAX_SCRIPT} make a chart.`,
      )
    : script;
};

/** what is wrong with a script, with its lines */
const problemsOf = (check: ReturnType<typeof checkFlowScript>) =>
  check.problems.map((problem) => `line ${problem.line}: ${problem.message}`);

/** the pages a spread chart goes on, made when they are missing */
const planned = (
  app: McpApp,
  entry: McpPage,
  fit: FlowFitMode,
  count: number,
) =>
  fit === "spread" && count > 1
    ? planChartPages({
        pages: app.state.pages,
        currentPageId: entry.page.id,
        count,
      })
    : null;

export const flowKinds = () => ({
  kinds: listFlowPresets(readStoredCustomPresets()).map((kind) => ({
    id: kind.id,
    name: kind.name,
    description: kind.description,
    example: kind.example,
    custom: kind.custom,
  })),
  script:
    "One line for each node, written as the example of the kind shows. A line starting with ? is a question (decision). A -> B joins two nodes (network). A | B puts nodes side by side (tiers, grid, matrix); a line starting with # is a header (grid).",
});

export const checkFlowScriptTool = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const { builtIn, custom } = kindOf(
    readString(args, "kind", { required: true })!,
  );
  const script = scriptOf(args);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const settings = custom ? buildSettingsOfCustom(custom).options : {};
  const check = checkFlowScript(builtIn, script, {
    ...settings,
    page: entry.rect,
    fit: fitOf(readString(args, "fit"), "page"),
    shape: shapeOf(readString(args, "shape"), custom?.shape ?? "own"),
    arrows: arrowsOf(readString(args, "arrows"), custom?.arrows ?? "own"),
    custom,
  });

  return {
    ok: check.ok,
    nodes: check.nodes,
    arrows: check.arrows,
    pages: check.pages,
    fontSize: check.fontSize,
    problems: problemsOf(check),
    reason: check.reason,
  };
};

export const createFlowChart = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const { builtIn, custom } = kindOf(
    readString(args, "kind", { required: true })!,
  );
  const script = scriptOf(args);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const fit = fitOf(readString(args, "fit"), "page");
  const shape = shapeOf(readString(args, "shape"), custom?.shape ?? "own");
  const arrows = arrowsOf(readString(args, "arrows"), custom?.arrows ?? "own");
  const settings = custom ? buildSettingsOfCustom(custom).options : {};
  const x = readNumber(args.x, "x");
  const y = readNumber(args.y, "y");
  const check = checkFlowScript(builtIn, script, {
    ...settings,
    page: entry.rect,
    fit,
    shape,
    arrows,
    custom,
  });

  if (!check.ok) {
    return fail(
      "bad-arguments",
      check.problems.length
        ? `The script has problems: ${problemsOf(check).join("; ")}.`
        : check.reason ?? "The script cannot be made into a chart.",
    );
  }

  const plan = planned(app, entry, fit, check.pages);
  const chartId = `chart-${randomId()}`;
  const built = buildFlowPreset(builtIn, script, {
    ...settings,
    page: entry.rect,
    // the middle of the page, or where asked: the builder keeps it on the page
    center:
      plan || (x === undefined && y === undefined)
        ? undefined
        : {
            x: entry.rect.x + (x ?? entry.rect.width / 2),
            y: entry.rect.y + (y ?? entry.rect.height / 2),
          },
    pageId: entry.page.id,
    pageNumber: entry.number,
    pages: plan ? flowPagesOf(plan) : undefined,
    seed: randomInteger(),
    chartId,
    fit,
    custom,
    shape,
    arrows,
  });

  if (!built.ok) {
    return fail(built.tooBig ? "too-large" : "bad-arguments", built.error);
  }

  // a chart over pages says its pages itself; the others are on the page asked for
  const placed =
    built.pages > 1
      ? built.elements
      : stampCurrentPage(built.elements, entry.page.id);

  if (plan && plan.created > 0) {
    const translated = translateContentForPageLayout({
      elements: app.scene.getElementsIncludingDeleted() as ExcalidrawElement[],
      previousPages: app.state.pages,
      nextPages: plan.pages,
    });

    app.updateScene({
      elements: [...translated, ...placed],
      appState: { pages: plan.pages },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  } else {
    app.updateScene({
      elements: [...app.scene.getElementsIncludingDeleted(), ...placed],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }

  return {
    chartId,
    kind: custom?.id ?? builtIn,
    page: entry.number,
    pages: built.pages,
    pagesMade: plan?.created ?? 0,
    nodes: check.nodes,
    arrows: check.arrows,
    fontSize: built.fontSize,
    at: toPageSpace(entry.rect, built.bounds.x, built.bounds.y),
    size: {
      width: Math.round(built.bounds.width),
      height: Math.round(built.bounds.height),
    },
    created: placed.length,
  };
};

type ChartListing = {
  chartId: string;
  kind: string;
  custom?: string;
  fit: FlowFitMode;
  shape: FlowChartShape;
  arrows: "own" | "none";
  script: string;
  pages: number[];
  nodes: number;
  elements: number;
};

const flowRole = (element: ExcalidrawElement) =>
  isRecord(element.customData?.flow) ? element.customData.flow.role : undefined;

export const listFlowCharts = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const only = readInteger(args, "page", { min: 1 });
  const elements = app.scene.getNonDeletedElements() as ExcalidrawElement[];
  const ids = new Set<string>();

  for (const element of elements) {
    const id = readChartId(element);

    if (id) {
      ids.add(id);
    }
  }

  const charts: ChartListing[] = [];

  for (const id of ids) {
    const members = chartElementsOf(id, elements);
    const record = chartRecordOf(members[0], elements);

    if (!record) {
      continue;
    }

    const pages = [
      ...new Set(
        members
          .map((element) => pageOfElement(app, element)?.number)
          .filter((number): number is number => number !== undefined),
      ),
    ].sort((a, b) => a - b);

    if (only !== undefined && !pages.includes(only)) {
      continue;
    }

    charts.push({
      chartId: id,
      kind: record.preset,
      ...(record.custom ? { custom: record.custom.name } : {}),
      fit: record.fit,
      shape: record.shape,
      arrows: record.arrows,
      script: record.script,
      pages,
      nodes: members.filter(
        (element) => flowRole(element) === "node" && element.type !== "text",
      ).length,
      elements: members.length,
    });
  }

  return { charts };
};

export const editFlowChart = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const chartId = readString(args, "chartId", { required: true })!;
  const all = app.scene.getElementsIncludingDeleted() as ExcalidrawElement[];
  const members = chartElementsOf(chartId, all);

  if (!members.length) {
    return fail(
      "not-found",
      `No chart ${chartId}. list_flow_charts lists the charts.`,
    );
  }

  const record = chartRecordOf(members[0], all);

  if (!record) {
    return fail(
      "failed",
      `${chartId} is a chart from before charts remembered their script: it cannot be changed here. Make it again with create_flow_chart.`,
    );
  }

  const given = readString(args, "kind");
  const chosen = given
    ? kindOf(given)
    : record.custom
    ? {
        builtIn: BUILT_IN_OF_LAYOUT[record.custom.layout],
        custom: record.custom,
      }
    : { builtIn: record.preset as FlowPresetId, custom: undefined };
  const { builtIn, custom } = chosen;
  const script = args.script === undefined ? record.script : scriptOf(args);
  const fit = fitOf(readString(args, "fit"), record.fit);
  const shape = shapeOf(readString(args, "shape"), record.shape);
  const arrows = arrowsOf(readString(args, "arrows"), record.arrows);
  const entry = pageOfElement(app, members[0]) ?? resolvePage(app, undefined);
  const settings = custom ? buildSettingsOfCustom(custom).options : {};
  const check = checkFlowScript(builtIn, script, {
    ...settings,
    page: entry.rect,
    fit,
    shape,
    arrows,
    custom,
  });

  if (!check.ok) {
    return fail(
      "bad-arguments",
      check.problems.length
        ? `The script has problems: ${problemsOf(check).join("; ")}.`
        : check.reason ?? "The script cannot be made into a chart.",
    );
  }

  const plan = planned(app, entry, fit, check.pages);
  const base =
    plan && plan.created > 0
      ? (translateContentForPageLayout({
          elements: all,
          previousPages: app.state.pages,
          nextPages: plan.pages,
        }) as ExcalidrawElement[])
      : all;
  const result = applyFlowScript({
    elements: base,
    chartId,
    preset: builtIn,
    script,
    fit,
    shape,
    arrows,
    custom,
    page: entry.rect,
    pageId: entry.page.id,
    pageNumber: entry.number,
    pages: plan ? flowPagesOf(plan) : undefined,
  });

  if (!result.ok) {
    return fail("bad-arguments", result.error);
  }

  app.updateScene({
    elements: result.elements,
    appState: plan && plan.created > 0 ? { pages: plan.pages } : undefined,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    chartId,
    rebuilt: result.rebuilt,
    kept: result.kept,
    added: result.added,
    removed: result.removed,
    pagesMade: plan?.created ?? 0,
  };
};

export const deleteFlowChart = (app: McpApp, rawArgs: unknown) => {
  const chartId = readString(argsOf(rawArgs), "chartId", { required: true })!;
  const all = app.scene.getElementsIncludingDeleted() as ExcalidrawElement[];
  const members = new Set(
    chartElementsOf(chartId, all).map((element) => element.id),
  );

  if (!members.size) {
    return fail(
      "not-found",
      `No chart ${chartId}. list_flow_charts lists the charts.`,
    );
  }

  app.updateScene({
    elements: all.map((element) =>
      members.has(element.id)
        ? newElementWith(element, { isDeleted: true })
        : element,
    ),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { chartId, deleted: members.size };
};

export const convertFlowScript = (_app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const from = kindOf(readString(args, "from", { required: true })!);
  const to = kindOf(readString(args, "to", { required: true })!);
  const script = scriptOf(args);
  const converted = convertScript(from.builtIn, script, to.builtIn);

  return {
    from: from.custom?.id ?? from.builtIn,
    to: to.custom?.id ?? to.builtIn,
    script: converted,
    changed: converted !== script,
  };
};

/* ------------------------------------------------- the look of the animation */

/** the shortest a step may be held, in milliseconds */
export const FLOW_MIN_STEP_MS = 100;

/** the longest a step may be held, in milliseconds */
export const FLOW_MAX_STEP_MS = 10_000;

/** the colours of the look, and what may be done with them */
const LOOK_COLOURS = [
  "nodeColor",
  "textColor",
  "markColor",
  "arrowColor",
] as const;

/** the switches of the look, and of the run */
const LOOK_SWITCHES = [
  "hideArrow",
  "glowShape",
  "glowText",
  "glowMark",
  "glowArrow",
  "loop",
  "camera",
] as const;

/**
 * How the animation looks and plays now, and what may be chosen (D-424).
 *
 * It is the bar's own state, read from the editor's store - the same numbers
 * the teacher sees in the bar, so the assistant and the person talk about the
 * same thing.
 */
export const describeFlowLook = () => {
  const state = editorJotaiStore.get(flowAnimationStateAtom);

  return {
    look: {
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
    },
    animation: {
      durationMs: state.durationMs,
      loop: state.loop,
      nodeStyle: state.nodeStyle,
      arrowStyle: state.arrowStyle,
      speed: state.speed,
      camera: state.camera,
    },
    playing: state.active,
    mode: state.mode,
    choices: {
      colours: LOOK_COLOURS,
      highlightTargets: FLOW_HIGHLIGHT_TARGETS.map((target) => target.id),
      nodeStyles: FLOW_NODE_STYLES.map((style) => style.id),
      arrowStyles: FLOW_ARROW_STYLES.map((style) => style.id),
      speed: [FLOW_SPEED_MIN, FLOW_SPEED_MAX],
      durationMs: [FLOW_MIN_STEP_MS, FLOW_MAX_STEP_MS],
      note: "A colour is a hex value like #6965db, or nothing for the accent colour.",
    },
  };
};

/** a colour of the look: a hex value, or nothing for the accent colour */
const colourOf = (args: Record<string, unknown>, key: string) => {
  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  return isFlowColor(value)
    ? value
    : fail(
        "bad-arguments",
        `${key} must be a hex colour like #6965db, or nothing for the accent colour.`,
      );
};

/**
 * Changes the look of the animation, and how it plays (D-424).
 *
 * What is not given stays what it was, and the settings are remembered for the
 * next session - the bar's own rule, through the bar's own action.
 */
export const setFlowLook = (_app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const settings: Partial<FlowAnimationSettings> = {};

  for (const key of LOOK_COLOURS) {
    const colour = colourOf(args, key);

    if (colour !== undefined) {
      settings[key] = colour;
    }
  }

  for (const key of LOOK_SWITCHES) {
    const value = readBoolean(args, key);

    if (value !== undefined) {
      settings[key] = value;
    }
  }

  const target = args.nodeTarget;

  if (target !== undefined) {
    if (
      typeof target !== "string" ||
      !FLOW_HIGHLIGHT_TARGETS.some((each) => each.id === target)
    ) {
      return fail(
        "bad-arguments",
        `nodeTarget must be one of ${FLOW_HIGHLIGHT_TARGETS.map(
          (each) => each.id,
        ).join(", ")}.`,
      );
    }

    settings.nodeTarget = target as FlowHighlightTarget;
  }

  const durationMs = readNumber(args.durationMs, "durationMs");

  if (durationMs !== undefined) {
    if (durationMs < FLOW_MIN_STEP_MS || durationMs > FLOW_MAX_STEP_MS) {
      return fail(
        "bad-arguments",
        `durationMs must be a number from ${FLOW_MIN_STEP_MS} to ${FLOW_MAX_STEP_MS}.`,
      );
    }

    settings.durationMs = durationMs;
  }

  const speed = readNumber(args.speed, "speed");

  if (speed !== undefined) {
    if (speed < FLOW_SPEED_MIN || speed > FLOW_SPEED_MAX) {
      return fail(
        "bad-arguments",
        `speed must be a number from ${FLOW_SPEED_MIN} to ${FLOW_SPEED_MAX}.`,
      );
    }

    settings.speed = speed;
  }

  const nodeStyle = args.nodeStyle;

  if (nodeStyle !== undefined) {
    if (
      typeof nodeStyle !== "string" ||
      !FLOW_NODE_STYLES.some((each) => each.id === nodeStyle)
    ) {
      return fail(
        "bad-arguments",
        `nodeStyle must be one of ${FLOW_NODE_STYLES.map(
          (each) => each.id,
        ).join(", ")}.`,
      );
    }

    settings.nodeStyle = nodeStyle as FlowNodeStyle;
  }

  const arrowStyle = args.arrowStyle;

  if (arrowStyle !== undefined) {
    if (
      typeof arrowStyle !== "string" ||
      !FLOW_ARROW_STYLES.some((each) => each.id === arrowStyle)
    ) {
      return fail(
        "bad-arguments",
        `arrowStyle must be one of ${FLOW_ARROW_STYLES.map(
          (each) => each.id,
        ).join(", ")}.`,
      );
    }

    settings.arrowStyle = arrowStyle as FlowArrowStyle;
  }

  if (!Object.keys(settings).length) {
    return fail(
      "bad-arguments",
      "Say what to change: a colour, a glow, hideArrow, nodeTarget, durationMs, loop, nodeStyle, arrowStyle, speed or camera.",
    );
  }

  updateFlowAnimationSettings(settings);

  return describeFlowLook();
};

/* ------------------------------------------------------------- playing a chart */

/**
 * Plays a chart, or presents it (D-424).
 *
 * The chart is found by its id and its steps are read with the editor's own
 * reader, so the animation walks the chart the teacher drew - the same steps
 * the bar plays.
 */
export const playFlow = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const chartId = readString(args, "chartId", { required: true })!;
  const mode = readString(args, "mode") ?? "play";

  if (mode !== "play" && mode !== "present") {
    return fail("bad-arguments", "mode must be play or present.");
  }

  const elements = app.scene.getNonDeletedElements() as ExcalidrawElement[];
  const members = chartElementsOf(chartId, elements);

  if (!members.length) {
    return fail(
      "not-found",
      `No chart ${chartId}. list_flow_charts lists the charts.`,
    );
  }

  const selected: Record<string, boolean> = {};

  for (const member of members) {
    selected[member.id] = true;
  }

  const graph = flowOfSelection(
    selected,
    elements,
    app.scene.getElementsMapIncludingDeleted(),
  );

  if (!graph || !graph.steps.length) {
    return fail(
      "failed",
      `The chart ${chartId} has no steps to walk. A chart of one shape has nothing to play.`,
    );
  }

  const state = editorJotaiStore.get(flowAnimationStateAtom);

  startFlowAnimation(graph.steps, {
    mode,
    graph,
    durationMs: state.durationMs,
    loop: mode === "play" ? state.loop : false,
    nodeStyle: state.nodeStyle,
    arrowStyle: state.arrowStyle,
    speed: state.speed,
    camera: state.camera,
  });

  return {
    chartId,
    mode,
    steps: graph.steps.length,
    playing: true,
  };
};

/** ends the animation and gives the canvas back */
export const stopFlow = () => {
  const state = editorJotaiStore.get(flowAnimationStateAtom);

  stopFlowAnimation();

  return { playing: false, wasPlaying: state.active };
};
