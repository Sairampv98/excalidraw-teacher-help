# Builder brief — Wave 4c, the paste that does not fit

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's decision Q3 (2026-10-21), about pasting a long block of text:

> "paste onto the canvas what fits the viewport and keep in clipboard the remaining text that can be pasted or not open a popup that the user selects from options reading: **discard remaining text**, **place all text in the same page**, and **place text in multiple pages** that copy text from the clipboard such that it does not overflow the viewport."

In their own words, in the test session:

> "whenever I paste a long content it goes beyond the page and is not visible or accessible anymore."

The full design, with the reasoning and the rejected alternatives, is `docs/superpowers/specs/2026-10-21-paste-overflow-design.md`. **Read it first.**

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-24 | A paste that does not fit the **current page** raises an **offer** — it is never resolved automatically. The offer's answers are: discard the rest, place everything on this page (growing it), or place the text across multiple pages. |
| D-25 | The text that does not fit is decided **per line**: a line whose element lies entirely inside the page fits; a line that straddles the edge overflows. |
| D-26 | Whatever is left over is **written back to the clipboard**, so the user can paste the rest somewhere else. The clipboard is the user's, and nothing is thrown away silently. |

Add these three rows to `SPEC.md` in the Decisions table (after `D-23`), and the three acceptance rows below to the Wave 4 acceptance table.

## The cause

The library's `addTextFromPaste` (`packages/excalidraw/components/App.tsx`) splits the pasted text into **one text element per line**, lays them out at the paste position, and inserts them. It does not look at the page.

The fork's page model makes that a problem: **the camera is clamped to the page rect** (`clampCameraToPage`). Content outside the page is in the document but unreachable — the owner cannot scroll to it and cannot see it. A long paste lands exactly there.

## The bound

The overflow is measured against **the current page's rect**, not the viewport.

The owner wrote "the viewport", but the viewport is what the camera happens to show; the page is the thing the camera is clamped to, and the thing that defines the document. A paste that fits the viewport but hangs off the page is exactly the failure the owner reported. The page is therefore the bound — and the library already has the geometry (`getCurrentPageRect`, `getPageRect`, `getPageClampRect` in `packages/excalidraw/scene/pages.ts`).

## The three answers

| Answer | What happens |
| --- | --- |
| **Discard the remaining text** | Only the part that fits the page is placed. The rest is dropped from the canvas — and **written back to the clipboard**, so the user can paste the rest somewhere else. |
| **Place all the text on this page** | Everything is placed, and the page **grows** to contain it — the same primitive the import path uses (`growPagesToFitContent` + `translateContentForPageLayout` in `packages/excalidraw/scene/pages.ts`). |
| **Place the text across multiple pages** | The text is split into chunks that each fit the page. The first chunk lands on the current page; every further chunk lands on a **new page**, appended to the document. |

And the **default** — dismissing the offer without choosing — is the first answer without the clipboard write: what fits is placed and the rest is left in the clipboard.

## The offer

Like the import offer (D-14), this is an **offer**, never an automatic decision.

The library already has the machinery for exactly this:

- `packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState.ts` — a Jotai atom and a promise-returning opener;
- `packages/excalidraw/components/Modal.tsx` — the container;
- `packages/excalidraw/components/LayerUI.tsx` — where the dialog is mounted (next to `<PageSplitDialog />`, which Wave 3c added and which is the closest existing example);
- `packages/excalidraw/components/PageSplitDialog/PageSplitState.ts` — the newest example of the pattern, and the one to copy.

So the paste offer is a new `PasteOverflowDialog/` beside the existing ones, mounted in `LayerUI.tsx`, and awaited in the paste path.

## Which text goes where

The text is split into lines (as today) and the lines into text elements (as today). The overflow is then decided **per line**, in order:

- a line whose text element lies **entirely inside** the current page's rect **fits**;
- the first line that does not fit, and everything after it, **overflows**.

A line that straddles the page's edge counts as overflow — half a line hanging off the edge is not readable, and the camera cannot reach it.

Splitting the text into **chunks** for the "across pages" answer uses the same per-line rule: a chunk is the longest run of lines that fits the page; the next chunk starts a new page.

## The files you own

Everything below is inside the task scope `packages/excalidraw,SPEC.md`.

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

| Row | Check file | What |
| --- | --- | --- |
| AC-29 | `packages/excalidraw/tests/` | A paste that fits the page is inserted as it is today — **no offer**. |
| AC-30 | `packages/excalidraw/tests/` | A paste that does not fit raises the offer, and each of the three answers does what it says. |
| AC-31 | `packages/excalidraw/tests/` | The text left over is on the clipboard after the offer. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-30 the paste offer puts the text across pages when the user says so', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

The clipboard in jsdom: check how the existing tests fake `navigator.clipboard` (the library's own `clipboard.test.tsx` does) and follow that.

## The house rules

- `yarn`, never `npm` or `bun`. No new dependency.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has (`getCommonBounds`, `getPageRect`, `getCurrentPageRect`, `growPagesToFitContent`).
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your three new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the offer is never raised, (b) the "discard" answer does not discard, (c) the leftover is not written back to the clipboard. Record what you broke and what failed — the orchestrator needs that in the close note.
