# Builder brief — Wave 4a, the paste path and the markdown viewer's text

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

Two of the fork owner's nine observations from their 2026-10-21 test session.

- **Observation 5** — "Whenever I am pasting the copied code from the markdown files from a sidebar onto the Canvas by using the mouse right-click and paste option it is not in the current format that was approved (black box with code highlighted as it would have been in a code editor) and it is reverting back to the old format which was multiple text boxes."
- **Observations 1 and 2** — "In Markdown files, after selecting non-code text, the highlighted blue text cannot be copied using Ctrl+C — so whenever such text is selected, it would be great if it automatically copies to the clipboard." and "In markdown files, if there are hyperlinks they don't turn into selectable text to copy."

The full design, with the reasoning and the evidence, is `docs/superpowers/specs/2026-10-21-paste-and-markdown-design.md`. **Read it first** — it carries the cause of each bug and the rejected alternatives.

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-17 | The armed code paste is decided **inside the library's paste path** (`props.onPaste`), not in a DOM listener — so the keyboard paste and the context menu's paste behave identically, and the context menu's paste keeps the code-card format. |
| D-18 | The armed paste is consumed **only** when the clipboard still holds the stashed code. If the user copied something else in the meantime, the paste is an ordinary paste. |
| D-19 | Selecting text in the markdown viewer **copies it to the clipboard automatically**. The copy happens on the mouse-up / key-up that ends the selection, because a clipboard write needs a user activation and `selectionchange` carries none. |
| D-20 | Only a selection that lies **wholly inside** the markdown body is copied. A selection that reaches out of the viewer is left to the browser. |

Add these four rows to `SPEC.md` in the Decisions table (after `D-16`), and the three acceptance rows below to the Wave 4 acceptance table.

## Part A — the right-click paste must keep the code-card format

### The cause (read the design doc, but the short version)

- The app's armed paste lives in `excalidraw-app/sidebar/insertIntoScene.ts` → `armCodePasteOnCanvas`, which registers a **`window` capture-phase `paste` listener**.
- The library's paste handler is a **`document` bubble-phase** listener (`packages/excalidraw/components/App.tsx` → `addEventListener(document, EVENT.PASTE, this.pasteFromClipboard, { passive: false })`).
- Ctrl+V fires a DOM `paste` event, so the window capture listener wins and the code card is inserted. **The right-click → Paste in the Excalidraw context menu fires no DOM event at all** — it is `actionPaste` (`packages/excalidraw/actions/actionClipboard.tsx`), which calls `app.pasteFromClipboard(createPasteEvent({ types }))` directly. The app's listener never runs, so the code arrives as plain text boxes.

### The fix

The library already has the hook that covers **both** paths, because `pasteFromClipboard` is the one funnel:

```ts
// packages/excalidraw/components/App.tsx, inside pasteFromClipboard
if (this.props.onPaste) {
  try {
    if ((await this.props.onPaste(data, event)) === false) {
      return;
    }
  } catch (error: any) {
    console.error(error);
  }
}
```

`props.onPaste` already exists in `packages/excalidraw/types.ts`:

```ts
onPaste?: (
  data: ClipboardData,
  event: ClipboardEvent | null,
) => Promise<boolean> | boolean;
```

So:

1. the app passes `onPaste` to `<Excalidraw>` in `excalidraw-app/App.tsx` (it does not today);
2. in it, the app checks whether a code paste is armed **and** whether the clipboard still holds that code;
3. if so, it inserts the code card and returns `false` — the library must not insert the plain text;
4. the `window` capture listener in `armCodePasteOnCanvas` is **removed**: `onPaste` now covers the keyboard paste too, so there is one path and one behaviour.

**Two wrinkles the design doc spells out — do not miss them:**

- The library calls `event?.preventDefault()` _after_ the `onPaste` hook, so an `onPaste` that returns `false` leaves the browser's default paste in place. The app's handler must call `event?.preventDefault()` itself.
- `actionPaste` builds a _synthetic_ clipboard event whose `clientX`/`clientY` are 0. The app already tracks the pointer itself (the `pointermove` listener in `armCodePasteOnCanvas`); keep that, and use it for the placement in both paths.

`ClipboardData` has `text?: string` — that is where the pasted text is.

## Part B — the markdown viewer copies the text you select

The markdown viewer is `excalidraw-app/sidebar/DocumentsTab.tsx` (the body is rendered with `dangerouslySetInnerHTML` at about line 473) and the document body is styled by `excalidraw-app/sidebar/sidebar.scss` (`.app-doc-markdown`).

Add a listener on the markdown body that copies the selection when the selection ends:

- the trigger is the **mouse-up / key-up** that ends the selection — not `selectionchange`, which carries no user activation, so `navigator.clipboard.writeText` would be rejected with `NotAllowedError`;
- the selection is read with `window.getSelection()`;
- it is copied only when it is **non-empty** and its common ancestor lies **inside** the markdown body (D-20);
- a link's text is ordinary text inside the body, so it is covered by the same code — that is observation 2.

A failed write must not throw: catch it, and say so with the app's own toast (`api?.setToast({ message: "Clipboard was blocked", closable: true })` — the pattern is already in `DocumentsTab.tsx`).

## The files you own

Everything below is inside the task scope `packages/excalidraw,excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `excalidraw-app/sidebar/insertIntoScene.ts` | changed | the armed paste is exposed to the app's `onPaste` instead of a DOM listener |
| `excalidraw-app/App.tsx` | changed | pass `onPaste` to `<Excalidraw>` |
| `excalidraw-app/sidebar/DocumentsTab.tsx` | changed | the selection → clipboard behaviour |
| `packages/excalidraw/types.ts` | changed | only if the `onPaste` prop's type has to change (it should not) |
| `packages/excalidraw/tests/` or `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-17, D-18, D-19, D-20 and the acceptance rows |

The app's tests live in `excalidraw-app/tests/`; the library's in `packages/excalidraw/tests/`. Put a test where the thing under test lives.

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-23 | `excalidraw-app/tests/` | A right-click paste of armed code produces a **code card**, not plain text boxes — the same as the keyboard paste. |
| AC-24 | `excalidraw-app/tests/` | A paste whose clipboard no longer holds the armed code is an **ordinary** paste. |
| AC-25 | `excalidraw-app/tests/` | Selecting prose in the markdown viewer puts it on the clipboard; the same holds for the text of a link. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-23 a right-click paste keeps the code-card format', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

Read the existing tests in `excalidraw-app/tests/` before writing yours and follow their style. The clipboard is jsdom's — check how the existing app tests fake `navigator.clipboard`.

## The house rules

- `yarn`, never `npm` or `bun`. No new dependency.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has.
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your three new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the armed paste is ignored, (b) the clipboard check is dropped, (c) the selection is never copied. Record what you broke and what failed — the orchestrator needs that in the close note.
