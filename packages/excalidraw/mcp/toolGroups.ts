/**
 * The tools in groups (D-425): what the whiteboard can do, in a list an assistant
 * can read in one go.
 *
 * The groups live here, once. `describe_capabilities` answers with them, the
 * coverage document is made from them, and the guide the server serves is made
 * from them too - so a group cannot drift from the tools it names, and a tool
 * that is in no group is refused when the list is made.
 */

import { MCP_TOOLS, mcpPublicTools } from "./toolSpecs";

export type McpToolGroup = {
  /** what the group is for */
  title: string;
  /** the tools of the group */
  tools: readonly string[];
};

/** the groups of the tools, in the order an assistant should read them */
export const MCP_TOOL_GROUPS: readonly McpToolGroup[] = [
  {
    title: "Look",
    tools: [
      "describe_capabilities",
      "list_pages",
      "list_elements",
      "get_element",
      "get_selection",
      "screenshot",
      "get_stats",
      "find_text",
      "check_page",
    ],
  },
  {
    title: "Create, change, delete",
    tools: [
      "create_elements",
      "update_elements",
      "delete_elements",
      "duplicate_elements",
      "style_text",
      "bind_arrow",
      "mermaid_to_diagram",
      "select_elements",
    ],
  },
  {
    title: "The properties panel and ink",
    tools: ["describe_properties", "set_properties", "set_ink"],
  },
  {
    title: "The editor's actions",
    tools: ["list_actions", "run_action"],
  },
  {
    title: "Pages and their look",
    tools: [
      "add_page",
      "rename_page",
      "move_page",
      "delete_page",
      "clear_page",
      "list_deleted_pages",
      "restore_page",
      "set_page",
      "scale_page_content",
      "describe_page_look",
      "apply_page_look",
      "go_to_page",
    ],
  },
  {
    title: "The canvas and the view",
    tools: ["set_canvas", "set_view", "set_tool"],
  },
  {
    title: "Export and insert",
    tools: ["export_scene", "insert_document"],
  },
  {
    title: "Library, stickers, tables, code",
    tools: [
      "library_list",
      "library_insert",
      "list_stickers",
      "insert_sticker",
      "insert_table",
      "insert_code_card",
    ],
  },
  {
    title: "Flow charts",
    tools: [
      "flow_kinds",
      "check_flow_script",
      "create_flow_chart",
      "list_flow_charts",
      "edit_flow_chart",
      "delete_flow_chart",
      "convert_flow_script",
      "describe_flow_look",
      "set_flow_look",
      "play_flow",
      "stop_flow",
    ],
  },
  {
    title: "Slides and lesson pages",
    tools: ["make_slides", "build_page"],
  },
  {
    title: "Pictures, documents, files and the internet",
    tools: [
      "list_allowed_folders",
      "list_folder",
      "file_info",
      "insert_image",
      "crop_image",
      "list_sources",
      "read_document",
      "insert_markdown",
      "insert_pdf_page",
      "read_image_text",
      "list_panels",
      "insert_video",
      "insert_youtube",
      "insert_code_panel",
      "set_code_panel",
      "read_code_panel",
      "run_code",
      "fetch_resource",
    ],
  },
];

/** the first sentence of a tool's description: what it does, in one line */
export const firstSentence = (text: string): string =>
  text.split(". ")[0].replace(/\.$/, "");

export type McpToolGroupListing = {
  title: string;
  tools: { name: string; does: string }[];
};

/**
 * The list of the tools is not made when a group and the tools do not agree: a
 * tool that is in no group, or a group that names a tool that is not there.
 */
export const assertGroupsCoverTools = (): void => {
  const grouped = new Set(MCP_TOOL_GROUPS.flatMap((group) => [...group.tools]));

  const missing = mcpPublicTools()
    .map((tool) => tool.name)
    .filter((name) => !grouped.has(name));

  if (missing.length) {
    throw new Error(`not in a group: ${missing.join(", ")}`);
  }

  const known = new Set(MCP_TOOLS.map((tool) => tool.name));

  const unknown = MCP_TOOL_GROUPS.flatMap((group) => [...group.tools]).filter(
    (name) => !known.has(name),
  );

  if (unknown.length) {
    throw new Error(`in a group but not a tool: ${unknown.join(", ")}`);
  }
};

/** the groups, with the tool of each and what it does */
export const mcpToolGroupListings = (): McpToolGroupListing[] => {
  assertGroupsCoverTools();

  return MCP_TOOL_GROUPS.map((group) => ({
    title: group.title,
    tools: group.tools.map((name) => {
      const tool = MCP_TOOLS.find((each) => each.name === name);

      return { name, does: firstSentence(tool?.description ?? "") };
    }),
  }));
};

/** the tools that are in no group */
export const toolsOutOfGroups = (): string[] => {
  const grouped = new Set(MCP_TOOL_GROUPS.flatMap((group) => [...group.tools]));

  return mcpPublicTools()
    .map((tool) => tool.name)
    .filter((name) => !grouped.has(name));
};

/** the groups that name a tool that is not there */
export const unknownToolsInGroups = (): string[] => {
  const known = new Set(MCP_TOOLS.map((tool) => tool.name));

  return MCP_TOOL_GROUPS.flatMap((group) => [...group.tools]).filter(
    (name) => !known.has(name),
  );
};
