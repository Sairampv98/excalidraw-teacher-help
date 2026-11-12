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

/** the seven kinds that join their shapes (D-163) */
export type FlowJoinedPresetId =
  | "process"
  | "decision"
  | "steps"
  | "cycle"
  | "tiers"
  | "integration"
  | "network";

/** the nine layouts of the gallery, which need no arrows (D-232) */
export type FlowGalleryPresetId =
  | "list"
  | "grid"
  | "matrix"
  | "pyramid"
  | "funnel"
  | "timeline"
  | "target"
  | "venn"
  | "hierarchy";

export type FlowPresetId = FlowJoinedPresetId | FlowGalleryPresetId;

/** the seven of D-163 */
export const FLOW_PRESET_IDS: readonly FlowJoinedPresetId[] = [
  "process",
  "decision",
  "steps",
  "cycle",
  "tiers",
  "integration",
  "network",
];

/** the nine of D-232 */
export const FLOW_GALLERY_IDS: readonly FlowGalleryPresetId[] = [
  "list",
  "grid",
  "matrix",
  "pyramid",
  "funnel",
  "timeline",
  "target",
  "venn",
  "hierarchy",
];

/** every kind of chart: the seven, then the gallery */
export const ALL_FLOW_PRESET_IDS: readonly FlowPresetId[] = [
  ...FLOW_PRESET_IDS,
  ...FLOW_GALLERY_IDS,
];

export type FlowNodeKind =
  | "step"
  | "question"
  | "branch"
  | "hub"
  | "spoke"
  // the gallery's own (D-232)
  | "cell"
  | "header"
  | "ring"
  | "set"
  | "block";

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
  look?: FlowScriptLook;
  /** `n0`, `n1`, ... in the order the nodes were first seen */
  id: string;
  label: string;
  kind: FlowNodeKind;
  /** the tier a node is in (tiers only) */
  tier?: number;
  /** the row and the column of a cell (grid and matrix only, D-234) */
  row?: number;
  col?: number;
  /** how deep in the tree a node is, 0 for the root (hierarchy only, D-236) */
  depth?: number;
  /** the shape the script gave this node with a mark or a keyword (D-229, D-230) */
  shape?: FlowNodeShape;
  /**
   * Where the node's words are in the script, with their mark or keyword: the
   * line, and the characters of that line from `start` to `end`. It is what
   * lets one node's shape be changed by rewriting that piece of the script
   * (D-230).
   */
  source?: { line: number; start: number; end: number };
};

export type FlowRouteBend = {
  kind: "elbow" | "curve" | "straight";
  side?: "left" | "right" | "in" | "out";
};

export type FlowScriptEdge = {
  look?: FlowScriptLook;
  from: string;
  to: string;
  /** `yes` or `no` on a question's branches */
  label?: string;
  route?: FlowRouteBend[];
  fork?: {
    id: string;
    count: number;
    index: number;
    reverse: boolean;
    loose: boolean;
  };
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
      settings?: Record<string, string | number | boolean>;
      /** the node ids of each tier, top first (tiers only) */
      tiers?: string[][];
      /** the node ids of each row, top first, the cells in column order (grid and matrix only) */
      rows?: string[][];
      /**
       * What the parser had to leave out or could not read. The chart is still
       * built without it; the editor refuses to apply it (D-224).
       */
      problems: FlowScriptProblem[];
    }
  | { ok: false; error: string };

export const EMPTY_SCRIPT_ERROR =
  "Nothing to build: write one line for each node.";

export type FlowScriptLook = {
  fill?: string;
  outline?: string;
  glowShape?: boolean;
  glowArrow?: boolean;
  glowMark?: boolean;
  arrowStyle?: string;
  nodeStyle?: string;
};

