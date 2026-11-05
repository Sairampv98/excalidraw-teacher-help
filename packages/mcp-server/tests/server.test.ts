/**
 * The MCP layer (D-397): what an assistant's client sees when it talks to the
 * server - the tools, `status`, a call that goes to the page, a picture, and an
 * error. A real MCP client is on the other end of an in-memory transport.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { mcpPublicTools } from "../../excalidraw/mcp/toolSpecs";
import { GUIDE_URI, whiteboardGuide } from "../src/guide";
import { McpCallError } from "../src/pageLink";
import { MCP_PROMPTS } from "../src/prompts";
import { SERVER_NAME, contentOf, createMcpServer } from "../src/server";
import { SKILL_DESCRIPTION, SKILL_NAME, skillMarkdown } from "../src/skill";
import { SKILLS } from "../src/skills";

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
      ...mcpPublicTools().map((tool) => tool.name),
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

describe("the tools the server does itself, and the tools only it calls", () => {
  it("AC-492 sends the tools of its own to its own handlers and not to the page, and tells the folders and the internet in status", async () => {
    const { link, calls } = fakeLink({ connected: true });
    const server = createMcpServer({
      link,
      code: "ABCD2345",
      folders: ["C:/class"],
      fileTools: {
        list_allowed_folders: async () => ({ folders: ["C:/class"] }),
      },
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });

    await server.connect(serverSide);
    await client.connect(clientSide);

    const result = await client.callTool({
      name: "list_allowed_folders",
      arguments: {},
    });

    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual({
      folders: ["C:/class"],
    });
    expect(calls).toEqual([]);

    const status = await client.callTool({ name: "status", arguments: {} });

    expect(
      JSON.parse((status.content as { text: string }[])[0].text),
    ).toMatchObject({
      allowedFolders: ["C:/class"],
      allowInternet: false,
    });

    // a tool of the server's own that this server does not have says so
    const missing = await client.callTool({
      name: "file_info",
      arguments: { path: "a" },
    });

    expect(missing.isError).toBe(true);
    expect((missing.content as { text: string }[])[0].text).toMatch(
      /not available in this server/,
    );
  });

  it("AC-492 does not list the tools only the server calls, and does not take a call to one", async () => {
    const { link, calls } = fakeLink({ connected: true });
    const { client } = await connectClient(link);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    for (const hidden of ["upload_chunk", "upload_drop", "place_image"]) {
      expect(names).not.toContain(hidden);

      const result = await client.callTool({
        name: hidden,
        arguments: {
          id: "abcdef",
          upload: "x",
          index: 0,
          total: 1,
          data: "AA==",
        },
      });

      expect(result.isError).toBe(true);
      expect((result.content as { text: string }[])[0].text).toMatch(
        /unknown-tool/,
      );
    }

    expect(names).toEqual(
      expect.arrayContaining([
        "insert_image",
        "fetch_resource",
        "list_folder",
        "crop_image",
      ]),
    );
    expect(calls).toEqual([]);
  });
});

describe("the prompts, the resources and the skill", () => {
  it("AC-517 the prompts are listed with their name, their description and their arguments, a prompt is given with its text, and a prompt that is not there is refused", async () => {
    const { client } = await connectClient(fakeLink({ connected: false }).link);
    const { prompts } = await client.listPrompts();

    expect(prompts.map((prompt) => prompt.name)).toEqual(
      MCP_PROMPTS.map((prompt) => prompt.name),
    );

    for (const prompt of prompts) {
      expect(prompt.description?.length).toBeGreaterThan(10);
      expect(prompt.arguments?.length).toBeGreaterThan(0);

      for (const argument of prompt.arguments ?? []) {
        expect(argument.description?.length).toBeGreaterThan(5);
      }
    }

    const got = await client.getPrompt({
      name: "lesson_deck",
      arguments: { topic: "photosynthesis", slides: "8" },
    });
    const text = (got.messages[0].content as { text: string }).text;

    expect(text).toMatch(/photosynthesis/);
    expect(text).toMatch(/8 slides/);
    expect(text).toMatch(/make_slides/);

    // a prompt that is not there is refused
    await expect(client.getPrompt({ name: "nope" })).rejects.toThrow(
      /not-found/,
    );
  });

  it("AC-518 the resources are listed with their name and their kind, the guide is read as text, and a resource that is not there is refused", async () => {
    const { client } = await connectClient(fakeLink({ connected: false }).link);
    const { resources } = await client.listResources();

    // the guide first, and then a resource for each skill (D-447)
    expect(resources).toHaveLength(1 + SKILLS.length);
    expect(resources[0]).toMatchObject({
      uri: GUIDE_URI,
      mimeType: "text/plain",
    });
    expect(resources[0].name.length).toBeGreaterThan(3);
    expect(resources[0].description?.length).toBeGreaterThan(10);

    const read = await client.readResource({ uri: GUIDE_URI });
    const contents = read.contents as {
      uri: string;
      mimeType?: string;
      text?: string;
    }[];

    expect(contents[0].text).toBe(whiteboardGuide());
    expect(contents[0].text).toMatch(/page-relative/);
    expect(contents[0].text).toMatch(/## The tools, in groups/);

    // a resource that is not there is refused
    await expect(
      client.readResource({ uri: "excalidraw://guide/nothing" }),
    ).rejects.toThrow(/not-found/);
  });

  it("AC-519 the skill is there, it names the tools in groups, and it carries the same guide the server serves", () => {
    const file = path.resolve(__dirname, "../skill/SKILL.md");
    const text = fs.readFileSync(file, "utf8");

    expect(text).toBe(skillMarkdown());
    expect(text).toContain(`name: ${SKILL_NAME}`);
    expect(text).toContain(`description: ${SKILL_DESCRIPTION}`);
    expect(text).toContain(whiteboardGuide());

    // it names the tools in groups, out of the groups of the code
    expect(text).toContain("## The tools, in groups");
    expect(text).toContain("### Look");
    expect(text).toContain("### Flow charts");
    expect(text).toContain("- `describe_capabilities` - ");
    expect(text).toContain("- `create_flow_chart` - ");
  });
});
