# Design — the page-split offer on import

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`.

## What this is

Wave 3b built the primitive: `paginateContentIntoPages(elements)` in `packages/excalidraw/scene/pages.ts` turns a scene whose content sprawls over many pages into a document whose content is tiled across pages, one cell per page. It is a pure function and it is tested (AC-18, AC-19, AC-20).

This wave wires it to the app: when the user opens a file whose content does not fit on one page, the app **offers** them the choice. The user picked the tiled option over "keep one big page" when the fork's owner was asked (2026-10-21), but the owner also decided that the choice is **offered on import**, not applied automatically. So this wave is the offer, and the three answers it can get.

## The evidence

The owner's own board, `C:\Users\user\projects\day-1.excalidraw`: a **vanilla** Excalidraw file — 2,507 elements, 97,228 points, 10.9 MB, and **no `pages` in its appState**. Its content spans x −6648..3595, y 74..14285 — about 5.3 × 13.2 pages of area, on a 1920×1080 page. Every element is therefore stamped onto page 1 (D-7), and the board hangs outside the rect the camera is clamped to. Two symptoms, one cause:

1. it is slow to open — every element is drawn on every frame, and the camera cannot get to most of them;
2. navigating it is hard — most of the board is outside the reachable area.

Tiling fixes both: 24 pages, max 282 / median 91.5 elements per page, zero elements overflowing their page. But tiling is a **decision about the user's document**, so it is not something the app may take on its own.

## The locked decisions

| Row | The decision in one line |
| --- | --- |
| D-14 | The offer is made **on import**, and only for a file that **defines no pages**. A file that defines its own pages has a structure its author chose; it is opened as it is. |
| D-15 | Three answers: **split across pages** (recommended), **keep on one big page**, **cancel**. Cancel aborts the import and leaves the canvas exactly as it was. |
| D-16 | The tiling is computed **once**. `paginateContentIntoPages` is a pure function over the whole scene, so the offer can show the page count it would produce — and the result it produced for the offer is the result that is imported. |

## The flow

1. `App.loadFileToCanvas(file, fileHandle)` calls `loadSceneOrLibraryFromBlob(...)`.
2. For an Excalidraw file, `loadSceneOrLibraryFromBlob` returns the **keep** result in `data` (today's behaviour: `growPagesToFitContent` + `translateContentForPageLayout`) and, when the file defines no pages and its content does not fit on one page, the **split** candidate in `pageSplit`.
3. `loadFileToCanvas` sees `pageSplit` and awaits `openPageSplitModal({ pageCount })`.
4. The answer decides which of the two results is applied:
   - `split` → `pageSplit.elements` and `pageSplit.pages`;
   - `keep` → `data.elements` and `data.appState.pages` (the grown one);
   - `cancel` → nothing is applied; the canvas is untouched and `isLoading` goes back to false.

`loadSceneOrLibraryFromBlob` computes the candidate with **one** call to `paginateContentIntoPages` (D-16). The candidate is `null` when the content already fits on one page, which is exactly the case in which no offer is made.

## Why the offer lives in the library

Every way of opening a file in this fork funnels through **one** function: `packages/excalidraw/components/App.tsx` → `loadFileToCanvas`. It is called from the open action (`actionExport.tsx` → `loadFromJSON` → `loadFromBlob` → the same blob loader), from the drop handler, from the web-share target and from the launch queue. There is no app-level seam to intercept, so the offer has to live next to that function — in the library — and the fork's app (`excalidraw-app`) inherits it.

## The modal

The library already has a promise-based modal pattern, used by the overwrite-confirm dialog:

- `packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState.ts` — a Jotai atom plus `openConfirmModal()`, which returns a `Promise<boolean>`;
- the dialog component reads the atom and renders itself;
- `LayerUI.tsx` mounts it.

Wave 3c follows that pattern exactly, with the library's own `Modal` (`packages/excalidraw/components/Modal.tsx`) as the container — **not** `Dialog`, which is tied to the app's `openDialog` app-state and is therefore no use to a promise-driven dialog.

New files:

- `packages/excalidraw/components/PageSplitDialog/PageSplitState.ts` — the atom and `openPageSplitModal()`;
- `packages/excalidraw/components/PageSplitDialog/PageSplitDialog.tsx` — the UI;
- `packages/excalidraw/components/PageSplitDialog/PageSplitDialog.scss` — its styles.

`LayerUI.tsx` mounts `<PageSplitDialog />` next to `<ActiveConfirmDialog />`.

## The library-side helper

New file `packages/excalidraw/data/pageSplit.ts`:

```ts
export type PageSplitChoice = "split" | "keep" | "cancel";

export type PageSplitCandidate = {
  elements: ExcalidrawElement[];
  pages: ExcalidrawPage[];
  pageCount: number;
};

/** the tiled result, or null when the content already fits on one page */
export const getPageSplitCandidate = (
  elements: readonly ExcalidrawElement[],
): PageSplitCandidate | null;
```

`getPageSplitCandidate` is a thin wrapper over `paginateContentIntoPages`: it calls it once, and returns `null` when the result has a single page (nothing to tile). It lives in `data/` because it is part of the **import** path, and `data/` is one of the project's behaviour paths.

## The blob loader's new return field

`loadSceneOrLibraryFromBlob` currently returns `{ type, data }`. For an Excalidraw file it now also returns `pageSplit`:

```ts
{
  type: MIME_TYPES.excalidraw,
  data: { elements, appState, files },   // the "keep" result — unchanged
  pageSplit: PageSplitCandidate | null,  // the "split" result, when it applies
}
```

`loadFromBlob` (which returns only `data`) is **unchanged** — its callers get today's behaviour. Only the file-open path in `App.tsx` looks at `pageSplit`.

`pageSplit` is non-null only when **both** hold:

- the file defines no pages of its own (`getFilePages(data.appState)` is empty) — D-14;
- the content does not fit on one page (the candidate has more than one page).

## The strings

`packages/excalidraw/locales/en.json` gains a `pageSplit` section:

```json
"pageSplit": {
  "title": "This drawing is bigger than one page",
  "description": "Its content covers {{count}} pages. How should it open?",
  "split": "Split across pages",
  "splitRecommended": "Split across pages (recommended)",
  "keep": "Keep on one big page",
  "cancel": "Cancel"
}
```

`t()` interpolates `{{count}}` through its second argument.

## The acceptance rows

| Row | What it checks | File |
| --- | --- | --- |
| AC-21 | The offer is made for a file that defines no pages and does not fit on one page; the three answers do what they say: split tiles it, keep leaves one big page, cancel leaves the canvas untouched. A file that **defines** its own pages is opened as it is, with no offer. | `packages/excalidraw/tests/pages.test.tsx` |
| AC-22 | The candidate is computed **once** and the page count in the offer is the number of pages the split actually produces. | `packages/excalidraw/tests/pages.test.tsx` |

## Rejected alternatives

- **Tiling automatically on import.** Rejected: it rewrites the user's document without asking. The owner asked for the choice to be offered.
- **Putting the offer in `excalidraw-app`.** Rejected: there is no seam — the library owns the file-open path, and an app-level dialog could not be reached from it.
- **Asking the question in the app-state `openDialog` channel.** Rejected: `Dialog` is driven by app state, and the payload (the whole scene) does not belong in app state — it is persisted. The promise/atom pattern already used by `openConfirmModal` is the right one.
- **Computing the tiling twice** (once for the offer, once for the import). Rejected: it is a whole-scene pass over thousands of elements, and the two results could disagree. D-16.
