# Design — the paste path and the markdown viewer's text

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`.

## What this is

Two of the fork owner's nine observations from their 2026-10-21 test session, plus the mechanism that will carry the rest of the paste work.

| # | The owner wrote | The fix |
| --- | --- | --- |
| 5 | "Whenever I am pasting the copied code from the markdown files from a sidebar onto the Canvas by using the mouse right-click and paste option it is not in the current format that was approved (black box with code highlighted as it would have been in a code editor) and it is reverting back to the old format which was multiple text boxes." | Part A |
| 1 | "In Markdown files, after selecting non-code text, the highlighted blue text cannot be copied using Ctrl+C — so whenever such text is selected, it would be great if it automatically copies to the clipboard." | Part B |
| 2 | "In markdown files, if there are hyperlinks they don't turn into selectable text to copy." | Part B |

## Part A — the right-click paste must keep the code-card format

### The cause

The fork's "copy this code, then paste it as a highlighted code card" feature works by **arming** the next paste:

- `excalidraw-app/sidebar/insertIntoScene.ts` → `armCodePasteOnCanvas(api, code, { language, fileName })` stashes the code and registers a **`window` capture-phase `paste` listener**;
- the library's own paste handler is a **`document` bubble-phase** listener (`packages/excalidraw/components/App.tsx` → `addEventListener(document, EVENT.PASTE, this.pasteFromClipboard, { passive: false })`).

For **Ctrl+V**, the DOM `paste` event fires, the window capture listener runs first, calls `stopPropagation()`, and the code card is inserted. The library never sees the event. That is why the keyboard paste works.

For the **right-click → Paste** in the _Excalidraw_ context menu, there is **no DOM paste event at all**: the menu item is `actionPaste` (`packages/excalidraw/actions/actionClipboard.tsx`), which reads the clipboard and calls

```ts
app.pasteFromClipboard(createPasteEvent({ types }));
```

directly. The library's paste function runs, the app's window listener never fires, and the code arrives as plain text boxes. The format the owner approved is lost.

The browser's own context menu (right-click outside the canvas) _does_ fire a DOM paste event, so it works — which is why the bug looks intermittent.

### The fix

Move the armed-paste decision **into the paste path itself**, so that every way of pasting goes through it. The library already has the hook for exactly this:

```ts
// packages/excalidraw/components/App.tsx, inside pasteFromClipboard
if (this.props.onPaste) {
  if ((await this.props.onPaste(data, event)) === false) {
    return;
  }
}
```

`pasteFromClipboard` is the **one** funnel both the DOM paste and `actionPaste` go through, so an `onPaste` prop sees both. Returning `false` stops the library from inserting the plain text.

The app therefore:

1. passes `onPaste` to `<Excalidraw>` (it does not today);
2. in it, checks whether a code paste is armed **and** whether the clipboard really holds that code — the user may have copied something else since;
3. if so, inserts the code card and returns `false`;
4. the `window` capture listener is **removed**, because `onPaste` now covers the keyboard paste too. One path, one behaviour.

The pointer position is tracked the same way as today (a `pointermove` listener on `window`), so the card lands under the cursor in both cases.

**One wrinkle.** The library calls `event?.preventDefault()` _after_ the `onPaste` hook, so an `onPaste` that returns `false` leaves the browser's default paste in place. The app's handler must call `event?.preventDefault()` itself.

**Another wrinkle.** `actionPaste` builds a _synthetic_ clipboard event. Its `clientX`/`clientY` are 0 — which is exactly why the app tracks the pointer itself rather than reading it off the event.

### The locked decision

| Row | The decision in one line |
| --- | --- |
| D-17 | The armed code paste is decided **inside the library's paste path** (`props.onPaste`), not in a DOM listener — so the keyboard paste and the context menu's paste behave identically, and the context menu's paste keeps the code-card format. |
| D-18 | The armed paste is consumed **only** when the clipboard still holds the stashed code. If the user copied something else in the meantime, the paste is an ordinary paste. |

## Part B — the markdown viewer copies the text you select

### The cause

The markdown viewer renders the document with `dangerouslySetInnerHTML` (`excalidraw-app/sidebar/DocumentsTab.tsx`). The prose opts back into selection (`user-select: text` in `excalidraw-app/sidebar/sidebar.scss`), and the library's own copy handler already stands down when there is a DOM text selection (`App.tsx` → `hasDomTextSelection()`). So the text _is_ selected — but the owner still has to press Ctrl+C and fight the browser's copy machinery, and a link's text does not come along.

The owner asked for something simpler and more reliable: **selecting the text copies it**.

### The fix

A `mouseup` / `keyup` listener on the markdown body: when the selection is non-empty and lies inside the body, write it to the clipboard.

`mouseup` and `keyup` — not `selectionchange` — because a clipboard write needs **transient user activation**. A `selectionchange` event carries none, and `navigator.clipboard.writeText` would reject it with `NotAllowedError`. A mouse-up or a key-up _is_ an activation, so the write is allowed.

The selection is read with `window.getSelection()`, and its common ancestor is checked against the markdown body, so a selection that reaches outside the viewer is ignored.

A link's text is ordinary text inside the body, so it is covered by the same code — that is observation 2.

### The locked decision

| Row | The decision in one line |
| --- | --- |
| D-19 | Selecting text in the markdown viewer **copies it to the clipboard automatically**. The copy happens on the mouse-up / key-up that ends the selection, because a clipboard write needs a user activation and `selectionchange` carries none. |
| D-20 | Only a selection that lies **wholly inside** the markdown body is copied. A selection that reaches out of the viewer is left to the browser. |

## The files

| File | New / changed | What |
| --- | --- | --- |
| `excalidraw-app/sidebar/insertIntoScene.ts` | changed | the armed paste is exposed to the app's `onPaste` instead of a DOM listener |
| `excalidraw-app/App.tsx` | changed | pass `onPaste` to `<Excalidraw>` |
| `excalidraw-app/sidebar/DocumentsTab.tsx` | changed | the selection → clipboard behaviour |
| `excalidraw-app/sidebar/sidebar.scss` | changed | if a style change is needed for the selection to be visible |
| `packages/excalidraw/types.ts` | changed | only if the `onPaste` prop's type has to change (it should not) |
| `SPEC.md` | changed | D-17, D-18, D-19, D-20 and the acceptance rows |

## The acceptance rows

| Row | What it checks | File |
| --- | --- | --- |
| AC-23 | A right-click paste of armed code produces a **code card**, not plain text boxes — the same as the keyboard paste. | `excalidraw-app/tests/` |
| AC-24 | A paste whose clipboard no longer holds the armed code is an **ordinary** paste. | `excalidraw-app/tests/` |
| AC-25 | Selecting prose in the markdown viewer puts it on the clipboard; the same holds for the text of a link. | `excalidraw-app/tests/` |

## Rejected alternatives

- **Keep the DOM listener and add a second one for the context menu.** Rejected: two paths that can disagree. The library already exposes the hook that covers both.
- **Make the library aware of code cards.** Rejected: the code card is the fork's feature and lives in the app; the library should not know about it.
- **Copy on `selectionchange`.** Rejected: a clipboard write without a user activation is rejected by the browser.
- **Copy on a timer after the selection settles.** Rejected: the same activation problem, plus a race.
