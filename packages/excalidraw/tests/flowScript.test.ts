/**
 * AC-196 - the script becomes nodes by the rules (D-164).
 *
 * Pure-function tests: text in, a graph out. No DOM, no canvas.
 */

import { describe, expect, it } from "vitest";

import { EMPTY_SCRIPT_ERROR, parseFlowScript } from "../scene/flowScript";

import type { ParsedFlow } from "../scene/flowScript";

type Flow = Extract<ParsedFlow, { ok: true }>;

/** the parse, with the "it worked" check done once */
const parsed = (...args: Parameters<typeof parseFlowScript>): Flow => {
  const result = parseFlowScript(...args);

  if (!result.ok) {
    throw new Error(`expected a flow, got: ${result.error}`);
  }

  return result;
};

const labels = (flow: Flow) => flow.nodes.map((node) => node.label);

/** an edge, read back as "from label -> to label" */
const edgeNames = (flow: Flow) => {
  const label = (id: string) => flow.nodes.find((n) => n.id === id)!.label;

  return flow.edges.map(
    (edge) =>
      `${label(edge.from)} -> ${label(edge.to)}${
        edge.label ? ` (${edge.label})` : ""
      }`,
  );
};

describe("flow script (AC-196)", () => {
  it("AC-196 blank lines are ignored and labels are trimmed", () => {
    const flow = parsed(
      "process",
      "\n  Plan  \n\n\t\r\n Teach\t\n   \nReview\n\n",
    );

    expect(labels(flow)).toEqual(["Plan", "Teach", "Review"]);
    expect(edgeNames(flow)).toEqual(["Plan -> Teach", "Teach -> Review"]);

    // a loop returns to its first step
    expect(edgeNames(parsed("cycle", "a\nb\nc"))).toEqual([
      "a -> b",
      "b -> c",
      "c -> a",
    ]);

    // one step has nothing to loop back from
    expect(parsed("cycle", "only").edges).toEqual([]);
  });

  it("AC-196 a tier line splits into its items", () => {
    const flow = parsed("tiers", "Web | Mobile\n\nAPI\n Database |  Cache | ");

    expect(flow.tiers).toHaveLength(3);
    expect(
      flow.tiers!.map((tier) =>
        tier.map((id) => flow.nodes.find((n) => n.id === id)!.label),
      ),
    ).toEqual([["Web", "Mobile"], ["API"], ["Database", "Cache"]]);

    // each node knows its tier, and a tier chart has no arrows
    expect(flow.nodes.map((n) => n.tier)).toEqual([0, 0, 1, 2, 2]);
    expect(flow.edges).toEqual([]);

    // a line that is only separators is not a tier
    expect(parsed("tiers", "a\n | | \nb").tiers).toHaveLength(2);
  });

  it("AC-196 the first line of an integration is the hub", () => {
    const flow = parsed("integration", "Our app\nStripe\nSlack\nEmail");

    expect(flow.nodes.map((n) => [n.label, n.kind])).toEqual([
      ["Our app", "hub"],
      ["Stripe", "spoke"],
      ["Slack", "spoke"],
      ["Email", "spoke"],
    ]);
    expect(edgeNames(flow)).toEqual([
      "Our app -> Stripe",
      "Our app -> Slack",
      "Our app -> Email",
    ]);
  });

  it("AC-196 a question takes the next two lines as its branches", () => {
    const flow = parsed(
      "decision",
      "Start\n? Is it raining?\nTake an umbrella\nWear sunglasses\nGo outside",
    );

    expect(flow.nodes.map((n) => [n.label, n.kind])).toEqual([
      ["Start", "step"],
      ["Is it raining?", "question"],
      ["Take an umbrella", "branch"],
      ["Wear sunglasses", "branch"],
      ["Go outside", "step"],
    ]);

    // the first branch is yes, the second is no, and both rejoin what follows
    expect(edgeNames(flow)).toEqual([
      "Start -> Is it raining?",
      "Is it raining? -> Take an umbrella (yes)",
      "Is it raining? -> Wear sunglasses (no)",
      "Take an umbrella -> Go outside",
      "Wear sunglasses -> Go outside",
    ]);

    // a bare "?" asks nothing and is dropped, and a question at the very end
    // takes the branches it has
    expect(labels(parsed("decision", "?\nA"))).toEqual(["A"]);
    expect(edgeNames(parsed("decision", "? Q\nonly yes"))).toEqual([
      "Q -> only yes (yes)",
    ]);
  });

  it("AC-196 an edge line creates each node once", () => {
    const flow = parsed("network", "A -> B\nB -> C\nA -> C\nD\nB -> A -> D");

    expect(labels(flow)).toEqual(["A", "B", "C", "D"]);
    expect(edgeNames(flow)).toEqual([
      "A -> B",
      "B -> C",
      "A -> C",
      "B -> A",
      "A -> D",
    ]);

    // ids are handed out in the order the nodes were first seen
    expect(flow.nodes.map((n) => n.id)).toEqual(["n0", "n1", "n2", "n3"]);
  });

  it("AC-196 an empty script builds nothing and says so", () => {
    for (const preset of [
      "process",
      "decision",
      "steps",
      "cycle",
      "tiers",
      "integration",
      "network",
    ] as const) {
      expect(parseFlowScript(preset, "")).toEqual({
        ok: false,
        error: EMPTY_SCRIPT_ERROR,
      });
      expect(parseFlowScript(preset, " \n\t\n  ")).toEqual({
        ok: false,
        error: EMPTY_SCRIPT_ERROR,
      });
    }

    // lines that are only structure have no node in them either
    expect(parseFlowScript("tiers", "|\n | ").ok).toBe(false);
    expect(parseFlowScript("decision", "?\n?").ok).toBe(false);
    expect(parseFlowScript("network", "->\n -> ->").ok).toBe(false);
  });
});
