---
id: wave5w-runnable-editor
paths: packages/excalidraw,excalidraw-app,packages/vscode-bridge,SPEC.md
read: 
base: main
status: open
---

# Wave 5w — the code panel becomes a real editor you can run

## Why this wave exists

The owner, reviewing the app on 2026-10-23 (item 3.2c):

> "clicking the live window turns on editor which is a black box - i assumed it would be like
> leetcode's editor instead where i can run the code after writing it out, this was the bypass i was
> talking about this being there even if i dont connect to a live window"

and, when asked whether the runnable editor should be **the same panel** or a new panel kind, the
owner answered: **"same panel"**.

Today the code panel's **Editor** view is a **mirror**: a CodeMirror that shows the text the
extension publishes and cannot be typed into. With no bridge there is nothing to mirror, so the
view is a **black box** - which is exactly what the owner saw. The owner wants the panel to be
usable on its own: **write code in the panel, run it, see the output** - the LeetCode shape.

## What already exists (so this wave does not invent it)

- The **grammar registry** (wave 5h): the panel already knows JavaScript, Java, Python, C, C++ and
  Rust, and the language is part of the panel's payload.
- The **bridge's run message**: `excalidraw-app/bridge/bridgeSession.ts` already exposes
  `startRun(command, args, cwd)` - the app can ask the extension to run a program in the
  workspace.
- The **panel's output region**: `code-panel-output` is already there and is already fed by the
  console stream.

So the missing parts are: an **editable** editor, a **Run** control, and the extension's side of
"run this snippet and give me the output".

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-123 | the code panel's editor view is a **real editor**: the teacher's own text is a **draft** on the panel, and the mirrored text is only what a draft starts from | locked | The editor view is a **mirror**, so it can only ever show what another program wrote, and with no bridge there is nothing to show - a black box. The owner wants the panel to be usable by itself: write code in it, run it, read the output. So the panel's payload gains a **draft**: the teacher's own text for that panel. The mirror becomes the draft's **starting point** - when the teacher opens the editor on a panel that has never been edited, the mirrored text is there to edit; once they type, the draft is theirs and the mirror no longer overwrites it. The editor is **editable** in both cases, and the panel says which it is showing. The rule: **a panel that shows text must let the teacher change it, and the teacher's own text must never be overwritten by a mirror.** |
| D-124 | **Run** executes the draft in the workspace, with a timeout and a bounded output, and a missing runtime is an **explicit** state | locked | Running needs something to run the code, and the thing that can is the extension: it already runs programs in the teacher's workspace (`bridge:run`). So the panel's Run control sends the **draft** and the **language** to the extension, which writes it to a temporary file and runs it with that language's runtime **in the workspace**, and returns the output. The run has a **timeout** and a **bounded output** - a program that never ends, or one that prints a million lines, must not wedge the panel - and both facts are reported ("timed out after 10 s", "output truncated at 20,000 characters"). The runtimes are the ones **actually present on the machine**: the extension detects them (node, python, and the others the registry knows) and offers only those, and a language whose runtime is missing says so with what to install (D-91). The rule: **the panel never claims a run happened that did not, and a run that cannot happen says why.** |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-161 | the editor view is **editable**, and the teacher's text is not overwritten by the mirror | `packages/excalidraw/tests/codePanel.test.tsx` | The draft is the teacher's (D-123). Tests: `AC-161 the teacher can type in the editor view`, `AC-161 a mirror update does not overwrite a panel the teacher has edited`. |
| AC-162 | **Run** sends the draft to the bridge and shows the output in the panel | `excalidraw-app/tests/codePanel.test.tsx` | The run path (D-124). Tests: `AC-162 the run control sends the draft and the language to the bridge`, `AC-162 the output arrives in the panel's output region`. |
| AC-163 | a run that times out, or that prints too much, is **reported**, and a missing runtime is an **explicit** state | `packages/vscode-bridge/tests/bridge.test.ts` | No run lies (D-124). Tests: `AC-163 a run that exceeds the timeout is reported as timed out`, `AC-163 a language whose runtime is missing says so instead of running`. |
| AC-164 | the editor is usable **with no bridge at all** | `packages/excalidraw/tests/codePanel.test.tsx` | The owner's bypass (D-123). Tests: `AC-164 the editor view works with no bridge and says that running needs one`. |

---

## The file map (read before writing)

- `packages/excalidraw/components/PanelOverlay.tsx` - the code panel's surfaces: the editor view
  (the CodeMirror), the header, and where a **Run** control belongs.
- `packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx` - the editor component; it must
  be able to be **read-only** (today's behaviour) **or editable**, and it must report the text
  back.
- `packages/excalidraw/scene/panelContent.ts` - the code panel's payload: the **draft** goes here
  (and therefore in the document, and therefore survives a reload).
- `excalidraw-app/bridge/useBridgePanel.ts` - the app's side: the Run control's action, and the
  output coming back.
- `excalidraw-app/bridge/bridgeSession.ts` - `startRun(command, args, cwd)` and the message it
  sends; a **new** message for "run this snippet" belongs beside it, in the shared protocol.
- `packages/vscode-bridge/bridge/src/protocol.ts` - the one definition of the protocol.
- `packages/vscode-bridge/extension/src/` - the extension's side: writing the temp file, running
  it with the right runtime, the timeout, the bounded output, and detecting the runtimes.
- The **grammar registry** (wave 5h) - the languages the panel knows.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency** in the library or the app. The extension may use Node's **built-in**
  `child_process` - it already spawns the capture helper.
- The **library** must not know how to run code: it draws the Run control and shows the output;
  the **app** sends the request; the **extension** runs it. The library's own functions stay the
  oracle for everything geometry and state.
- The **temp file** the extension writes must be in the teacher's workspace and must be cleaned
  up, and the file's name must say what it is.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-161 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: at minimum, make the editor read-only again and show AC-161 fails; remove the timeout
  and show AC-163 fails.
- The scope is `packages/excalidraw`, `excalidraw-app`, `packages/vscode-bridge` and `SPEC.md`.
  Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof**: in the real app, type a one-line program into the panel's editor, press Run,
and see its output in the panel - with the extension running, and with **no** extension, where the
editor must still be usable and must say that running needs the bridge. Report both.

