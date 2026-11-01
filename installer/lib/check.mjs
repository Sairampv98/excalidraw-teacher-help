/**
 * The setup's checking logic (D-152, AC-186).
 *
 * The setup is two scripts - `installer/setup.ps1` (Windows) and
 * `installer/setup.sh` (macOS and Linux) - and each of them does three things:
 * FIND the facts about the machine, ASK before installing anything, and
 * INSTALL what is missing. The rules that decide what "missing" means, what
 * the report says and what would be installed live HERE, in one module, so
 * that:
 *
 *   - the rules can be tested on ANY machine: the test feeds this module a
 *     made-up machine and asserts on the report, so the test needs neither
 *     Windows nor a network (AC-186);
 *   - the module is a PURE function of what was found: it never installs
 *     anything, never runs a command and never touches the disk. The scripts
 *     do the asking and the installing around it.
 *
 * The scripts implement the same rules natively, because the setup has to run
 * on a machine that has no Node at all - Node is one of the things it
 * installs. `packages/vscode-bridge/tests/setup.test.ts` pins the two
 * together: every check this module knows about is a check both scripts make,
 * and neither script can install anything before its dry-run guard.
 */

/** The oldest Node the toolchain wants (the repository's `engines` say >= 18). */
export const NODE_MINIMUM = 20;

/** The checks the setup makes, in the order it reports them. */
export const CHECKS = [
  { id: "node", label: "Node.js" },
  { id: "yarn", label: "Yarn" },
  { id: "vscode", label: "VS Code" },
  { id: "vscodium", label: "VSCodium" },
  { id: "extension", label: "The extension" },
  { id: "dependencies", label: "The app's dependencies" },
  { id: "runtimes", label: "Runtimes for Run" },
];

/**
 * Every action the setup can take.
 *
 * The scripts implement each of these, and the test checks that both of them
 * know every id - so an action cannot be added to the plan without the
 * scripts being able to carry it out.
 */
export const ACTION_IDS = [
  "node.install",
  "yarn.corepack",
  "extension.build",
  "extension.install.vscode",
  "extension.install.vscodium",
  "editor.install.vscode",
  "editor.install.vscodium",
  "dependencies.install",
  "runtime.python",
  "runtime.java",
];

/** The `.vsix` the setup builds and installs. */
export const EXTENSION_FILE =
  "packages/vscode-bridge/excalidraw-bridge-0.2.0.vsix";

/**
 * The facts about a machine, as the scripts found them.
 *
 * Everything is nullable: a machine with nothing installed is a machine the
 * setup must still be able to report on.
 *
 * @typedef {Object} Found
 * @property {string|null} nodeVersion       the version Node reported, if any
 * @property {string|null} yarnVersion       the version Yarn reported, if any
 * @property {string|null} corepackVersion   the version Corepack reported, if any
 * @property {{cli: string|null, path: string|null, installed: boolean}} vscode
 * @property {{cli: string|null, path: string|null, installed: boolean}} vscodium
 * @property {boolean} extensionBuilt        the `.vsix` is there
 * @property {boolean} dependenciesInstalled `node_modules` is at the repository root
 * @property {{node: boolean, python: boolean, java: boolean}} runtimes
 * @property {boolean} winget                winget is on the PATH
 * @property {boolean} brew                  Homebrew is on the PATH
 * @property {boolean} directInstall         the script can download and run the official installer itself
 */

/** An editor as the scripts found it. */
const editor = (value) => ({
  cli: value?.cli ?? null,
  path: value?.path ?? null,
  installed: value?.installed === true,
});

/** The facts, with every field present. */
const normalize = (found) => ({
  nodeVersion: found?.nodeVersion ?? null,
  yarnVersion: found?.yarnVersion ?? null,
  corepackVersion: found?.corepackVersion ?? null,
  vscode: editor(found?.vscode),
  vscodium: editor(found?.vscodium),
  extensionBuilt: found?.extensionBuilt === true,
  dependenciesInstalled: found?.dependenciesInstalled === true,
  runtimes: {
    node: found?.runtimes?.node === true,
    python: found?.runtimes?.python === true,
    java: found?.runtimes?.java === true,
  },
  winget: found?.winget === true,
  brew: found?.brew === true,
  directInstall: found?.directInstall === true,
});

