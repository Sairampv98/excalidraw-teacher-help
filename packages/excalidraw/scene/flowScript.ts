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

export type FlowScriptNode = {
  /** `n0`, `n1`, ... in the order the nodes were first seen */
  id: string;
  label: string;
  kind: FlowNodeKind;
  /** the tier a node is in (tiers only) */
  tier?: number;
};

export type FlowScriptEdge = {
  from: string;
  to: string;
  /** `yes` or `no` on a question's branches */
  label?: string;
};

export type ParsedFlow =
  | {
      ok: true;
      preset: FlowPresetId;
      nodes: FlowScriptNode[];
      edges: FlowScriptEdge[];
      /** the node ids of each tier, top first (tiers only) */
      tiers?: string[][];
    }
  | { ok: false; error: string };

export const EMPTY_SCRIPT_ERROR =
  "Nothing to build: write one line for each node.";

const clean = (text: string) => text.trim();

const scriptLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => line.length > 0);

/** a builder that hands out ids and remembers what it has made */
const createGraph = () => {
  const nodes: FlowScriptNode[] = [];
  const edges: FlowScriptEdge[] = [];

  const add = (
    label: string,
    kind: FlowNodeKind,
    extra: Partial<FlowScriptNode> = {},
  ) => {
    const node: FlowScriptNode = {
      id: `n${nodes.length}`,
      label,
      kind,
      ...extra,
    };
    nodes.push(node);
    return node;
  };

  const link = (from: string, to: string, label?: string) => {
    edges.push(label ? { from, to, label } : { from, to });
  };

  return { nodes, edges, add, link };
};

const parseSequence = (
  preset: "process" | "steps" | "cycle",
  lines: string[],
): ParsedFlow => {
  const { nodes, edges, add, link } = createGraph();

  for (const line of lines) {
    const node = add(line, "step");
    if (nodes.length > 1) {
      link(nodes[nodes.length - 2].id, node.id);
    }
  }

  // a loop returns to its first step; one step has nothing to return from
  if (preset === "cycle" && nodes.length > 1) {
    link(nodes[nodes.length - 1].id, nodes[0].id);
  }

  return { ok: true, preset, nodes, edges };
};

const parseTiers = (lines: string[]): ParsedFlow => {
  const { nodes, edges, add } = createGraph();
  const tiers: string[][] = [];

  for (const line of lines) {
    const items = line.split("|").map(clean).filter(Boolean);

    if (items.length === 0) {
      continue;
    }

    const tier = tiers.length;
    tiers.push(items.map((item) => add(item, "step", { tier }).id));
  }

  return { ok: true, preset: "tiers", nodes, edges, tiers };
};

const parseIntegration = (lines: string[]): ParsedFlow => {
  const { nodes, edges, add, link } = createGraph();
  const [hubLine, ...spokes] = lines;
  const hub = add(hubLine, "hub");

  for (const spoke of spokes) {
    link(hub.id, add(spoke, "spoke").id);
  }

  return { ok: true, preset: "integration", nodes, edges };
};

const parseDecision = (lines: string[]): ParsedFlow => {
  const { nodes, edges, add, link } = createGraph();

  /** the nodes the next step has to be joined from: the last step, or both branches */
  let open: string[] = [];

  const join = (to: string) => {
    for (const from of open) {
      link(from, to);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("?")) {
      const question = clean(line.slice(1));

      // a bare "?" has nothing to ask: drop it
      if (!question) {
        continue;
      }

      const node = add(question, "question");
      join(node.id);

      const branches = lines.slice(i + 1, i + 3);
      const ends: string[] = [];

      branches.forEach((label, index) => {
        const branch = add(label, "branch");
        link(node.id, branch.id, index === 0 ? "yes" : "no");
        ends.push(branch.id);
      });

      // both branches rejoin whatever comes next
      open = ends.length ? ends : [node.id];
      i += branches.length;
    } else {
      const node = add(line, "step");
      join(node.id);
      open = [node.id];
    }
  }

  return { ok: true, preset: "decision", nodes, edges };
};

const parseNetwork = (lines: string[]): ParsedFlow => {
  const { nodes, edges, add, link } = createGraph();
  const byLabel = new Map<string, FlowScriptNode>();

  /** a node is created the first time its label is seen */
  const nodeFor = (label: string) => {
    let node = byLabel.get(label);
    if (!node) {
      node = add(label, "step");
      byLabel.set(label, node);
    }
    return node;
  };

  for (const line of lines) {
    const labels = line.split("->").map(clean).filter(Boolean);

    if (labels.length === 1) {
      nodeFor(labels[0]);
      continue;
    }

    // `A -> B -> C` is two edges
    for (let i = 0; i < labels.length - 1; i++) {
      link(nodeFor(labels[i]).id, nodeFor(labels[i + 1]).id);
    }
  }

  return { ok: true, preset: "network", nodes, edges };
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