/** Header words mirror the Flow panel; their spelling is also used by the register. */
export const FLOW_SCRIPT_LOOK_WORDS: Record<string, string> = {
  "node-color": "nodeColor",
  "text-color": "textColor",
  "mark-color": "markColor",
  "arrow-color": "arrowColor",
  "glow-shape": "glowShape",
  "glow-text": "glowText",
  "glow-mark": "glowMark",
  "glow-arrow": "glowArrow",
  "glow-shape-strength": "glowShapeStrength",
  "glow-shape-width": "glowShapeWidth",
  "glow-text-strength": "glowTextStrength",
  "glow-text-width": "glowTextWidth",
  "glow-mark-strength": "glowMarkStrength",
  "glow-mark-width": "glowMarkWidth",
  "glow-arrow-strength": "glowArrowStrength",
  "glow-shape-core": "glowShapeCore",
  "glow-text-core": "glowTextCore",
  "glow-mark-core": "glowMarkCore",
  "glow-arrow-core": "glowArrowCore",
  "glow-arrow-width": "glowArrowWidth",
  "hide-arrow": "hideArrow",
  highlight: "nodeTarget",
  animation: "arrowStyle",
  "arrow-animation": "arrowStyle",
  "node-animation": "nodeStyle",
  speed: "speed",
  "step-ms": "durationMs",
  loop: "loop",
  background: "background",
  order: "order",
  shape: "shape",
  fit: "fit",
  arrows: "arrows",
  layout: "layout",
  spacing: "spacing",
  marching: "marchingStyle",
};

const arrowStyles = [
  "off",
  "none",
  "beam",
  "token",
  "marching",
  "marching-beam",
  "marching-token",
  "pipe",
];
export const FLOW_SCRIPT_NODE_STYLES = [
  "off",
  "none",
  "focus",
  "pulse",
  "ouroboros",
  "sparkle",
  "flowing-beam",
  "draw-on",
  "glint",
  "orbit",
  "ripple",
  "breathing",
  "wobble",
  "flicker",
  "spotlight",
];
const styleAlias = (value: string) =>
  value === "marching-tokens"
    ? "marching-token"
    : value === "marching-beams"
    ? "marching-beam"
    : value === "marching-dashes"
    ? "marching"
    : value;
const scriptColor = (value: string) =>
  /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value);

/** the longest label a shape can be asked to hold, in characters (D-224) */
export const MAX_LABEL_CHARS = 120;

const clean = (text: string) => text.trim();

/** a line of the script, with the number it has in the text (D-224) */
type ScriptLine = {
  text: string;
  no: number;
  /** where the trimmed text starts in the line as it was written */
  offset: number;
  /** the white space the line starts with, for the levels of a hierarchy (D-236) */
  indent: string;
};

const scriptLines = (text: string): ScriptLine[] =>
  text
    .split(/\r?\n/)
    .map((raw, index) => ({
      text: clean(raw),
      no: index + 1,
      offset: raw.length - raw.trimStart().length,
      indent: raw.slice(0, raw.length - raw.trimStart().length),
    }))
    .filter((line) => line.text.length > 0);

/** the pieces of a line between a separator, with where each starts and ends in the line */
const piecesOf = (line: ScriptLine, separator: string) => {
  const pieces: { text: string; start: number; end: number }[] = [];
  let at = 0;

  for (const part of line.text.split(separator)) {
    const lead = part.length - part.trimStart().length;
    const text = part.trim();

    pieces.push({
      text,
      start: line.offset + at + lead,
      end: line.offset + at + lead + text.length,
    });
    at += part.length + separator.length;
  }

  return pieces;
};

