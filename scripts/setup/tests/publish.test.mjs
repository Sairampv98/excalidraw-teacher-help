/**
 * AC-619 - the script that publishes /setup/*.ps1 and the .vsix with the page (D-518).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  publishEditorSetup,
  REPO_ROOT,
  SETUP_SCRIPTS,
  SETUP_VSIX,
  setupFolder,
} from "../publish-editor-setup.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "setup-publish-"));

/** a repository with the four scripts and nothing else */
const fakeRepo = () => {
  const root = tmp();
  const source = path.join(root, "installer", "editor-setup");

  fs.mkdirSync(source, { recursive: true });

  for (const name of SETUP_SCRIPTS) {
    fs.writeFileSync(path.join(source, name), `# ${name}\n`);
  }

  return root;
};

describe("AC-619 the setup is published with the page", () => {
  it("AC-619 the four scripts are copied to public/setup, unchanged", () => {
    const root = fakeRepo();
    const result = publishEditorSetup({
      root,
      buildVsix: false,
      log: () => {},
    });

    expect(result.scripts).toEqual(SETUP_SCRIPTS);
    expect(result.folder).toBe(setupFolder(root));

    for (const name of SETUP_SCRIPTS) {
      expect(fs.readFileSync(path.join(result.folder, name), "utf8")).toBe(
        `# ${name}\n`,
      );
    }

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("AC-619 a script that is missing stops the publish and says which", () => {
    const root = fakeRepo();

    fs.rmSync(path.join(root, "installer", "editor-setup", "Bootstrap.ps1"));

    expect(() =>
      publishEditorSetup({ root, buildVsix: false, log: () => {} }),
    ).toThrow(/Bootstrap\.ps1/);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("AC-619 an extension that cannot be built is reported and the scripts are still published", () => {
    const root = fakeRepo();
    const lines = [];
    const result = publishEditorSetup({
      root,
      log: (line) => lines.push(line),
    });

    // the fake repository has no extension to build
    expect(result.vsix).toBeNull();
    expect(result.vsixError).toBeTruthy();
    expect(lines.join("\n")).toContain("could not be built");
    expect(fs.existsSync(path.join(result.folder, "EditorSetup.ps1"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(result.folder, SETUP_VSIX))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it("AC-619 the real repository's scripts are all there to publish, and nothing of the sandbox proof is", () => {
    const source = path.join(REPO_ROOT, "installer", "editor-setup");

    for (const name of SETUP_SCRIPTS) {
      expect(fs.existsSync(path.join(source, name)), name).toBe(true);
    }

    // the sandbox proof is for the repository, not for a teacher's page
    expect(SETUP_SCRIPTS.join(" ")).not.toMatch(/sandbox/i);
  });

  it("AC-619 the Vite config publishes the setup before a build and before the dev server, and the folder is not committed", () => {
    const config = fs.readFileSync(
      path.join(REPO_ROOT, "excalidraw-app", "vite.config.mts"),
      "utf8",
    );

    expect(config).toContain("publishEditorSetup");
    expect(config).toMatch(/name: "editor-setup"/);

    const ignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");

    expect(ignore).toMatch(/^\/public\/setup\/$/m);
  });
});
