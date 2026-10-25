---
id: wave7l-one-file-container-guide
paths: installer,docs,packages/vscode-bridge,Dockerfile,.dockerignore,SPEC.md,.gitignore
base: main
status: merged
---

# Wave 7l — the setup as one file, the container, and the guide

The product is for people who will not read a README. This wave finishes the
job: a **setup.exe** they can double-click, a **container image** they can pull
instead of installing anything, and an **installation guide with pictures**.

It also fixes two defects the container build found - defects the gate could
not see, because the gate's `tsc` excludes every directory named `tests`, so
`packages/vscode-bridge/tests/` was never type-checked at all.

## The defects the container build found

1. **`packages/vscode-bridge/tests/setup.test.ts` had five type errors** - implicit
   `any` on a callback parameter, from `noImplicitAny`. The gate passed them
   because the repository's `tsconfig.json` excludes `tests`, so that file was
   never type-checked. The app's build checks it, and the container build
   failed on it. The fix names the shapes the callbacks use, so the file is
   correct under BOTH configurations.
2. **The container's build context did not contain `installer/`** - `.dockerignore`
   whitelists the directories the app needs, and the installer was not on the
   list, so the test's import of `installer/lib/check.mjs` could not resolve
   inside the build. `!installer/` is now whitelisted.
3. **The build inside the container ran out of memory** - "Reached heap limit -
   JavaScript heap out of memory", at Node's default heap of about 2 GB, while
   the same build on a developer's machine succeeds. `NODE_OPTIONS`
   (`--max-old-space-size=4096`) is now set in the build stage.

## The rule to record

Add **one** decision row to `SPEC.md`, in a new section
**"### Wave 7l — the setup as one file, the container, and the guide"**:

- `D-153` - the project ships the setup **as one file**, and a **container**
  that needs nothing installed.

The detail must say, in substance: the setup is also an **executable** so it can
be double-clicked, it is compiled by the compiler **that ships with Windows** so
the project gains no dependency, and the **container** serves the app with
nothing installed on the machine - while the extension stays on the host,
because it lives inside the editor.

## The acceptance row

Add **one** acceptance row in the same section, using the reserved id
**AC-187**:

| id | what it proves | where the test goes |
| --- | --- | --- |
| **AC-187** | the setup **is** one executable, it carries the installer with it, it is built by **the compiler that ships with Windows** (no new dependency), and the container's **build context contains the installer** and **has the heap the build needs** | `packages/vscode-bridge/tests/setup.test.ts` |

The test name must **start with the row id** - `AC-187 …` - or
`node scripts/rowcheck.mjs --all` fails.

The test must read the **files** - the launcher's source, the build script, the
`.dockerignore` and the `Dockerfile` - and assert on them. It must NOT build
anything: the build is proved by the real thing, and a test that compiles a C#
executable on every run is a test that breaks on a machine without the
compiler.

## The files

- `installer/launcher/SetupLauncher.cs` - the launcher. C# 5, because it is
  compiled by the compiler that ships with Windows, so it may use no newer
  syntax. It finds the repository, runs `installer/setup.ps1` inside it, passes
  every argument through, and waits for it.
- `installer/build-setup-exe.mjs` - builds `setup.exe` with
  `C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe`, **AnyCPU** so it
  runs on ARM64 Windows too, with the installer scripts **embedded** as
  resources.
- `packages/vscode-bridge/tests/setup.test.ts` - the type fix, and the AC-187
  test.
- `.dockerignore` - `!installer/`.
- `Dockerfile` - the heap for the build.
- `docs/INSTALL.md` - **the installation guide, with pictures.** Windows,
  macOS and Linux; the setup; the container; the extension; the token; and
  what a machine on **ARM64** must change.

## The pictures

They are photographs of the real thing, not drawings:

- the setup running on a clean machine (from the Windows Sandbox);
- the app served by the container;
- the properties panel, with the actions.

Put them in `docs/images/` and refer to them from the guide.

## The constraints

- **Spec first**: the rows go into `SPEC.md` **before** the code.
- **No new dependency.** The setup is compiled by a compiler that is already on
  every Windows machine.
- **LF line endings, no BOM, `yarn` only.**
- The launcher's C# must stay **C# 5**: no string interpolation, no
  expression-bodied members, no `nameof`.
- The setup must still **ask before it installs anything**, and `-DryRun` must
  still install nothing.

## The gates

`node scripts/tins-gate.mjs` must pass **4/4** and
`node scripts/rowcheck.mjs --all` must exit **0**.

Never run `yarn test:app` bare - it is `vitest` in WATCH mode and never exits.
Use `npx vitest run <file> --watch=false`.

**One gate at a time.** The gate takes a machine-wide lock and waits for a
quiet machine; two concurrent gates deadlock and both fail after 30 minutes.
Pipe the gate's output through `Tee-Object` to a log and poll the log.

## The real proof

1. `node installer/build-setup-exe.mjs` produces `setup.exe`; run it with
   `-DryRun` and show the report.
2. `yarn build:app:docker` completes **without a type error** - that is the
   build the container runs.
3. `docker build` produces the image, and `docker run` serves the app.

Report what you saw, plainly. If a step could not be run on this machine, say
so and say why.

## The teeth check

Revert the fix and the AC-187 test must FAIL; restore the fix and it must pass
again. Report both failures verbatim.

Do NOT close the kit session and do NOT merge - the parent owns both.