/** the whole of a line as a piece */
const wholeOf = (line: ScriptLine) => ({
  text: line.text,
  start: line.offset,
  end: line.offset + line.text.length,
});

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

  // a keyword: `@circle Plan` (D-230) - the same as `{Plan}`, said in words
  const keyword = /^@([A-Za-z]+)(?:\s+([\s\S]*))?$/.exec(text);

  if (keyword) {
    const name = keyword[1].toLowerCase() as FlowNodeShape;

    if (!FLOW_NODE_SHAPES.includes(name)) {
      return {
        label: text,
        problem: `@${
          keyword[1]
        } is not a shape. The shapes are ${FLOW_NODE_SHAPES.join(", ")}.`,
      };
    }

    const rest = clean(keyword[2] ?? "");

    if (!rest) {
      return {
        label: text,
        problem: `@${name} needs the words of the node after it.`,
      };
    }

    // the keyword is the shape; a mark inside it is read for its words only
    const inner = readShapeMark(rest);

    return { label: inner.label, shape: name, problem: inner.problem };
  }

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
    span?: { start: number; end: number },
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
      ...(span ? { source: { line, start: span.start, end: span.end } } : {}),
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
    const node = add(line.text, "step", line.no, {}, wholeOf(line));
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
    const items = piecesOf(line, "|").filter((piece) => piece.text);

    if (items.length === 0) {
      problem(line.no, "That tier has no items.");
      continue;
    }

    const tier = tiers.length;
    tiers.push(
      items.map((item) => add(item.text, "step", line.no, { tier }, item).id),
    );
  }

  return { ok: true, preset: "tiers", nodes, edges, tiers, problems };
};

const parseIntegration = (lines: ScriptLine[]): ParsedFlow => {
  const { nodes, edges, problems, add, link } = createGraph();
  const [hubLine, ...spokes] = lines;
  const hub = add(hubLine.text, "hub", hubLine.no, {}, wholeOf(hubLine));

  for (const spoke of spokes) {
    link(hub.id, add(spoke.text, "spoke", spoke.no, {}, wholeOf(spoke)).id);
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
      const lead =
        line.text.slice(1).length - line.text.slice(1).trimStart().length;

      // a bare "?" has nothing to ask: drop it
      if (!question) {
        problem(line.no, "A ? needs a question after it.");
        continue;
      }

      const node = add(
        question,
        "question",
        line.no,
        {},
        {
          start: line.offset + 1 + lead,
          end: line.offset + line.text.length,
        },
      );
      join(node.id);

      const branches = lines.slice(i + 1, i + 3);
      const ends: string[] = [];

      if (branches.length < 2) {
        problem(line.no, "A question needs two lines after it: yes and no.");
      }

      branches.forEach((branchLine, index) => {
        const branch = add(
          branchLine.text,
          "branch",
          branchLine.no,
          {},
          wholeOf(branchLine),
        );
        link(node.id, branch.id, index === 0 ? "yes" : "no");
        ends.push(branch.id);
      });

      // both branches rejoin whatever comes next
      open = ends.length ? ends : [node.id];
      i += branches.length;
    } else {
      const node = add(line.text, "step", line.no, {}, wholeOf(line));
      join(node.id);
      open = [node.id];
    }
  }

  return { ok: true, preset: "decision", nodes, edges, problems };
};

