# Design — the paste that does not fit

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`.

## What this is

The fork owner's decision Q3 (2026-10-21), about pasting a long block of text:

> "paste onto the canvas what fits the viewport and keep in clipboard the remaining text that can be pasted or not open a popup that the user selects from options reading: **discard remaining text**, **place all text in the same page**, and **place text in multiple pages** that copy text from the clipboard such that it does not overflow the viewport."

In their own words, in the test session:

> "whenever I paste a long content it goes beyond the page and is not visible or accessible anymore."

## The cause

The library's `addTextFromPaste` (`packages/excalidraw/components/App.tsx`) splits the pasted text into **one text element per line**, lays them out at the paste position, and inserts them. It does not look at the page.

The fork's page model makes that a problem: **the camera is clamped to the page rect** (`clampCameraToPage`). Content that lies outside the page is in the document but unreachable — the owner cannot scroll to it, and it is not drawn in the visible area. A long paste lands exactly there.

## The bound

The overflow is measured against **the current page's rect**, not the viewport.

The owner wrote "the viewport", but the viewport is what the camera happens to show; the page is the thing the camera is clamped to, and the thing that defines the document. A paste that fits the viewport but hangs off the page is exactly the failure the owner reported. The page is therefore the bound — and the library already has the geometry (`getCurrentPageRect`, `getPageRect`, `getPageClampRect`).

## The three answers

| Answer | What happens |
| --- | --- |
| **Discard the remaining text** | Only the part that fits the page is placed. The rest is dropped from the canvas — and **written back to the clipboard**, so the user can paste the rest somewhere else. |
| **Place all the text on this page** | Everything is placed, and the page **grows** to contain it — the same primitive the import path uses (`growPagesToFitContent` + `translateContentForPageLayout`). |
| **Place the text across multiple pages** | The text is split into chunks that each fit the page. The first chunk lands on the current page; every further chunk lands on a **new page**, appended to the document. |

And the **default** — dismissing the offer without choosing — is the first answer without the clipboard write: what fits is placed and the rest is left in the clipboard.

## The offer

Like the import offer (D-14), this is an **offer**, never an automatic decision: the paste that does not fit raises a modal and waits.

The library already has the machinery for exactly this:

- `packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState.ts` — a Jotai atom and a promise-returning opener;
- `packages/excalidraw/components/Modal.tsx` — the container;
- `packages/excalidraw/components/LayerUI.tsx` — where the dialog is mounted.

So the paste offer is a new `PasteOverflowState.ts` + `PasteOverflowDialog.tsx` beside the existing ones, and `loadFileToCanvas`-style `await` in the paste path.

## Which text goes where

The text is split into lines (as today) and the lines into text elements (as today). The overflow is then decided **per line**, in order:

- a line whose text element lies **entirely inside** the current page's rect **fits**;
- the first line that does not fit, and everything after it, **overflows**.

A line that straddles the page's edge counts as overflow — half a line hanging off the edge is not readable, and the camera cannot reach it.

Splitting the text into **chunks** for the "across pages" answer uses the same per-line rule: a chunk is the longest run of lines that fits the page; the next chunk starts a new page.

## The locked decisions

| Row | The decision in one line |
| --- | --- |
| D-24 | A paste that does not fit the **current page** raises an **offer** — it is never resolved automatically. The offer's answers are: discard the rest, place everything on this page (growing it), or place the text across multiple pages. |
| D-25 | The text that does not fit is decided **per line**: a line whose element lies entirely inside the page fits; a line that straddles the edge overflows. |
| D-26 | Whatever is left over is **written back to the clipboard**, so the user can paste the rest somewhere else. The clipboard is the user's, and nothing is thrown away silently. |

## The files

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/components/PasteOverflowDialog/PasteOverflowState.ts` | new | the atom and `openPasteOverflowModal()` |
| `packages/excalidraw/components/PasteOverflowDialog/PasteOverflowDialog.tsx` | new | the modal |
| `packages/excalidraw/components/PasteOverflowDialog/PasteOverflowDialog.scss` | new | its styles |
| `packages/excalidraw/components/LayerUI.tsx` | changed | mount it |
| `packages/excalidraw/components/App.tsx` | changed | `addTextFromPaste` asks, and applies the answer |
| `packages/excalidraw/scene/pages.ts` | changed | only if a helper is needed for "the longest run of lines that fits the page" |
| `packages/excalidraw/locales/en.json` | changed | the strings |
| `packages/excalidraw/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-24, D-25, D-26 and the acceptance rows |

## The acceptance rows

| Row | What it checks | File |
| --- | --- | --- |
| AC-29 | A paste that fits the page is inserted as it is today — **no offer**. | `packages/excalidraw/tests/` |
| AC-30 | A paste that does not fit raises the offer, and each of the three answers does what it says. | `packages/excalidraw/tests/` |
| AC-31 | The text left over is on the clipboard after the offer. | `packages/excalidraw/tests/` |

## Rejected alternatives

- **Grow the page silently.** Rejected: the owner asked for the choice; growing a page behind the user's back changes the document's shape without their say.
- **Move the overflow onto a new page without asking.** Rejected: same reason.
- **Measure against the viewport.** Rejected: the viewport is not what the camera is clamped to; a paste can fit on screen and still be unreachable.
- **Let the paste overflow and leave it to the user to notice.** Rejected: that is the bug.
- **Write the leftover back to the clipboard on every answer.** Rejected: only the answers that actually leave something over need it; the "place everything" answers leave nothing over.
