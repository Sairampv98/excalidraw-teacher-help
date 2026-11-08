# How this was built: the models, the harness and where the orchestration lives

This file says **who and what made the things in this repository**, and **where the programs are that make them**, so that nothing important lives only on one person's disk.

## The models and the harness

| what | which |
| --- | --- |
| the work of the sessions from **2026-11-07** (the UI gate, the first-launch tour, the clips and their recorder, the engines the app carries, the Features list, the click-through installers, the Windows 7 plan) | the model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), used through **Claude Code**, the command-line harness of Anthropic, on Windows 11 |
| how a task is run | the **tins-kit** (`.tins/kit`): one task is one branch and one working folder with a declared scope, a session is opened with `kit start --task` and closed with `kit close`, which runs the gate (type check, lint, formatting, tests) and writes the record in `sessions/`; `kit merge` runs the gate again on the merged tree |
| the tools the model was given in the harness | a shell (Git Bash and PowerShell), file read, edit and write, search, web search and fetch, and the browser-driving and agent tools of the harness; no tool reached a machine other than this computer and its virtual machines |

**The record starts on 2026-11-07 and is not written back.** The sessions of earlier days say `model_claimed: unknown`, and they are left as they are.

The kit records the model only when it is told: `kit start --task <id> --model <model>/effort-<n>`, for example `claude-sonnet-5-5/effort-5`: the model, then the reasoning effort that the harness showed when the session began (the effort can change between messages; the value at the start is the one written). It is **self-reported** (`model_source: self-reported`, `model_verified: false`): the kit cannot check it. Every session from 2026-11-07 on is started this way. The kit does not record the **harness** or the **build environment**; this file and `docs/build-env.json` do (see `docs/BUILD-ENVIRONMENT.md`), and a request is open in `docs/next.md` (the kit improvement) to make the kit write them all by itself.

## Where the orchestration lives

Everything that makes a setup, a clip, a proof or a release is a program in this repository. Nothing that matters is only on a disk outside it.

| it makes or does | where | how it is run |
| --- | --- | --- | --- |
| **the UI gate**: the built app driven in the real browser, scenario by scenario, with a card for each discrepancy | `scripts/ui/` | `node scripts/ui/build.mjs`, then `node scripts/ui/run.mjs [--only id]`; `node scripts/ui/replay.mjs <id>` shows a scenario slowly |
| **the clips** of the app (filmed from the real app, with ffmpeg) | `scripts/clips/` | `node scripts/clips/run.mjs [--only id] [--gif]` |
| **the engines** the app carries (PDF, picture reading, Python) | `scripts/vendor/` | `node scripts/vendor/engines.mjs` |
| **the click-through installer** and the student setup | `installer/gui/` | `node installer/gui/build-gui-installer.mjs [--edition student]`; proofs: `installer/gui/tests/e2e-install.ps1`, `e2e-student.ps1`; the program checks itself with `ClassroomSetup.exe /selftest` |
| **the payload** of the offline setups (the app, the tools, the Indra reader) | `installer/offline/build-payload.mjs` | `node installer/offline/build-payload.mjs --out <folder>` |
| **the Windows 7 pack** (the launcher that needs no installation, and the machine that tests it) | `installer/win7/` | `portable/start.bat`; the virtual machine is driven by `vm/vm-type.ps1`, `vm/vm-click.ps1` and `vm/vm-shot.ps1` (the keyboard, the mouse and a picture of the screen of a Hyper-V machine, through WMI), and made from the owner's own Windows 7 disc by `vm/Autounattend.xml` |
| **a release** of the public repository (a draft, the files, a proof that they come back the same, then published) | `scripts/release/publish-release.mjs` | `node scripts/release/publish-release.mjs --tag v2.1.1 --notes <file> --dir <folder> [--check]` |
| **the public mirror** and the leak guard | `scripts/public-sync/` | `node scripts/public-sync.mjs`, and a hook on every merge |
| **the build environment**: what the building computer had, and how to make it again | `scripts/env/` and `docs/BUILD-ENVIRONMENT.md` | `node scripts/env/build-env.mjs [--write | --check]` |
| **the MCP server** and its skills | `packages/mcp-server/` | `yarn build:mcp` |

## The tests with teeth

A test that cannot fail is not a test. The rule in this repository (the owner's, from the start) is that a test is shown to fail when the thing it guards is broken. Where this was done in these sessions:

- the **self test** of the installer found a real flaw (an archive with one entry that climbs out of its folder was treated as a top folder, and was not refused) on its first run;
- the **UI gate** found, before anyone reported them: the fonts and the analytics script fetched from the internet on every launch, a first click on the help icon that was lost when the side panel closed, and the PDF reader, the reader of pictures and Python all failing with no internet;
- the **end-to-end proofs** put a whole install in place, run each tool, and check that the uninstall leaves the PATH, the variables, the uninstall list and the folder as they were.

## What is not here, and why

- **Large build output** (the payloads, the setups, the engines, the recorded raw frames) is not in git: it is made by the programs above. The engines' files and their hashes are listed in `scripts/vendor/engines.manifest.json`.
- **The owner's Windows 7 disc** and the virtual machine disks are not in git (they are the owner's, and large). The answer file that makes the machine from the disc is.
- **The course material** for the classes (the data-structure lessons and their code) lives with the owner outside this repository until the owner says where it belongs.
