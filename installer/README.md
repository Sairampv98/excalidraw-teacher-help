# The setup

One command that **checks what this machine is missing and installs it**.

You do not need to read anything else to use this project. Run the setup, and it will tell you what is there and what is not, ask before it installs anything, and leave you with a summary you can act on.

## Run it

**Windows** (PowerShell 5.1 or newer):

```powershell
powershell -ExecutionPolicy Bypass -File installer\setup.ps1
```

**macOS and Linux** (bash):

```bash
./installer/setup.sh
```

Both scripts do the same checks, in the same order, with the same wording.

### The three ways to run it

| how | what happens |
| --- | --- |
| no flags | it **reports** what it finds, then **asks** before it installs anything |
| `-Yes` (`--yes`) | it accepts the answers: everything that is missing is installed, and nothing is asked |
| `-DryRun` (`--dry-run`) | it **reports only**. Nothing is installed, not even a question is asked |

`-DryRun` is the safe one to try first. It changes nothing at all.

## What it checks

| it checks | what "present" means |
| --- | --- |
| Node.js | on the PATH, and **20 or newer** |
| Yarn | on the PATH, or Corepack is there to provide it |
| VS Code | the `code` command, or the standard install path |
| VSCodium | the `codium` command, or the standard install path |
| the extension | `packages/vscode-bridge/excalidraw-bridge-0.1.0.vsix` is built |
| the app's dependencies | `node_modules` is at the repository root |
| the language runtimes | `node`, `python` and `java` are on the PATH - these are what the panel's **Run** can execute |

**Checking never uses the network.** Only installing does.

## What it installs

- **Yarn**, through Corepack (`corepack enable`), when Yarn is missing.
- **The extension** - the `.vsix` is built if it is not there (`node packages/vscode-bridge/scripts/build-vsix.mjs`) and then installed into whichever editor it found: `code --install-extension` or `codium --install-extension`, with `--force`.
- **The app's dependencies**, with `yarn install --frozen-lockfile`, in the repository root.
- **A language runtime that is missing**, with `winget` on Windows (`winget install --id OpenJS.NodeJS` and friends) or `brew` on macOS and Linux, when that tool is there.

Every one of these is **asked for first**. The report comes first, then the question, then the installing.

## What it needs

**Nothing of its own.** PowerShell on Windows, bash on macOS and Linux, and what is already on the machine. There is no package manager to install first and no runtime to bootstrap the setup with - it runs from a fresh clone.

It is also **safe to run twice**. Every check is idempotent, so a second run says _already there_ instead of doing it again.

## What it will NOT do

- It will **not** install software silently. Without a flag it asks; with `-Yes` it accepts the answers; with `-DryRun` it installs nothing.
- It will **not** install anything on your machine that is already there, and it will not downgrade or uninstall anything.
- It will **not** touch your editor's settings, your files, or your open documents.
- It will **not** change the port the bridge listens on, and it will not start the bridge for you.
- It will **not** install a package manager of its own - no `pip install`, no `npm install -g`. If winget (or brew) is missing, the script says which program is missing and prints the link to get it, and leaves it to you.
- It will **not** work without a network when it has to install something. Checking never needs one; installing always does.

## The report

The report is plain data as well as text: `installer/lib/check.mjs` takes **what was found** and returns the report - what is present, what is missing, what would be installed - and it never installs anything itself. The test (`packages/vscode-bridge/tests/setup.test.ts`) feeds it a made-up machine and asserts on the report, so the rules are checked on every machine, not only on the one that happens to have the tools.

The two scripts implement the same rules natively, because the setup has to run on a machine with no Node at all - and Node is one of the things it installs. The test pins them together: the same checks, the same labels, the same actions, and no install command before the dry-run guard.
