/**
 * The prompts of the server (D-426): the requests a model is often asked to
 * make, written out so that it can begin without knowing the tools.
 *
 * Each prompt says what it is for, what it needs and what it makes, and the
 * arguments it takes are named - so a client that lists the prompts can offer
 * them with a form.
 */

export type McpPromptArgument = {
  name: string;
  description: string;
  required?: boolean;
};

export type McpPrompt = {
  name: string;
  description: string;
  arguments: readonly McpPromptArgument[];
  /** the request the model is given */
  text: (args: Record<string, string>) => string;
};

/** the prompts the server offers */
export const MCP_PROMPTS: readonly McpPrompt[] = [
  {
    name: "lesson_deck",
    description:
      "A deck of slides for a lesson, written from the plan the teacher gives.",
    arguments: [
      {
        name: "topic",
        description: "What the lesson is about.",
        required: true,
      },
      {
        name: "slides",
        description:
          "How many slides the deck should have, up to 60. The plan decides when it is not given.",
      },
    ],
    text: (args) =>
      [
        `Make a deck of slides for a lesson about ${
          args.topic ?? "the topic the teacher names"
        }.`,
        "Write the script as plain text: the slides are separated by a line of three dashes, and each slide begins with its heading.",
        "Give the script to make_slides, which makes one page for each slide. Do not draw the slides yourself.",
        args.slides ? `The deck should have ${args.slides} slides.` : "",
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    name: "process_chart",
    description: "A chart of a process, from the steps the teacher gives.",
    arguments: [
      {
        name: "process",
        description: "The steps of the process, one after the other.",
        required: true,
      },
      {
        name: "kind",
        description:
          "The kind of chart: process, decision, steps, network, cycle, and the others that flow_kinds lists. The process chart when it is not given.",
      },
    ],
    text: (args) =>
      [
        `Draw the process ${
          args.process ?? "the teacher names"
        } as a chart of the whiteboard.`,
        "Write the script of the chart: one node per line, with an arrow from one line to the next as `->`.",
        "Give the script to check_flow_script first, and then to create_flow_chart. Do not draw the nodes yourself.",
        args.kind ? `The chart is of the kind ${args.kind}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    name: "lesson_page",
    description:
      "A lesson page, made from a document the teacher has on the machine.",
    arguments: [
      {
        name: "document",
        description:
          "The path of the document (markdown, text or PDF). It must be in a folder the teacher allowed.",
        required: true,
      },
      {
        name: "title",
        description: "The heading of the page.",
      },
    ],
    text: (args) =>
      [
        `Make the page of the lesson from the document ${
          args.document ?? "the teacher names"
        }.`,
        "Read the document with read_document first: it gives the text, and the pictures of the pages when it is a PDF.",
        "Then build the page with build_page: a title for the heading, and a block for each part of the document - a text for the words, a table for a table, a code for code.",
        args.title ? `The heading of the page is ${args.title}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
  },
  {
    name: "check_the_page",
    description:
      "A check of a page before a class, so that nothing is broken on the screen.",
    arguments: [
      {
        name: "page",
        description:
          "The page to check. The page that is open when it is not given.",
      },
    ],
    text: (args) =>
      [
        `Check the page ${
          args.page ?? "that is open"
        } before the class, with check_page.`,
        "It says what is wrong with it - text that does not fit, elements that are off the page, things that are too small to read.",
        "Say what it found in plain words, and offer to fix it. Do not change anything until the teacher says so.",
      ].join(" "),
  },
];

/** the prompt of that name, when it is there */
export const mcpPromptByName = (name: string): McpPrompt | undefined =>
  MCP_PROMPTS.find((prompt) => prompt.name === name);
