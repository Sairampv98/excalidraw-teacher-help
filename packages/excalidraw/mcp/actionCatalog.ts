/**
 * Every action the editor has, and what the assistant may do with it (D-406).
 *
 * The editor registers about a hundred actions - the buttons of its panels and
 * its menus. The promise is that nothing the editor offers is left out, and it is
 * kept by this list: **every registered action is named here**, with the way the
 * assistant reaches it, or the reason it does not. The completeness test fails
 * when an action is registered that is not named, and when a name is here that is
 * not registered - so a new feature cannot be forgotten.
 *
 *  - `run`      the assistant runs it with `run_action` (on the elements it names)
 *  - `covered`  a tool of its own does what the action does
 *  - `later`    a tool of a later wave of the server does it
 *  - `excluded` the assistant does not do it, and why
 */

export type McpActionEntry =
  | {
      name: string;
      use: "run";
      /** what it does, for the one who reads list_actions */
      description: string;
      /** how many elements it needs: none, at least one, or at least two or three */
      needs?: "none" | "elements" | "two" | "three";
      /** what the value is, when the action takes one */
      value?: string;
    }
  | { name: string; use: "covered"; tool: string }
  | { name: string; use: "later"; tool: string; wave: string }
  | { name: string; use: "excluded"; why: string };

const run = (
  name: string,
  description: string,
  needs: "none" | "elements" | "two" | "three" = "elements",
  value?: string,
): McpActionEntry => ({ name, use: "run", description, needs, value });
const covered = (name: string, tool: string): McpActionEntry => ({
  name,
  use: "covered",
  tool,
});
const later = (name: string, tool: string, wave: string): McpActionEntry => ({
  name,
  use: "later",
  tool,
  wave,
});
const excluded = (name: string, why: string): McpActionEntry => ({
  name,
  use: "excluded",
  why,
});

const CLIPBOARD = "the person's clipboard is the person's own";
const PICK =
  "it opens a file dialog, and the files are for wave 2 of the server";
const UI_MODE =
  "it is a mode of the person's own editing, not a change of the document";

