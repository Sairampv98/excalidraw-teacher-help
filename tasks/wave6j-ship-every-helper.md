---
id: wave6j-ship-every-helper
paths: packages/excalidraw,excalidraw-app,packages/vscode-bridge,SPEC.md
base: main
status: merged
---

# Wave 6j — five defects the live clips found

The feature clips for the public repository were recorded by **driving the real
app with a real editor behind it**. Doing that surfaced five defects that the
tests did not. Two of them mean a shipped install does not work at all.

## The defects, with the evidence

### 1. The `.vsix` does not ship `media/virtual-display.ps1`

`packages/vscode-bridge/scripts/build-vsix.mjs` copies **`capture.ps1`** and
**`ocr_sidecar.py`** into the stage, and its `entries` list - the list that
becomes the `.vsix` - contains only those two. The virtual-display helper is
never added.

So every install of the extension has a **dead virtual display**: the extension
resolves the helper inside its own installed folder, the folder has no such
file, and the panel reports *"no virtual display was found on this machine …
and no display was found at all"* on a machine whose Virtual Display Driver is
attached as `DISPLAY7`.

**The proof** - read the `.vsix`'s own entry list (not a byte search: the
helper's NAME appears inside `extension.js`, so a byte search gives a false
positive):

```
extension/media/capture.ps1      16.2 KB
extension/media/ocr_sidecar.py   16.0 KB
extension/media/virtual-display.ps1: *** MISSING ***
```

### 2. The snapshot endpoint sends no `Access-Control-Allow-Origin`

`packages/vscode-bridge/extension/src/stream.ts` serves the snapshot
(`/s/<capability>/snapshot`) with `res.writeHead(200, headers)` and no CORS
header at all.

The app and the extension are **always on different origins** - the page is
`http://localhost:3001` and the extension's server is `http://127.0.0.1:47511`
- so a stock browser refuses the app's `fetch()` of the editor's picture.

The **live view** is not affected: it is an `<img src=…>`, and an image is
fetched in "no-cors" mode. Only the **snapshot** - and therefore **"take a
screenshot of the editor's window"** and **"crop and read"** from the editor -
is broken, and it fails with *"Failed to fetch"*.

**The proof**: the clip for the crop-and-read had to be recorded with
Chromium's `--disable-web-security` flag, which is how the defect was found.

### 3. The mirror picker's choice buttons cannot be clicked

They are drawn at the foot of the picture at **z-index 8**, and the app's bottom
page bar covers them at **z-index 70**. The picker works from the keyboard and
cannot be worked with the mouse.

### 4. The YouTube caption note is invisible as shipped

It is painted **under** the composited iframe, and its background
(`var(--color-surface)`) is **not defined in the theme**, so it has no
background either.

### 5. The input panel's status line never shows anything

In the panel page, `var status = document.getElementById("status")` collides
with **`window.status`**, which is a string. `status.textContent = …` is then
silently dropped onto the string. Confirmed: `window.status` holds
`"[object HTMLParagraphElement]"`.

## The rule to record

Add **one** decision row to `SPEC.md`, in a new section
**"### Wave 6j — what the live clips found"**:

- `D-151` - the extension ships **every helper it runs**, and the bridge
  answers the app's **own** origin.

The detail must say, in substance: a helper that is not in the `.vsix` is a
feature that is dead in every install, and the extension's HTTP server answers
the **same loopback origins** the websocket answers, so the picture the app is
entitled to fetch is not refused by the browser.

## The acceptance rows to add

Add **acceptance** rows in the same section, using ids **AC-184** and
**AC-185**:

| id | what it proves | where the test goes |
| --- | --- | --- |
| **AC-184** | the built `.vsix` **contains** `media/virtual-display.ps1` - and the test reads the `.vsix`'s **entry list**, not the bytes | `packages/vscode-bridge/tests/vsix.test.ts` |
| **AC-185** | the snapshot's response carries an `Access-Control-Allow-Origin` for a **loopback** origin, and **refuses** (or omits it for) a foreign origin | `packages/vscode-bridge/tests/stream.test.ts` |

Every test name must **start with the row id** - `AC-184 …`, `AC-185 …` - or
`node scripts/rowcheck.mjs --all` fails.

For **AC-184**, look at how `packages/vscode-bridge/tests/vsix.test.ts` already
reads the built `.vsix` (it has its own CRC-checking zip reader) and reuse
that: the test must read the **entry names**, because a byte search for the
file's name gives a false positive.

For **AC-185**, use the origin rule that already exists:
`isAllowedOrigin(origin, extra)` in
`packages/vscode-bridge/extension/src/bridge.ts`. The **same** rule must decide
the CORS header: a loopback origin gets its own origin echoed back (so the
browser allows the read), a foreign origin does not. Keep the capability as
the authorisation (D-86) - a foreign page must still not be able to read a
picture it has no capability for.

## The files to change

- `packages/vscode-bridge/scripts/build-vsix.mjs` - copy `virtual-display.ps1`
  into the stage **and** add it to the `entries` list. That is the whole fix
  for defect 1.
- `packages/vscode-bridge/extension/src/stream.ts` - the snapshot's CORS
  header (defect 2). The MJPEG stream's headers may carry it too, but the
  snapshot is the one that **must** have it.
- `packages/excalidraw/components/PanelMirrorPicker.tsx` (or wherever the
  picker's choice buttons are drawn) - the picker's z-index (defect 3).
- The panel's caption note - its z-index and its background (defect 4).
- `packages/vscode-bridge/extension/media/` - the input panel's page: the
  `status` variable's name (defect 5).
- `packages/vscode-bridge/tests/vsix.test.ts` - the AC-184 test.
- `packages/vscode-bridge/tests/stream.test.ts` - the AC-185 test.
- `packages/excalidraw/locales/en.json` - any new label goes in a **new
  group**; do not add keys to the `panel` group.

## The constraints

- **Spec first**: the rows go into `SPEC.md` **before** the code.
- **No new dependency.**
- **LF line endings, no BOM, `yarn` only.**
- **Do not touch `packages/vscode-bridge/extension/media/virtual-display.ps1`
  itself** - it is correct; it is only **missing from the package**.
- The fix must not weaken the bridge: the token is still negotiated in band,
  the capability is still the authorisation, and the server still binds the
  loopback interface only.

## The gates

`node scripts/tins-gate.mjs` must pass **4/4** and
`node scripts/rowcheck.mjs --all` must exit **0**.

Never run `yarn test:app` bare - it is `vitest` in WATCH mode and never exits.
Use `npx vitest run <file> --watch=false`.

**One gate at a time.** The gate takes a machine-wide lock and waits for a
quiet machine; two concurrent gates deadlock and both fail after 30 minutes.
Pipe the gate's output through `Tee-Object` to a log and poll the log.

## The real proof

The proof is the **built package** and a **stock browser**:

1. Build the `.vsix` (`node packages/vscode-bridge/scripts/build-vsix.mjs`) and
   show the **entry list** now contains `extension/media/virtual-display.ps1`.
2. Install it into a **throwaway** extensions folder and show the helper is
   really there. Do not disturb the owner's editors.
3. In a **stock** browser (NO `--disable-web-security`), with the extension
   connected, take a screenshot of the **editor's window** and show the picture
   arriving - the crop-and-read must work without any browser flag.

Report what you saw. If step 3 still fails in a stock browser, say so plainly
with the browser's own error.

## The teeth check

Revert the fix and the AC-184 and AC-185 tests must FAIL. Restore the fix and
they must pass again. Report both failures verbatim.

Do NOT close the kit session and do NOT merge - the parent owns both.