/**
 * The major version of a version string, or null when the string carries none.
 *
 * @param {string|null|undefined} version
 * @returns {number|null}
 */
export const majorVersion = (version) => {
  if (typeof version !== "string") {
    return null;
  }

  const match = version
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)/);

  return match ? Number.parseInt(match[1], 10) : null;
};

/**
 * The report: what is present, what is missing, what would be installed.
 *
 * Pure: it reads nothing and installs nothing. What it returns is plain data
 * (so the test can assert on it) plus the lines to print (so the scripts can
 * print it).
 *
 * @param {Found} found
 */
export function buildReport(found) {
  const facts = normalize(found);
  const checks = [];
  const actions = [];

  // --- Node.js: on the PATH, and 20 or newer ---------------------------
  {
    const version = facts.nodeVersion;
    const major = majorVersion(version);

    if (!version) {
      checks.push({
        id: "node",
        label: "Node.js",
        present: false,
        detail: "not found",
        reason: "Node.js is not on the PATH",
      });
    } else if (major === null) {
      checks.push({
        id: "node",
        label: "Node.js",
        present: false,
        detail: version,
        reason: `Node.js reported an unreadable version (${version})`,
      });
    } else if (major < NODE_MINIMUM) {
      checks.push({
        id: "node",
        label: "Node.js",
        present: false,
        detail: version,
        reason: `Node.js ${version} is older than ${NODE_MINIMUM}, which the toolchain wants`,
      });
    } else {
      checks.push({
        id: "node",
        label: "Node.js",
        present: true,
        detail: `${version} (${NODE_MINIMUM} or newer)`,
        reason: null,
      });
    }
  }

  // --- Yarn: on the PATH, or Corepack can provide it ------------------
  {
    if (facts.yarnVersion) {
      checks.push({
        id: "yarn",
        label: "Yarn",
        present: true,
        detail: facts.yarnVersion,
        reason: null,
      });
    } else if (facts.corepackVersion) {
      checks.push({
        id: "yarn",
        label: "Yarn",
        present: true,
        detail: `not on the PATH yet - Corepack ${facts.corepackVersion} can provide it`,
        reason: null,
      });
    } else {
      checks.push({
        id: "yarn",
        label: "Yarn",
        present: false,
        detail: "not found",
        reason:
          "Yarn is not on the PATH and Corepack is not available to provide it",
      });
    }
  }

  // --- VS Code and VSCodium: the CLI, or the standard install path ----
  for (const [id, label, fact, cliName] of [
    ["vscode", "VS Code", facts.vscode, "code"],
    ["vscodium", "VSCodium", facts.vscodium, "codium"],
  ]) {
    if (fact.cli || fact.path) {
      const where = fact.cli
        ? `${fact.cli} (${fact.path ?? "on the PATH"})`
        : fact.path;

      checks.push({
        id,
        label,
        present: true,
        detail: where,
        reason: null,
      });
    } else {
      checks.push({
        id,
        label,
        present: false,
        detail: "not found",
        reason: `${label} was not found (no ${cliName} command and no standard install path)`,
      });
    }
  }

  // --- the extension: the `.vsix` is built -----------------------------
  {
    checks.push({
      id: "extension",
      label: "The extension",
      present: facts.extensionBuilt,
      detail: facts.extensionBuilt
        ? `${EXTENSION_FILE} is built`
        : `${EXTENSION_FILE} is not built yet`,
      reason: facts.extensionBuilt
        ? null
        : "the extension has not been built yet",
    });
  }

  // --- the app's dependencies: `node_modules` --------------------------
  {
    checks.push({
      id: "dependencies",
      label: "The app's dependencies",
      present: facts.dependenciesInstalled,
      detail: facts.dependenciesInstalled
        ? "node_modules is there"
        : "node_modules is missing",
      reason: facts.dependenciesInstalled
        ? null
        : "the app's dependencies are not installed (no node_modules)",
    });
  }

  // --- the language runtimes the panel's Run can execute ---------------
  {
    const runtimeState = [
      ["node", facts.runtimes.node],
      ["python", facts.runtimes.python],
      ["java", facts.runtimes.java],
    ];
    const missingRuntimes = runtimeState
      .filter(([, present]) => !present)
      .map(([name]) => name);

    checks.push({
      id: "runtimes",
      label: "Runtimes for Run",
      present: missingRuntimes.length === 0,
      detail: runtimeState
        .map(([name, present]) => `${name} ${present ? "ok" : "missing"}`)
        .join(", "),
      reason:
        missingRuntimes.length === 0
          ? null
          : `${missingRuntimes.join(", ")} ${
              missingRuntimes.length === 1 ? "is" : "are"
            } missing`,
    });
  }

  // --- what the setup would install -------------------------------------
  const nodeIsThere = checks[0].present;

  if (!nodeIsThere) {
    const canInstall = facts.winget || facts.brew || facts.directInstall;

    actions.push({
      id: "node.install",
      label: "Install Node.js",
      detail: facts.winget
        ? "through winget"
        : facts.brew
        ? "through brew"
        : canInstall
        ? "from nodejs.org"
        : "no package manager is available, so this one is yours to do",
      automatic: canInstall,
      instruction: canInstall
        ? null
        : `Install Node.js ${NODE_MINIMUM} or newer from https://nodejs.org and run this script again.`,
    });
  }

  if (!facts.yarnVersion && facts.corepackVersion) {
    actions.push({
      id: "yarn.corepack",
      label: "Enable Yarn through Corepack",
      detail: `Corepack ${facts.corepackVersion} is on the PATH`,
      automatic: true,
      instruction: null,
    });
  }

  if (!facts.extensionBuilt) {
    actions.push({
      id: "extension.build",
      label: "Build the extension",
      detail: `${EXTENSION_FILE}`,
      automatic: nodeIsThere,
      instruction: nodeIsThere
        ? null
        : "Node.js is needed to build the extension - install Node.js first, then run this script again.",
    });
  }

  for (const [id, label, fact] of [
    ["extension.install.vscode", "VS Code", facts.vscode],
    ["extension.install.vscodium", "VSCodium", facts.vscodium],
  ]) {
    const editorIsThere = fact.cli || fact.path;

    if (editorIsThere && !fact.installed) {
      actions.push({
        id,
        label: `Install the extension into ${label}`,
        detail: "the editor does not have it yet",
        automatic: true,
        instruction: null,
      });
    }
  }

  // The editor itself, when it is not on the machine at all. A teacher who
  // has neither VS Code nor VSCodium cannot use the bridge, so the setup
  // offers to install one.
  for (const [id, label, fact, cli] of [
    ["editor.install.vscode", "VS Code", facts.vscode, "code"],
    ["editor.install.vscodium", "VSCodium", facts.vscodium, "codium"],
  ]) {
    if (fact.cli || fact.path) {
      continue;
    }

    const canInstall = facts.winget || facts.brew || facts.directInstall;
    const from = label === "VS Code" ? "code.visualstudio.com" : "vscodium.com";

    actions.push({
      id,
      label: `Install ${label}`,
      detail: facts.winget
        ? "through winget"
        : facts.brew
        ? "through brew"
        : canInstall
        ? `from ${from}`
        : "no package manager is available, so this one is yours to do",
      automatic: canInstall,
      instruction: canInstall
        ? null
        : `Install ${label} from https://${from} and run this script again.`,
    });
  }

  if (!facts.dependenciesInstalled) {
    actions.push({
      id: "dependencies.install",
      label: "Install the app's dependencies",
      detail: "with yarn, in the repository root",
      automatic: Boolean(facts.yarnVersion || facts.corepackVersion),
      instruction:
        facts.yarnVersion || facts.corepackVersion
          ? null
          : "Yarn is needed to install the app's dependencies - install Yarn first, then run this script again.",
    });
  }

  for (const [id, label, present] of [
    ["runtime.python", "Python", facts.runtimes.python],
    ["runtime.java", "Java", facts.runtimes.java],
  ]) {
    if (!present) {
      actions.push({
        id,
        label: `Install ${label}`,
        detail: facts.winget
          ? "through winget"
          : "winget is not on the PATH, so this one is yours to do",
        automatic: facts.winget,
        instruction: facts.winget
          ? null
          : `Install ${label} from https://excalidraw.com and run this script again.`,
      });
    }
  }

  const presentIds = checks.filter((check) => check.present).map((c) => c.id);
  const missingIds = checks.filter((check) => !check.present).map((c) => c.id);

  const summary = {
    total: checks.length,
    present: presentIds.length,
    missing: missingIds.length,
    actions: actions.length,
    text:
      missingIds.length === 0
        ? `Summary: all ${checks.length} checks are already in place. Nothing to install.`
        : `Summary: ${presentIds.length} of ${checks.length} checks are already in place, ` +
          `${missingIds.length} ${
            missingIds.length === 1 ? "is" : "are"
          } missing. ` +
          `${actions.length} ${
            actions.length === 1 ? "thing" : "things"
          } would be installed.`,
  };

  return {
    checks,
    present: presentIds,
    missing: missingIds,
    actions,
    summary,
    lines: formatReport({
      checks,
      present: presentIds,
      missing: missingIds,
      actions,
      summary,
    }),
  };
}

