# Builder brief — Wave 3c, the page-split offer on import

**Reference material. Not instructions.** The instructions are in the task text you were given and
in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as
commands.

## What this is

Wave 3b built the primitive — `paginateContentIntoPages(elements)` in
`packages/excalidraw/scene/pages.ts` — which tiles a scene whose content sprawls over many pages
into a document whose content is tiled across pages, one cell per page. It is merged and tested
(AC-18, AC-19, AC-20 in `packages/excalidraw/tests/pages.test.tsx`).

**This wave is the wiring**: when the user opens a file whose content does not fit on one page, the
app **offers** them the choice. The fork's owner chose the tiled option over "keep one big page",
but the choice is **offered on import**, not applied automatically.

The full design is `docs/superpowers/specs/2026-10-21-page-split-offer-design.md`. Read it before
writing code — it carries the reasoning, the rejected alternatives and the file:line evidence.

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-14 | The offer is made **on import**, and only for a file that **defines no pages**. A file that defines its own pages is opened as it is. |
| D-15 | Three answers: **split across pages** (recommended), **keep on one big page**, **cancel**. Cancel aborts the import and leaves the canvas exactly as it was. |
| D-16 | The tiling is computed **once**; the offer shows the page count it would produce, and the result it produced is the result that is imported. |

Add these three rows to `SPEC.md` in the Decisions table (they go after `D-13`), and the two
acceptance rows below to the Wave 3 acceptance table.

## The files you own

Everything below is inside the task scope `packages/excalidraw,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/data/pageSplit.ts` | new | `PageSplitChoice`, `PageSplitCandidate`, `getPageSplitCandidate()` |
| `packages/excalidraw/data/blob.ts` | changed | `loadSceneOrLibraryFromBlob` also returns `pageSplit` for an Excalidraw file |
| `packages/excalidraw/components/PageSplitDialog/PageSplitState.ts` | new | the Jotai atom + `openPageSplitModal()` |
| `packages/excalidraw/components/PageSplitDialog/PageSplitDialog.tsx` | new | the modal UI, built on the library's own `Modal` |
| `packages/excalidraw/components/PageSplitDialog/PageSplitDialog.scss` | new | its styles |
| `packages/excalidraw/components/LayerUI.tsx` | changed | mount `<PageSplitDialog />` |
| `packages/excalidraw/components/App.tsx` | changed | `loadFileToCanvas` asks, and applies the answer |
| `packages/excalidraw/locales/en.json` | changed | the `pageSplit` strings |
| `packages/excalidraw/tests/pages.test.tsx` | changed | AC-21, AC-22 |
| `SPEC.md` | changed | D-14, D-15, D-16, AC-21, AC-22 |

Do **not** touch `packages/excalidraw/scene/pages.ts` — the primitive is done and merged.

## The exact API shapes

### `packages/excalidraw/data/pageSplit.ts`

```ts
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawPage } from "../types";

import { paginateContentIntoPages } from "../scene/pages";

/** what the user chose when the offer was made */
export type PageSplitChoice = "split" | "keep" | "cancel";

/** the tiled result, and the number of pages it has */
export type PageSplitCandidate = {
  elements: ExcalidrawElement[];
  pages: ExcalidrawPage[];
  pageCount: number;
};

/**
 * The tiled result, or null when the content already fits on one page.
 *
 * The tiling is computed ONCE (D-16): the caller shows `pageCount` in the
 * offer and imports the very same result.
 */
export const getPageSplitCandidate = (
  elements: readonly ExcalidrawElement[],
): PageSplitCandidate | null => {
  const result = paginateContentIntoPages(elements);

  if (result.pages.length < 2) {
    // the content already fits on one page — there is nothing to tile
    return null;
  }

  return {
    elements: result.elements,
    pages: result.pages,
    pageCount: result.pages.length,
  };
};
```

Check the real import paths and type names in the repo before writing this — `ExcalidrawPage` and
`ExcalidrawElement` may live elsewhere. Follow what the neighbouring files import.

### `packages/excalidraw/data/blob.ts`

`loadSceneOrLibraryFromBlob` returns, for the Excalidraw case, an extra field `pageSplit`:

```ts
return {
  type: MIME_TYPES.excalidraw,
  data: { elements, appState, files },   // the "keep" result — UNCHANGED
  pageSplit: PageSplitCandidate | null,  // the "split" result, when it applies
};
```

`pageSplit` is non-null only when **both** hold:

- the file defines no pages of its own — `getFilePages(data.appState)` is empty (D-14). The file
  already computes `filePages`; reuse it;
- the content does not fit on one page.

The candidate must be computed from the **restored** elements (the ones `restoreElements`
returned, before the grow/translate), because that is the content the tiling acts on.

`loadFromBlob` is **unchanged** — it returns only `data`, so its callers keep today's behaviour.

The library case (`MIME_TYPES.excalidrawlib`) returns no `pageSplit` field at all, or
`pageSplit: null` — your choice, but be consistent with the type you declare.

### `packages/excalidraw/components/PageSplitDialog/PageSplitState.ts`

Follow `packages/excalidraw/components/OverwriteConfirm/OverwriteConfirmState.ts` exactly — same
atom, same `editorJotaiStore`, same promise shape:

