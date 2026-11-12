import { describe, expect, it } from "vitest";

import { parseFlowScript } from "../scene/flowScript";

const network = (script: string) => {
  const result = parseFlowScript("network", script);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
};

describe("AC-579 route script", () => {
  it("a line containing only a route reports Line 1", () => {
    const result = parseFlowScript("network", "@elbow");
    expect(!result.ok && result.error).toContain("Line 1");
  });
  it("reads bends in order and preserves plain arrows", () => {
    const flow = network(
      "A -> B @elbow:left @elbow:right @curve:in @curve:out\nB -> C",
    );
    expect(flow.problems).toEqual([]);
    expect(flow.edges[0]).toMatchObject({
      route: [
        { kind: "elbow", side: "left" },
        { kind: "elbow", side: "right" },
        { kind: "curve", side: "in" },
        { kind: "curve", side: "out" },
      ],
    });
    expect(flow.nodes.map((node) => node.label)).toEqual(["A", "B", "C"]);
    expect(flow.edges[1]).not.toHaveProperty("route");
    expect(network("A -> B @straight").edges[0].route).toEqual([
      { kind: "straight" },
    ]);
  });

  it.each([
    "A -> B @unknown",
    "A -> B @elbow:up",
    "A -> B @elbow:left:up",
    "A -> B @elbow @elbow @elbow @elbow @elbow",
    "A -> B :left",
    "@elbow",
  ])("reports the original line for %s", (bad) => {
    const result = parseFlowScript("network", `First\n\n${bad}`);
    expect(result.ok && result.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: 3 })]),
    );
    const late = parseFlowScript(
      "network",
      `${Array.from({ length: 39 }, () => "First").join("\n")}\n${bad}`,
    );
    expect(late.ok && late.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: 40 })]),
    );
  });

  it("reports routes outside network without silently changing a label", () => {
    const result = parseFlowScript("process", "A\nB @curve");
    expect(result.ok && result.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 2,
          message: expect.stringContaining("Network"),
        }),
      ]),
    );
  });
});
