/**
 * The flow studio's script (D-164): one line per node.
 *
 * A teacher plans a class as a list, so the chart is filled from a list. This
 * is a pure function - text in, a graph out - so it is tested without a canvas
 * and the MCP server can call the same one the sidebar does (D-162).
 *
 * The rules are small and the same for every preset:
 *  - a blank line is ignored, and a label is trimmed;
 *  - **tiers**: a line is one tier, and its items are separated by `|`;
 *  - **integration**: the first line is the hub, each later line a spoke;
 *  - **decision**: a line that starts with `?` is a question, and the next two
 *    lines are its yes and no branches;
 *  - **network**: `A -> B` is an edge, and a node is created the first time its
 *    label is seen;
 *  - **process**, **steps**, **cycle**: each line is the next step.
 */

export type FlowPresetId =
  | "process"
  | "decision"
  | "steps"
  | "cycle"
  | "tiers"
  | "integration"
  | "network";

export const FLOW_PRESET_IDS: readonly FlowPresetId[] = [
  "process",
  "decision",
  "steps",
  "cycle",
  "tiers",
  "integration",
  "network",
];

export type FlowNodeKind = "step" | "question" | "branch" | "hub" | "spoke";

/** the shape a node can be given (D-229); `circle` is an ellipse of equal sides */
export type FlowNodeShape =
  | "rectangle"
  | "rounded"
  | "ellipse"
  | "circle"
  | "diamond";

export const FLOW_NODE_SHAPES: readonly FlowNodeShape[] = [
  "rectangle",
  "rounded",
  "ellipse",
  "circle",
  "diamond",
];

export type FlowScriptNode = {
  /** `n0`, `n1`, ... in the order the nodes were first seen */
  id: string;
  label: string;
  kind: FlowNodeKind;
  /** the tier a node is in (tiers only) */
  tier?: number;
  /** the shape the script gave this node with a mark (D-229) */
  shape?: FlowNodeShape;
};

export type FlowScriptEdge = {
  from: string;
  to: string;
  /** `yes` or `no` on a question's branches */
  label?: string;
};

/** something in a script that cannot be built as written, and where (D-224) */
export type FlowScriptProblem = {
  /** the line of the script, counted from 1, blank lines included */
  line: number;
  message: string;
};

export type ParsedFlow =
  | {
      ok: true;
      preset: FlowPresetId;
      nodes: FlowScriptNode[];
      edges: FlowScriptEdge[];
      /** the node ids of each tier, top first (tiers only) */
      tiers?: string[][];
      /**
       * What the parser had to leave out or could not read. The chart is still
       * built without it; the editor refuses to apply it (D-224).
       */
      problems: FlowScriptProblem[];
    }
  | { ok: false; error: string };

export const EMPTY_SCRIPT_ERROR =
  "Nothing to build: write one line for each node.";

/** the longest label a shape can be asked to hold, in characters (D-224) */
export const MAX_LABEL_CHARS = 120;

const clean = (text: string) => text.trim();

/** a line of the script, with the number it has in the text (D-224) */
type ScriptLine = { text: string; no: number };

const scriptLines = (text: string): ScriptLine[] =>
  text
    .split(/\r?\n/)
    .map((raw, index) => ({ text: clean(raw), no: index + 1 }))
    .filter((line) => line.text.length > 0);

/* ------------------------------------------------------------------ the marks */

/** a shape mark: what opens it, what closes it, and the shape it gives (D-229) */
const MARKS: readonly [string, string, FlowNodeShape][] = [
  ["((", "))", "ellipse"],
  ["[", "]", "rectangle"],
  ["(", ")", "rounded"],
  ["{", "}", "circle"],
  ["<", ">", "diamond"],
];

/**
 * Reads the mark a label may start with. A label that is wrapped in a mark gives
 * its shape and the words inside; a label that opens one and never closes it is
 * a problem - but a label that only starts with a bracket and closes it
 * somewhere in the middle (`(draft) plan`) is plain text.
 */
export const readShapeMark = (
  raw: string,
): { label: string; shape?: FlowNodeShape; problem?: string } => {
  const text = clean(raw);

  for (const [open, close, shape] of MARKS) {
    if (!text.startsWith(open)) {
      continue;
    }

    if (text.length >= open.length + close.length && text.endsWith(close)) {
      return { label: clean(text.slice(open.length, -close.length)), shape };
    }

    if (!text.includes(close, open.length)) {
      return {
        label: text,
        problem: `The mark ${open}...${close} is opened and not closed.`,
      };
    }

    return { label: text };
  }

  return { label: text };
};

/** a builder that hands out ids and remembers what it has made */
const createGraph = () => {
  const nodes: FlowScriptNode[] = [];
  const edges: FlowScriptEdge[] = [];
  const problems: FlowScriptProblem[] = [];

  const problem = (line: number, message: string) => {
    problems.push({ line, message });
  };

  const add = (
    raw: string,
    kind: FlowNodeKind,
    line: number,
    extra: Partial<FlowScriptNode> = {},
  ) => {
    const read = readShapeMark(raw);

    if (read.problem) {
      problem(line, read.problem);
    }

    if (read.label.length > MAX_LABEL_CHARS) {
      problem(
        line,
        `That label is longer than ${MAX_LABEL_CHARS} characters, which no shape can hold.`,
      );
    }

    const node: FlowScriptNode = {
      id: `n${nodes.length}`,
      label: read.label,
      kind,
      ...(read.shape ? { shape: read.shape } : {}),
      ...extra,
    };
    nodes.push(node);
    return node;
  };

  const link = (from: string, to: string, label?: string) => {
    edges.push(label ? { from, to, label } : { from, to });
  };

  return { nodes, edges, problems, problem, add, link };
};

