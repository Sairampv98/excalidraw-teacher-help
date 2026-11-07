import { startMcp } from "../lib/mcp.mjs";

// An AI assistant draws on the board: the server is added to the assistant, the board is paired
// with it by a code, and the assistant makes a flowchart. The right window is the assistant's
// side (the real server answering real tool calls); the left window is the board.
export default {
  id: "assistant-mcp",
  group: "Assistant (AI)",
  title: "Connect an AI assistant to the board",
  line: "Add the MCP server to your assistant, pair the board with a code, and the assistant draws on it.",
  split: true,
  second: "terminal",
  posterAt: 30,
  async run(c) {
    const { page } = c;
    const top = { at: "top" };
    const tool = (name) => c.right.print(`assistant calls ${name}`, "tool");
    const mcp = await startMcp();

    try {
      // 1. the server is built and added to the assistant
      await c.say("1. Add the server to your assistant (once)", {
        ...top,
        hold: 1500,
      });
      await c.right.typeCommand("yarn build:mcp");
      await c.right.print("wrote packages/mcp-server/dist/index.js", "ok");
      await c.right.typeCommand(
        'claude mcp add excalidraw -- node "<this project>/packages/mcp-server/dist/index.js"',
      );
      await c.right.print("Added stdio MCP server excalidraw", "ok");
      await c.wait(1200);

      // 2. the board is paired with the code the assistant tells
      await c.say("2. Open the Assistant tab on the board", {
        ...top,
        hold: 1500,
      });
      await c.click(page.locator('button[title="Assistant"]'));
      await c.wait(800);

      await c.say("3. The assistant tells you its pairing code", {
        ...top,
        hold: 1200,
      });
      await tool("status");

      const status = await mcp.call("status");
      const code = JSON.parse(status).pairingCode;

      if (!code) {
        throw new Error(
          `the server told no pairing code: ${status.slice(0, 200)}`,
        );
      }

      await c.right.print(`pairing code: ${code}`, "ok");
      await c.wait(1200);

      await c.say("Type it in once, and press Connect", { ...top, hold: 1000 });
      await c.click(page.locator('[data-testid="assistant-code-input"]'));
      await page.keyboard.type(code, { delay: 120 });
      await c.wait(500);
      await c.click(page.locator('[data-testid="assistant-connect"]'));
      await page
        .locator('[data-testid="assistant-status"][data-status="connected"]')
        .waitFor({ timeout: 15000 });
      await c.say("Connected: the board and the assistant are paired", {
        ...top,
        hold: 2500,
      });

      // 3. the assistant draws
      await c.say("4. Now the assistant can draw on your board", {
        ...top,
        hold: 1500,
      });
      await tool("create_flow_chart (process)");
      await mcp.call("create_flow_chart", {
        kind: "process",
        script: "Plan the lesson\nTeach it\nCheck the class understood",
      });
      await c.right.print("made a flowchart on page 1", "ok");
      await c.wait(1500);
      await c.click({ x: 300, y: 650 });
      await c.say("It is made of ordinary shapes: you can change it", {
        ...top,
        hold: 3500,
      });
    } finally {
      await mcp.close();
    }
  },
};
