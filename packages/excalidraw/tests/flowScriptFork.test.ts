import { describe, expect, it } from "vitest";

import { parseFlowScript, withNodeShape } from "../scene/flowScript";

const read = (text: string) => {
  const flow = parseFlowScript("network", text);
  if (!flow.ok) {
    throw new Error(flow.error);
  }
  return flow;
};

describe("AC-597 fork script", () => {
  it("reads forward, reverse, loose and nested forks without a branch cap", () => {
    const forward = read("A -> B, C @fork-4\nB -> D, E @fork-2");
    expect(forward.problems).toEqual([]);
    expect(forward.edges).toHaveLength(6);
    expect(forward.edges.slice(0, 4).map((edge) => edge.fork?.index)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(forward.edges.filter((edge) => edge.fork?.loose)).toHaveLength(2);
    const reverse = read("B, C -> A @fork-3");
    expect(reverse.edges).toHaveLength(3);
    expect(
      reverse.edges.every(
        (edge) =>
          edge.to === reverse.nodes.find((node) => node.label === "A")!.id,
      ),
    ).toBe(true);
    expect(read("A -> B @fork-101").edges).toHaveLength(101);
    const loose = read("A -> @fork-3");
    expect(loose.problems).toEqual([]);
    expect(loose.edges).toHaveLength(3);
    expect(loose.edges.every((edge) => edge.fork?.loose)).toBe(true);
  });

  it("plain lists produce independent arrows", () => {
    const flow = read("A -> B, C");
    expect(flow.edges).toHaveLength(2);
    expect(flow.edges.every((edge) => !edge.fork)).toBe(true);
    expect(
      withNodeShape(
        "A -> B, C",
        flow.nodes.find((node) => node.label === "C")!,
        "diamond",
      ),
    ).toBe("A -> B, @diamond C");
  });

  it.each([
    "A -> B, C, D @fork-2",
    "A -> B @fork-1",
    "A -> B @fork-2.5",
    "A -> B @fork-2 @curve",
  ])("names the line for invalid fork %s", (script) => {
    expect(read(`Root\n${script}`).problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: 2 })]),
    );
  });
});
