# Wave 5y — a panel must never claim a connection that is not there

## Why this wave exists

The live pass in a real browser (real VS Code, the installed `.vsix`, a real document with a
saved code panel) found a **lie** in the panel, and it is the exact shape of the owner's
complaint from 2026-10-22: *"the panel says Connected and nothing happens"*.

**Measured, in the owner's own saved document, with the app freshly loaded and NO bridge
connected at all** (no token in the tab's session memory, the extension not reachable):

| what the panel showed | the truth |
| --- | --- |
| the console line **"Connected to Visual Studio Code (my-todo-app, bridge 0.1.0)."** | there was **no** bridge: the tab had no token and nothing was connected |
| the status row "The live window has not arrived yet." | correct, but it contradicts the line above it |

The panel said "Connected" and the live window never came - the teacher is left waiting for
something that is not going to happen, and there is no way for them to tell the difference.

### Why the stale line is there (the mechanism, so the fix is aimed correctly)

The connection line is written into the panel's **payload** by the app when the bridge says
`bridge:hello` (D-75). The payload is **saved with the document**, so the line survives a reload.

The reducer already knows the line is a **status, not a log entry** - it is marked
`kind: "connection"`, and a NEW hello replaces the previous one:

```ts
console: keepTail([
  ...state.console.filter((line) => line.kind !== "connection"),
  { level: "info", kind: "connection", text: "Connected to ..." },
]),
```

**But the line is only replaced when a new hello arrives.** When there is **no** bridge - the
teacher closed the editor, the token was not pasted, the extension is not running - no hello
ever arrives, so the **saved** line stays in the payload and the panel keeps claiming a
connection that is not there.

The same is true on **load**: the app's in-memory state starts fresh
(`initialCodePanelState()`), but the app only writes its state into the panels **when the state
changes**. With no token the session never changes state, so the app never writes, and the saved
line survives.

### The rule this wave records

A **status** is the truth **now**. A document that was saved while the bridge was connected must
not make the panel claim a connection that is not there: when the app knows the bridge is **not**
connected, it must say so.

## The rows to add to SPEC.md

Add to the Decisions table, in the established shape `| D-n | <label> | locked | <detail> |`:

| D-133 | a panel never shows a **stale** connection: the connection line is replaced by the **truth** | locked | The connection line is a **status**, and a status is the truth **now** - but the status rides in the panel's payload, and the payload is **saved with the document**. So a document saved while the bridge was connected comes back with a line that says *"Connected to Visual Studio Code (my-todo-app, bridge 0.1.0)."* on a machine where nothing is connected, and the teacher waits for a live window that is never coming. The rule: **the app writes its truth into the panels when it starts and whenever the connection changes** - so a panel that is not connected says **"not connected"**, whatever the document remembers. The saved line is history; the panel's line is the truth. |

Add to the acceptance table, in the shape `| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-172 | a code panel saved while connected shows **not connected** after a reload with no bridge | `excalidraw-app/tests/bridgePanelState.test.tsx` | The panel tells the truth (D-133). Tests: `AC-172 a panel saved with a connection line shows not connected when the app starts with no bridge`, `AC-172 the connection line is replaced, never duplicated`. |

## The files to change

- `excalidraw-app/bridge/codePanel.ts` - the reducer: a way to put the **current** connection
  truth into a panel's state, replacing the saved line.
- `excalidraw-app/bridge/useBridgePanel.ts` - the wiring: publish that truth **when the app
  starts** and **whenever the session's connection state changes** (connected, not connected,
  rejected, closed).
- `excalidraw-app/tests/bridgePanelState.test.tsx` - the AC-172 tests (create the file if there
  is no such test file yet; the app's tests live in `excalidraw-app/tests/`).

`packages/excalidraw` is **not** in this wave's paths: the library already renders whatever the
app puts in the panel's console, and it already renders the session's status in the bridge box.
Do not widen the scope - if you find yourself wanting a library change, write it in the close
note instead and stop.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency.**
- The **token** stays a secret: nothing in this wave may put a token into a panel's payload, a
  URL, a log line or the document.
- The **editor text** that was mirrored into the panel must **survive**: replacing the connection
  truth must not wipe the teacher's mirrored code, the run output, or the draft.
- The live view's own status ("The live window has not arrived yet.") is a **different** status
  and must keep working.
- **Text in `packages/excalidraw/locales/en.json`** only if the library needs a new string (it
  should not - the app already has its own sentences).
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**, load a document whose code panel was
saved while the bridge was connected, with **no** token in the tab's session memory, and show
that the panel says it is **not connected** - not "Connected to Visual Studio Code". Then paste
the token, let the session connect, and show that the panel then says it **is** connected. Report
the two sentences you saw.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-172 tests must **fail** with the stale line still showing. Restore the fix and they must pass
again. Report both failures verbatim.
