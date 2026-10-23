---
id: wave5t-live-view-survives
paths: packages/vscode-bridge,SPEC.md
read: 
base: main
status: open
---

# Wave 5t — the live view survives a reload, a hidden window and a dead helper

## Why this wave exists

The owner tested the live view on 2026-10-23 and reported (item 1.1–2.4):

> "before reloading the page the view is visible but after reloading the page the editor becomes black and does not show what the connection was showing earlier (just before the refresh), after changing pages the vscode window needs to be selected (refocused) before the connection resumes again (this works for exactly 2 times and 3rd time onwards doesnt seem to work black box on both the presenter and editor, easy fix using the selection tool delete the vscode black box and paste the code and re-connect works again- replicable)"

Their screenshot shows the panel's own message: **"The live window has not started yet."** — so the
panel is not guessing; the **extension** is saying that the capture is not running.

### The cause, in the code

**One.** `packages/vscode-bridge/extension/media/capture.ps:95-118` resolves the editor's
window **once**, when the helper starts, and then loops forever with that one handle:

```powershell
$procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 }
$proc = $procs | Where-Object { $_.MainWindowTitle -like ('*' + $TitleLike + '*') } | Select-Object -First 1
...
$hwnd = [IntPtr]$proc.MainWindowHandle
# ... the frame loop never re-resolves
```

`MainWindowHandle` is **0 for a window that is hidden or minimised**, and the handle **changes**
when VS Code recreates its window (a **Reload Window** does exactly that). Either way the helper
keeps a dead handle and `PrintWindow` returns a **black frame** - or the helper exits with
`NO_WINDOW` and there are no frames at all.

**Two.** `packages/vscode-bridge/extension/src/extension.ts:178-193, 491-493` starts the capture
**once per extension activation** and never restarts it:

```ts
// The live view of the editor's own window (D-82). It is started once, and
// it is stopped when the extension goes away.
startWindowCapture();
```

So one dead helper means **dead for the rest of the session** - which is why the owner's
"delete the black box and paste the code again" works (a new panel, a new capture request) while
the *same* panel stays black, and why it "works exactly twice and then stops".

**Three.** The app side is **already correct**: `excalidraw-app/bridge/bridgeSession.ts:285-298`
clears the stream URL when the connection goes away, because the URL carries the connection's
capability (D-86), and the extension's `bridge:hello` carries the new one. **Do not change this.**

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-112 | the capture **re-resolves the editor's window** whenever it stops producing a picture, and the extension **restarts** a helper that has died | locked | The helper resolves the window once and then loops with that handle, so a window that is hidden, minimised or recreated (a Reload Window) leaves it holding a dead handle: `PrintWindow` returns black, or the helper exits with `NO_WINDOW` and the panel says *"The live view has not started yet"*. That is a **fact about a moment**, and it was being answered with a **permanent** failure. So the helper keeps the *rule* for finding the window (the process, the title) and re-resolves the *handle* whenever a capture comes back empty, and it does **not** exit when there is no window - it waits and says so. The extension restarts a helper that has exited, and re-arms the capture when a client connects, so a reload recovers **by itself** instead of needing a refocus. The rule: **a capture that cannot find its subject must keep looking, and the subject is found by rule, not remembered by handle.** |
| D-113 | the editor's window is found **by rule**, even when it is not the foreground window | locked | `Get-Process`'s `MainWindowHandle` is **0** for a hidden or minimised window, so the lookup that finds the editor while it is in front **loses it** the moment the browser takes the focus - which is the normal state while the teacher is looking at the whiteboard. So the window is found by **enumerating the editor's own top-level windows and matching the title** (the same title rule the project already uses elsewhere), and a window that exists but is not visible is a **different, stated** fact from a window that does not exist. The panel then says *"VS Code's window is not visible - click on it"*, not a black rectangle and not "not started yet". The rule: **"not in front" and "not there" are different facts, and neither of them is "broken".** |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-149 | the helper **re-resolves** the window when the capture comes back empty, and the extension restarts a dead helper | `packages/vscode-bridge/tests/windowCapture.test.ts` | The capture must recover (D-112). Tests: `AC-149 the helper re-resolves the window when a capture comes back empty`, `AC-149 the extension restarts a helper that exited`. |
| AC-150 | the window is found **without being the foreground window**, and "not visible" is its own message | `packages/vscode-bridge/tests/windowCapture.test.ts` | The lookup must not depend on the focus (D-113). Tests: `AC-150 a window that is not the foreground window is still found`, `AC-150 a window that exists but is not visible is reported as not visible, not as missing`. |

---

## The file map (read before writing)

- `packages/vscode-bridge/extension/media/capture.ps1` - the window lookup (lines 95-118) and the
  frame loop. The lookup becomes an **enumeration** (`EnumWindows` over the editor process, or
  the title rule applied to every top-level window of the process) that can be **re-run**, and
  the loop must **re-run it** when a frame comes back empty. The script must not `exit` on
  `NO_WINDOW`; it must keep waiting and report the state.
- `packages/vscode-bridge/extension/src/windowCapture.ts` - `captureArgs`, `createWindowCapture`,
  the reader. The helper's **exit** must be an event the extension acts on (restart), not the end
  of the capture.
- `packages/vscode-bridge/extension/src/extension.ts` - `startWindowCapture` (line 178) and the
  one call at line 493. The extension must restart a helper that exited, and re-arm the capture
  when a client connects.
- `packages/vscode-bridge/extension/src/stream.ts` - the state the panel is told
  (`unavailable`, `ready`, ...): the "the editor's window is not visible" state belongs here.
- `packages/vscode-bridge/tests/windowCapture.test.ts` - where AC-149 and AC-150 go.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency.** The helper is PowerShell, which is on every Windows machine.
- **The capture stays ONE helper for the session** (D-73): a helper per frame would spawn a
  process every frame. Re-resolving the window is not a new helper.
- The **capture's cost** must not change: it is ~12 ms a frame, JPEG q60 @0.75, and only a
  **changed** picture is published (D-87, D-88).
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-149 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: make the helper resolve the window only once and show AC-149 fails; make the
  lookup depend on `MainWindowHandle -ne 0` and show AC-150 fails.
- The scope is `packages/vscode-bridge` and `SPEC.md`. Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof** is the owner's own sequence, and it must be run **for real** on this machine:

1. start the extension (VS Code is on this machine), with the whiteboard open in a browser;
2. confirm the live view shows the editor;
3. **reload the whiteboard page** -> the live view must come back **by itself**;
4. **minimise or hide VS Code**, then reload -> the panel must say the window is not visible (not
   "not started yet"), and it must recover when VS Code is brought back;
5. **Reload Window** in VS Code (Ctrl+Shift+P) -> the live view must recover.

Report what you measured in the close note, including whether step 4's message is the right one.

