/**
 * Checking a script while it is typed (D-224).
 *
 * The check is the parser's own and the builder's own: it reads the script with
 * `parseFlowScript` and builds the chart with `buildFlowPreset`, so what it
 * accepts always builds. Nothing here is a second set of rules.
 *
 * Everything here is pure.
 */

import { buildFlowPreset } from "./flowPresets";
import { EMPTY_SCRIPT_ERROR, parseFlowScript } from "./flowScript";

import type { FlowFitMode } from "./flowChart";
import type { BuildFlowOptions } from "./flowPresets";
import type { FlowPresetId, FlowScriptProblem } from "./flowScript";

export type FlowScriptCheck = {
  /** the script can be built as it is written */
  ok: boolean;
  /** what cannot be read, each with its line (D-224) */
  problems: FlowScriptProblem[];
  /** what the chart would be made of */
  nodes: number;
  arrows: number;
  /** the text size the chart would have; `null` when it cannot be built */
  fontSize: number | null;
  /** the pages the chart would be on */
  pages: number;
  /** why the chart cannot be applied or inserted, in a sentence; `null` when it can */
  reason: string | null;
};

const EMPTY: FlowScriptCheck = {
  ok: false,
  problems: [],
  nodes: 0,
  arrows: 0,
  fontSize: null,
  pages: 0,
  reason: EMPTY_SCRIPT_ERROR,
};

/**
 * What a script would make, and what is wrong with it. `options` are the ones
 * the chart would be built with: the fit mode, the shape and the page.
 */
export const checkFlowScript = (
  preset: FlowPresetId,
  script: string,
  options: BuildFlowOptions & { fit?: FlowFitMode } = {},
): FlowScriptCheck => {
  const parsed = parseFlowScript(preset, script);

  if (!parsed.ok) {
    return { ...EMPTY, reason: parsed.error };
  }

  const counts = {
    nodes: parsed.nodes.length,
    arrows: parsed.edges.length,
  };

  // problems come first: a script that cannot be read is not built to find out more
  if (parsed.problems.length > 0) {
    const first = parsed.problems[0];

    return {
      ok: false,
      problems: parsed.problems,
      ...counts,
      fontSize: null,
      pages: 0,
      reason: `Line ${first.line}: ${first.message}`,
    };
  }

  const built = buildFlowPreset(preset, script, options);

  if (!built.ok) {
    return {
      ok: false,
      problems: [],
      ...counts,
      fontSize: null,
      pages: 0,
      reason: built.error,
    };
  }

  return {
    ok: true,
    problems: [],
    ...counts,
    fontSize: built.fontSize,
    pages: built.pages,
    reason: null,
  };
};
