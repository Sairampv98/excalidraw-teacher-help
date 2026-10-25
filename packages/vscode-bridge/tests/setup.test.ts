/**
 * The setup: check what is missing, and install it (D-152, AC-186).
 *
 * The setup is the thing a teacher or a student runs. It REPORTS what it
 * finds, ASKS before it installs anything, and INSTALLS what is missing.
 *
 * The rules that decide all of that live in `installer/lib/check.mjs`: a
 * module that takes **what was found** and returns the **report** - what is
 * present, what is missing, what would be installed - and never installs
 * anything itself. That is what makes this test possible: the test feeds the
 * module a made-up machine and asserts on the report, so the test needs
 * neither Windows nor a network.
 *
 * The scripts - `installer/setup.ps1` and `installer/setup.sh` - are the
 * halves that FIND the facts, ASK and INSTALL, and they cannot ask the
 * module, because the setup has to run on a machine with no Node at all and
 * Node is one of the things it installs. So the test pins them to the
 * module: the same checks, the same labels, the same actions - and no
 * install command before the dry-run guard.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ACTION_IDS,
  CHECKS,
  NODE_MINIMUM,
  answerIsYes,
  buildReport,
  formatReport,
  majorVersion,
  planInstalls,
} from "../../../installer/lib/check.mjs";

/**
 * The shape of one thing the setup checks, and of one thing it would install.
 *
 * They are written out here rather than imported, because the module is plain
 * JavaScript with a `.d.mts` beside it: the declaration is found by the
 * repository's own `tsc`, but the app's build checks the tests with a
 * different configuration, and there the module resolves to `any`. A callback
 * over an `any` array then has an implicitly-`any` parameter, which is an
 * error. Naming the shapes here makes the test correct under BOTH.
 */
type SetupCheck = {
  id: string;
  label: string;
  present: boolean;
  detail: string;
  reason: string | null;
};

type SetupAction = {
  id: string;
  label: string;
  detail: string;
  automatic: boolean;
  instruction: string | null;
};

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

const repoRoot = findRepoRoot();

const read = (relative: string) =>
  readFileSync(join(repoRoot, relative), "utf8");

/** A machine that has everything the setup checks. */
const everythingThere = () => ({
  nodeVersion: "22.23.2",
  yarnVersion: "1.22.22",
  corepackVersion: "0.34.6",
  vscode: { cli: "code", path: "C:\\code.cmd", installed: true },
  vscodium: { cli: "codium", path: "C:\\codium.cmd", installed: true },
  extensionBuilt: true,
  dependenciesInstalled: true,
  runtimes: { node: true, python: true, java: true },
  winget: true,
  brew: true,
  directInstall: true,
});

/** A machine that has nothing at all. */
const nothingThere = () => ({
  nodeVersion: null,
  yarnVersion: null,
  corepackVersion: null,
  vscode: { cli: null, path: null, installed: false },
  vscodium: { cli: null, path: null, installed: false },
  extensionBuilt: false,
  dependenciesInstalled: false,
  runtimes: { node: false, python: false, java: false },
  winget: false,
  brew: false,
  directInstall: false,
});

/**
 * A bare machine with no package manager at all - a Windows Sandbox, a fresh
 * server. The setup must still be able to install, because it can download the
 * official installer itself.
 */
const bareMachine = () => ({
  ...nothingThere(),
  directInstall: true,
});

/** The command that installs something - never before the dry-run guard. */
const COMMON_INSTALL_COMMANDS = [
  "--install-extension",
  "corepack enable",
  "yarn install --frozen-lockfile",
  "build-vsix.mjs",
];

/**
 * The two scripts, the line that stops a dry run, and the install commands
 * **that script** can run - the Windows one downloads and runs an installer
 * itself, the Unix one uses Homebrew.
 */
