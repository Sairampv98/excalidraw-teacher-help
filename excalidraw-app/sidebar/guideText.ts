/**
 * What the Flow tab's guide says (D-225).
 *
 * Written for a teacher, in our own words: nothing is fetched and nothing is
 * copied (D-169). Each built-in preset has its rules, a sentence about what the
 * chart looks like, and the example the studio already knows; a custom preset
 * (D-228) is described by the layout it was made with.
 */

import type { FlowPresetId } from "@excalidraw/excalidraw/scene/flowScript";
import type { FlowCustomLayout } from "@excalidraw/excalidraw/scene/flowCustomPresets";

export type FlowGuideEntry = {
  /** the rules of the script, in plain words */
  rules: string[];
  /** what the chart looks like, in a sentence */
  looks: string;
};

export const FLOW_GUIDE: Record<FlowPresetId, FlowGuideEntry> = {
  process: {
    rules: [
      "Write one line for each step, in the order they happen.",
      "Each step is joined to the next with an arrow.",
      "A blank line is ignored.",
    ],
    looks:
      "A row of boxes joined by arrows. A long chain turns back on itself in rows, so it stays on the page.",
  },
  decision: {
    rules: [
      "Write one line for each step, in order.",
      "A line that starts with ? is a question. The next two lines are its answers: the first is the yes, the second is the no.",
      "After the answers, the chart carries on from both of them.",
    ],
    looks:
      "A diamond for the question, a green box for yes and a red one for no, joining up again after.",
  },
  steps: {
    rules: [
      "Write one line for each step, in order.",
      "The steps are numbered for you, so leave the numbers out.",
    ],
    looks: "A numbered run of boxes, each carrying its number.",
  },
  cycle: {
    rules: [
      "Write one line for each step, in order.",
      "The last step leads back to the first, so the chart goes round.",
    ],
    looks:
      "The steps placed round a ring, with an arrow from each to the next.",
  },
  tiers: {
    rules: [
      "Write one line for each tier, the top one first.",
      "Put the items of a tier on its line, with a | between them.",
    ],
    looks:
      "Stacked layers, each with its own items and its own colour, and no arrows.",
  },
  integration: {
    rules: [
      "The first line is the hub: the thing in the middle.",
      "Each line after it is something the hub connects to.",
    ],
    looks:
      "One shape in the middle with the others round it, each joined to it by an arrow.",
  },
  network: {
    rules: [
      "Write one line for each node, or write A -> B to join two of them.",
      "A node is made the first time its name appears, so you do not have to list them first.",
      "A -> B -> C joins A to B and B to C.",
    ],
    looks:
      "Nodes joined by the arrows you wrote, laid out so that none overlap.",
  },
};

/** the guide for a custom preset: its layout decides the rules (D-228) */
export const GUIDE_OF_LAYOUT: Record<FlowCustomLayout, FlowPresetId> = {
  "top-down": "process",
  "left-right": "process",
  ring: "cycle",
  tiers: "tiers",
  hub: "integration",
};

/** the shape marks (D-229) */
export const SHAPE_MARKS: {
  mark: string;
  shape: string;
  example: string;
  keyword: string;
}[] = [
  {
    mark: "[ ]",
    shape: "rectangle",
    example: "[Plan]",
    keyword: "@rectangle Plan",
  },
  {
    mark: "( )",
    shape: "rounded rectangle",
    example: "(Teach)",
    keyword: "@rounded Teach",
  },
  {
    mark: "(( ))",
    shape: "ellipse",
    example: "((Review))",
    keyword: "@ellipse Review",
  },
  {
    mark: "{ }",
    shape: "circle",
    example: "{Practise}",
    keyword: "@circle Practise",
  },
  {
    mark: "< >",
    shape: "diamond",
    example: "<Check>",
    keyword: "@diamond Check",
  },
];

/** the fit modes (D-226) */
export const FIT_MODE_GUIDE: { name: string; says: string }[] = [
  {
    name: "Fit to page",
    says: "The chart is shrunk to fit the page, down to the smallest text that can be read from the back of the room.",
  },
  {
    name: "Spread over pages",
    says: "A chart that is too big goes on to the pages that follow. Where an arrow crosses to another page, a short arrow and a note say which page it continues on.",
  },
  {
    name: "Allow larger than page",
    says: "The chart stays in one piece at a readable size, even if it is bigger than the page.",
  },
];
