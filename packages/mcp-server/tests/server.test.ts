/**
 * The MCP layer (D-397): what an assistant's client sees when it talks to the
 * server - the tools, `status`, a call that goes to the page, a picture, and an
 * error. A real MCP client is on the other end of an in-memory transport.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { MCP_TOOLS } from "../../excalidraw/mcp/toolSpecs";
import { McpCallError } from "../src/pageLink";
import { SERVER_NAME, contentOf, createMcpServer } from "../src/server";

import type { PageLink } from "../src/pageLink";

type Answer = unknown | Error;

/** a link to a page that answers what it is told to */
const fakeLink = ({
  connected,
  answer,
}: {
  connected: boolean;
  answer?: (tool: string, args: unknown) => Answer;
}) => {
  const calls: { tool: string; args: unknown }[] = [];
  const link: PageLink = {
    start: async () => 0,
    stop: async () => undefined,
    call: async (tool, args) => {
      calls.push({ tool, args });

      const result = answer?.(tool, args);

      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
    status: () => ({
      connected,
      state: connected
        ? { allowChanges: true, app: "whiteboard", features: [] }
        : null,
    }),
  };

  return { link, calls };
};

const connectClient = async (link: PageLink) => {
  const server = createMcpServer({ link, code: "ABCD2345" });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });

  await server.connect(serverSide);
  await client.connect(clientSide);

  return { client, server };
};

describe("the MCP server", () => {
  it("AC-460 lists status and every tool of the page, each with its description and its schema", async () => {
    const { link } = fakeLink({ connected: false });
    const { client } = await connectClient(link);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "status",
      ...MCP_TOOLS.map((tool) => tool.name),
    ]);

    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }

    expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
    expect(client.getInstructions()).toMatch(/status/);
  });

  it("AC-460 status tells the pairing code while no page is paired, and not once one is", async () => {
    const away = await connectClient(fakeLink({ connected: false }).link);
    const before = await away.client.callTool({
      name: "status",
      arguments: {},
    });
    const text = (before.content as { text: string }[])[0].text;

    expect(JSON.parse(text)).toMatchObject({
      connected: false,
      pairingCode: "ABCD2345",
    });

    const here = await connectClient(fakeLink({ connected: true }).link);
    const after = await here.client.callTool({ name: "status", arguments: {} });
    const paired = (after.content as { text: string }[])[0].text;

    expect(JSON.parse(paired)).toMatchObject({
      connected: true,
      allowChanges: true,
    });
    expect(paired).not.toMatch(/ABCD2345/);
  });

  it("AC-460 sends a call to the page with its arguments and gives the answer back as text", async () => {
    const { link, calls } = fakeLink({
      connected: true,
      answer: () => ({ pages: [{ page: 1 }] }),
    });
    const { client } = await connectClient(link);
    const result = await client.callTool({
      name: "list_elements",
      arguments: { page: 1 },
    });

    expect(calls).toEqual([{ tool: "list_elements", args: { page: 1 } }]);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual({
      pages: [{ page: 1 }],
    });
  });

  it("AC-460 gives a picture the page made as an image, with the rest as text", () => {
    expect(
      contentOf({
        page: 2,
        images: [{ data: "AAAA", mimeType: "image/png" }],
      }),
    ).toEqual([
      { type: "text", text: JSON.stringify({ page: 2 }, null, 2) },
      { type: "image", data: "AAAA", mimeType: "image/png" },
    ]);
    expect(
      contentOf({ images: [{ data: "AAAA", mimeType: "image/png" }] }),
    ).toEqual([{ type: "image", data: "AAAA", mimeType: "image/png" }]);
    expect(contentOf("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("AC-460 an error of the page is an error result that names its code, and a tool that does not exist is one too", async () => {
    const { link } = fakeLink({
      connected: true,
      answer: () =>
        new McpCallError({
          code: "changes-not-allowed",
          message: "Allow changes is off.",
        }),
    });
    const { client } = await connectClient(link);
    const refused = await client.callTool({
      name: "delete_elements",
      arguments: { ids: ["a"] },
    });

    expect(refused.isError).toBe(true);
    expect((refused.content as { text: string }[])[0].text).toBe(
      "changes-not-allowed: Allow changes is off.",
    );

    const unknown = await client.callTool({ name: "nope", arguments: {} });

    expect(unknown.isError).toBe(true);
    expect((unknown.content as { text: string }[])[0].text).toMatch(
      /unknown-tool/,
    );
  });

  it("AC-460 a call while no page is paired says what to do", async () => {
    const link: PageLink = {
      ...fakeLink({ connected: false }).link,
      call: async () => {
        throw new McpCallError({
          code: "not-connected",
          message: "The whiteboard is not connected.",
        });
      },
    };
    const { client } = await connectClient(link);
    const result = await client.callTool({ name: "list_pages", arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(
      /not-connected/,
    );
  });
});
