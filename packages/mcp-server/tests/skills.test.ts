/**
 * The skills (D-447): several short lessons for a model on how to use the
 * whiteboard - served as resources, written as files, and true about the tools.
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
import { MCP_PROMPTS, mcpPromptByName } from "../src/prompts";
import { createMcpServer } from "../src/server";
import { SKILLS, skillFile, skillUri } from "../src/skills";

import type { PageLink } from "../src/pageLink";

const SKILL_ROOT = path.resolve(__dirname, "../skill");

const text = (name: string) =>
  SKILLS.find((skill) => skill.name === name)!.body.join("\n");

/** a link to no page: the resources need none */
const noPage = {
  status: () => ({ connected: false }),
  call: async () => {
    throw new Error("not-connected");
  },
} as unknown as PageLink;

const connect = async () => {
  const server = createMcpServer({ link: noPage, code: "ABCD2345" });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(a), client.connect(b)]);

  return client;
};

describe("the skills", () => {
  it("AC-539 each skill is served as a resource and is a file that says the same", async () => {
    expect(SKILLS.map((skill) => skill.name)).toEqual([
      "whiteboard-workflow",
      "whiteboard-text-only",
      "whiteboard-flow-charts",
      "whiteboard-animation",
      "lesson-page-format",
      "voice-fast-and-funny",
      "voice-rigorous",
      "voice-balanced",
      "dsa-lesson-method",
    ]);

    const client = await connect();
    const { resources } = await client.listResources();

    for (const skill of SKILLS) {
      expect(skill.description.length).toBeGreaterThan(40);
      expect(skill.name).toMatch(/^[a-z]+(-[a-z]+)*$/);

      // listed, with its description
      expect(
        resources.find((r) => r.uri === skillUri(skill.name)),
      ).toMatchObject({ name: skill.name, description: skill.description });

      // read, it is the text of the skill
      const read = await client.readResource({ uri: skillUri(skill.name) });

      expect((read.contents as { text: string }[])[0].text).toBe(
        skill.body.join("\n"),
      );

      // and the file is made from the same text
      expect(
        fs.readFileSync(path.join(SKILL_ROOT, skill.name, "SKILL.md"), "utf8"),
      ).toBe(skillFile(skill));
    }

    // a skill that is not there is refused
    await expect(
      client.readResource({ uri: "excalidraw://skills/nothing" }),
    ).rejects.toThrow(/not-found/);
  });

  it("AC-540 a skill names only tools that exist", () => {
    const tools = new Set(mcpPublicTools().map((tool) => tool.name));
    // the server's own tools are not in the page's list
    for (const own of ["status", "read_document"]) {
      tools.add(own);
    }

    const unknown: string[] = [];

    for (const skill of SKILLS) {
      for (const match of skill.body
        .join("\n")
        .matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        if (!tools.has(match[1])) {
          unknown.push(`${skill.name}: ${match[1]}`);
        }
      }
    }

    expect(unknown).toEqual([]);
    // and the tools the skills lean on are really there
    for (const name of [
      "describe_page",
      "check_page",
      "build_page",
      "make_slides",
      "create_flow_chart",
      "check_flow_script",
      "flow_kinds",
      "play_flow",
      "set_flow_look",
      "export_animation",
      "export_handout",
    ]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("AC-541 each skill says what it is for - the text-only one a model that cannot see, the three voices three different ways", () => {
    // a model that cannot see is told what to use instead, and to report numbers
    const textOnly = text("whiteboard-text-only");

    expect(textOnly).toMatch(/Do not call `screenshot`/);
    expect(textOnly).toMatch(/`describe_page`/);
    expect(textOnly).toMatch(/`fits: true`|fits: true/);
    expect(textOnly).toMatch(/never say that a page looks good/);

    // the animation skill keeps the camera off unless the teacher asks
    expect(text("whiteboard-animation")).toMatch(/off by default/);

    // the voices differ in what they ask for
    expect(text("voice-fast-and-funny")).toMatch(/hook/i);
    expect(text("voice-fast-and-funny")).toMatch(/Real definition/);
    expect(text("voice-fast-and-funny")).toMatch(/Do not copy a video, a meme/);
    expect(text("voice-rigorous")).toMatch(/invariant/i);
    expect(text("voice-rigorous")).toMatch(/Trace by hand/);
    expect(text("voice-balanced")).toMatch(/A picture from life/);
    expect(text("voice-balanced")).toMatch(/at most one light moment/i);

    // the teacher's method has its steps, the order of the topics and the problems
    const method = text("dsa-lesson-method");

    expect(method).toMatch(/\*\*The pain\.\*\*/);
    expect(method).toMatch(/\| 1 \| Queue \| 60 \|/);
    expect(method).toMatch(/\| 4 \| Graph \| 100 \|/);
    expect(method).toMatch(/232 Implement Queue using Stacks/);
    expect(method).toMatch(/Run it before you show it/);

    // every skill stays short enough to be read whole
    for (const skill of SKILLS) {
      expect(skill.body.length).toBeLessThan(90);
    }
  });

  it("AC-541 the prompt that starts a lesson names skills that exist", () => {
    const prompt = mcpPromptByName("teach_a_topic")!;

    expect(MCP_PROMPTS).toContain(prompt);

    const named = SKILLS.map((skill) => skill.name);

    for (const voice of ["fast", "rigorous", "balanced", undefined]) {
      const request = prompt.text({ topic: "queue", voice: voice as string });
      const skills = [
        ...request.matchAll(
          /\b(whiteboard-[a-z-]+|lesson-page-format|dsa-lesson-method|voice-[a-z-]+)\b/g,
        ),
      ].map((match) => match[1]);

      expect(skills.length).toBeGreaterThan(3);
      for (const skill of skills) {
        expect(named).toContain(skill);
      }
    }

    expect(prompt.text({ topic: "trie", voice: "fast" })).toMatch(
      /voice-fast-and-funny/,
    );
    expect(prompt.text({ topic: "trie", voice: "rigorous" })).toMatch(
      /voice-rigorous/,
    );
  });
});
