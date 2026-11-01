/**
 * The runner (D-397, D-399): the page's side of a tool call. It finds the tool,
 * refuses a change when Allow changes is off, runs it against the app, and gives
 * back either the result or the error the protocol names - so a handler that
 * throws is an answer, never a silence.
 */

import {
  bindArrow,
  checkPage,
  duplicateElementsTool,
  listActions,
  mermaidToDiagram,
  runAction,
  styleText,
} from "./arrangeTools";
import {
  exportScene,
  findText,
  getStats,
  insertDocument,
  setCanvas,
  setTool,
  setView,
} from "./canvasTools";
import { createElements, deleteElements, updateElements } from "./elementTools";
import {
  addPage,
  applyPageLook,
  clearPage,
  deletePageTool,
  describePageLook,
  listDeletedPages,
  movePage,
  renamePage,
  restorePage,
  scalePage,
  setInk,
  setPage,
} from "./pageTools";
import { describeProperties, setProperties } from "./propertyTools";
import {
  describeCapabilities,
  getElement,
  getSelection,
  listElements,
  listPages,
} from "./readTools";
import { McpToolError } from "./common";
import { mcpToolByName } from "./toolSpecs";
import { libraryInsert, libraryList } from "./libraryTools";
import {
  cropImage,
  listPanels,
  listSources,
  placeImage,
  uploadChunk,
  uploadDrop,
} from "./mediaTools";
import { goToPage, screenshot, selectElements } from "./viewTools";

import type { McpApp } from "./common";
import type { McpError } from "./protocol";
import type { McpRunContext } from "./readTools";

export type { McpRunContext } from "./readTools";

type Handler = (
  app: McpApp,
  args: unknown,
  context: McpRunContext,
) => unknown | Promise<unknown>;

/** the handler of each tool; the completeness test checks it against the specs */
export const MCP_HANDLERS: Record<string, Handler> = {
  describe_capabilities: (app, _args, context) =>
    describeCapabilities(app, context),
  list_pages: (app) => listPages(app),
  list_elements: (app, args) => listElements(app, args),
  get_element: (app, args) => getElement(app, args),
  get_selection: (app) => getSelection(app),
  create_elements: (app, args) => createElements(app, args),
  update_elements: (app, args) => updateElements(app, args),
  delete_elements: (app, args) => deleteElements(app, args),
  describe_properties: (app, args) => describeProperties(app, args),
  set_properties: (app, args) => setProperties(app, args),
  add_page: (app, args) => addPage(app, args),
  rename_page: (app, args) => renamePage(app, args),
  move_page: (app, args) => movePage(app, args),
  delete_page: (app, args, context) => deletePageTool(app, args, context),
  clear_page: (app, args) => clearPage(app, args),
  list_deleted_pages: (app, args, context) =>
    listDeletedPages(app, args, context),
  restore_page: (app, args, context) => restorePage(app, args, context),
  set_page: (app, args) => setPage(app, args),
  scale_page_content: (app, args) => scalePage(app, args),
  describe_page_look: (app, args) => describePageLook(app, args),
  apply_page_look: (app, args) => applyPageLook(app, args),
  set_ink: (app, args) => setInk(app, args),
  list_actions: () => listActions(),
  run_action: (app, args) => runAction(app, args),
  duplicate_elements: (app, args) => duplicateElementsTool(app, args),
  style_text: (app, args) => styleText(app, args),
  bind_arrow: (app, args) => bindArrow(app, args),
  mermaid_to_diagram: (app, args) => mermaidToDiagram(app, args),
  check_page: (app, args) => checkPage(app, args),
  set_canvas: (app, args) => setCanvas(app, args),
  set_view: (app, args) => setView(app, args),
  set_tool: (app, args) => setTool(app, args),
  find_text: (app, args) => findText(app, args),
  get_stats: (app, args) => getStats(app, args),
  export_scene: (app, args) => exportScene(app, args),
  insert_document: (app, args) => insertDocument(app, args),
  library_list: (app) => libraryList(app),
  library_insert: (app, args) => libraryInsert(app, args),
  crop_image: (app, args) => cropImage(app, args),
  list_sources: (app) => listSources(app),
  list_panels: (app) => listPanels(app),
  upload_chunk: (app, args) => uploadChunk(app, args),
  upload_drop: (app, args) => uploadDrop(app, args),
  place_image: (app, args) => placeImage(app, args),
  select_elements: (app, args) => selectElements(app, args),
  go_to_page: (app, args) => goToPage(app, args),
  screenshot: (app, args) => screenshot(app, args),
};

export type McpRunOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: McpError };

export const runMcpTool = async (
  app: McpApp,
  name: string,
  args: unknown,
  context: McpRunContext,
): Promise<McpRunOutcome> => {
  const spec = mcpToolByName(name);

  if (!spec) {
    return {
      ok: false,
      error: {
        code: "unknown-tool",
        message: `There is no tool called ${name}.`,
      },
    };
  }

  if (spec.changes && !context.allowChanges) {
    return {
      ok: false,
      error: {
        code: "changes-not-allowed",
        message:
          "Allow changes is off in the whiteboard's Assistant panel, so this tool cannot change anything. Ask the person to turn it on.",
      },
    };
  }

  // a tool that needs what only the app has is the app's to give (D-407)
  const appTool = spec.app ? context.appTools?.[name] : undefined;
  // a tool the server does itself is not one the page has (D-409)
  if (spec.server) {
    return {
      ok: false,
      error: {
        code: "unknown-tool",
        message: `${name} is done by the server, not by the page.`,
      },
    };
  }

  const handler: Handler | undefined = spec.app
    ? appTool && ((forApp, forArgs) => appTool(forArgs, forApp))
    : MCP_HANDLERS[name];

  if (!handler) {
    return {
      ok: false,
      error: {
        code: "failed",
        message: `This build of the whiteboard does not have ${name}.`,
      },
    };
  }

  try {
    return { ok: true, result: await handler(app, args, context) };
  } catch (error) {
    if (error instanceof McpToolError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }

    return {
      ok: false,
      error: {
        code: "failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
};
