/**
 * How to confirm it works: the install check and the feature checklist
 * (AC-189).
 *
 * Two documents a teacher uses after the setup has run:
 *
 * - `installer/verify-install.ps1` - one command that checks the machine and
 *   prints a table: the check, the expected value, the actual value and the
 *   verdict. It only READS the machine.
 * - `docs/VERIFY.md` - the feature checklist: what to do, what you should
 *   see, what a deviation looks like, and the clip that shows it working.
 * - `docs/REPORT.md` - how to report a deviation.
 *
 * The test reads the FILES and asserts on them; it does not run the script.
 * That is deliberate: the script runs on Windows and on a machine with the
 * editors, and the rules it must follow - it changes nothing, a missing thing
 * is a row and never an exception, the expected values come from the code -
 * are rules about the text of the script, so they are pinned by reading it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The repository root, found by walking up from the working directory. */
const findRepoRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "excalidraw-app", "App.tsx");

    if (existsSync(candidate)) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the repository root was not found");
};

const root = findRepoRoot();

const script = readFileSync(
  join(root, "installer", "verify-install.ps1"),
  "utf8",
);
const checklist = readFileSync(join(root, "docs", "VERIFY.md"), "utf8");
const report = readFileSync(join(root, "docs", "REPORT.md"), "utf8");

/** the clips the project ships - one per feature, and the first release's one */
const CLIPS = [
  "01-panels-on-the-canvas.mp4",
  "02-properties-panel-actions.mp4",
  "03-crop-and-read.mp4",
  "04-the-crop-crops.mp4",
  "05-placement-flows.mp4",
  "06-presenter-view.mp4",
  "07-live-editor.mp4",
  "08-what-is-mirrored.mp4",
  "09-run-code.mp4",
  "10-pages-frame-number-size.mp4",
  "11-virtual-display.mp4",
  "12-youtube-captions.mp4",
  "13-the-code-card.mp4",
  "14-the-file-sidebar.mp4",
  "15-the-live-view.mp4",
];

/** the recording that is not made yet - the checklist names it, it does not link it */
const PLANNED = ["11-park-and-control.mp4"];

