/**
 * AC-295 and AC-296 - the public message is derived from the task description
 * and is clean, and the leak guard stops a leak and passes a clean tree.
 */

import { describe, expect, it } from "vitest";

import { describeFinding, scanMessages, scanTree } from "../guard.mjs";
import {
  deriveMessage,
  subjectFromPaths,
  taskBody,
  taskIdOf,
} from "../message.mjs";

const TASK = `---
id: wave7q-flow-studio
paths: packages
base: main
status: open
---

Flow studio: charts built from a script, with presets and animation. The teacher
types the steps and the chart lays itself out.
`;

describe("AC-295 the public message", () => {
  it("AC-295 the message comes from the task description", () => {
    expect(
      taskIdOf("tins: merge task x\n\nTins-Merge: wave7q-flow-studio"),
    ).toBe("wave7q-flow-studio");
    expect(taskBody(TASK).startsWith("Flow studio")).toBe(true);

    const derived = deriveMessage({
      message: "tins: merge task wave7q-flow-studio",
      taskText: TASK,
      paths: ["packages/excalidraw/a.ts"],
    });

    expect(derived.message.split("\n")[0]).toBe(
      "Flow studio: charts built from a script, with presets and animation",
    );
    expect(derived.message.replace(/\s+/g, " ")).toContain(
      "The teacher types the steps",
    );

    // no id, session or method word is left
    expect(derived.message).not.toMatch(/\b(?:D|AC)-\d+|tins|wave|kit\b/i);
  });

  it("AC-295 a commit with no task gets a subject from its paths", () => {
    expect(
      subjectFromPaths(["packages/excalidraw/a.ts", "excalidraw-app/App.tsx"]),
    ).toBe("Update packages/excalidraw, excalidraw-app");

    const derived = deriveMessage({
      message: "tins: uncommitted work at close",
      taskText: null,
      paths: ["packages/excalidraw/a.ts"],
    });

    expect(derived.message).toBe("Update packages/excalidraw\n");
  });

  it("AC-295 a description that names the method is reported, not published", () => {
    const derived = deriveMessage({
      message: "x",
      taskText:
        "---\nid: a\n---\n\nWave 9z reworked the thing under the method.",
      paths: ["a.ts"],
    });

    expect(derived.unmapped.length).toBeGreaterThan(0);
  });
});

describe("AC-296 the leak guard", () => {
  it("AC-296 each kind of leak is found", () => {
    const files = new Map([
      ["src/a.ts", "// see SPEC.md for the row\nexport const a = 1;"],
      ["src/b.ts", "// covered by AC-12\nexport const b = 1;"],
      ["src/c.ts", `const token = "${"a1".repeat(20)}";`],
      ["src/d.ts", 'const home = "C:\\\\Users\\\\someone\\\\work";'],
      ["SPEC.md", "# rows"],
      ["src/e.ts", `// ${["ghp", "a".repeat(36)].join("_")}`],
    ]);

    const findings = scanTree(files, { deny: ["SPEC.md"], untouched: [] });
    const rules = findings.map((finding) => `${finding.file}:${finding.rule}`);

    expect(rules).toContain("src/a.ts:method-word");
    expect(rules).toContain("src/b.ts:id");
    expect(rules).toContain("src/c.ts:secret");
    expect(rules).toContain("src/d.ts:local-path");
    expect(rules).toContain("SPEC.md:denied-file");
    expect(rules).toContain("src/e.ts:secret");

    // a finding names the place and the rule, never the value
    for (const finding of findings) {
      expect(describeFinding(finding)).not.toContain("ghp_");
      expect(describeFinding(finding)).not.toContain("abcdefghijkl");
    }
  });

  it("AC-296 a clean tree passes", () => {
    const files = new Map([
      ["src/a.ts", "// lays the chart out\nexport const a = 1;"],
      ["README.md", "# A classroom whiteboard\n\nIt draws."],
      ["locales/ro-RO.json", '{"x": "tins is a word here"}'],
      ["img.png", Buffer.from([0, 1, 2, 0])],
    ]);

    expect(
      scanTree(files, { deny: ["SPEC.md"], untouched: ["locales/"] }),
    ).toEqual([]);
  });

  it("AC-296 a message with a method word or an id is a finding", () => {
    const findings = scanMessages([
      { id: "abc12345", message: "Add the flow tab" },
      { id: "def67890", message: "tins: merge task wave7q" },
      { id: "0123abcd", message: "Fix the paste (D-24)" },
    ]);

    expect(findings.map((finding) => finding.file)).toEqual([
      "commit def67890",
      "commit 0123abcd",
    ]);
  });
});
