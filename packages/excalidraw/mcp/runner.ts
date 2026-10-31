/**
 * The runner (D-397, D-399): the page's side of a tool call. It finds the tool,
 * refuses a change when Allow changes is off, runs it against the app, and gives
 * back either the result or the error the protocol names - so a handler that
 * throws is an answer, never a silence.
 */

import { createElements, deleteElements, updateElements } from "./elementTools";
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
  const handler = MCP_HANDLERS[name];

  if (!spec || !handler) {
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