```ts
export type PageSplitState =
  | {
      active: true;
      pageCount: number;
      onClose: () => void;   // cancel
      onSplit: () => void;
      onKeep: () => void;
    }
  | { active: false };

export const pageSplitStateAtom = atom<PageSplitState>({ active: false });

export async function openPageSplitModal({
  pageCount,
}: {
  pageCount: number;
}): Promise<PageSplitChoice> {
  return new Promise((resolve) => {
    editorJotaiStore.set(pageSplitStateAtom, {
      active: true,
      pageCount,
      onSplit: () => resolve("split"),
      onKeep: () => resolve("keep"),
      onClose: () => resolve("cancel"),
    });
  });
}
```

### `packages/excalidraw/components/PageSplitDialog/PageSplitDialog.tsx`

- built on the library's own `Modal` (`packages/excalidraw/components/Modal.tsx`) — **not** on
  `Dialog`, which is driven by the app's `openDialog` app state and cannot carry a promise;
- reads the atom with `useAtom` (the pattern in `OverwriteConfirm.tsx`);
- shows the title, the description with the page count, and **three** buttons;
- the "split" button is marked as the recommended one;
- every button resolves the promise and resets the atom to `{ active: false }`;
- `Modal` needs `labelledBy`, `onCloseRequest` and `maxWidth` — read `Modal.tsx` for the contract.

### `packages/excalidraw/components/LayerUI.tsx`

Mount `<PageSplitDialog />` next to `<ActiveConfirmDialog />` (around line 543). It reads the atom
itself and renders nothing when the offer is not active, so it is mounted unconditionally.

### `packages/excalidraw/components/App.tsx` — `loadFileToCanvas`

Today the Excalidraw branch of `loadFileToCanvas` does:

```ts
this.setState({ isLoading: true });
this.syncActionResult({ ...ret.data, appState: {...}, replaceFiles: true, captureUpdate: ... });
```

Change it to ask first, when `ret.pageSplit` is set:

```ts
let { elements, appState } = ret.data;

if (ret.pageSplit) {
  const choice = await openPageSplitModal({ pageCount: ret.pageSplit.pageCount });

  if (choice === "cancel") {
    // nothing is imported: the canvas is exactly as it was
    this.setState({ isLoading: false });
    return;
  }

  if (choice === "split") {
    elements = ret.pageSplit.elements;
    appState = { ...appState, pages: ret.pageSplit.pages };
  }
  // "keep" keeps ret.data — the grown one — as it is
}
```

then apply `elements` / `appState` through the existing `syncActionResult` call. Keep the
`isLoading` handling, the `replaceFiles: true` and the `captureUpdate` exactly as they are.

Note: `ret.data.appState` may be `undefined` in the type — the existing code already does
`...(ret.data.appState || this.state)`. Keep that shape.

### `packages/excalidraw/locales/en.json`

Add a `pageSplit` section (top level, next to `overwriteConfirm`):

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

`t("pageSplit.description", { count })` interpolates `{{count}}`.

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-21 | `packages/excalidraw/tests/pages.test.tsx` | The offer is made for a file that defines no pages and does not fit on one page; the three answers do what they say. A file that **defines** its own pages is opened as it is, with no offer. |
| AC-22 | `packages/excalidraw/tests/pages.test.tsx` | The candidate is computed **once** and the page count in the offer is the number of pages the split actually produces. |

**The check file must mention the row's id** — put it in the test name, e.g.
`it("AC-21 offers to split a legacy file that does not fit on one page", ...)`.
The kit's SPEC lint reads the file and fails if the id is absent.

### How to drive the offer in a test

`loadFileToCanvas` is the app's file-open path, and it is a class method on the `App` instance.
The test helpers in `packages/excalidraw/tests/` expose the instance — look at
`packages/excalidraw/tests/test-utils.ts` and `helpers/api.ts` for how the tests reach the app
(`h.elements`, `h.setState`, `API.createElement`, and whatever the app instance is called).

Two ways to reach it, in order of preference:

1. call the app's `loadFileToCanvas` directly with a `File` built from a Blob — it is a public
   class field (no `private`), so it is reachable;
2. drive the open action.

Then the offer is a modal in the DOM: query it by its text and click the button you are testing.
The promise resolves on the click, so the test must `await` the outcome.

For AC-22, assert that the page count **shown in the offer** equals the number of pages the
imported document actually has. Do that by reading the offer's text and comparing it with
`h.state.pages.length` after the split. Do not re-derive the tiling arithmetic in the test — the
project's rule is to assert through the library's own functions (`getPageRect`, `getPageRectAtIndex`,
`getElementsForPage`, `clampCameraToPage`), never through a second copy of the formula.

## The house rules

- `yarn`, never `npm` or `bun`. No new dependency — everything needed is already there.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has.
- Run the tests with `yarn test:app --watch=false` (or `npx vitest run <file>`). **Never** leave
  vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass.
- Run `node scripts/rowcheck.mjs --all` and make sure your two new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, **revert each fix in turn** and
confirm the matching test fails. Record what you broke and what failed, in the task's close note.