const parseNetwork = (
  lines: ScriptLine[],
  looks: ReadonlyMap<number, FlowScriptLook>,
): ParsedFlow => {
  const { nodes, edges, problems, problem, add } = createGraph();
  const byLabel = new Map<string, FlowScriptNode>();

  /** a node is created the first time its label is seen, with the mark it had then */
  const nodeFor = (
    raw: string,
    line: number,
    span: { start: number; end: number },
  ) => {
    const label = readShapeMark(raw).label;
    let node = byLabel.get(label);
    if (!node) {
      const original = lines.find((entry) => entry.no === line);
      const offset =
        original?.text.indexOf(
          raw,
          Math.max(0, span.start - (original?.offset ?? 0)),
        ) ?? -1;
      node = add(
        raw,
        "step",
        line,
        {},
        offset >= 0
          ? {
              start: (original?.offset ?? 0) + offset,
              end: (original?.offset ?? 0) + offset + raw.length,
            }
          : span,
      );
      byLabel.set(node.label, node);
    }
    return node;
  };

  for (const original of lines) {
    const route: FlowRouteBend[] = [];
    let count: number | undefined;
    const text = original.text.replace(
      /(?:^|\s)(@(?:elbow|curve|straight)(?::[^\s]+)?|@fork-[^\s]+)(?=\s|$)/g,
      (_, word: string) => {
        if (word.startsWith("@fork-")) {
          const value = Number(word.slice(6));
          if (!Number.isSafeInteger(value) || value < 2) {
            problem(
              original.no,
              "A fork needs a whole number of branches, at least 2: @fork-2.",
            );
          } else {
            count = value;
          }
        } else {
          const parts = word.slice(1).split(":");
          const [kind, side] = parts;
          if (
            parts.length > 2 ||
            (side && !["left", "right", "in", "out"].includes(side))
          ) {
            problem(
              original.no,
              `Unknown route side ${side}; use left, right, in or out.`,
            );
          } else {
            route.push({
              kind: kind as FlowRouteBend["kind"],
              ...(side ? { side: side as FlowRouteBend["side"] } : {}),
            });
          }
        }
        return "";
      },
    );
    if (route.length > 4) {
      problem(
        original.no,
        "A route takes at most four bend words. Split a longer route with another node.",
      );
    }
    if (count && route.length) {
      problem(
        original.no,
        "A fork already has a shared trunk and bar. Remove its bend words or put the routed arrow on another line.",
      );
    }
    const line = { ...original, text: text.trim() };
    for (const word of line.text.match(/(?:^|\s)@[^\s]+/g) ?? []) {
      if (
        !FLOW_NODE_SHAPES.some(
          (shape) => word.trim().toLowerCase() === `@${shape}`,
        )
      ) {
        problem(
          line.no,
          `Unknown word ${word
            .trim()
            .slice(
              0,
              64,
            )}. Use @elbow, @curve, @straight or @fork-N for a route; use @fill:#abc, @outline:#abc, @glow or @style:token for looks.`,
        );
      }
    }
    if ((route.length || count) && !line.text.includes("->")) {
      problem(line.no, "A route needs an arrow: A -> B @elbow.");
    }
    if (/(?:^|\s):(?:left|right|in|out)\b/.test(line.text)) {
      problem(line.no, "A side needs a bend: write @elbow:left.");
    }
    const pieces = piecesOf(line, "->");
    const labels = pieces.filter((piece) => piece.text);
    if (count && pieces.length === 2 && labels.length === 1) {
      const reverse = !pieces[0].text;
      const trunk = nodeFor(labels[0].text, line.no, labels[0]);
      for (let index = 0; index < count; index++) {
        edges.push({
          from: reverse ? "" : trunk.id,
          to: reverse ? trunk.id : "",
          fork: { id: `fork-${line.no}-0`, count, index, reverse, loose: true },
        });
      }
      continue;
    }

    if (pieces.length > 1 && labels.length < pieces.length) {
      problem(line.no, "A -> needs a name on each side.");
    }

    if (labels.length === 1) {
      nodeFor(labels[0].text, line.no, labels[0]);
      continue;
    }

    // Lists expand to branches; a fork retains empty ends without making nodes.
    for (let i = 0; i < labels.length - 1; i++) {
      const left = labels[i].text
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      const right = labels[i + 1].text
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      if (!left.length || !right.length) {
        problem(
          line.no,
          "A list needs a node name between commas; remove its empty entries.",
        );
        continue;
      }
      const reverse = left.length > 1;
      const names = reverse ? left : right;
      if (
        count &&
        (names.length > count || (left.length > 1 && right.length > 1))
      ) {
        problem(
          line.no,
          "A fork has one trunk and at most its branch count in names; increase @fork-N.",
        );
        continue;
      }
      const trunk = nodeFor(
        reverse ? right[0] : left[0],
        line.no,
        reverse ? labels[i + 1] : labels[i],
      );
      const total = count ?? names.length;
      for (let branch = 0; branch < total; branch++) {
        const name = names[branch];
        const end = name
          ? nodeFor(name, line.no, reverse ? labels[i] : labels[i + 1]).id
          : "";
        edges.push({
          from: reverse ? end : trunk.id,
          to: reverse ? trunk.id : end,
          ...(route.length ? { route } : {}),
          ...(Object.keys(looks.get(line.no) ?? {}).length
            ? { look: looks.get(line.no) }
            : {}),
          ...(count
            ? {
                fork: {
                  id: `fork-${line.no}-${i}`,
                  count,
                  index: branch,
                  reverse,
                  loose: !name,
                },
              }
            : {}),
        });
      }
    }
  }

  return { ok: true, preset: "network", nodes, edges, problems };
};

