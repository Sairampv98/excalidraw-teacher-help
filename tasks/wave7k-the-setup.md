---
id: wave7k-the-setup
paths: installer,docker,Dockerfile,docker-compose.yml,packages/vscode-bridge,SPEC.md,dev-docs
base: main
status: open
---

# Wave 7k — the setup: check what is missing, and install it

The product is for **students and teachers who will not read a README**. The
project's promise is that a person with a laptop, VS Code or VSCodium, and a
class to teach can be **running** in a few minutes — so the project must ship a
**setup that checks what is missing and installs it**.

Right now it does not. A student has to know that they need Node, that Yarn
comes from corepack, that the extension has to be installed from a `.vsix`,
and that the app's dependencies have to be installed. That is the gap this wave
closes.

## The rule to record

Add **one** decision row to `SPEC.md`, in a new section
**"### Wave 7k — the setup checks, and installs what is missing"**:

- `D-152` - the project ships a **setup** that checks for everything it needs
  and **installs what is missing**.

The detail must say, in substance: the person who runs it is a **teacher or a
student**, not a developer, so the setup **reports what it finds**, **asks
before it installs anything on the machine**, and ends with a **summary** the
reader can act on. It never installs software silently, and it never needs a
dependency of its own.

## The acceptance row

Add **one** acceptance row in the same section, using the reserved id
**AC-186**:

| id | what it proves | where the test goes |
| --- | --- | --- |
| **AC-186** | the setup **reports** every thing it checks, **asks** before installing, installs **nothing** in `-DryRun`, and the report ends with a summary - and it needs **no dependency of its own** | `packages/vscode-bridge/tests/setup.test.ts` |

The test name must **start with the row id** - `AC-186 …` - or
`node scripts/rowcheck.mjs --all` fails.

**The test must not depend on a Windows machine.** The checks and the report
are the thing being tested, so **put the checking logic in a place the test can
call**: a small module that takes the **versions it found** and returns the
**report** - what is present, what is missing, what would be installed - and
the script itself only does the asking and the installing. Then the test can
feed it a made-up machine and assert on the report.

## What the setup checks

| it checks | what "present" means |
| --- | --- |
| **Node.js** | on the PATH and **20 or newer** (the repository's `engines` says `>=18`; the toolchain wants 20) |
| **Yarn** | on the PATH, or Corepack available to provide it (`corepack enable`) |
| **VS Code** | the `code` CLI, or the standard install path |
| **VSCodium** | the `codium` CLI, or the standard install path |
| **the extension** | `packages/vscode-bridge/excalidraw-bridge-0.1.0.vsix` - and it is **built** if it is not there (`node packages/vscode-bridge/scripts/build-vsix.mjs`) |
| **the app's dependencies** | `node_modules` present at the repository root |
| **the language runtimes** | `node`, `python` and `java` on the PATH - these are what the panel's **Run** can execute |

## What it installs, and what it asks first

- **Corepack** for Yarn, if Yarn is missing and Corepack is there.
- **The `.vsix`** into whichever editor(s) were found - `code --install-extension`
  or `codium --install-extension`, `--force`.
- **The app's dependencies**, with `yarn install --frozen-lockfile`, in the
  repository root.
- **A language runtime** that is missing, using **winget** on Windows
  (`winget install --id OpenJS.NodeJS` etc.) if winget is present. **Ask first.**

**The rules that matter:**

- **Never install software silently.** The script **reports** first, then asks.
  `-Yes` accepts the defaults and does not prompt; `-DryRun` reports and
  installs **nothing** at all.
- **No dependency of its own.** PowerShell and bash only - no Python, no
  Node script, no package manager of its own. It runs from a fresh clone.
- **It must be safe to run twice.** Everything it checks is idempotent, and a
  second run says *"already there"* rather than doing it again.
- **It must not need the network** to check - only to install.

## The files

- `installer/setup.ps1` - **Windows**, PowerShell 5.1 compatible (this machine
  runs 5.1, and so do most classrooms).
- `installer/setup.sh` - **macOS and Linux**, bash.
- `installer/README.md` - what it does, how to run it, what it installs, what it
  needs, and what it will NOT do.
- `installer/lib/check.mjs` (or an equivalent) - the checking logic the test
  calls. It takes what it found and returns the report; it **never** installs.
- `packages/vscode-bridge/tests/setup.test.ts` - the AC-186 test.

## The Docker half

The owner also wants a **container** a student can run instead of installing
anything. The repository already has upstream Excalidraw's `Dockerfile` (nginx
serving the built app) and `docker-compose.yml`.

Make that **real for this project**:

- The app's build takes the bridge's URL from **`VITE_APP_BRIDGE_URL`** (a
  build-time variable - see `excalidraw-app/vite-env.d.ts`), so the
  `Dockerfile` needs an **`ARG`** for it and the compose file passes it.
- The **extension still runs on the host** - it lives inside the editor - so
  the container reaches the host's bridge over **`host.docker.internal`**
  (Docker Desktop's name for the host). The compose file's bridge URL must be
  `ws://host.docker.internal:47511`.
- Add `docker/README.md` - what the container does, what stays on the host, and
  how to point it at the bridge.

## The constraints

- **Spec first**: the rows go into `SPEC.md` **before** the code.
- **No new dependency.** The setup itself needs none.
- **LF line endings, no BOM, `yarn` only.**
- **Do not touch the `panel` locale group** - another wave may be editing it.
- The setup must **not** touch the owner's own machine when it is merely
  being tested. Use `-DryRun` for the test, and if you must run it for real,
  run it with `-Yes` on this machine where everything is already installed -
  and **do not** uninstall or change anything that is already there.

## The gates

`node scripts/tins-gate.mjs` must pass **4/4** and
`node scripts/rowcheck.mjs --all` must exit **0**.

Never run `yarn test:app` bare - it is `vitest` in WATCH mode and never exits.
Use `npx vitest run <file> --watch=false`.

**One gate at a time.** The gate takes a machine-wide lock and waits for a
quiet machine; two concurrent gates deadlock and both fail after 30 minutes.
Pipe the gate's output through `Tee-Object` to a log and poll the log.

## The real proof

1. Run `powershell -ExecutionPolicy Bypass -File installer\setup.ps1 -DryRun` and
   show the report it prints on **this** machine.
2. Run it **for real** (`-Yes`) and show that it changes nothing that is
   already right, and says so.
3. Run it a **second** time and show it is idempotent.
4. Show `bash -n installer/setup.sh` is clean (a syntax check; do not execute
   the bash one on Windows).
5. Show the Docker compose file is valid: `docker compose -f
   docker/docker-compose.yml config` (if Docker is on this machine; if it is
   not, say so plainly and validate the YAML another way).

Report what you saw. If a step could not be run, say so plainly.

## The teeth check

Revert the fix and the AC-186 test must FAIL; restore the fix and it must pass
again. Report both failures verbatim.

Do NOT close the kit session and do NOT merge - the parent owns both.