describe("the install check", () => {
  it("AC-189 the check script only reads the machine", () => {
    // nothing that installs, changes or removes
    const forbidden = [
      /\bwinget\b/i,
      /\bchoco\b/i,
      /\bscoop\b/i,
      /\bnpm\s+install\b/i,
      /\byarn\s+add\b/i,
      /\bpip\s+install\b/i,
      /\bRemove-Item\b/,
      /\bNew-Item\b/,
      /\bSet-Item\b/,
      /\bSet-Content\b/,
      /\bOut-File\b/,
      /\bAdd-Content\b/,
      /\bStart-Process\b/,
      /\bInvoke-Expression\b/,
      /\bUninstall\b/,
    ];
    // this repo's `expect` takes one argument, so the failures are collected
    // first and asserted once - the message is then in the failure itself.
    const used = forbidden.filter((pattern) => pattern.test(script));
    expect(used).toEqual([]);

    // and it does read
    expect(script).toMatch(/Get-NetTCPConnection/);
    expect(script).toMatch(/Test-Path/);
    expect(script).toMatch(/Invoke-WebRequest/);
    expect(script).toMatch(/Get-FileHash/);

    // the script says so, in the words a reader sees
    expect(script).toMatch(/only reads/i);
    expect(script).toMatch(/changes nothing/i);
  });

  it("AC-189 a missing thing is a row and never an exception", () => {
    // the three verdicts, plus the one that says "I did not look"
    for (const verdict of ["PASS", "FAIL", "MISSING", "NOT CHECKED"]) {
      expect(script).toContain(verdict);
    }

    // every check is guarded, and one failing check does not stop the rest
    expect(script).toMatch(/\$ErrorActionPreference\s*=\s*"Continue"/);
    const tries = script.match(/\btry\s*\{/g) ?? [];
    const catches = script.match(/\bcatch\b/g) ?? [];
    expect(tries.length).toBeGreaterThanOrEqual(10);
    expect(catches.length).toBeGreaterThanOrEqual(10);

    // the checks that are "not installed" say MISSING, and say why
    expect(script).toMatch(/not installed"[\s\S]{0,40}"MISSING"/);
    expect(script).toMatch(
      /not listening - no editor is running, and the bridge only listens while one is"[\s\S]{0,40}"MISSING"/,
    );

    // the app is not checked when no address was given - it is not a failure
    expect(script).toMatch(
      /not checked - no address was given"[\s\S]{0,40}"NOT CHECKED"/,
    );
  });

  it("AC-189 the script ends with a paste-able report and exits 1 only on a failure", () => {
    // the report: a fenced block with the machine's facts, the table and the counts
    expect(script).toMatch(/'```'/);
    expect(script).toMatch(
      /\$report\.Add\(\("\| \{0\} \| \{1\} \| \{2\} \| \{3\} \|"/,
    );
    expect(script).toMatch(
      /"PASS \{0\} {3}FAIL \{1\} {3}MISSING \{2\} {3}NOT CHECKED \{3\}"/,
    );
    expect(script).toMatch(/Computer:/);
    expect(script).toMatch(/Windows:/);
    expect(script).toMatch(/An editor was running:/);

    // the exit code: 1 only when something FAILED, 0 otherwise
    expect(script).toMatch(/if \(\$counts\["FAIL"\] -gt 0\) \{ exit 1 \}/);
    expect(script).toMatch(/exit 0/);
  });

  it("AC-189 the expected values are read from the code", () => {
    // the Node floor comes from the setup's own module
    expect(script).toMatch(/installer\\lib\\check\.mjs/);
    expect(script).toMatch(/NODE_MINIMUM/);
    // the editor floor comes from the extension's own engines
    expect(script).toMatch(/packages\\vscode-bridge\\extension\\package\.json/);
    expect(script).toMatch(/engines\.vscode/);
    // the port comes from the bridge's own constant
    expect(script).toMatch(/bridge\\src\\protocol\.ts/);
    expect(script).toMatch(/DEFAULT_BRIDGE_PORT/);
    // the extension's name comes from its own package.json
    expect(script).toMatch(/publisher/);
    // and the hashes come from the payload's own manifest
    expect(script).toMatch(/manifest\.json/);
    expect(script).toMatch(/SHA256/);
  });

  it("AC-189 the three files carry no trace of how the project is built", () => {
    const traces: string[] = [];

    for (const [name, text] of [
      ["installer/verify-install.ps1", script],
      ["docs/VERIFY.md", checklist],
      ["docs/REPORT.md", report],
    ] as const) {
      if (/\b(?:AC|D)-\d+\b/.test(text)) {
        traces.push(`${name} carries a row id`);
      }
      if (/SPEC\.md/i.test(text)) {
        traces.push(`${name} names the specification`);
      }
      if (/\bthe gate\b/i.test(text)) {
        traces.push(`${name} names the gate`);
      }
      if (/\bthe kit\b/i.test(text)) {
        traces.push(`${name} names the kit`);
      }
      if (/\bwave \d/i.test(text)) {
        traces.push(`${name} names a wave`);
      }
    }

    expect(traces).toEqual([]);
  });
});

describe("the feature checklist", () => {
  it("AC-189 and AC-524 the checklist gives every feature its four parts, and its clip or the plain words that there is none", () => {
    // the features are the sections under the checklist's feature heading
    const sections = checklist.split(/^###\s+/m).slice(1);
    const features = sections.filter((s) => /^\d+\.\d+\s/.test(s));
    expect(features.length).toBeGreaterThanOrEqual(16);

    const incomplete: string[] = [];

    for (const feature of features) {
      const title = feature.split("\n")[0];
      if (!feature.includes("**What to do**")) {
        incomplete.push(`${title}: no "What to do"`);
      }
      if (!feature.includes("**You should see**")) {
        incomplete.push(`${title}: no "You should see"`);
      }
      if (!feature.includes("**If it is not that**")) {
        incomplete.push(`${title}: no "If it is not that"`);
      }
      if (!feature.includes("**See it**")) {
        incomplete.push(`${title}: no "See it"`);
      }
      // a recording that has not been made is said out loud, never left out
      // (D-433): either the clip is there, or the plain words are
      if (
        !/\.\.\/clips\/[\w.-]+\.mp4/.test(feature) &&
        !/there is no clip of this yet/.test(feature)
      ) {
        incomplete.push(`${title}: no clip`);
      }
    }

    expect(incomplete).toEqual([]);
  });

  it("AC-189 the checklist covers every clip the project ships", () => {
    const notShown = CLIPS.filter((clip) => !checklist.includes(clip));
    expect(notShown).toEqual([]);
  });

  it("AC-527 the checklist links only the recordings that are there, and names the one that is not made yet", () => {
    // a link is a promise: the file is there when the teacher clicks it
    const links = [...checklist.matchAll(/\.\.\/clips\/([\w.-]+\.mp4)/g)].map(
      (match) => match[1],
    );
    const notShipped = links.filter((clip) => !CLIPS.includes(clip));
    expect(notShipped).toEqual([]);

    // and the recording that is not made yet is named, never linked
    for (const clip of PLANNED) {
      expect(checklist).toContain(clip);
      expect(links).not.toContain(clip);
    }
  });

  it("AC-189 the checklist carries the real output of the check", () => {
    // the table the script prints, as it was really printed
    expect(checklist).toMatch(
      /\|\s*check\s*\|\s*expected\s*\|\s*actual\s*\|\s*verdict\s*\|/,
    );
    expect(checklist).toMatch(
      /PASS \d+\s+FAIL \d+\s+MISSING \d+\s+NOT CHECKED \d+/,
    );
    // and the three verdicts are explained where a reader will look for them
    expect(checklist).toMatch(/\*\*PASS\*\*/);
    expect(checklist).toMatch(/\*\*MISSING\*\*/);
    expect(checklist).toMatch(/\*\*FAIL\*\*/);
  });
});

describe("the report page", () => {
  it("AC-189 the report page never asks for the session token", () => {
    // it says the token is a secret and must never be sent ...
    expect(report).toMatch(/token is a secret/i);
    expect(report).toMatch(/never put it in a report/i);
    // ... and it never asks the reader for one
    expect(report).not.toMatch(/token\s*[:=]\s*_{2,}/i);
    expect(report).not.toMatch(/your\s+token\s*[:=]/i);
    expect(report).not.toMatch(/paste\s+your\s+token/i);

    // it asks for the five things a report needs
    expect(report).toMatch(/##\s*1\.\s*What you did/);
    expect(report).toMatch(/##\s*2\.\s*What you expected/);
    expect(report).toMatch(/##\s*3\.\s*What you actually saw/);
    expect(report).toMatch(/##\s*4\.\s*Which feature/);
    expect(report).toMatch(/##\s*5\.\s*The check report/);
    expect(report).toMatch(/##\s*6\.\s*The machine/);
    // and it quotes the words rather than describing them
    expect(report).toMatch(/quote it exactly/i);
    // the machine part asks for the Windows version and whether an editor was running
    expect(report).toMatch(/Windows version/i);
    expect(report).toMatch(/editor was running/i);
  });
});

describe("the files the check reads", () => {
  it("AC-189 the script and the pages are where the reader will look for them", () => {
    expect(existsSync(join(root, "installer", "verify-install.ps1"))).toBe(
      true,
    );
    expect(existsSync(join(root, "docs", "VERIFY.md"))).toBe(true);
    expect(existsSync(join(root, "docs", "REPORT.md"))).toBe(true);
  });
});
