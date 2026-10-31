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
  /**
   * The tool needs what only the app has (the sticker catalogue, the table and code
   * card builders): its handler is the app's, given to the runner (D-407).
   */
  app?: boolean;
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
    name: "add_page",
    description:
      "Add a page. By default it goes after the page that is open; give after (a page number: the new page comes after it, 0 for first) or before. The pages after it, with what is on them, move on. It does not open the new page unless open is true. Returns the new page's number, id and name. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        after: {
          type: "integer",
          minimum: 0,
          description: "Put it after this page number (0 puts it first).",
        },
        before: PAGE,
        name: { type: "string", description: "Its name. Defaults to Page N." },
        open: { type: "boolean", description: "Open the new page." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "rename_page",
    description: "Give a page a name. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: { page: PAGE, name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "move_page",
    description:
      "Move a page to a place in the order (1 is first). What is on the pages moves with them. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: { page: PAGE, to: { type: "integer", minimum: 1 } },
      required: ["to"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_page",
    description:
      "Delete a page with everything on it. The pages after it move back. The person can undo it, and the page is also kept so it can be brought back with restore_page, also after a reload. A document always keeps at least one page.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: { page: PAGE },
      additionalProperties: false,
    },
  },
  {
    name: "clear_page",
    description:
      "Delete everything that is on a page and keep the page. The person can undo it.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: { page: PAGE },
      additionalProperties: false,
    },
  },
  {
    name: "list_deleted_pages",
    description:
      "The pages that were deleted and are kept, newest first: id, name, when, and how many elements were on them.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "restore_page",
    description:
      "Bring a deleted page back, as a new page after the last one, with everything that was on it. Take the id from list_deleted_pages.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "set_page",
    description:
      "Change a page: frame (the rectangle drawn round it), pageNumber (the number in its footer), preset (a size - see describe_page_look) or width and height (never below 1920 by 1080), and paper: {type, color, grain, age}. paperOnAllPages gives every page the paper. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        page: PAGE,
        frame: { type: "boolean" },
        pageNumber: { type: "boolean" },
        preset: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        paper: {
          type: "object",
          properties: {
            type: { type: "string" },
            color: { type: "string" },
            grain: { type: "number", minimum: 0, maximum: 100 },
            age: { type: "number", minimum: 0, maximum: 100 },
          },
          additionalProperties: false,
        },
        paperOnAllPages: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "scale_page_content",
    description:
      "Make what is on a page smaller (shrink: half the size, to get more room) or larger (grow: back by two). The page itself keeps its size. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        page: PAGE,
        direction: { type: "string", enum: ["shrink", "grow"] },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  },
  {
    name: "describe_page_look",
    description:
      "What a page looks like now (size, frame, number, paper) and what it may be: the paper types, the twelve paper colours, grain and age, the size presets, and the four one-click looks (old paper, green chalkboard, blackboard, neon night) with the ink each brings.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: { page: PAGE },
      additionalProperties: false,
    },
  },
  {
    name: "apply_page_look",
    description:
      "Give a page one of the one-click looks: its paper, and the ink the next elements are drawn with (as the person's Page look dialog does). What is drawn already is not recoloured. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        page: PAGE,
        look: {
          type: "string",
          enum: ["old-paper", "green-chalkboard", "blackboard", "neon-night"],
        },
      },
      required: ["look"],
      additionalProperties: false,
    },
  },
  {
    name: "set_ink",
    description:
      "Change the ink look of drawn elements (shapes, lines, freedraw, text): look (normal, neon, chalk, marker, pencil), amount (1 to 100: the glow of neon, the dust of chalk, the width of marker, the darkness of pencil) and color. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        ids: IDS,
        look: {
          type: "string",
          enum: ["normal", "neon", "chalk", "marker", "pencil"],
        },
        amount: { type: "number", minimum: 1, maximum: 100 },
        color: { type: "string" },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "list_actions",
    description:
      "Every action the editor has, and how you reach it: the ones run_action runs, the ones another tool does, the ones that come with a later part of the server, and the ones that are not for an assistant, with why.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "run_action",
    description:
      "Run one of the editor's actions on elements - align, distribute, flip, group and ungroup, layers (bring to front...), lock, bind a text to a shape, bold, bigger or smaller text, close a line into a polygon, put in a frame, snapping and the grid. list_actions says which and what each needs. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        ids: IDS,
        value: {
          description:
            "What the action takes, when it takes something (list_actions says).",
        } as never,
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "duplicate_elements",
    description:
      "Copy elements, with the text bound to them and the arrows between them, and put the copies dx and dy to the side (default 40 and 40). Returns the copies. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        ids: IDS,
        dx: { type: "number" },
        dy: { type: "number" },
      },
      required: ["ids"],
      additionalProperties: false,
    },
  },
  {
    name: "style_text",
    description:
      "Make a text, or a part of it (start and end are positions in the words), bold or italic - or plain again with false. Give the id of a text or of the shape it is in. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        start: { type: "integer", minimum: 0 },
        end: { type: "integer", minimum: 0 },
        bold: { type: "boolean" },
        italic: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "bind_arrow",
    description:
      "Bind the ends of an arrow to shapes (start and/or end: an element id), or take an end off with null. The arrow follows the shape from then on. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        arrow: { type: "string" },
        start: { type: ["string", "null"] },
        end: { type: ["string", "null"] },
      },
      required: ["arrow"],
      additionalProperties: false,
    },
  },
  {
    name: "mermaid_to_diagram",
    description:
      "Draw a diagram from Mermaid text (a flowchart, sequence diagram, class diagram...) as ordinary elements, with its top-left at x, y on the page (default 100, 100). Returns the elements made. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        page: PAGE,
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["source"],
      additionalProperties: false,
    },
  },
  {
    name: "check_page",
    description:
      "Look at a page for what would not read well: things that reach outside the page, things that lie on each other, text that is small, and text whose colour is too near the colour behind it. Returns the problems with the ids, and ok. Run it after drawing a page, and put right what it finds.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: { page: PAGE },
      additionalProperties: false,
    },
  },
  {
    name: "set_canvas",
    description:
      "Change the canvas: backgroundColor, grid and gridSize, snapToObjects, snapToMidpoints, theme (light or dark), zen (hide the chrome), viewOnly, stats (the numbers panel), and the document's name. The background colour is one undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        backgroundColor: { type: "string" },
        grid: { type: "boolean" },
        gridSize: { type: "number" },
        snapToObjects: { type: "boolean" },
        snapToMidpoints: { type: "boolean" },
        theme: { type: "string", enum: ["light", "dark"] },
        zen: { type: "boolean" },
        viewOnly: { type: "boolean" },
        stats: { type: "boolean" },
        name: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_view",
    description:
      "Move what the person sees: fit a page (fit: page), the selection or some elements into view, set a zoom, or centre on a point of a page. This changes the view, not the document.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {
        fit: { type: "string", enum: ["page", "selection", "elements"] },
        page: PAGE,
        ids: IDS,
        zoom: { type: "number", minimum: 0.1, maximum: 30 },
        center: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_tool",
    description:
      "Pick the tool the person draws with next: selection, lasso, rectangle, diamond, ellipse, arrow, line, freedraw, text, eraser, hand, frame, embeddable or laser.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: { tool: { type: "string" } },
      required: ["tool"],
      additionalProperties: false,
    },
  },
  {
    name: "find_text",
    description:
      "Find the words in the document: every text, and the shape it is in, that has the query in it. With select the matches are selected.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        caseSensitive: { type: "boolean" },
        select: { type: "boolean" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_stats",
    description:
      "The numbers the stats panel shows: how many elements of each type, how many on each page, and for the selection (or for ids) where it is on its page and how large.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: { ids: IDS },
      additionalProperties: false,
    },
  },
  {
    name: "export_scene",
    description:
      "Export as a PNG (an image), SVG or the saved-document JSON (text): a page, the whole document (scope all) or the selection. Options: scale (0.25 to 4, default 2), background, darkMode, padding.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["png", "svg", "json"] },
        scope: { type: "string", enum: ["page", "all", "selection"] },
        page: PAGE,
        scale: { type: "number", minimum: 0.25, maximum: 4 },
        background: { type: "boolean" },
        darkMode: { type: "boolean" },
        padding: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "insert_document",
    description:
      "Put a saved whiteboard document (the text of an .excalidraw file) on a page, beside what is there. Its elements get ids of their own. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: { json: { type: "string" }, page: PAGE },
      required: ["json"],
      additionalProperties: false,
    },
  },
  {
    name: "library_list",
    description:
      "What the shape library holds: each item's id, name, how many elements it has and its size. Add to it with run_action addToLibrary.",
    changes: false,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "library_insert",
    description:
      "Put an item of the shape library on a page, with its top-left at x, y (page-relative, default 100, 100). Returns the elements made. One undo step.",
    changes: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        page: PAGE,
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_stickers",
    description:
      "The whiteboard's own emoji and animated GIFs, found by words (every word must match): id, kind (emoji or gif), label and tags. With no query it is the whole set, most popular first.",
    changes: false,
    app: true,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kind: { type: "string", enum: ["emoji", "gif"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "insert_sticker",
    description:
      "Put a sticker (an emoji or an animated GIF, by the id list_stickers gives) on a page, with its top-left at x, y (page-relative; the middle of the page when not given), its longest side size long (default 200). A GIF stays a GIF. One undo step.",
    changes: true,
    app: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        page: PAGE,
        x: { type: "number" },
        y: { type: "number" },
        size: { type: "number", minimum: 24, maximum: 1000 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "insert_table",
    description:
      "Draw a table on a page: rows is a list of rows, each a list of cell texts, with the top-left at x, y (page-relative, default 100, 100). Each cell is a box and its text, grouped, and the table is never wider than the page. At most 60 rows and 12 columns. One undo step.",
    changes: true,
    app: true,
    inputSchema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          minItems: 1,
          maxItems: 60,
          items: { type: "array", items: { type: "string" }, maxItems: 12 },
        },
        page: PAGE,
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["rows"],
      additionalProperties: false,
    },
  },
  {
    name: "insert_code_card",
    description:
      "Put code on a page as a syntax-highlighted card (dark, monospace, real text that can be edited), with its top-left at x, y (page-relative, default 100, 100). language is the name of the language (python, javascript, java, c, cpp, rust...). One undo step.",
    changes: true,
    app: true,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string" },
        language: { type: "string" },
        page: PAGE,
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["code"],
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
