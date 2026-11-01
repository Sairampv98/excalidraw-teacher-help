// Writes docs/mcp-coverage.md from the code: the tools of the server and the
// actions of the editor, and how each is reached (D-406). Run: node scripts/mcpCoverage.mjs
import fs from "node:fs";
import { EOL, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { build } from "esbuild";

const W = `${resolve(dirname(fileURLToPath(import.meta.url)), "..")}/`;
const out = join(tmpdir(), "mcp-specs.bundle.mjs");

const bundle = async (entry, name) => {
  const file = out.replace("specs", name);

  await build({
    entryPoints: [`${W}${entry}`],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "esm",
  });

  return pathToFileURL(file).href;
};

const specsUrl = await bundle("packages/excalidraw/mcp/toolSpecs.ts", "specs");
const catalogUrl = await bundle(
  "packages/excalidraw/mcp/actionCatalog.ts",
  "catalog",
);
const groupsUrl = await bundle(
  "packages/excalidraw/mcp/toolGroups.ts",
  "groups",
);

const { MCP_TOOLS } = await import(specsUrl);
const { MCP_ACTION_CATALOG } = await import(catalogUrl);
const { MCP_TOOL_GROUPS, assertGroupsCoverTools } = await import(groupsUrl);

// the groups live in the code (D-425): the document is made from them
assertGroupsCoverTools();

const first = (text) => text.split(". ")[0].replace(/\.$/, "");
const groups = Object.fromEntries(
  MCP_TOOL_GROUPS.map((group) => [group.title, [...group.tools]]),
);

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
      ? `\`${entry.tool}\`, in a later part of the server`
      : `not for the assistant: ${entry.why}`;

  md += `| \`${entry.name}\` | ${how.replace(/\|/g, "/")} |\n`;
}

md += `
## Still to come

- The export of an animation and of a handout, the VS Code terminal.
`;

fs.writeFileSync(`${W}docs/mcp-coverage.md`, md);
process.stdout.write(
  `tools ${MCP_TOOLS.length}, actions ${MCP_ACTION_CATALOG.length}${EOL}`,
);