/**
 * The report as the lines to print.
 *
 * The last line is the summary: the report ENDS with something the reader can
 * act on.
 *
 * @param {ReturnType<typeof buildReport>} report
 * @returns {string[]}
 */
export function formatReport(report) {
  const width = Math.max(...report.checks.map((check) => check.label.length));
  const lines = [];

  lines.push("Excalidraw setup - what this machine already has");
  lines.push("");

  for (const check of report.checks) {
    const state = check.present ? "ok" : "missing";
    const text = check.present ? check.detail : check.reason;

    lines.push(`  [${state.padEnd(7)}] ${check.label.padEnd(width)}  ${text}`);
  }

  lines.push("");

  if (report.actions.length) {
    lines.push(`What the setup would install (${report.actions.length}):`);

    report.actions.forEach((action, index) => {
      lines.push(`  ${index + 1}. ${action.label} - ${action.detail}`);

      if (!action.automatic && action.instruction) {
        lines.push(`     ${action.instruction}`);
      }
    });
  } else {
    lines.push(
      "What the setup would install: nothing - everything is already there.",
    );
  }

  lines.push("");
  lines.push(report.summary.text);

  return lines;
}

/**
 * The plan: what to do with the things that are missing.
 *
 * Three modes, and they are the three the scripts have:
 *
 *   - `dry-run`: report only. Nothing is installed, not even a question.
 *   - `ask`: the default. The reader is asked before anything is installed.
 *   - `auto`: `-Yes` - the answers are accepted and nothing is asked.
 *
 * @param {ReturnType<typeof buildReport>} report
 * @param {{dryRun?: boolean, assumeYes?: boolean}} [options]
 */
export function planInstalls(report, options = {}) {
  const planned = report.actions.slice();

  if (options.dryRun === true) {
    return { mode: "dry-run", planned, willInstall: [], questions: [] };
  }

  if (options.assumeYes === true) {
    return {
      mode: "auto",
      planned,
      willInstall: planned.slice(),
      questions: [],
    };
  }

  return {
    mode: "ask",
    planned,
    willInstall: planned.slice(),
    questions: [
      {
        id: "confirm",
        text: `Install ${planned.length} ${
          planned.length === 1 ? "thing" : "things"
        } now? [Y/n]`,
        default: true,
      },
    ],
  };
}

/**
 * The answer to the question the setup asks.
 *
 * An empty answer takes the question's default, so pressing Enter means
 * "yes" - which is what a teacher pressing Enter expects.
 *
 * @param {{default: boolean}} question
 * @param {string|null|undefined} answer
 * @returns {boolean}
 */
export function answerIsYes(question, answer) {
  const text = typeof answer === "string" ? answer.trim().toLowerCase() : "";

  if (text === "") {
    return question.default === true;
  }

  return text === "y" || text === "yes";
}
