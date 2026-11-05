#!/usr/bin/env node
/**
 * Write the assistant's skill (D-428) from the guide in the code.
 *
 *   node scripts/buildMcpSkill.mjs
 *
 * The guide is written once, in `packages/mcp-server/src/guide.ts`; the file
 * this writes carries it, so the two cannot drift. The test in
 * `packages/mcp-server/tests/server.test.ts` fails when they do.
 */
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { build } from "esbuild";

const W = `${resolve(dirname(fileURLToPath(import.meta.url)), "..")}/`;
const out = join(tmpdir(), "mcp-skill.bundle.mjs");

await build({
  entryPoints: [`${W}packages/mcp-server/src/skill.ts`],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
});

const { skillMarkdown } = await import(pathToFileURL(out).href);

const file = `${W}packages/mcp-server/skill/SKILL.md`;

fs.mkdirSync(dirname(file), { recursive: true });
fs.writeFileSync(file, skillMarkdown(), "utf8");

process.stdout.write(`wrote ${file}\n`);

// the other skills (D-447): one folder and one SKILL.md each, from skills.ts
const skillsOut = join(tmpdir(), "mcp-skills.bundle.mjs");

await build({
  entryPoints: [`${W}packages/mcp-server/src/skills.ts`],
  outfile: skillsOut,
  bundle: true,
  platform: "node",
  format: "esm",
});

const { SKILLS, skillFile } = await import(pathToFileURL(skillsOut).href);

for (const skill of SKILLS) {
  const skillPath = `${W}packages/mcp-server/skill/${skill.name}/SKILL.md`;

  fs.mkdirSync(dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, skillFile(skill), "utf8");
  process.stdout.write(`wrote ${skillPath}\n`);
}
