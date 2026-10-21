/**
 * The auto-layout of a flowchart.
 *
 * `dagre` lays a graph out in layers. The fork's own drawing stays the source
 * of truth for the *order* — the arrows decide it — so the layout only has to
 * place the shapes the arrows connect, and it does that as an ordinary scene
 * mutation (see `actionFlowLayout`), so it is undoable and it is saved.
 *
 * A **cycle is broken, not refused** (D-62): the owner's own words are "this
 * entire thing is in a loop", so a flowchart whose arrows form a cycle is
 * expected. `dagre.layout()` does not tolerate one, so the cycle is found with
 * `graphlib.alg.findCycles(g)` and its back-edge is dropped. The dropped edge
 * is the loop, and the animation repeats that step.
 */

import * as dagre from "dagre";

import type { FlowBox, FlowEdge } from "./flowOrder";

export type FlowLayoutNode = {
  id: string;
  box: FlowBox;
};

export type FlowLayoutResult = {
  /** the new scene-space top-left of every node */
  positions: Map<string, { x: number; y: number }>;
  /** the edges that were dropped to break a cycle */
  droppedEdges: FlowEdge[];
};

/** how far apart dagre puts two shapes on the same rank */
const NODE_SEPARATION = 40;
/** how far apart dagre puts two ranks */
const RANK_SEPARATION = 80;
/** the margin around the whole laid-out graph */
const MARGIN = 20;

/**
 * Drops the back-edge of every cycle, so the graph dagre is handed is acyclic.
 *
 * `findCycles` reports the strongly connected components, so the members of a
 * reported cycle are not necessarily a path: the back-edge is the last member
 * pointing back at the first, and when the component is not a path at all, any
 * edge inside it will do.
 */
const breakCycles = (graph: dagre.graphlib.Graph): FlowEdge[] => {
  const dropped: FlowEdge[] = [];

  // a graph has at most as many cycles as it has edges, so this terminates
  for (let guard = 0; guard < 1000; guard++) {
    const cycles = dagre.graphlib.alg.findCycles(graph);

    if (!cycles.length) {
      break;
    }

    let removed = false;

    for (const cycle of cycles) {
      if (cycle.length < 2) {
        // a self-edge: dagre handles it itself
        continue;
      }

      const from = cycle[cycle.length - 1];
      const to = cycle[0];

      if (graph.hasEdge(from, to)) {
        graph.removeEdge(from, to);
        dropped.push({ from, to });
        removed = true;
        break;
      }

      for (const source of cycle) {
        for (const target of graph.successors(source) ?? []) {
          if (!cycle.includes(target)) {
            continue;
          }

          graph.removeEdge(source, target);
          dropped.push({ from: source, to: target });
          removed = true;
          break;
        }

        if (removed) {
          break;
        }
      }

      if (removed) {
        break;
      }
    }

    if (!removed) {
      break;
    }
  }

  return dropped;
};

/**
 * Lays the flow out in layers.
 *
 * `origin` is where the laid-out group is placed in scene space — the caller
 * passes the selection's own top-left, so the flowchart stays where the user
 * drew it and only its arrangement changes.
 */
export const layoutFlow = (
  nodes: readonly FlowLayoutNode[],
  edges: readonly FlowEdge[],
  origin: { x: number; y: number } = { x: 0, y: 0 },
): FlowLayoutResult => {
  const graph = new dagre.graphlib.Graph();

  graph.setGraph({
    rankdir: "TB",
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: node.box.width,
      height: node.box.height,
    });
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.from) || !graph.hasNode(edge.to)) {
      continue;
    }

    if (edge.from === edge.to) {
      continue;
    }

    graph.setEdge(edge.from, edge.to);
  }

  const droppedEdges = breakCycles(graph);

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  let minLeft = Infinity;
  let minTop = Infinity;

  for (const node of nodes) {
    const laidOut = graph.node(node.id);

    // dagre's node x/y is the node's CENTRE, so the top-left is half a box up
    // and to the left of it
    const left = laidOut.x - laidOut.width / 2;
    const top = laidOut.y - laidOut.height / 2;

    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);

    positions.set(node.id, { x: left, y: top });
  }

  if (positions.size) {
    const dx = origin.x - minLeft;
    const dy = origin.y - minTop;

    for (const [id, position] of positions) {
      positions.set(id, { x: position.x + dx, y: position.y + dy });
    }
  }

  return { positions, droppedEdges };
};
