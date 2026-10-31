/**
 * What the Flow tab's guide says (D-225).
 *
 * Written for a teacher, in our own words: nothing is fetched and nothing is
 * copied (D-169). Each built-in preset has its rules, a sentence about what the
 * chart looks like, and the example the studio already knows; a custom preset
 * (D-228) is described by the layout it was made with.
 */

import type {
  FlowGalleryPresetId,
  FlowJoinedPresetId,
  FlowPresetId,
} from "@excalidraw/excalidraw/scene/flowScript";
import type { FlowCustomLayout } from "@excalidraw/excalidraw/scene/flowCustomPresets";

export type FlowGuideEntry = {
  /** the rules of the script, in plain words */
  rules: string[];
  /** what the chart looks like, in a sentence */
  looks: string;
};

const JOINED_GUIDE: Record<FlowJoinedPresetId, FlowGuideEntry> = {
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

/** what the gallery's layouts say (D-232) */
const GALLERY_GUIDE: Record<FlowGalleryPresetId, FlowGuideEntry> = {
  list: {
    rules: [
      "Write one line for each block, in the order they go down the page.",
      "Nothing joins the blocks: a list has no arrows.",
    ],
    looks: "Blocks one under the next, all as wide as the widest.",
  },
  grid: {
    rules: [
      "Write one line for each row, with a | between the cells.",
      "Start a line with # to make it the header row.",
      "A row with fewer cells than the widest leaves the cells at its right empty.",
    ],
    looks:
      "A table: columns as wide as their widest cell, rows as high as theirs.",
  },
  matrix: {
    rules: [
      "Write one line for each row, with a | between its two cells.",
      "A matrix has two columns, so a row has two cells at most.",
    ],
    looks:
      "Four quadrants, larger than the cells of a grid, each in its own colour.",
  },
  pyramid: {
    rules: [
      "Write one line for each layer, the top one first.",
      "Each layer is wider than the one above it.",
    ],
    looks: "Blocks that widen down the page.",
  },
  funnel: {
    rules: [
      "Write one line for each stage, the widest first.",
      "Each stage is narrower than the one above it.",
    ],
    looks: "Blocks that narrow down the page.",
  },
  timeline: {
    rules: [
      "Write one line for each moment, in the order they happen.",
      "The boxes sit above and below a line in turn, so long words have room.",
    ],
    looks:
      "One line across the page with a dot for each moment and a box on each dot.",
  },
  target: {
    rules: [
      "Write one line for each ring, the outermost first. Six rings at most.",
    ],
    looks:
      "Rings one inside the next, each with its words at the top of its band.",
  },
  venn: {
    rules: ["Write one line for each circle. Two to four circles."],
    looks: "Circles that cross, each with its words on its far side.",
  },
  hierarchy: {
    rules: [
      "Write one line for each node. Indent a line once - a tab, or two spaces - to put it under the line above.",
      "The first line is the top of the tree and is not indented.",
    ],
    looks:
      "A tree, a parent over its children, joined by lines with no arrowheads.",
  },
};

/** the guide of every kind of chart: the seven, then the gallery */
export const FLOW_GUIDE: Record<FlowPresetId, FlowGuideEntry> = {
  ...JOINED_GUIDE,
  ...GALLERY_GUIDE,
};

/** the guide for a custom preset: its layout decides the rules (D-228) */
export const GUIDE_OF_LAYOUT: Record<FlowCustomLayout, FlowPresetId> = {
  "top-down": "process",
  "left-right": "process",
  ring: "cycle",
  tiers: "tiers",
  hub: "integration",
  list: "list",
  grid: "grid",
  matrix: "matrix",
  pyramid: "pyramid",
  funnel: "funnel",
  timeline: "timeline",
  target: "target",
  venn: "venn",
  hierarchy: "hierarchy",
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

/**
 * The worked example of an animated chart (D-380): a gateway chart, in the look
 * of the infographics a class is shown - boxes on the left that call a gateway,
 * and the gateway that calls the services on the right, with dashes running
 * along the arrows. It is a network script, so it is one more example the
 * studio already knows how to read; what it adds is the arrow animation it
 * switches on and the way to a file.
 */
export const FLOW_ANIMATED_EXAMPLE: {
  title: string;
  preset: FlowPresetId;
  /** the arrow animation the example is made to show */
  arrowStyle: "marching";
  /** what the shapes do while a step is current */
  nodeStyle: "focus";
  script: string;
  /** the steps from the script to a file, in plain words */
  steps: string[];
} = {
  title: "An animated gateway chart",
  preset: "network",
  arrowStyle: "marching",
  nodeStyle: "focus",
  script: [
    "Apps and agents -> LLM gateway",
    "LLM gateway -> OpenAI",
    "LLM gateway -> Anthropic",
    "LLM gateway -> Usage and cost",
    "Web and mobile -> API gateway",
    "API gateway -> Orders service",
    "API gateway -> Users service",
    "API gateway -> Payments service",
  ].join("\n"),
  steps: [
    "Press Use this animated example: the script is filled in, and the arrows are set to Marching dashes.",
    "Press Insert chart. Select the chart and the animation bar appears.",
    "Press Play: a step lights up at a time, and dashes run along the arrows.",
    "Press Export in the bar to save the animation as a GIF, a WebP or an MP4. Choose the frames a second, the size, and whether it has the page's background.",
  ],
};