export const MCP_ACTION_CATALOG: readonly McpActionEntry[] = [
  run("addToLibrary", "Add the elements to the shape library.", "elements"),
  run("alignLeft", "Align the elements by their left edges.", "two"),
  run("alignRight", "Align the elements by their right edges.", "two"),
  run("alignTop", "Align the elements by their top edges.", "two"),
  run("alignBottom", "Align the elements by their bottom edges.", "two"),
  run(
    "alignHorizontallyCentered",
    "Centre the elements on one vertical line.",
    "two",
  ),
  run(
    "alignVerticallyCentered",
    "Centre the elements on one horizontal line.",
    "two",
  ),
  run(
    "distributeHorizontally",
    "Space the elements evenly from left to right.",
    "three",
  ),
  run(
    "distributeVertically",
    "Space the elements evenly from top to bottom.",
    "three",
  ),
  run("bringForward", "Bring the elements one layer forward.", "elements"),
  run("bringToFront", "Bring the elements to the front.", "elements"),
  run("sendBackward", "Send the elements one layer back.", "elements"),
  run("sendToBack", "Send the elements to the back.", "elements"),
  run("flipHorizontal", "Flip the elements left to right.", "elements"),
  run("flipVertical", "Flip the elements top to bottom.", "elements"),
  run("group", "Group the elements.", "two"),
  run("ungroup", "Take the elements out of their group.", "elements"),
  run(
    "duplicateSelection",
    "Duplicate the elements, a little to the side (duplicate_elements places the copies where you say).",
    "elements",
  ),
  run(
    "toggleElementLock",
    "Lock the elements, or unlock them when all are locked.",
    "elements",
  ),
  run("unlockAllElements", "Unlock every element of the document.", "none"),
  run(
    "autoResize",
    "Let a text grow with its words, or give it a fixed width.",
    "elements",
  ),
  run("bindText", "Put a text inside the shape it is selected with.", "two"),
  run("unbindText", "Take the text out of the shape.", "elements"),
  run("wrapTextInContainer", "Put each text in a box of its own.", "elements"),
  run(
    "toggleBold",
    "Make the text bold, or plain when all of it is bold (style_text does a part of it).",
    "elements",
  ),
  run(
    "toggleItalic",
    "Make the text italic, or upright when all of it is (style_text does a part of it).",
    "elements",
  ),
  run("increaseFontSize", "Make the text one step larger.", "elements"),
  run("decreaseFontSize", "Make the text one step smaller.", "elements"),
  run("togglePolygon", "Close a line into a polygon, or open it.", "elements"),
  run("wrapSelectionInFrame", "Put the elements in a new frame.", "elements"),
  run(
    "removeAllElementsFromFrame",
    "Take every element out of the frame.",
    "elements",
  ),
  run("selectAllElementsInFrame", "Select what is in the frame.", "elements"),
  run(
    "linkToElement",
    "Link the element to another element of the document.",
    "elements",
    "the id of the element to link to",
  ),
  run(
    "arrowBinding",
    "Turn arrow binding on or off for what the person draws next.",
    "none",
  ),
  run(
    "midpointSnapping",
    "Turn snapping to the middle of shapes on or off.",
    "none",
  ),
  run("objectsSnapMode", "Turn snapping to other elements on or off.", "none"),
  run("gridMode", "Turn the grid on or off.", "none"),
  run(
    "updateFrameRendering",
    "Show or hide the names and outlines of frames.",
    "none",
  ),

  covered("changeStrokeColor", "set_properties"),
  covered("changeBackgroundColor", "set_properties"),
  covered("changeFillStyle", "set_properties"),
  covered("changeStrokeWidth", "set_properties"),
  covered("changeStrokeStyle", "set_properties"),
  covered("changeSloppiness", "set_properties"),
  covered("changeRoundness", "set_properties"),
  covered("changeOpacity", "set_properties"),
  covered("changeFontFamily", "set_properties"),
  covered("changeFontSize", "set_properties"),
  covered("changeFontStyle", "style_text"),
  covered("changeTextAlign", "set_properties"),
  covered("changeVerticalAlign", "set_properties"),
  covered("changeArrowType", "set_properties"),
  covered("changeArrowhead", "set_properties"),
  covered("changeArrowProperties", "set_properties"),
  covered("changeInkLook", "set_ink"),
  covered("changePage", "set_page"),
  covered("copyStyles", "set_properties"),
  covered("pasteStyles", "set_properties"),
  covered("deleteSelectedElements", "delete_elements"),
  covered("deselect", "select_elements"),
  covered("selectAll", "select_elements"),
  covered("hyperlink", "update_elements"),
  covered("changeViewBackgroundColor", "set_canvas"),
  covered("toggleTheme", "set_canvas"),
  covered("zenMode", "set_canvas"),
  covered("viewMode", "set_canvas"),
  covered("stats", "get_stats"),
  covered("searchMenu", "find_text"),
  covered("changeExportBackground", "export_scene"),
  covered("changeExportEmbedScene", "export_scene"),
  covered("changeExportScale", "export_scene"),
  covered("exportWithDarkMode", "export_scene"),
  covered("changeProjectName", "set_canvas"),
  covered("zoomIn", "set_view"),
  covered("zoomOut", "set_view"),
  covered("resetZoom", "set_view"),
  covered("zoomToFit", "set_view"),
  covered("zoomToFitSelection", "set_view"),
  covered("zoomToFitSelectionInViewport", "set_view"),
  covered("toggleEraserTool", "set_tool"),
  covered("toggleHandTool", "set_tool"),
  covered("toggleLassoTool", "set_tool"),
  covered("setEmbeddableAsActiveTool", "set_tool"),
  covered("setFrameAsActiveTool", "set_tool"),
  covered("insertDocument", "insert_document"),

  later("changePanel", "set_panel", "9c-2"),
  later("cropEditor", "crop_image", "9c-2"),
  later("flowClass", "flow_class", "9c-3"),
  later("flowLayout", "flow_layout", "9c-3"),
  later("flowResetLayout", "flow_reset_layout", "9c-3"),

  excluded("copy", CLIPBOARD),
  excluded("cut", CLIPBOARD),
  excluded("paste", CLIPBOARD),
  excluded("copyAsPng", CLIPBOARD),
  excluded("copyAsSvg", CLIPBOARD),
  excluded("copyText", CLIPBOARD),
  excluded("copyElementLink", CLIPBOARD),
  excluded(
    "undo",
    "the history holds the person's own work as well; the person undoes with Ctrl+Z",
  ),
  excluded(
    "redo",
    "the history holds the person's own work as well; the person redoes with Ctrl+Shift+Z",
  ),
  excluded(
    "clearCanvas",
    "it empties every page at once; clear_page and delete_elements do it with a name on it",
  ),
  excluded("loadScene", PICK),
  excluded("saveFileToDisk", PICK),
  excluded("saveToActiveFile", PICK),
  excluded("finalize", UI_MODE),
  excluded("toggleLinearEditor", UI_MODE),
  excluded("toggleShapeSwitch", UI_MODE),
  excluded("toggleShortcuts", UI_MODE),
  excluded("goToCollaborator", "collaboration is not part of this whiteboard"),
];

export const mcpActionEntry = (name: string) =>
  MCP_ACTION_CATALOG.find((entry) => entry.name === name);
