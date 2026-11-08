# The build environment, and how to make it again on another computer

Everything this project builds (the app, the clips, the installers, the proofs, a release) is built on a Windows computer with the tools below. `docs/build-env.json` is the **record of what the building computer had** (written by `node scripts/env/build-env.mjs --write`, and refreshed at each release); `node scripts/env/build-env.mjs --check` compares another computer with it and says what is missing or of another major version.

## What a new computer needs

| it needs | why | notes |
| --- | --- | --- |
| **Windows 10 or 11, 64-bit** | the installers are Windows programs; the proofs run real installs | Windows 11 is what the record was made on. Hyper-V (Windows Pro) is needed only to test in virtual machines |
| **Node.js** (the major version in the record) | the app, the builders, the gate, the proofs | install it from nodejs.org; the gate uses the Node that is first on the PATH |
| **Yarn 1** | installs the packages, runs the app and its tests | `corepack enable`, or `npm install -g yarn` |
| **Git for Windows** (with Git Bash) | the repository, the public mirror, and the login that the release script borrows | the project's checks need `git` on the PATH |
| **A browser: Chrome or Edge** | the UI gate and the clips drive the real browser (Playwright-core is told where it is; nothing is downloaded) | `UI_BROWSER` names another browser |
| **ffmpeg** | the clips and the GIF | on the PATH (for example `choco install ffmpeg`), or `FFMPEG` names the file |
| **Python 3** | `pip download` makes the wheels of the Indra reader | any recent 3; the wheels are for Python 3.12 whichever one runs pip |
| **The .NET Framework 4 compiler** (`csc.exe`) | compiles the installers | it ships with Windows, in `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\`; nothing to install |
| **PowerShell 5.1** | the proofs and the control of the virtual machines | ships with Windows |
| **Disk space**: about 20 GB free, more for virtual machines | a payload is about 1 GB, a setup 1 GB, and every build keeps raw frames | `node_modules/.cache` holds the work and can be deleted |

## From nothing, in order

1. Install the tools above; open a new terminal so that the PATH is read.
2. Clone the repository and the public repository beside it (the release script expects `excalidraw-public` beside the private one, or `--clone`).
3. `yarn` in the repository root.
4. `node scripts/env/build-env.mjs --check`: it must say that this computer matches, or name what differs.
5. `node scripts/vendor/engines.mjs` fetches the engines the app carries (about 33 MB, checked by hash); the build of the app does it on its own.
6. Build and look: `node scripts/ui/build.mjs`, then `node scripts/ui/run.mjs` (the real browser, every scenario).
7. Make a setup: `node installer/offline/build-payload.mjs --out <folder> --app <the built app> --skip vscodium`, then `node installer/gui/build-gui-installer.mjs --payload <folder> --out <folder>`. Prove it: `powershell -File installer/gui/tests/e2e-install.ps1 -Setup <the setup>`.
8. Make the clips: `node scripts/clips/run.mjs`.
9. Publish: `node scripts/release/publish-release.mjs --tag <tag> --notes <file> --dir <folder> --check` first.

## The virtual machines

The tests on Windows 7, 10 and 11 run in Hyper-V (`installer/win7/vm/`). A Windows 7 machine is made from your own Windows 7 disc by `installer/win7/vm/Autounattend.xml`; the disc and the disks are not in the repository. Windows 10 and 11 machines are the Hyper-V "development environment" images.

## What this record does not hold

Passwords and tokens are never written down: the release script reads the GitHub login from Git's own store.
