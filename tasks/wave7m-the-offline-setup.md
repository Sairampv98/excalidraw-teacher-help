---
id: wave7m-the-offline-setup
paths: installer,docs,packages/vscode-bridge,SPEC.md,.gitignore
base: main
status: merged
---

# Wave 7m — the offline setup: one file, no internet, nothing to install

The online setup (wave 7l) needs the internet to download what it installs. A
classroom machine may not have one: a locked-down lab, a school network, a
laptop on a train. So the project must ship a **setup that carries everything
it needs with it** and installs it **offline**.

## What the product actually needs, and what it does not

This is the inventory that decides the payload. It was taken from the code, not
guessed.

**Needed to USE the product:**

| | why | where it comes from offline |
| --- | --- | --- |
| **VS Code or VSCodium** (`^1.91.0`) | the extension runs INSIDE the editor; the editor provides its own Node | the official installer, in the payload |
| **the extension** | the bridge itself | the `.vsix`, built by us |
| **the app** | the whiteboard | the **prebuilt static bundle** - it is nginx-served HTML and assets, so it needs NO server runtime |
| **a browser** | the app runs in one | already on the machine |

**NOT needed to use the product** - this is the important finding:

- **The app's npm dependencies are NOT needed at runtime.** The app is a static
  bundle. Only *developing* the app needs `yarn install`. So the payload does
  **not** have to carry the npm registry's tarballs, and the offline setup
  does not have to run `yarn install` at all.
- **Python is NOT needed.** The default OCR engine, **tesseract**, is
  **WebAssembly inside the extension** - it runs in the extension's own
  process. Python is only for `indra` and `paddle`.

**Optional, and only if the teacher wants them:**

| | why it is optional |
| --- | --- |
| **Node.js** | only for the panel's **Run** button (running the teacher's own code) |
| **Python** | only for the `indra` / `paddle` OCR engines |
| **Java** | only for the Run button on `.java` files |
| **the virtual display driver** | only for putting a window on a second screen |

## What to build

### 1. The payload builder - `installer/offline/build-payload.mjs`

It downloads **everything the offline setup needs** into
`installer/offline/payload/`, and it must be **re-runnable**: it skips a file
that is already there, so the payload is never downloaded twice.

The payload is:

| file | where it comes from |
| --- | --- |
| `node-<ver>-win-x64.msi` and `node-<ver>-win-arm64.msi` | `https://nodejs.org/dist/index.json` - the **latest LTS**, then `https://nodejs.org/dist/<ver>/node-<ver>-win-<arch>.msi`. The MSI's name is `node-<ver>-<arch>.msi` - **no `win-`** |
| `vscode-<arch>-setup.exe` | `https://update.code.visualstudio.com/latest/win32-<arch>-user/stable` |
| `vscodium-<arch>-setup.exe` | `https://github.com/VSCodium/vscodium/releases/latest/download/VSCodium-win32-<arch>-user.exe` |
| `python-<ver>-amd64.exe` | `https://www.python.org/ftp/python/<ver>/python-<ver>-amd64.exe` |
| `vdd.zip` | `https://github.com/itsmikethetech/Virtual-Display-Driver/releases/latest/download/VDD.Control.<tag>.zip` - the API is `https://api.github.com/repos/itsmikethetech/Virtual-Display-Driver/releases/latest`, and its assets include a **driver-only** package for **ARM64** and one for **x86**. Prefer the small driver-only zips for the machine's architecture, and keep the Control package too - it is what a teacher uses to **Extend** the display |
| `excalidraw-bridge-0.1.0.vsix` | built by `packages/vscode-bridge/scripts/build-vsix.mjs` |
| the **app** | the built `excalidraw-app/build` folder, zipped |

`<arch>` is `x64` or `arm64` - the builder must take it, so the payload can be
built for either.

The builder writes a `manifest.json` next to the payload: the files, their
**SHA-256**, and the version of each. The installer checks the hashes before it
installs anything.

### 2. The offline setup - `installer/offline/OfflineSetup.cs`

A C# 5 program (the compiler that ships with Windows understands C# 5 - no
string interpolation, no expression-bodied members, no `nameof`), built by
`installer/offline/build-offline-setup.mjs` the same way `setup.exe` is built.

It does **three** things, and the third is the point:

1. **It carries the payload with it.** The payload is a **zip**, embedded as a
   resource. On the first run it is extracted to
   `%LOCALAPPDATA%\ExcalidrawClassroom\payload`. The hashes in
   `manifest.json` are checked, and a payload that does not match is refused.

