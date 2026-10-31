# The whiteboard's MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude or another) look at, draw on, edit and delete things on the **running whiteboard**. It is a small program the assistant's client starts over stdio; the whiteboard connects to it from the browser, on this computer only.

## Build it

```
yarn build:mcp
```

This writes one file, `packages/mcp-server/dist/index.js`. It needs only `node` to run.

## Add it to your assistant

Claude Code:

```
claude mcp add excalidraw -- node "<this project>\packages\mcp-server\dist\index.js"
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["<this project>\\packages\\mcp-server\\dist\\index.js"]
    }
  }
}
```

## Pair the whiteboard with it

1. Open the whiteboard and the **Assistant** tab in its sidebar.
2. Ask the assistant to call its `status` tool - it tells you an eight-character **pairing code**.
3. Type the code in the tab and press **Connect**. It is remembered on this computer.

The tab has an **Allow changes** switch (on by default): with it off the assistant can look but not change. What the assistant did is listed in the tab, and **Ctrl+Z** undoes each change it made in one step.

## What it listens on

The server listens on `127.0.0.1:47711` only (`EXCALIDRAW_MCP_PORT` changes the port; the page's address can be set at build time with `VITE_APP_MCP_URL`). It accepts a page served from this machine, and only one that presents the pairing code in its first message. The code is kept in `~/.excalidraw-mcp/pairing.json` (`EXCALIDRAW_MCP_HOME` changes the folder).

## The tools

The tools are defined once, in `packages/excalidraw/mcp/toolSpecs.ts`. `status` is the server's own; the rest run in the page. Positions are page-relative: (0, 0) is the top-left of the page, and pages are numbered from 1.
