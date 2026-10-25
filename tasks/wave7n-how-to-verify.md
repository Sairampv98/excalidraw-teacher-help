---
id: wave7n-how-to-verify
paths: installer,docs,packages/vscode-bridge,SPEC.md
base: main
status: merged
---

# Wave 7n — how to confirm it works, and that it is the expected behaviour

The offline setup (wave 7m) is proved to install and to serve the app on a
machine with no internet. But a teacher who installs it on **another** machine
needs two things this project has not given them yet:

1. a way to **confirm the install is sound** - one command that says, item by
   item, what is right and what is not;
2. a way to **confirm the behaviour is the expected behaviour** - what each
   feature should look like, so a deviation is obvious and reportable.

Both are for a **reader**, not for a developer, and they go in the **public**
repository - so they must be plain language, with no trace of how the project
is built.

## 1. `installer/verify-install.ps1` - the machine check

A single script the teacher runs after the install. It **checks**, it does not
change anything.

```powershell
powershell -ExecutionPolicy Bypass -File installer\verify-install.ps1
```

It prints a table, one row per check:

| check | expected | actual | verdict |

The verdict is one of **PASS**, **FAIL** or **MISSING** - and the three mean
different things, which the script must make clear:

- **PASS** - it is there and it is right.
- **MISSING** - it is not installed. Often fine: the app itself needs nothing.
- **FAIL** - it is there but it is **wrong**. That is the one that needs
  attention: a wrong version, a wrong port, a hash that does not match, an
  editor without the extension in it.

**The checks, and where the expected value comes from - take it from the code,
never from memory:**

| check | expected |
| --- | --- |
| the operating system | Windows 10 or 11 (say so plainly) |
| Node.js, if installed | **20 or newer** - the project's own floor, from the repository's `engines` |
| Yarn, if installed | present |
| VS Code, if installed | present, and **1.91.0 or newer** - the extension's own `engines.vscode` |
| VSCodium, if installed | present, and 1.91.0 or newer |
| the extension, in whichever editor is installed | `excalidraw-teacher-help.excalidraw-bridge` listed by that editor's `--list-extensions` |
| the extension's helpers | `media/capture.ps1`, `media/virtual-display.ps1` and `media/ocr_sidecar.py` present in the installed extension folder |
| the virtual display driver | present - `Get-PnpDevice` / the `ROOT\DISPLAY` device the driver creates - and **"a reboot is needed"** if it is there but not yet attached |
| the bridge | listening on **47511** - but only **while an editor is running**. If no editor is open, that is **MISSING**, not FAIL, and the script must say why |
| the app | **HTTP 200** from wherever the teacher serves it - the script takes the address as an argument, and if it is not given, it reports the app as **not checked** rather than failing |
| the offline payload's hashes | every file in `manifest.json` matches - the script re-verifies them |

**Rules for the script:**

- It **never installs, changes or removes anything**. It only reads and
  requests.
- It **never crashes** because something is missing. Every check is guarded, and
  a missing thing is a row in the table, not an exception.
- It ends with a **paste-able report**: a fenced block the teacher can send
  back as it is, containing the machine's facts, the table, and the verdict
  counts. That block is how a deviation gets reported.
- It exits **0** when nothing is FAIL, and **1** when something is FAIL - so
  it can be used in a script.

## 2. `docs/VERIFY.md` - the feature checklist

The human half. For **each** feature: what to do, **what you should see**, and
**what a deviation looks like**.

The features are the ones the project has. Read them off the code and the
clips - `clips/` has one recording per feature, and each is the **reference**
for what correct looks like:

| | |
| --- | --- |
| the code panel and the video panel | the panel on the canvas, floating, selectable, with its own chrome |
| the panel's properties | Panel / Kind / State / Live, and the **Actions**: the camera, **Read the text** with its engine picker, and the Bridge box |
| crop and read | one action; the panel says it is reading; then it names **the engine it used and why it did not use the one above it**; the text lands on the canvas, per line |
| the crop really crops | the placed picture is visibly smaller and shows only the cropped region |
| the placement flows | crop, then the choice, then the page (through the page ribbon), then the target; the popup hands the canvas back; the text flow asks where the **text** goes |
| the presenter view | a second window, full screen, showing the same canvas |
| the live editor | the text can be selected, copied as a **code card** onto the canvas, the **language** changed, and the editor **zooms inside** the panel while the canvas zoom stays put |
| what is mirrored | the whole editor window by default; **change what is mirrored** opens it; a region is cropped; the panel then shows only that region; the region is changed again; **follow the cursor** is turned on and the region follows the pointer, and turned off |
| run | the panel's **Run** executes the draft in the workspace and shows the output; the runtime picker offers only the runtimes really on this machine |
| the pages | the **frame** toggles, the **page number** appears, a **size preset** changes the page's shape, and the export honours it |
| the virtual display | the report says whether the display is attached, moving the teacher's own window is **opt-in**, a moved window can be **brought back**, and every placement reports the **measured** rectangle |
| YouTube | the video plays in YouTube's own player, and the captions come from one of **three tiers** - and the panel says which |
| the live view | the editor's window is mirrored live and the picture moves as the editor moves |
| the file sidebar | the list is grouped by type, a video row drags onto the canvas, and a file that cannot be used is listed **with the reason** |
| the code card | the markdown viewer's *Copy code* and the live editor's copy produce the **same** card |
| OCR engines | *tesseract* needs no Python at all; *indra* and *paddle* do. The engine picker shows what is available |

**The shape of every entry** - the same four parts, so the page is easy to
follow:

> **What to do** - the clicks, in order.
> **You should see** - the exact words or the exact picture.
> **If it is not that** - what a deviation looks like, and what to check.
> **See it** - the clip that shows it working.

## 3. `docs/REPORT.md` - how to report a deviation

A short page the teacher reads when something is not right. It must say:

- **What you did** - the steps.
- **What you expected** - and **what you actually saw**, quoted exactly.
- **Which feature** - the section of the checklist.
- **The check report** - the fenced block from `verify-install.ps1`.
- **The machine** - Windows version, and whether the editor was running.

And a line about the **token**: the token is a secret - **never** include it in
a report, and the report must not ask for it.

## The constraints

- **Plain language only.** These three files go in the **public** repository,
  which has the development method stripped out of it. They must not mention
  internal row ids, the specification, the gate, the kit, the sessions, or
  anything about how the project is built. Write them for a **teacher**.
- The check script must be **tested on this machine**, where Node, Yarn, VS
  Code, VSCodium, the extension and the driver are all installed - and its
  **real output** is what goes into `docs/VERIFY.md`. Do not invent a table.
- The script must also survive a machine where things are missing: check every
  check against a **missing** case and report MISSING, not an error.
- **Spec first**: add the decision row and the acceptance row to `SPEC.md`
  **before** the code.
- **No new dependency.** PowerShell only - the same rule as the other
  installers.
- **LF line endings, no BOM, `yarn` only.**

## The acceptance row

Add **one** acceptance row, id **AC-189**:

| id | what it proves | where the test goes |
| --- | --- | --- |
| **AC-189** | the check script **checks without changing anything**, tells **PASS**, **FAIL** and **MISSING** apart, **never crashes** when a thing is missing, and ends with a **paste-able report**; and the checklist names the **expected** behaviour of every feature with the **clip** that shows it | `packages/vscode-bridge/tests/verify.test.ts` |

The test name must **start with the row id** - `AC-189 …` - or
`node scripts/rowcheck.mjs --all` fails. The test reads the **files** - the
script and the checklist - and asserts on them; it does not run the script.

## The real proof

1. Run `installer\verify-install.ps1` on **this** machine and paste its **real
   output** into `docs/VERIFY.md`.
2. Run it on a machine with something missing, or make a thing missing
   temporarily, and show it reporting **MISSING** rather than failing.
3. Show the exit code: **0** when nothing is FAIL.
4. Check the checklist against the code - every feature the project has is in
   it, with its clip.

## The gates

`node scripts/tins-gate.mjs` must pass **4/4** and
`node scripts/rowcheck.mjs --all` must exit **0**.

Never run `yarn test:app` bare - it is `vitest` in WATCH mode and never exits.
Use `npx vitest run <file> --watch=false`.

**One gate at a time.** The gate takes a machine-wide lock and waits for a
quiet machine; two concurrent gates deadlock and both fail after 30 minutes.
Pipe the gate's output through `Tee-Object` to a log and poll the log.

## The teeth check

Revert the fix and the AC-189 test must FAIL; restore the fix and it must pass
again. Report both failures verbatim.

Do NOT close the kit session and do NOT merge - the parent owns both.