const SCRIPTS = [
  {
    path: "installer/setup.ps1",
    guard: "if ($DryRun) {",
    installs: [...COMMON_INSTALL_COMMANDS, "msiexec", "winget install"],
  },
  {
    path: "installer/setup.sh",
    guard: 'if [ "$DRY_RUN" -eq 1 ]; then',
    installs: [...COMMON_INSTALL_COMMANDS, "winget install", "brew install"],
  },
];

describe("the setup: check what is missing, and install it", () => {
  it("AC-187 the setup is one executable built by the compiler that ships with Windows", () => {
    const build = readFileSync(
      join(findRepoRoot(), "installer", "build-setup-exe.mjs"),
      "utf8",
    );

    // the compiler that is already on every Windows machine - no download, no
    // new dependency for the project
    expect(build).toContain(
      "C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe",
    );
    expect(build).not.toContain("npm install");
    expect(build).not.toContain("yarn add");

    // AnyCPU, so the executable runs on ARM64 Windows too
    expect(build).toContain("/platform:anycpu");

    // and the launcher is C# 5, because that is what the compiler understands
    const launcher = readFileSync(
      join(findRepoRoot(), "installer", "launcher", "SetupLauncher.cs"),
      "utf8",
    );
    expect(launcher).not.toContain('$"');
    expect(launcher).not.toContain("=>");
  });

  it("AC-187 the launcher carries the installer with it", () => {
    const build = readFileSync(
      join(findRepoRoot(), "installer", "build-setup-exe.mjs"),
      "utf8",
    );

    // the scripts are embedded as resources, so the executable works on its own
    expect(build).toContain("setup.ps1");
    expect(build).toContain("setup.sh");
    expect(build).toContain("check.mjs");
    expect(build).toContain("/resource:");

    const launcher = readFileSync(
      join(findRepoRoot(), "installer", "launcher", "SetupLauncher.cs"),
      "utf8",
    );
    expect(launcher).toContain("GetManifestResourceStream");
    // and it passes the arguments through, so -DryRun and -Yes mean the same
    // thing in the executable as in the script
    expect(launcher).toContain("args");
    expect(launcher).toContain("setup.ps1");
  });

  it("AC-187 the container's build context carries the installer and the heap the build needs", () => {
    const root = findRepoRoot();

    // without the installer in the context, the build cannot resolve the
    // module the test imports, and the build fails on a TYPE error
    const dockerignore = readFileSync(join(root, ".dockerignore"), "utf8");
    expect(dockerignore).toContain("!installer/");

    // the build inside a container dies at Node's default heap; the same build
    // on a developer's machine succeeds
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("NODE_OPTIONS");
    expect(dockerfile).toContain("--max-old-space-size");

    // and the bridge's URL is a BUILD-time variable, because the extension
    // runs on the host
    expect(dockerfile).toContain("ARG VITE_APP_BRIDGE_URL");
  });

  it("AC-187 a machine with no package manager is still set up", () => {
    const report = buildReport(bareMachine());
    const ids = report.actions.map((action: SetupAction) => action.id);

    // the setup can download the official installers itself, so nothing is
    // "yours to do" on a bare machine
    expect(ids).toContain("node.install");
    expect(ids).toContain("editor.install.vscode");
    expect(ids).toContain("editor.install.vscodium");

    for (const action of report.actions) {
      // the things that do not need Node are done in this run
      if (
        action.id === "node.install" ||
        action.id === "editor.install.vscode" ||
        action.id === "editor.install.vscodium"
      ) {
        expect(action.automatic).toBe(true);
        expect(action.instruction).toBeNull();
      }
    }

    // and the Windows script really can: it downloads and runs the installer
    const script = readFileSync(
      join(findRepoRoot(), "installer", "setup.ps1"),
      "utf8",
    );
    expect(script).toContain("nodejs.org/dist");
    expect(script).toContain("update.code.visualstudio.com");
    expect(script).toContain("msiexec");
    // and it picks the installer for the machine's own architecture
    expect(script).toContain("arm64");

    // and the plan is made AGAIN after Node is installed, so the things that
    // needed Node are done in the SAME run rather than on the next one
    expect(script).toContain("Looking again");
  });

  it("AC-186 the report names every thing the setup checks", () => {
    const report = buildReport(everythingThere());
    const text = report.lines.join("\n");

    // every check the module knows about is in the report, with its own name
    for (const check of CHECKS) {
      expect(report.checks.map((c: SetupCheck) => c.id)).toContain(check.id);
      expect(text).toContain(check.label);
    }

    // a machine with everything has nothing missing and nothing to install
    expect(report.missing).toEqual([]);
    expect(report.present.length).toBe(CHECKS.length);
    expect(report.actions).toEqual([]);
    expect(text).toContain("nothing - everything is already there");
  });

  it("AC-186 a missing thing is reported as missing with what would be installed", () => {
    const report = buildReport(nothingThere());

    // everything is missing, and every one of them is named
    expect(report.missing.length).toBe(CHECKS.length);
    expect(report.checks.every((check: SetupCheck) => !check.present)).toBe(
      true,
    );

    // the report says what would be installed, and what it cannot do itself
    const actions = report.actions.map((action: SetupAction) => action.id);

    expect(actions).toContain("node.install");
    expect(actions).toContain("extension.build");
    expect(actions).toContain("dependencies.install");
    expect(actions).toContain("runtime.python");
    expect(actions).toContain("runtime.java");

    // without winget there is nothing the setup can install on its own, and it
    // says so rather than pretending
    const withoutWinget = buildReport({ ...nothingThere(), winget: false });

    expect(
      withoutWinget.actions.every(
        (action: SetupAction) => action.automatic === false,
      ),
    ).toBe(true);

    for (const action of withoutWinget.actions) {
      expect(action.instruction).toBeTruthy();
    }

    // Node 20 or newer is the rule: 18 is not enough, 20 is
    expect(majorVersion("18.19.0")).toBe(18);
    expect(majorVersion("v20.0.0")).toBe(20);

    const tooOld = buildReport({
      ...everythingThere(),
      nodeVersion: "18.19.0",
    });
    const nodeCheck = tooOld.checks.find(
      (check: SetupCheck) => check.id === "node",
    );

    expect(nodeCheck?.present).toBe(false);
    expect(nodeCheck?.reason).toContain(String(NODE_MINIMUM));
    expect(tooOld.actions.map((action: SetupAction) => action.id)).toContain(
      "node.install",
    );

    const newEnough = buildReport({
      ...everythingThere(),
      nodeVersion: "20.0.0",
    });

    expect(
      newEnough.checks.find((check: SetupCheck) => check.id === "node")
        ?.present,
    ).toBe(true);

    // Yarn on the PATH, or Corepack to provide it
    const corepackOnly = buildReport({
      ...everythingThere(),
      yarnVersion: null,
      corepackVersion: "0.34.6",
    });

    expect(
      corepackOnly.checks.find((check: SetupCheck) => check.id === "yarn")
        ?.present,
    ).toBe(true);
    expect(
      corepackOnly.actions.map((action: SetupAction) => action.id),
    ).toContain("yarn.corepack");

    const noYarnAtAll = buildReport({
      ...everythingThere(),
      yarnVersion: null,
      corepackVersion: null,
    });

    expect(
      noYarnAtAll.checks.find((check: SetupCheck) => check.id === "yarn")
        ?.present,
    ).toBe(false);
  });

  it("AC-186 the setup asks before it installs anything", () => {
    const report = buildReport(nothingThere());
    const plan = planInstalls(report);

    // the default is a question, not an installation
    expect(plan.mode).toBe("ask");
    expect(plan.questions.length).toBe(1);
    expect(plan.questions[0].text).toContain("Install");
    expect(plan.planned.length).toBeGreaterThan(0);

    // and the answer is what decides: Enter takes the default, "n" says no
    expect(answerIsYes(plan.questions[0], "")).toBe(true);
    expect(answerIsYes(plan.questions[0], "y")).toBe(true);
    expect(answerIsYes(plan.questions[0], "n")).toBe(false);
    expect(answerIsYes(plan.questions[0], "no")).toBe(false);

    // -Yes accepts the answers, and then asks nothing
    const auto = planInstalls(report, { assumeYes: true });

    expect(auto.mode).toBe("auto");
    expect(auto.questions).toEqual([]);
    expect(auto.willInstall.length).toBe(auto.planned.length);
  });

  it("AC-186 a dry run installs nothing", () => {
    const report = buildReport(nothingThere());
    const plan = planInstalls(report, { dryRun: true });

    expect(plan.mode).toBe("dry-run");
    expect(plan.willInstall).toEqual([]);
    expect(plan.questions).toEqual([]);

    // it still says what it WOULD do - a dry run reports, it does not hide
    expect(plan.planned.length).toBe(report.actions.length);
    expect(report.lines.join("\n")).toContain("would be installed");
  });

  it("AC-186 the report ends with a summary", () => {
    const report = buildReport(nothingThere());
    const lines = formatReport(report);
    const last = lines[lines.length - 1];

    expect(last.startsWith("Summary:")).toBe(true);
    expect(last).toBe(report.summary.text);
    expect(last).toContain(String(CHECKS.length));

    // and the same is true of a machine that has everything
    const clean = buildReport(everythingThere());
    const cleanLines = formatReport(clean);

    expect(cleanLines[cleanLines.length - 1].startsWith("Summary:")).toBe(true);
    expect(cleanLines[cleanLines.length - 1]).toContain("Nothing to install");
  });

  it("AC-186 the setup needs no dependency of its own", () => {
    const module = read("installer/lib/check.mjs");

    // the checking logic imports nothing at all, and it never runs anything:
    // it cannot install anything, because it cannot run anything
    expect(module).not.toMatch(/^\s*import\s+/m);
    expect(module).not.toMatch(/child_process|execSync|spawnSync|\bspawn\(/);

    // and the scripts bring no package manager of their own
    for (const script of SCRIPTS) {
      const text = read(script.path);

      expect(text).not.toMatch(/pip install|npm install -g|apt-get install/);
    }
  });

  it("AC-186 both scripts check the same things the module checks", () => {
    for (const script of SCRIPTS) {
      const text = read(script.path);

      // every check the module knows about is a check the script makes, and
      // it says it with the same words
      for (const check of CHECKS) {
        expect(text).toContain(check.label);
        expect(text).toContain(check.id);
      }

      // every action the module can plan is an action the script can carry out
      for (const id of ACTION_IDS) {
        expect(text).toContain(id);
      }

      // and nothing can be installed before the dry-run guard: that is what
      // makes -DryRun install nothing at all
      const guard = text.indexOf(script.guard);

      expect(guard).toBeGreaterThan(-1);

      for (const command of script.installs) {
        const at = text.indexOf(command);

        expect(at).toBeGreaterThan(-1);
        expect(at).toBeGreaterThan(guard);
      }
    }
  });

  // The Windows script, run for real. It is the one that has to work on the
  // machines in the classrooms, so it is run here - but only on Windows, and
  // only in its dry-run mode, which installs nothing.
  const describeOnWindows =
    process.platform === "win32" ? describe : describe.skip;

  describeOnWindows("the Windows script", () => {
    it("AC-186 the Windows script's dry run installs nothing", () => {
      const result = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(repoRoot, "installer", "setup.ps1"),
          "-DryRun",
        ],
        { cwd: repoRoot, encoding: "utf8", timeout: 120000 },
      );

      expect(result.status).toBe(0);

      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

      expect(output).toContain("Dry run: nothing was installed.");
      expect(output).toContain("Summary:");

      // the report names every check, and the summary is the last thing said
      for (const check of CHECKS) {
        expect(output).toContain(check.label);
      }
    }, 30_000);
  });
});
