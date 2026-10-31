// Builds the MCP server into one file: packages/mcp-server/dist/index.js (D-397).
//
// The server is started by the person's AI assistant over stdio, so it has to be a
// single file that runs with `node` and needs nothing installed beside it: the MCP
// SDK and the pieces shared with the page (the protocol, the tool definitions and
// the websocket frame codec) are bundled in.
import { mkdirSync } from "node:fs";
import { EOL } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "packages/mcp-server/dist/index.js");

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, "packages/mcp-server/src/index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  sourcemap: false,
  minify: false,
  // the bundle is ESM, and some of what it holds still asks for `require`
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: "info",
});

process.stdout.write(`built ${outfile}${EOL}`);
