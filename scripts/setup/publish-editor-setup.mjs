/**
 * Publishes the editor setup with the page (D-518): the four PowerShell scripts
 * of `installer/editor-setup/` and the bridge extension (`.vsix`) are put in
 * `public/setup/`, so that the page serves them at `/setup/<name>` from its own
 * site - which is where the dialog's link, the downloadable `.cmd` and the
 * PowerShell command fetch them from.
 *
 *   node scripts/setup/publish-editor-setup.mjs
 *
 * The folder is generated and not committed (`/public/setup/` is in
 * `.gitignore`). The Vite config runs this before a build and before the dev
 * server starts, so the page always serves the scripts that are in the repo.
 *
 * Nothing is fetched from the network: the files are copied from the
 * repository, and the extension is built from it (the app opens with no
 * request to another computer, D-452).
 */

/* eslint-disable no-console -- a command line tool: its lines are its output */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(here, "..", "..");

/** The scripts the page serves, in the order the bootstrap needs them. */
export const SETUP_SCRIPTS = [
  "Bootstrap.ps1",
  "EditorSetup.ps1",
  "Open-SetupLink.ps1",
  "Register-SetupLink.ps1",
];

/** The extension, under the name the dialog's link gives. */
export const SETUP_VSIX = "excalidraw-bridge.vsix";

/** The folder the page serves from: `/setup/`. */
export const setupFolder = (root = REPO_ROOT) => join(root, "public", "setup");

/** The newest modification time of the files under a folder. */
const newestIn = (folder) => {
  let newest = 0;

  if (!existsSync(folder)) {
    return newest;
  }

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "build") {
      continue;
    }

    const path = join(folder, entry.name);
    const time = entry.isDirectory() ? newestIn(path) : statSync(path).mtimeMs;

    if (time > newest) {
      newest = time;
    }
  }

  return newest;
};

/**
 * Copies the scripts and builds the extension into `public/setup/`.
 *
 * Returns what was done. A failure to build the extension is REPORTED and does
 * not stop the page: the scripts are published anyway, and the engine says
 * plainly that it could not fetch the extension.
 */
export const publishEditorSetup = ({
  root = REPO_ROOT,
  log = console.log,
  buildVsix = true,
} = {}) => {
  const source = join(root, "installer", "editor-setup");
  const target = setupFolder(root);

  mkdirSync(target, { recursive: true });

  const scripts = [];

  for (const name of SETUP_SCRIPTS) {
    const from = join(source, name);

    if (!existsSync(from)) {
      throw new Error(`the setup script ${name} is not in ${source}`);
    }

    copyFileSync(from, join(target, name));
    scripts.push(name);
  }

  const result = { folder: target, scripts, vsix: null, vsixError: null };

  if (!buildVsix) {
    return result;
  }

  const out = join(target, SETUP_VSIX);
  const bridge = join(root, "packages", "vscode-bridge");
  const inputs = Math.max(
    newestIn(join(bridge, "extension")),
    newestIn(join(bridge, "bridge")),
    newestIn(join(bridge, "scripts")),
  );

  if (existsSync(out) && statSync(out).mtimeMs >= inputs) {
    log("setup: the extension is up to date");
    result.vsix = out;
    return result;
  }

  const built = spawnSync(
    process.execPath,
    [join(bridge, "scripts", "build-vsix.mjs"), "--out", out],
    { cwd: root, encoding: "utf8" },
  );

  if (built.status === 0 && existsSync(out)) {
    log("setup: the extension was built");
    result.vsix = out;
  } else {
    rmSync(out, { force: true });
    result.vsixError = (built.stderr || built.stdout || "unknown error")
      .toString()
      .trim()
      .split(/\r?\n/)
      .slice(-3)
      .join(" | ");
    log(`setup: the extension could not be built (${result.vsixError})`);
  }

  return result;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = publishEditorSetup();

  console.log(
    `setup: ${result.scripts.length} scripts${
      result.vsix ? " and the extension" : ", no extension"
    } in ${result.folder}`,
  );

  if (!result.vsix) {
    process.exitCode = 1;
  }
}
