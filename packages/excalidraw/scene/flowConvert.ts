/**
 * Switching the kind of a chart keeps its words (D-233).
 *
 * The scripts of the kinds are written in different ways - lines, rows between
 * bars, \`A -> B\`, indentation - so a script is **written again** for the new
 * kind, from what the old one said: the words of the nodes in their order, with
 * the shape keywords they had (D-230), and the structure the new kind can say -
 * rows, arrows, levels.
 *
 * Everything here is pure.
 */

import { parseFlowScript } from "./flowScript";

import type { FlowNodeShape, FlowPresetId, FlowScriptNode } from "./flowScript";

/** the words of a node, with its shape keyword when it has one (D-230) */
const textOf = (node: FlowScriptNode) =>
  node.shape ? `@${node.shape} ${node.label}` : node.label;

/** what a kind of script says about its nodes besides their words */
type Structure = {
  nodes: FlowScriptNode[];
  /** the node ids of each row or tier, in order; the rows of a hierarchy are its levels */
  rows: string[][] | null;
  /** the joins the script made, as node ids */
  edges: { from: string; to: string }[];
  /** the first row was a header (grid and matrix only) */
  header: boolean;
};

const structureOf = (
  preset: FlowPresetId,
  script: string,
): Structure | null => {
  const parsed = parseFlowScript(preset, script);

  if (!parsed.ok) {
    return null;
  }

  let rows: string[][] | null = null;

  if (parsed.tiers) {
    rows = parsed.tiers;
  } else if (parsed.rows) {
    rows = parsed.rows;
  } else if (preset === "hierarchy") {
    // the levels of a tree are its rows
    const byDepth = new Map<number, string[]>();

    for (const node of parsed.nodes) {
      byDepth.set(node.depth ?? 0, [
        ...(byDepth.get(node.depth ?? 0) ?? []),
        node.id,
      ]);
    }

    rows = [...byDepth.keys()]
      .sort((a, b) => a - b)
      .map((d) => byDepth.get(d)!);
  }

  return {
    nodes: parsed.nodes,
    rows,
    edges: parsed.edges.map(({ from, to }) => ({ from, to })),
    header: parsed.nodes.some((node) => node.kind === "header"),
  };
};

/** rows of at most \`width\` cells: a longer row goes on to the next */
const chunked = (ids: string[], width: number) => {
  const out: string[][] = [];

  for (let i = 0; i < ids.length; i += width) {
    out.push(ids.slice(i, i + width));
  }

  return out;
};

/**
 * The script of \`script\`, written for the kind \`to\`. A script that cannot be
 * read is returned as it was.
 */
export const convertScript = (
  from: FlowPresetId,
  script: string,
  to: FlowPresetId,
): string => {
  if (from === to) {
    return script;
  }

  const structure = structureOf(from, script);

  if (!structure || structure.nodes.length === 0) {
    return script;
  }

  const byId = new Map(structure.nodes.map((node) => [node.id, node]));
  const text = (id: string) => textOf(byId.get(id)!);
  // the order of the nodes: rows read across and down when there are rows
  // (a tree is read as it is written, and its levels only make rows for a table)
  const order =
    structure.rows && from !== "hierarchy"
      ? structure.rows.flat()
      : structure.nodes.map((node) => node.id);
  const lines = (ids: string[]) => ids.map(text).join("\n");

  switch (to) {
    case "tiers": {
      const rows = structure.rows ?? order.map((id) => [id]);

      return rows.map((row) => row.map(text).join(" | ")).join("\n");
    }

    case "grid":
    case "matrix": {
      const width = to === "matrix" ? 2 : 3;
      const rows = (structure.rows ?? chunked(order, width)).flatMap((row) =>
        to === "matrix" ? chunked(row, 2) : [row],
      );

      return rows
        .map(
          (row, index) =>
            // only a grid has a header row, and only when it had one
            `${
              to === "grid" && structure.header && index === 0 ? "# " : ""
            }${row.map(text).join(" | ")}`,
        )
        .join("\n");
    }

    case "network": {
      if (structure.edges.length === 0) {
        return lines(order);
      }

      const joined = new Set<string>();
      const written = structure.edges.map(({ from: a, to: b }) => {
        joined.add(a);
        joined.add(b);

        return `${text(a)} -> ${text(b)}`;
      });

      return [
        ...written,
        ...order.filter((id) => !joined.has(id)).map(text),
      ].join("\n");
    }

    case "hierarchy": {
      const [root, ...rest] = order;

      // a tree stays a tree; anything else is its first line with the others under it
      if (from === "hierarchy") {
        return script;
      }

      return [text(root), ...rest.map((id) => `  ${text(id)}`)].join("\n");
    }

    // decision, process, steps, cycle, integration, list, pyramid, funnel,
    // timeline, target and venn: the words, a line for each node, in order
    default:
      return lines(order);
  }
};

/** the shape keywords of the nodes of a script, for the tests of what comes across */
export const shapesOfScript = (
  preset: FlowPresetId,
  script: string,
): (FlowNodeShape | undefined)[] => {
  const structure = structureOf(preset, script);

  return structure ? structure.nodes.map((node) => node.shape) : [];
};
