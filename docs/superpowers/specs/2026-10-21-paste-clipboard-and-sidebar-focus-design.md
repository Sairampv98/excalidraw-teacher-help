# The paste that stopped producing a code card, and the sidebar that eats the canvas

**Date:** 2026-10-21
**Status:** design locked, implementation pending (wave 7)
**Origin:** the owner's 2026-10-21 test session, reproduced live in the dev server

## What the owner reported

Three things, in their own words:

1. "i tried the copy code button from markdown where it failed to paste it like this
   from the earlier version" — the **Copy code** button in the sidebar's markdown viewer
   used to paste a code card (a dark rounded card with monospace, syntax-coloured text).
   Now it pastes the code as a row of separate bordered text boxes.
2. "also ctrl+v is still not fixed" — the keyboard paste has the same problem.
3. "the focus of the cursor in the side bar should be lost once i click back on the canvas
   so that it cant scroll if iam clicking, paning or scrolling over in the canvas" — the
   sidebar keeps the interaction, and the canvas does not scroll under it.

The owner also confirmed what still works: "the markdown text outside the copy code blocks
gets copied upon selecting good" — the selection auto-copy of prose is fine.

## The reproduction

Done live in the dev server (`http://localhost:47311/`), not inferred:

1. Open a markdown file with a fenced code block in the sidebar.
2. Click **Copy code**.
3. Click the canvas.
4. Press Ctrl+V.

The canvas receives the code as **three separate bordered text elements**, one per line —
exactly the picture the owner attached. No code card.

The clipboard was read back at that moment:

```
"class Solution:\r\n    def secondLargestDistinct(self, nums: List[int]) -> int:\r\n        ..."
```

while the code that was stashed when **Copy code** was pressed was:

```
"class Solution:\n    def secondLargestDistinct(self, nums: List[int]) -> int:\n        ..."
```

## Root cause 1 — the clipboard comparison is byte-exact (the code card)

`excalidraw-app/sidebar/insertIntoScene.ts`:

```ts
const clipboardHoldsCode = (stashed: StashedCode, data: ClipboardData) =>
  typeof data.text === "string" && data.text.trim() === stashed.code.trim();
```

The guard exists for a good reason: "the user may have copied something else since the code
was armed, and that paste is an ordinary one." It compares the **trimmed** strings — but it
does not normalise the **line endings**.

Windows Chrome stores text on the clipboard with **CRLF**. `navigator.clipboard.writeText`
writes LF; the clipboard hands back CRLF. So on Windows the two sides never match, the armed
paste is always declined, and the code always arrives as plain text.

This is a Windows-only failure. That is why it can look like "it worked in an earlier
version" — it never worked on Windows; what changed is that the comparison was tightened
from "does the clipboard start with the code" to "is the clipboard exactly the code".

**The fix:** normalise the line endings on **both** sides before comparing — CRLF to LF, and
a lone CR to LF. The comparison stays exact otherwise: a clipboard holding different code is
still an ordinary paste.

**The fix must not be** "compare only the first line" and **must not be** "compare the first
N characters". Both would paste the wrong code when the clipboard holds something else.

## Root cause 1b — the arm is dropped when the sidebar closes

`excalidraw-app/sidebar/DocumentViewer.tsx`:

```ts
useEffect(() => {
  cancelCodePaste();
  return () => cancelCodePaste();
}, [entry]);
```

The cleanup runs on **unmount**. And clicking the canvas **closes the sidebar** by default —
Excalidraw closes it unless *Keep sidebar open* is on. So the owner's own sequence is:

1. Click **Copy code** → the code is copied and the paste is armed.
2. Click the canvas → the sidebar closes → the viewer unmounts → `cancelCodePaste()`.
3. Paste → **nothing is armed** → the code arrives as plain text.

Measured in the live app: after the canvas click the document viewer is gone
(`document.querySelector(".app-doc-viewer")` → null) in the default configuration. This is
why the bug survives the CRLF fix on its own: fixing the comparison is not enough, because
by the time the paste happens the stash is already gone.

The unmount cancel was meant to stop "a later paste inserting code nobody asked for". But
the guard for that already exists and is better: **`clipboardHoldsCode`**. If the user
copied something else in the meantime, the clipboard no longer holds the code and the paste
is an ordinary one. The unmount cancel is redundant protection that breaks the feature.

**The fix:** the arm survives the sidebar closing. Keep the cancel for the cases that
really are a change of mind: the user copies something else, the user opens a **different**
document (the `[entry]` change), the paste is consumed, or the user explicitly cancels.

## Root cause 2 — the paste is dropped when the pointer is still over the sidebar

`packages/excalidraw/components/App.tsx`, in `pasteFromClipboard`:

