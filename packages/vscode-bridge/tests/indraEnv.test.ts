/**
 * The **private environment** of the indra OCR engine: made and filled by the
 * extension when the teacher says so (D-353).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  indraEnvPython,
  installIndra,
  isIndraMissing,
  pythonForSidecar,
  wheelhouseOf,
} from "../extension/src/indraEnv";

const findPackageRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");

    if (existsSync(join(candidate, "extension", "package.json"))) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the vscode-bridge package was not found");
};

const packageRoot = findPackageRoot();

const STORAGE = join("C:", "storage");
const EXTENSION = join("C:", "extension");

/** a runner that says what it was asked and answers from a script */
const fakeRun = (
  answers: Record<string, { code: number | null; output: string }> = {},
) => {
  const calls: { command: string; args: string[] }[] = [];

  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });

      const key = args.includes("venv") ? "venv" : "pip";

      return answers[key] ?? { code: 0, output: "" };
    },
  };
};

describe("the private environment of indra", () => {
  it("AC-414 the sidecar runs in the environment once it is there, and in the teacher's Python until then", () => {
    const own = indraEnvPython(STORAGE);

    expect(own).toContain("indra-env");
    expect(indraEnvPython(STORAGE, "win32")).toMatch(
      /Scripts[\\/]python\.exe$/,
    );
    expect(indraEnvPython(STORAGE, "linux")).toMatch(/bin[\\/]python$/);

    expect(
      pythonForSidecar({
        configured: "python",
        storageDir: STORAGE,
        exists: () => false,
      }),
    ).toBe("python");
    expect(
      pythonForSidecar({
        configured: "python",
        storageDir: STORAGE,
        exists: (path) => path === own,
      }),
    ).toBe(own);
  });

  it("AC-414 the install makes the environment and installs the package in it", async () => {
    const helper = fakeRun();

    const outcome = await installIndra({
      basePython: "python",
      storageDir: STORAGE,
      extensionDir: EXTENSION,
      run: helper.run,
      exists: () => false,
      wheelsShip: () => false,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.python).toBe(indraEnvPython(STORAGE));

    // the teacher's Python makes the environment, and the environment's own
    // Python installs - the teacher's own packages are never touched
    expect(helper.calls[0].command).toBe("python");
    expect(helper.calls[0].args).toEqual([
      "-m",
      "venv",
      join(STORAGE, "indra-env"),
    ]);
    expect(helper.calls[1].command).toBe(indraEnvPython(STORAGE));
    expect(helper.calls[1].args).toContain("indra-ocr");
    expect(helper.calls[1].args).not.toContain("--no-index");
  });

  it("AC-414 an environment that is there is not made again, and shipped wheels are used without the internet", async () => {
    const helper = fakeRun();

    const outcome = await installIndra({
      basePython: "python",
      storageDir: STORAGE,
      extensionDir: EXTENSION,
      run: helper.run,
      exists: () => true,
      wheelsShip: (folder) => folder === wheelhouseOf(EXTENSION),
    });

    expect(outcome.ok).toBe(true);
    expect(helper.calls).toHaveLength(1);
    expect(helper.calls[0].args).toEqual(
      expect.arrayContaining([
        "--no-index",
        "--find-links",
        wheelhouseOf(EXTENSION),
      ]),
    );
    expect(outcome.message).toContain("ship with the extension");
  });

  it("AC-414 a step that fails is said in a sentence that names the step", async () => {
    const noVenv = await installIndra({
      basePython: "python",
      storageDir: STORAGE,
      extensionDir: EXTENSION,
      run: fakeRun({ venv: { code: 1, output: "No module named venv\n" } }).run,
      exists: () => false,
      wheelsShip: () => false,
    });

    expect(noVenv.ok).toBe(false);
    expect(noVenv.message).toContain("could not make the environment");
    expect(noVenv.message).toContain("No module named venv");
    expect(noVenv.message).toContain("pythonPath");

    const noPip = await installIndra({
      basePython: "python",
      storageDir: STORAGE,
      extensionDir: EXTENSION,
      run: fakeRun({
        pip: { code: 1, output: "Collecting x\nERROR: no internet\n" },
      }).run,
      exists: () => true,
      wheelsShip: () => false,
    });

    expect(noPip.ok).toBe(false);
    expect(noPip.message).toContain("pip could not install indra-ocr");
    expect(noPip.message).toContain("ERROR: no internet");
  });

  it("AC-414 a read with indra missing offers the install once, and does not raise an error", () => {
    // the sidecar's own words are what says indra is not there
    expect(
      isIndraMissing("indra-ocr is not installed - pip install indra-ocr"),
    ).toBe(true);
    expect(isIndraMissing("the OCR sidecar crashed")).toBe(false);

    const source = readFileSync(
      join(packageRoot, "extension", "src", "extension.ts"),
      "utf8",
    );

    expect(source).toMatch(
      /if \(isIndraMissing\(message\)\) \{\s*void offerIndraInstall\(\);\s*\} else \{\s*vscode\.window\.showErrorMessage/,
    );
    expect(source).toContain("excalidraw-bridge.installIndraOcr");

    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "extension", "package.json"), "utf8"),
    ) as { contributes: { commands: { command: string }[] } };

    expect(manifest.contributes.commands.map((each) => each.command)).toContain(
      "excalidraw-bridge.installIndraOcr",
    );
  });
});
