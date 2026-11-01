/**
 * The entry of the MCP server: it speaks MCP on stdin and stdout, and listens
 * for the page on the loopback interface (D-397).
 *
 * Nothing but MCP may be written to stdout - the log goes to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { DEFAULT_MCP_PORT } from "../../excalidraw/mcp/protocol";

import { createFileTools } from "./fileTools";
import { createFolders, foldersFromConfig } from "./folders";
import { readOrCreatePairingCode } from "./pairing";
import { createPageLink } from "./pageLink";
import { SERVER_NAME, SERVER_VERSION, createMcpServer } from "./server";

const log = (message: string) => process.stderr.write(`[mcp] ${message}\n`);

const main = async () => {
  const code = readOrCreatePairingCode();
  const port = Number(process.env.EXCALIDRAW_MCP_PORT) || DEFAULT_MCP_PORT;
  const link = createPageLink({
    code,
    serverName: SERVER_NAME,
    version: SERVER_VERSION,
    port,
    log,
  });

  try {
    await link.start();
    log(`listening for the whiteboard on 127.0.0.1:${port}`);
  } catch (error) {
    // the tools still answer: status says the page cannot connect
    log(
      `could not listen on 127.0.0.1:${port}: ${
        error instanceof Error ? error.message : String(error)
      } (another copy of the server may be running)`,
    );
  }

  // the folders the person listed: nothing is read or written outside them (D-409)
  const folders = createFolders(foldersFromConfig());

  log(
    folders.allowed().length
      ? `allowed folders: ${folders.allowed().join(", ")}`
      : "no folder is allowed (start the server with --folder <path>)",
  );

  const server = createMcpServer({
    link,
    code,
    fileTools: createFileTools({ link, folders }),
    folders: folders.allowed(),
  });

  await server.connect(new StdioServerTransport());

  const stop = () => {
    void link.stop().then(() => process.exit(0));
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdin.on("close", stop);
};

main().catch((error) => {
  log(`failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
