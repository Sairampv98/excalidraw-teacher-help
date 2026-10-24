---
id: wave6h-virtual-display-input-panel
paths: packages/vscode-bridge,SPEC.md
read: 
base: main
status: open
---

# Wave 6h — the virtual display and the input panel

## Why this wave exists

The owner's decision, in their words, answering the question that was open:

> *"yes work on the virtual display+input panel"*

The idea, in one line: **the screen the students see and the controls the teacher uses are different
surfaces.** Today, the presenter view takes over the teacher's own desktop, so the teacher cannot keep
their notes, their IDE or their lesson plan in front of them while presenting. A **virtual display**
is a second screen the presenter opens on - not the real desktop - and an **input panel** is a small
window on the teacher's real screen that drives it.

### The rule this wave records

| D-145 | the virtual display and the **input panel** are built | locked | The owner approved this: *"yes work on the virtual display+input panel"*. The idea: a **virtual display** - a screen the teacher can show on a projector without occupying the real desktop - and an **input panel** beside it, so the teacher's controls for the virtual screen are not on the virtual screen. The rule: **the screen the students see and the controls the teacher uses are different surfaces.** |

## The rows to add to SPEC.md

**D-145 is already written** - it is in `SPEC.md` on the main branch. Do not add it again; do not
change it.

Add **one** acceptance row to the section **"### Wave 6h — the virtual display and the input panel"**
in `SPEC.md`, using the reserved id **AC-181**:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

The shape is `| AC-n | <label> | \`<check file>\` | <detail> |` and the detail must name the test
names, which must themselves start with the row id - for example:
`Tests: \`AC-181 the virtual display opens and shows the scene\`, \`AC-181 the input panel's controls
drive the virtual display and not the desktop\`.`

## The scope, concretely

This wave builds **the extension's side** and the **small input surface** the teacher opens on their
real screen. It does not redesign the presenter (that is wave 6d, running beside it).

1. **The virtual display.** The extension looks for a **virtual monitor** on the machine - on
   Windows, an indirect display driver (the kind tools like "Virtual Display Driver" install). When
   one is present, the extension can place a window on it. When there is **none**, the feature says
   so plainly and falls back to the presenter's own window on the normal desktop - **never** a
   silent failure, and never a crash.
2. **The input panel.** A small page the extension **serves on its own HTTP server** (the same server
   that already serves the capture stream), which the teacher opens on their **real** screen. It
   carries the presenter's controls - previous page, next page, zoom, and present/stop - and every
   control **acts on the virtual display**, not on the teacher's own window.
3. **The controls travel over the bridge**, not over a private channel: the panel sends the same
   messages the presenter's own controls send, so there is one way to drive a presentation.

### What must be **measured** (the owner's five things)

The feature is only worth shipping if these are measured, and the measurements go in the close note:

| what | how |
| --- | --- |
| the virtual display's **resolution and position** | enumerate the display devices and report the one the panel opened on |
| whether the **capture helper can find** that window | the capture finds its window **by rule** (D-112, D-113) - so a window on a virtual display must still be found |
| the **input panel's** behaviour | it must be reachable on the real screen and must not steal the teacher's keystrokes from their own editor |
| the **latency** from a control to the virtual screen | measure it and report it |
| the teacher's **own desktop is undisturbed** | state plainly what happens on the real screen |

## The files to change

- `packages/vscode-bridge/extension/src/` - the virtual display's detection and placement, the
  input panel's route, and the bridge messages the panel sends.
- `packages/vscode-bridge/extension/src/virtualDisplay.ts` (new) - the detection and the placement.
- `packages/vscode-bridge/extension/src/inputPanel.ts` (new) - the panel's route and its controls.
- `packages/vscode-bridge/tests/bridge.test.ts` - the AC-181 tests.

`excalidraw-app` is **not** in this wave's paths: the presenter itself is wave 6d's business. If you
find the feature cannot work without an app change, write it in the close note and stop.

## The constraints

- **Spec first**: the acceptance row goes in **before** the code.
- **No new dependency.**
- **No new driver is installed** and no driver is required: the feature works without one, and says
  so.
- The input panel's page is served on **127.0.0.1 only** - never on the network.
- The **token** stays a secret: the input panel's page must not carry a token in a URL, and the
  panel must not become a way to reach the bridge without one.
- The panel must **not** be able to run anything on the teacher's machine that the bridge does not
  already allow.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: on this machine, open the input panel on the real screen and
show that:

1. it opens and its controls work;
2. the presenter's window is on the **other** screen (or, with no virtual display present, the
   feature says so plainly and the presenter's window opens on the desktop);
3. the **latency** from pressing a control to the presenter's screen changing;
4. the teacher's own window keeps its focus and its keystrokes.

Report the five measurements above with the numbers.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-181 tests must FAIL. Restore the fix and they must pass again. Report both failures verbatim.