/** the most rings a target and the most sets a venn take (D-235) */
export const MAX_TARGET_RINGS = 6;
export const MAX_VENN_SETS = 4;

/** the parts of a gallery chart that are only a run of items, no arrows */
const parseItems = (
  preset: "list" | "pyramid" | "funnel" | "timeline" | "target" | "venn",
  lines: ScriptLine[],
): ParsedFlow => {
  const { nodes, edges, problems, problem, add } = createGraph();
  const kind: FlowNodeKind =
    preset === "target"
      ? "ring"
      : preset === "venn"
      ? "set"
      : preset === "pyramid" || preset === "funnel"
      ? "block"
      : "step";
  const limit =
    preset === "target"
      ? MAX_TARGET_RINGS
      : preset === "venn"
      ? MAX_VENN_SETS
      : Infinity;

  for (const line of lines) {
    if (nodes.length >= limit) {
      problem(
        line.no,
        preset === "target"
          ? `A target takes ${MAX_TARGET_RINGS} rings at most.`
          : `A venn takes ${MAX_VENN_SETS} sets at most.`,
      );
    }

    add(line.text, kind, line.no, {}, wholeOf(line));
  }

  return { ok: true, preset, nodes, edges, problems };
};

/** a grid: a row for each line, the cells of a row between bars (D-234) */
const parseGrid = (
  preset: "grid" | "matrix",
  lines: ScriptLine[],
): ParsedFlow => {
  const { nodes, edges, problems, problem, add } = createGraph();
  const rows: string[][] = [];

  for (const line of lines) {
    const header = line.text.startsWith("#");
    // the pieces of the line without its #, still counted from the line's own start
    const body: ScriptLine = header
      ? {
          ...line,
          text: line.text.slice(1).trim(),
          offset:
            line.offset +
            1 +
            (line.text.slice(1).length - line.text.slice(1).trimStart().length),
        }
      : line;
    const cells = piecesOf(body, "|");

    if (preset === "matrix" && cells.length > 2) {
      problem(
        line.no,
        "A matrix has two columns: a row has two cells at most.",
      );
    }

    if (cells.every((cell) => !cell.text)) {
      problem(line.no, "That row has no cells.");
      continue;
    }

    const row = rows.length;
    const ids: string[] = [];

    cells.forEach((cell, col) => {
      // a cell with nothing in it is a gap, and is not drawn
      if (!cell.text) {
        return;
      }

      ids.push(
        add(cell.text, header ? "header" : "cell", line.no, { row, col }, cell)
          .id,
      );
    });

    rows.push(ids);
  }

  return { ok: true, preset, nodes, edges, rows, problems };
};

/** how many levels a line's indentation is: a tab, or two spaces (D-236) */
const depthOf = (indent: string) =>
  [...indent].filter((c) => c === "\t").length +
  Math.floor([...indent].filter((c) => c === " ").length / 2);

/** a tree: one line for each node, its level the indentation it starts with (D-236) */
const parseHierarchy = (lines: ScriptLine[]): ParsedFlow => {
  const { nodes, edges, problems, problem, add, link } = createGraph();
  /** the last node at each level, so that a node finds its parent */
  const lastAt: FlowScriptNode[] = [];

  lines.forEach((line, index) => {
    let depth = depthOf(line.indent);

    if (index === 0 && depth > 0) {
      problem(line.no, "The first line is the root: it cannot be indented.");
      depth = 0;
    } else if (depth > lastAt.length) {
      problem(
        line.no,
        "A line is one level under the line above it at most: indent it once.",
      );
      depth = lastAt.length;
    }

    const node = add(line.text, "step", line.no, { depth }, wholeOf(line));

    if (depth > 0) {
      link(lastAt[depth - 1].id, node.id);
    }

    lastAt[depth] = node;
    lastAt.length = depth + 1;
  });

  return { ok: true, preset: "hierarchy", nodes, edges, problems };
};

/**
 * Reads a script for a preset. A script with no usable line builds **nothing**
 * and says so - it never builds an empty chart.
 */
