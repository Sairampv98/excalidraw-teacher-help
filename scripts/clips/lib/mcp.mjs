// The assistant's side of the MCP clip: the real server, started the way an assistant's client starts it,
// and called with real tool calls. Nothing here is made up: what the page shows is what the server did.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** the built server: made once with the project's own build when it is not there */
export const ensureServerBuilt = () => {
  const file = path.join(ROOT, "packages", "mcp-server", "dist", "index.js");

  if (!fs.existsSync(file)) {
    const built = spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts", "buildMcpServer.mjs")],
      { cwd: ROOT, encoding: "utf8" },
    );

    if (built.status !== 0 || !fs.existsSync(file)) {
      throw new Error(`the MCP server could not be built: ${built.stderr}`);
    }
  }

  return file;
};

export const startMcp = async () => {
  const file = ensureServerBuilt();
  const sdk = (name) =>
    import(
      pathToFileURL(
        path.join(
          ROOT,
          "node_modules",
          "@modelcontextprotocol",
          "sdk",
          "dist",
          "esm",
          name,
        ),
      ).href
    );
  const { Client } = await sdk("client/index.js");
  const { StdioClientTransport } = await sdk("client/stdio.js");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-clip-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [file],
    env: { ...process.env, EXCALIDRAW_MCP_HOME: home },
  });
  const client = new Client({ name: "clip-assistant", version: "1.0.0" });

  await client.connect(transport);

  return {
    file,
    /** a tool call; the answer is the words the server sent back */
    call: async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });

      return (result.content ?? []).map((part) => part.text ?? "").join("\n");
    },
    close: async () => {
      await client.close().catch(() => {});
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
};