2. **It installs, offline, what is missing** - after **asking**, one thing at a
   time, with `-Yes` to accept and `-DryRun` to report and install nothing:
   - **Node.js** - `msiexec /i <msi> /qn /norestart`
   - **VS Code** and/or **VSCodium** - the installer is Inno Setup:
     `/VERYSILENT /NORESTART /SP-`
   - **Python** - `/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1`
   - **Java** - a Temurin **zip**, unpacked, with its `bin` added to the
     machine's PATH
   - **the virtual display driver** - the driver package's own installer. It
     needs **administrator rights**, and it needs a **reboot** to take effect -
     so the program must say so plainly, and must not claim the display works
     before the reboot
   - **the extension** - `code --install-extension` / `codium --install-extension`

   The program must **elevate itself** for the parts that need it (the driver,
   the machine-wide PATH), by relaunching with the runas verb.

3. **It runs the app with NOTHING installed.** This is what makes it
   *portable*: a **built-in HTTP server** (a `HttpListener` is enough) serves
   the prebuilt app from the payload, and the browser is opened on it. No
   Node, no Python, no editor - just the whiteboard.

   The program must also print the **bridge URL** the app must be built with,
   because the app is built with `VITE_APP_BRIDGE_URL` baked in. If the payload
   was built for a different URL, say so - do not pretend.

### 3. The guide

`docs/OFFLINE.md` - how to use the offline setup, what it carries, what it
installs, the reboot the driver needs, and the ARM64 notes. With a picture.

## The rule and the acceptance row

Add **one** decision row to `SPEC.md`, in a new section
**"### Wave 7m — the offline setup: one file, no internet, nothing to install"**:

- `D-154` - the project ships a setup that **needs no internet** and needs
  **nothing installed** to run the app.

And **one** acceptance row, id **AC-188**:

| id | what it proves | where the test goes |
| --- | --- | --- |
| **AC-188** | the offline setup **carries its payload**, **checks the payload's hashes**, **installs nothing in `-DryRun`**, **runs the app with nothing installed**, and the payload builder **needs no internet at the time it runs** - only at the time it is BUILT | `packages/vscode-bridge/tests/offline.test.ts` |

The test name must **start with the row id** - `AC-188 …` - or
`node scripts/rowcheck.mjs --all` fails.

The test must read the **files** - the C# source, the payload builder, the
manifest - and assert on them. It must **not** download anything: the test
proves the SHAPE of the offline setup, and the shape is proved by the real run
below.

## The real proof - the Sandbox with NO networking

This is the test that matters, and it is possible because Windows Sandbox can
have **no network at all**.

Write `installer/offline/offline.wsb`:

```xml
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>None</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>C:\Users\user\projects\offline-test</HostFolder>
      <SandboxFolder>C:\Sandbox</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -ExecutionPolicy Bypass -File C:\Sandbox\run.ps1</Command>
  </LogonCommand>
</Configuration>
```

and `run.ps1` runs the offline setup with **no network** and writes what
happened into the mapped folder.

The proof is:

1. The setup runs in a Sandbox with **no network** and still finds its payload.
2. It **serves the app** - and a request for the app's HTML comes back **200**.
3. It installs what it can, from the payload, and says so.

**Report honestly what could not be done.** The virtual display driver cannot
really be proved in a Sandbox - it needs a reboot and a real display. Say that.

## The constraints

- **Spec first**: the rows go into `SPEC.md` **before** the code.
- **No new dependency.** The offline setup is compiled by the compiler that
  ships with Windows, exactly like `setup.exe`.
- The C# must be **C# 5**.
- **LF line endings, no BOM, `yarn` only.**
- The payload is **build output**: it must be **gitignored**, and the payload
  builder must be committed, not the payload.
- The offline setup must **never** reach the internet. If a file is missing
  from the payload, it says so - it does not download it.

## The gates

`node scripts/tins-gate.mjs` must pass **4/4** and
`node scripts/rowcheck.mjs --all` must exit **0**.

Never run `yarn test:app` bare - it is `vitest` in WATCH mode and never exits.
Use `npx vitest run <file> --watch=false`.

**One gate at a time.** The gate takes a machine-wide lock and waits for a
quiet machine; two concurrent gates deadlock and both fail after 30 minutes.
Pipe the gate's output through `Tee-Object` to a log and poll the log.

## The teeth check

Revert the fix and the AC-188 test must FAIL; restore the fix and it must pass
again. Report both failures verbatim.

Do NOT close the kit session and do NOT merge - the parent owns both.