```ts
const target = document.activeElement;
const isExcalidrawActive = this.excalidrawContainerRef.current?.contains(target);
if (event && !isExcalidrawActive) {
  return;
}
const elementUnderCursor = document.elementFromPoint(
  this.lastViewportPosition.x,
  this.lastViewportPosition.y,
);
if (event && (!(elementUnderCursor instanceof HTMLCanvasElement) || isWritableElement(target))) {
  return;
}
```

`lastViewportPosition` is updated by a **document-level** `pointermove` listener
(`updateCurrentCursorPosition`). So it holds whatever position the pointer last occupied —
which, right after clicking **Copy code**, is a point **inside the sidebar**.

`elementFromPoint` at that point returns the copy button, not a canvas, so
`pasteFromClipboard` returns early and **the paste never happens**. Nothing is inserted, no
error, no toast. Reproduced: pressing Ctrl+V straight after **Copy code**, without moving
the pointer, inserts nothing at all.

The canvas check exists so that a paste does not land in the canvas while the user is
working with a text input or a dialog. For the **context menu** paste the pointer position
is the meaningful thing — the user right-clicked there. For the **keyboard** paste there is
no pointer at all: the position is a leftover from wherever the pointer last was, and using
it to veto the paste is wrong.

**The fix:** the pointer-position check applies to the **synthetic** paste event the context
menu produces, not to a real keyboard paste. `ClipboardEvent.isTrusted` tells the two apart:
a real key press produces a trusted event, `createPasteEvent` produces an untrusted one.

The `isWritableElement(target)` half of the guard must stay for **both** paths — pasting
into a text field must never land on the canvas.

## Root cause 3 — the docked sidebar overlays the canvas and eats the wheel

Measured in the live app (layout viewport 1280x529):

| thing | rect |
| --- | --- |
| the excalidraw container | x 0 → 1280 |
| the **canvas** element | x 0 → 1280 |
| the docked sidebar | x 986 → 1280 |

The sidebar is `position: absolute` **inside** the excalidraw container, and the canvas is
sized to the whole container. So the sidebar covers the canvas's right-hand strip, and a
wheel gesture at x=1100 lands on `SPAN.app-doc-copy-code__label`, **not** on the canvas —
the wheel event is not prevented, so the sidebar's own scroll container scrolls and the
canvas does not zoom. A pan started in that strip cannot begin either.

The fork already knows the sidebar overlaps the canvas: `insertPlacement.ts` computes a
"cover" and places inserted content outside it. The overlap is therefore deliberate. What
is missing is that **the canvas keeps the interaction** once the user is working on it.

**The fix:** the sidebar must not capture the interaction that belongs to the canvas. When
the user clicks on the canvas, the sidebar loses the pointer: it stops being a scroll
target and stops holding the keyboard focus, until the pointer comes back to it.

The two halves are separable and both are wanted:

- **Keyboard focus.** A focused control inside the sidebar keeps the keyboard. After a
  click on the canvas the focus must leave the sidebar, so that Ctrl+V, the arrow keys and
  Delete reach the canvas.
- **Wheel.** A wheel gesture that begins over the canvas must reach the canvas, including
  in the strip the sidebar covers.

The implementation is the builder's choice, but it has to be **observable**: a test that
asserts the sidebar is not the wheel target after a canvas click, and a test that asserts
no sidebar control holds the focus after a canvas click.

## What must NOT change

- The selection auto-copy of prose in the markdown viewer works and must keep working.
- A clipboard that holds something **other** than the stashed code must still produce an
  ordinary paste, not a code card.
- The context menu's **Paste** must keep producing a code card (the owner's item: the
  context menu never fires a DOM paste event, so the library's `onPaste` hook is the only
  funnel — that part is correct and must not be reworked).
- The code card's own rendering (the dark card, the syntax colours, the monospace) is
  correct — the owner's first screenshot is the target, and the card is what the wave must
  produce again.

## The acceptance rows

| id | the row |
| --- | --- |
| AC-76 | a paste of code armed from the sidebar's **Copy code** produces a code card, when the clipboard stores the text with CRLF line endings |
| AC-77 | the armed paste survives the sidebar closing: clicking the canvas after **Copy code** and then pasting still produces a code card |
| AC-78 | a keyboard paste is not dropped when the pointer is still over the sidebar; the pointer-position veto applies only to the synthetic context-menu paste |
| AC-79 | after a click on the canvas the sidebar holds neither the keyboard focus nor the wheel: a wheel gesture over the canvas reaches the canvas, and no sidebar control is focused |

AC-76 to AC-79 are numbered out of sequence on purpose: AC-65 to AC-69 belong to the video
panel wave and AC-70 to AC-75 to the OCR and presenter wave, and those ids are already
reserved in their briefs.
