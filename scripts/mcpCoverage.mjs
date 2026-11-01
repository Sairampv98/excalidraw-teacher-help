// Writes docs/mcp-coverage.md from the code: the tools of the server and the
// actions of the editor, and how each is reached (D-406). Run: node scripts/mcpCoverage.mjs
import fs from "node:fs";
import { EOL, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { build } from "esbuild";

const W = `${resolve(dirname(fileURLToPath(import.meta.url)), "..")}/`;
const out = join(tmpdir(), "mcp-specs.bundle.mjs");

await build({
  entryPoints: [`${W}packages/excalidraw/mcp/toolSpecs.ts`],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
});
await build({
  entryPoints: [`${W}packages/excalidraw/mcp/actionCatalog.ts`],
  outfile: out.replace("specs", "catalog"),
  bundle: true,
  platform: "node",
  format: "esm",
});

const { MCP_TOOLS } = await import(pathToFileURL(out).href);
const { MCP_ACTION_CATALOG } = await import(
  pathToFileURL(out.replace("specs", "catalog")).href
);

const first = (text) => text.split(". ")[0].replace(/\.$/, "");
const groups = {
  Look: [
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
  "Create, change, delete": [
    "create_elements",
    "update_elements",
    "delete_elements",
    "duplicate_elements",
    "style_text",
    "bind_arrow",
    "mermaid_to_diagram",
    "select_elements",
  ],
  "The properties panel and ink": [
    "describe_properties",
    "set_properties",
    "set_ink",
  ],
  "The editor's actions": ["list_actions", "run_action"],
  "Pages and their look": [
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
  "The canvas and the view": ["set_canvas", "set_view", "set_tool"],
  "Export and insert": ["export_scene", "insert_document"],
  "Library, stickers, tables, code": [
    "library_list",
    "library_insert",
    "list_stickers",
    "insert_sticker",
    "insert_table",
    "insert_code_card",
  ],
  "Pictures, documents, files and the internet": [
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
};

const grouped = new Set(Object.values(groups).flat());
// the tools only the server calls are not for an assistant, so they are not listed
const missing = MCP_TOOLS.filter((tool) => !tool.hidden)
  .map((tool) => tool.name)
  .filter((name) => !grouped.has(name));

if (missing.length) {
  throw new Error(`not in a group: ${missing.join(", ")}`);
}

let md = `# What the MCP server does

Made from the code by \`scripts/mcpCoverage.mjs\` - the tools are defined once, in
\`packages/excalidraw/mcp/toolSpecs.ts\`, and the actions in \`packages/excalidraw/mcp/actionCatalog.ts\`.
\`status\` is the server's own: it tells the pairing code while no page is paired.

Positions are page-relative: (0, 0) is the top-left of the page, in scene units; pages are numbered from 1.
A tool marked **changes** is refused while *Allow changes* is off, and each is one undo step.
A tool marked **server** is done by the server itself, which has the disk: it reads and writes only in the folders the person lists, and goes on the internet only while *Allow internet* is on.

`;

for (const [title, names] of Object.entries(groups)) {
  md += `## ${title}\n\n| Tool | What it does | |\n| --- | --- | --- |\n`;

  for (const name of names) {
    const tool = MCP_TOOLS.find((each) => each.name === name);

    md += `| \`${name}\` | ${first(tool.description).replace(/\|/g, "/")} | ${
      tool.changes ? "changes" : "reads"
    }${tool.app ? ", app" : ""}${tool.server ? ", server" : ""} |\n`;
  }

  md += "\n";
}

const count = (use) =>
  MCP_ACTION_CATALOG.filter((entry) => entry.use === use).length;

md += `## The editor's actions (${
  MCP_ACTION_CATALOG.length
})\n\nEvery action the editor registers is named, and a test fails when one is not: ${count(
  "run",
)} run with \`run_action\`, ${count(
  "covered",
)} are done by a tool of their own, ${count(
  "later",
)} come with a later part of the server, ${count(
  "excluded",
)} are not for an assistant.\n\n| Action | How |\n| --- | --- |\n`;

for (const entry of MCP_ACTION_CATALOG) {
  const how =
    entry.use === "run"
      ? `run_action: ${entry.description}`
      : entry.use === "covered"
      ? `the tool \`${entry.tool}\``
      : entry.use === "later"
      ? `\`${entry.tool}\`, wave ${entry.wave}`
      : `not for the assistant: ${entry.why}`;

  md += `| \`${entry.name}\` | ${how.replace(/\|/g, "/")} |\n`;
}

md += `
## Still to come

- Wave 9c-2: local files in listed folders, images, GIFs and video from disk, the video and YouTube panels with captions, documents (markdown and PDF), OCR, the code panel and Run, the internet.
- Wave 9c-3: flow charts and their animation and export, slides from a script, playbook pages, the skills for assistants, the VS Code terminal.
`;

fs.writeFileSync(`${W}docs/mcp-coverage.md`, md);
process.stdout.write(
  `tools ${MCP_TOOLS.length}, actions ${MCP_ACTION_CATALOG.length}${EOL}`,
);
