---
id: wave5z-ocr-engine-truth
paths: excalidraw-app,SPEC.md
read: 
base: main
status: open
---

# Wave 5z — the OCR sentence must name the engine the panel will actually use

## Why this wave exists

The live pass in a real browser found a small but real **lie** in the panel's OCR row.

**Measured, in the owner's own app, against the real installed extension** (the panel row under
"Read the text"):

```
[ Read the text ]  ( indra )          <- the picker: the teacher's choice for THIS panel
Read the text with the bridge. (engine: paddle)   <- the sentence: the extension's default
```

The teacher sees **indra** selected and **paddle** named underneath. Only one of them is true.

### Which one is true

The **picker's**. The panel sends the engine the teacher chose with every OCR request
(`engine: engineFor(panelId)` in `excalidraw-app/App.tsx`, D-118), so **indra** is the engine that
will run. The sentence comes from `ocrEngineMessage()` in `excalidraw-app/bridge/useOcr.ts`:

```ts
return `${OCR_IDLE_MESSAGE} (engine: ${state.engine ?? "unknown"})`;
```

and `state.engine` is the engine the **extension** reported in its `ocr:state` message - which is
the extension's own setting (`excalidraw-bridge.ocrEngine`, shipped as `paddle`). The extension's
setting is only the **fallback** for a machine with no picker at all; the panel's picker wins.

So the sentence names the fallback while the picker names the choice. The teacher reads the
sentence and believes paddle will run; indra runs (147 ms instead of 27,822 ms on this box - a
180x difference).

### The rule this wave records

A panel's sentence names **what will happen**, not what is configured elsewhere. If the teacher
picked an engine for this panel, the panel says **that** engine.

## The rows to add to SPEC.md

Add to the Decisions table, in the established shape `| D-n | <label> | locked | <detail> |`:

| D-134 | the panel's OCR sentence names the engine the panel will **use**, not the extension's default | locked | The panel's engine picker (D-118) is the teacher's choice **for this panel**, and the panel sends that engine with every OCR request - so the engine that **runs** is the one the teacher picked. But the sentence under the row was built from the engine the **extension** reported in `ocr:state`, which is the extension's own setting (`excalidraw-bridge.ocrEngine`) - and that setting is only the **fallback** for a machine with no picker at all. So the panel could show `indra` in the picker and name `paddle` in the sentence, and the teacher would believe the slow engine runs (27,822 ms against 147 ms on this box). The rule: **the panel says what will happen** - the sentence names the engine the panel will use, which is the teacher's choice when there is one. |

Add to the acceptance table, in the shape `| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-173 | the panel's OCR sentence names the engine the **picker** chose | `excalidraw-app/tests/ocrBridge.test.tsx` | The panel says what will happen (D-134). Tests: `AC-173 the OCR sentence names the engine the panel picked, not the extension's default`. |

## The files to change

- `excalidraw-app/bridge/useOcr.ts` - `ocrEngineMessage` must be able to name the **picked** engine.
- `excalidraw-app/bridge/useBridgePanel.ts` - the panel's chosen engine (it already has one: the
  `engineFor(panelId)` map, D-118) must reach the sentence.
- `excalidraw-app/tests/ocrBridge.test.tsx` - the AC-173 test.

`packages/excalidraw` is **not** in this wave's paths: the library renders the sentence it is given.
If you think a library change is needed, write it in the close note instead and stop.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency.**
- The **extension's** setting stays the fallback for a machine with no picker - do not change the
  extension's behaviour, and do not change what the extension ships.
- The sentence must still name the engine that **ran** after a read (D-90) - do not break that.
- **Text in `packages/excalidraw/locales/en.json`** only if the library needs a new string (it
  should not).
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**, with the extension connected and its
own setting left at its default, the panel's OCR row must show the picked engine in **both** the
picker and the sentence - `indra` in the picker and `indra` in the sentence - and the sentence must
change when the teacher picks the other engine. Report what you saw.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-173 test must **fail** with the sentence still naming the extension's default. Restore the fix
and it must pass again. Report both failure messages verbatim.

