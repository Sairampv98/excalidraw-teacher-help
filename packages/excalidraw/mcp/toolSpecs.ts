/**
 * The tools of the MCP server (D-397 to D-406): the ONE definition of each tool's
 * name, what it says to the assistant, what it takes, and whether it changes the
 * scene.
 *
 * Both sides read it. The server lists these tools and sends each call to the
 * page; the page checks its runner against the same list, so a tool cannot exist
 * on one side only (the completeness test, D-406).
 *
 * Positions are **page-relative** unless a tool says otherwise: (0, 0) is the
 * top-left corner of the page, in scene units, and a page is at least 1920 by
 * 1080. Pages are numbered from 1, as the person sees them.
 */

export type McpJsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, McpJsonSchema>;
  required?: string[];
  items?: McpJsonSchema;
  enum?: readonly (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | McpJsonSchema;
  oneOf?: McpJsonSchema[];
};

export type McpToolSpec = {
  name: string;
  description: string;
  inputSchema: McpJsonSchema;
  /** whether the tool changes the scene: it is refused when Allow changes is off */
  changes: boolean;
};

/** the most elements a single call may create, change or delete (D-399) */
export const MCP_MAX_ELEMENTS_PER_CALL = 500;

const PAGE = {
  type: "integer",
  minimum: 1,
  description:
    "The page number as the person sees it (1 is the first). Defaults to the page that is open.",
} as const;

const IDS = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  maxItems: MCP_MAX_ELEMENTS_PER_CALL,
  description: "Element ids, as list_elements gives them.",
} as const;

export const MCP_TOOLS: readonly McpToolSpec[] = [
  {
    name: "describe_capabilities",
    description:
      "What this whiteboard can do right now: whether changes are allowed, the app, the features that are on, the limits, and the pages. Call this first.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_pages",
    description:
      "The pages of the document, in order: number, id, name, size, whether the frame and the page number are shown, the paper, how many elements are on it, and which page is open.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "list_elements",
    description:
      "The elements of the document in short: id, type, position and size (page-relative), text, colours, lock, groups, link, and the shape a text is in. Use get_element for everything about one. Elements come in the order they are drawn, bottom first.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {
        page: PAGE,
        ids: IDS,
        types: {
          type: "array",
          items: { type: "string" },
          description:
            "Only these types: rectangle, diamond, ellipse, arrow, line, freedraw, text, image, frame, embeddable, iframe, panel.",
        },
        selected: {
          type: "boolean",
          description: "Only the elements that are selected now.",
        },
        absolute: {
          type: "boolean",
          description:
            "Give positions in scene units and not relative to the page.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_element",
    description:
      "Everything the document holds about one element, with its position relative to its page.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_selection",
    description:
      "The ids of the elements that are selected now, and the page they are on.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "create_elements",
    description:
      "Create elements on a page. Each is a short description: type (rectangle, diamond, ellipse, text, line, arrow, freedraw, image, frame), x and y (page-relative), width and height, and styles (strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness). A rectangle, diamond or ellipse takes label: {text, fontSize} to hold words. A text takes text, fontSize, fontFamily, textAlign. A line or arrow takes points: [[0,0],[200,0]] (relative to x, y) and an arrow takes start and end: {id} of an element made in the same call, or an {type, x, y, width, height} shape to make. A freedraw takes points. Give an id to refer to an element later in the same call. Returns the ids made, in order. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        page: PAGE,
        elements: {
          type: "array",
          minItems: 1,
          maxItems: MCP_MAX_ELEMENTS_PER_CALL,
          items: {
            type: "object",
            properties: { type: { type: "string" } },
            required: ["type"],
            additionalProperties: true,
          },
        },
      },
      required: ["elements"],
      additionalProperties: false,
    },
  },
  {
    name: "update_elements",
    description:
      "Change elements: each update names an id and the things to change - x, y (page-relative), width, height, angle (radians), text, points, locked, link. Styles are changed with set_properties. A text inside a shape is changed by changing its text. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          minItems: 1,
          maxItems: MCP_MAX_ELEMENTS_PER_CALL,
          items: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
            additionalProperties: true,
          },
        },
      },
      required: ["updates"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_elements",
    description:
      "Delete elements (and the text bound to them). The person can undo it.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: { ids: IDS },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_properties",
    description:
      'What the properties panel would show for these elements: for each property its current value ("mixed" when they differ), and the values it may take. A property the panel would not show for these elements is left out.',
    changes: false,
    inputSchema: {
      type: "object",
      properties: { ids: IDS },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "set_properties",
    description:
      "Change properties of elements the way the properties panel does: strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, roundness, opacity, fontFamily, fontSize, textAlign, verticalAlign, startArrowhead, endArrowhead, arrowType. Use describe_properties to see which apply. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        ids: IDS,
        properties: { type: "object", additionalProperties: true },
      },
      required: ["ids", "properties"],
      additionalProperties: false,
    },
  },
  {
    name: "select_elements",
    description: "Select elements (an empty list clears the selection).",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          maxItems: MCP_MAX_ELEMENTS_PER_CALL,
        },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "go_to_page",
    description: "Open a page and bring it into view.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: { page: PAGE },
      required: ["page"],
      additionalProperties: false,
    },
  },
  {
    name: "screenshot",
    description:
      "A picture of what is on the whiteboard, for a model that can see: the page that is open (or the one named), the selection, or some elements. Returns an image.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["page", "selection", "elements"],
          description: "What to draw. Defaults to the page.",
        },
        page: PAGE,
        ids: IDS,
        maxSize: {
          type: "integer",
          minimum: 200,
          maximum: 2400,
          description:
            "The longest side of the picture in pixels. Defaults to 1200.",
        },
      },
      additionalProperties: false,
    },
  },
];

export const mcpToolByName = (name: string): McpToolSpec | undefined =>
  MCP_TOOLS.find((tool) => tool.name === name);