const parseSequence = (
  preset: "process" | "steps" | "cycle",
  lines: ScriptLine[],
): ParsedFlow => {
  const { nodes, edges, problems, add, link } = createGraph();

  for (const line of lines) {
    const node = add(line.text, "step", line.no);
    if (nodes.length > 1) {
      link(nodes[nodes.length - 2].id, node.id);
    }
  }

  // a loop returns to its first step; one step has nothing to return from
  if (preset === "cycle" && nodes.length > 1) {
    link(nodes[nodes.length - 1].id, nodes[0].id);
  }

  return { ok: true, preset, nodes, edges, problems };
};

const parseTiers = (lines: ScriptLine[]): ParsedFlow => {
  const { nodes, edges, problems, problem, add } = createGraph();
  const tiers: string[][] = [];

  for (const line of lines) {
    const items = line.text.split("|").map(clean).filter(Boolean);

    if (items.length === 0) {
      problem(line.no, "That tier has no items.");
      continue;
    }

    const tier = tiers.length;
    tiers.push(items.map((item) => add(item, "step", line.no, { tier }).id));
  }

  return { ok: true, preset: "tiers", nodes, edges, tiers, problems };
};

const parseIntegration = (lines: ScriptLine[]): ParsedFlow => {
  const { nodes, edges, problems, add, link } = createGraph();
  const [hubLine, ...spokes] = lines;
  const hub = add(hubLine.text, "hub", hubLine.no);

  for (const spoke of spokes) {
    link(hub.id, add(spoke.text, "spoke", spoke.no).id);
  }

  return { ok: true, preset: "integration", nodes, edges, problems };
};

const parseDecision = (lines: ScriptLine[]): ParsedFlow => {
  const { nodes, edges, problems, problem, add, link } = createGraph();

  /** the nodes the next step has to be joined from: the last step, or both branches */
  let open: string[] = [];

  const join = (to: string) => {
    for (const from of open) {
      link(from, to);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.text.startsWith("?")) {
      const question = clean(line.text.slice(1));

      // a bare "?" has nothing to ask: drop it
      if (!question) {
        problem(line.no, "A ? needs a question after it.");
        continue;
      }

      const node = add(question, "question", line.no);
      join(node.id);

      const branches = lines.slice(i + 1, i + 3);
      const ends: string[] = [];

      if (branches.length < 2) {
        problem(line.no, "A question needs two lines after it: yes and no.");
      }

      branches.forEach((branchLine, index) => {
        const branch = add(branchLine.text, "branch", branchLine.no);
        link(node.id, branch.id, index === 0 ? "yes" : "no");
        ends.push(branch.id);
      });

      // both branches rejoin whatever comes next
      open = ends.length ? ends : [node.id];
      i += branches.length;
    } else {
      const node = add(line.text, "step", line.no);
      join(node.id);
      open = [node.id];
    }
  }

  return { ok: true, preset: "decision", nodes, edges, problems };
};

const parseNetwork = (lines: ScriptLine[]): ParsedFlow => {
  const { nodes, edges, problems, problem, add, link } = createGraph();
  const byLabel = new Map<string, FlowScriptNode>();

  /** a node is created the first time its label is seen, with the mark it had then */
  const nodeFor = (raw: string, line: number) => {
    const label = readShapeMark(raw).label;
    let node = byLabel.get(label);
    if (!node) {
      node = add(raw, "step", line);
      byLabel.set(node.label, node);
    }
    return node;
  };

  for (const line of lines) {
    const pieces = line.text.split("->").map(clean);
    const labels = pieces.filter(Boolean);

    if (pieces.length > 1 && labels.length < pieces.length) {
      problem(line.no, "A -> needs a name on each side.");
    }

    if (labels.length === 1) {
      nodeFor(labels[0], line.no);
      continue;
    }

    // `A -> B -> C` is two edges
    for (let i = 0; i < labels.length - 1; i++) {
      link(nodeFor(labels[i], line.no).id, nodeFor(labels[i + 1], line.no).id);
    }
  }

  return { ok: true, preset: "network", nodes, edges, problems };
};

/**
 * Reads a script for a preset. A script with no usable line builds **nothing**
 * and says so - it never builds an empty chart.
 */
export const parseFlowScript = (
  preset: FlowPresetId,
  text: string,
): ParsedFlow => {
  const lines = scriptLines(text);

  if (lines.length === 0) {
    return { ok: false, error: EMPTY_SCRIPT_ERROR };
  }

  let parsed: ParsedFlow;

  switch (preset) {
    case "process":
    case "steps":
    case "cycle":
      parsed = parseSequence(preset, lines);
      break;
    case "tiers":
      parsed = parseTiers(lines);
      break;
    case "integration":
      parsed = parseIntegration(lines);
      break;
    case "decision":
      parsed = parseDecision(lines);
      break;
    case "network":
      parsed = parseNetwork(lines);
      break;
  }

  // a script whose every line was an empty tier, a bare "?" or a stray "->"
  if (parsed.ok && parsed.nodes.length === 0) {
    return { ok: false, error: EMPTY_SCRIPT_ERROR };
  }

  return parsed;
};