export const parseFlowScript = (
  preset: FlowPresetId,
  text: string,
): ParsedFlow => {
  const originals = scriptLines(text);
  const settings: Record<string, string | number | boolean> = {};
  const looks = new Map<number, FlowScriptLook>();
  const problems: FlowScriptProblem[] = [];
  const lines: ScriptLine[] = [];
  let inBody = false;
  for (const original of originals) {
    const header = /^([a-z-]+):\s+(.+)$/.exec(original.text);
    if (header && FLOW_SCRIPT_LOOK_WORDS[header[1]]) {
      const [, word, raw] = header;
      const key = FLOW_SCRIPT_LOOK_WORDS[word];
      const value = styleAlias(raw.trim());
      let read: string | number | boolean = value;
      let valid = !inBody;
      let advice = "Put this setting before the first node.";
      if (key.endsWith("Color") || key === "background") {
        advice = "Use a hexadecimal colour such as #e7f5ff.";
        valid = valid && scriptColor(value);
      } else if (
        (key.startsWith("glow") &&
          !key.endsWith("Strength") &&
          !key.endsWith("Width") &&
          !key.endsWith("Core")) ||
        key === "hideArrow" ||
        key === "loop"
      ) {
        valid = valid && ["true", "false"].includes(value);
        advice = "Use true or false.";
        read = value === "true";
      } else if (key.endsWith("Strength")) {
        read = Number(value);
        valid = valid && Number.isInteger(read) && read >= 1 && read <= 100;
        advice = "Use a whole number from 1 to 100 (50 is the usual glow).";
      } else if (["speed", "durationMs", "spacing"].includes(key)) {
        advice = "Use a positive finite number.";
        read = Number(value) * (key === "speed" ? 240 : 1);
        valid = valid && Number.isFinite(read) && read > 0;
        if (key === "spacing" && valid && read < 16) {
          // the engine never draws marks closer than 16, so say it here
          valid = false;
          advice = "Use 16 or more: marks closer than that run together.";
        }
      } else {
        const allowed: Record<string, readonly string[]> = {
          arrowStyle: arrowStyles,
          marchingStyle: [
            "none",
            "marching",
            "marching-beam",
            "marching-token",
          ],
          nodeStyle: FLOW_SCRIPT_NODE_STYLES,
          nodeTarget: [
            "shape",
            "shape-box",
            "shape-text",
            "box",
            "letters",
            "all",
          ],
          order: ["forward", "reverse"],
          shape: ["own", ...FLOW_NODE_SHAPES],
          fit: ["page", "spread", "larger"],
          arrows: ["own", "none"],
          layout: ["TB", "LR"],
          ...Object.fromEntries(
            ["Shape", "Text", "Mark", "Arrow"].flatMap((part) => [
              [`glow${part}Width`, ["small", "normal", "large"]],
              [`glow${part}Core`, ["soft", "white", "colour"]],
            ]),
          ),
        };
        valid = valid && (allowed[key]?.includes(value) ?? false);
        advice = `Use ${(allowed[key] ?? []).join(", ")}.`;
      }
      if (valid) {
        settings[key] = read;
      } else {
        problems.push({
          line: original.no,
          message: `Invalid ${word}. ${
            inBody ? "Move the setting above the first node. " : ""
          }${advice}`,
        });
      }
      continue;
    }
    inBody = true;
    const look: FlowScriptLook = {};
    const body = original.text.replace(
      /(?:^|\s)@(fill:[^\s]+|outline:[^\s]+|glow|style:[^\s]+)(?=\s|$)/g,
      (_, token: string) => {
        const [word, raw] = token.split(":");
        if (word === "glow") {
          Object.assign(
            look,
            original.text.includes("->")
              ? { glowArrow: true, glowMark: true }
              : { glowShape: true },
          );
        } else if (
          (word === "fill" || word === "outline") &&
          scriptColor(raw)
        ) {
          look[word] = raw;
        } else if (
          word === "style" &&
          (original.text.includes("->")
            ? arrowStyles.includes(styleAlias(raw))
            : FLOW_SCRIPT_NODE_STYLES.includes(raw))
        ) {
          if (original.text.includes("->")) {
            look.arrowStyle = styleAlias(raw);
          } else {
            look.nodeStyle = raw;
          }
        } else {
          problems.push({
            line: original.no,
            message: `Unknown or invalid @${token.slice(0, 64)}. ${
              word === "fill" || word === "outline"
                ? "Use a hexadecimal colour such as #e7f5ff."
                : `Use ${(original.text.includes("->")
                    ? arrowStyles
                    : FLOW_SCRIPT_NODE_STYLES
                  ).join(", ")}.`
            }`,
          });
        }
        return "";
      },
    );
    looks.set(original.no, look);
    lines.push({ ...original, text: body.trim() });
  }

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
      parsed = parseNetwork(lines, looks);
      break;
    case "list":
    case "pyramid":
    case "funnel":
    case "timeline":
    case "target":
    case "venn":
      parsed = parseItems(preset, lines);
      break;
    case "grid":
    case "matrix":
      parsed = parseGrid(preset, lines);
      break;
    case "hierarchy":
      parsed = parseHierarchy(lines);
      break;
  }

  // a script whose every line was an empty tier, a bare "?" or a stray "->"
  if (parsed.ok && preset !== "network") {
    for (const line of lines) {
      for (const word of line.text.match(/(?:^|\s)@[^\s]+/g) ?? []) {
        const token = word.trim();
        if (
          !FLOW_NODE_SHAPES.some(
            (shape) => token.toLowerCase() === `@${shape}`,
          ) &&
          !/^@(elbow|curve|straight|fork-)/.test(token) &&
          !parsed.problems.some((problem) => problem.line === line.no)
        ) {
          parsed.problems.push({
            line: line.no,
            message: `Unknown word ${token.slice(
              0,
              64,
            )}. Use @fill:#abc, @outline:#abc, @glow or @style:focus for a node look.`,
          });
        }
      }
      if (/@(?:elbow|curve|straight|fork-\d+)\b/.test(line.text)) {
        parsed.problems.push({
          line: line.no,
          message: "Routes and forks need the Network preset with A -> B.",
        });
      }
    }
  }
  if (parsed.ok) {
    parsed.problems.push(...problems);
    if (Object.keys(settings).length) {
      parsed.settings = settings;
    }
    for (const node of parsed.nodes) {
      const look = node.source && looks.get(node.source.line);
      if (
        look &&
        Object.keys(look).length &&
        !originals
          .find((line) => line.no === node.source!.line)
          ?.text.includes("->")
      ) {
        node.look = look;
      }
    }
  }
  if (parsed.ok && parsed.nodes.length === 0) {
    if (
      originals.some((line) =>
        /@(?:elbow|curve|straight|fork-)/.test(line.text),
      ) &&
      parsed.problems.length
    ) {
      return {
        ok: false,
        error: parsed.problems
          .map((problem) => `Line ${problem.line}: ${problem.message}`)
          .join("\n"),
      };
    }
    return { ok: false, error: EMPTY_SCRIPT_ERROR };
  }

  return parsed;
};

/**
 * The script with one node's shape changed (D-230): the node's words are written
 * with the keyword for the shape - `@circle Plan` - or with no mark at all when
 * `shape` is `null`, which gives the node back to the chart's shape. The rest of
 * the script, line for line and character for character, is as it was. Returns
 * `null` for a node that was not read from a script.
 */
export const withNodeShape = (
  script: string,
  node: FlowScriptNode,
  shape: FlowNodeShape | null,
): string | null => {
  if (!node.source) {
    return null;
  }

  const lines = script.split("\n");
  const line = lines[node.source.line - 1];

  if (line === undefined) {
    return null;
  }

  const piece = line.slice(node.source.start, node.source.end);
  const words = readShapeMark(piece).label;
  const written = shape ? `@${shape} ${words}` : words;

  lines[node.source.line - 1] =
    line.slice(0, node.source.start) + written + line.slice(node.source.end);

  return lines.join("\n");
};
