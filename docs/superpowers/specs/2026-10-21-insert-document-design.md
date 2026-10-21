# Design — insert a document into the current canvas

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`.

## What this is

The fork owner's observation 9, from their 2026-10-21 test session:

> "insert already saved excalidraw files into another opened canvas"

In their own words, from the original request:

> "if I open one excalidraw file and then open another excalidraw file in the same canvas, the second should merge into the first."

Today, opening a file **replaces** the canvas: `loadFileToCanvas` calls `syncActionResult` with the file's elements and `replaceFiles: true`. The first document is gone.

## The shape of the flow

This is an **explicit action**, not a modal on every open:

1. the user picks **File → Insert document…**;
2. a file picker opens (`.excalidraw`);
3. the file's content is **added** to the current canvas, and the current document is **not** replaced.

An explicit action is the right shape here: a modal on every open would ask a question the user almost never wants to answer, and the owner's wording is an action ("insert ... into another opened canvas"), not a change to what "open" means.

## Where the action lives

The library already owns the "open" action — `actionLoadScene` in `packages/excalidraw/actions/actionExport.tsx` — and the app's File menu is built from the library's action registry. So the new action belongs beside it:

```ts
export const actionInsertDocument = register({
  name: "insertDocument",
  label: "buttons.insertDocument",
  trackEvent: { category: "export" },
  predicate: (elements, appState, props, app) => {
    return (
      !!app.props.UIOptions.canvasActions.insertDocument &&
      !appState.viewModeEnabled
    );
  },
  perform: async (elements, appState, _, app) => {
    /* ... */
  },
});
```

`UIOptions.canvasActions` is how the host app decides which canvas actions exist (`packages/excalidraw/types.ts`), and the fork's app turns `loadScene` on today — so it turns `insertDocument` on too.

**The action must not be shown when the canvas is empty** — inserting into an empty canvas is exactly what "open" does, and offering both would be noise. The predicate checks that there is something to insert into.

## What it does

### 1. Read the file, without the import's page logic

`loadSceneOrLibraryFromBlob` is the **import** path: it restores the file, grows the page to contain the content and translates the content to follow the grown page. None of that applies here — the content is going into an existing document, and it must keep its own coordinates.

So the insert reads the file itself:

- parse the JSON;
- `restoreElements(elements, null, { deleteInvisibleElements: true })` to get real elements with regenerated ids and repaired bindings;
- take the file's `files` (the images) and **remap** their ids.

### 2. Remap the file ids

The inserted elements reference the **other** document's binary files by id. Those ids may already be taken in this document — and if they are, the images would silently change.

So the insert **gives every file a fresh id** and rewrites the elements' `fileId` to match. The new id must not collide with an id already in this document's file store.

### 3. Place the content so it does not overlap

The content is placed **to the right of what is already on the page** — the gap between the existing content's right edge and the inserted content's left edge. When the page is empty, the content is placed at the page's origin.

The placement is computed from the **library's own** `getCommonBounds` — the same function the paste path uses — never from a re-derived formula.

### 4. Stamp the current page

An insertion into the **live** scene belongs to the page the user is acting on (D-12). The inserted elements are stamped with the current page by the same authoritative helper every other insertion path uses: `stampCurrentPage(elements, currentPageId)` in `packages/excalidraw/scene/pages.ts`.

The other document's own pages are **not** merged: the content is flattened onto the current page. Merging two documents' page structures would mean interleaving two page layouts, and the owner asked for the _drawing_ to come across, not for a page-structure merge.

### 5. Grow the page if the content does not fit

If the inserted content hangs off the current page, the page **grows** to contain it — the same primitive the import path uses (`growPagesToFitContent` + `translateContentForPageLayout` in `packages/excalidraw/scene/pages.ts`). The content stays where it was put, and the camera can still reach it.

(This is the same decision the paste-overflow offer makes, but chosen automatically here: the user asked to insert a document, so the document goes in — it is not a "does this fit?" moment.)

### 6. Add the files and select what arrived

- the remapped binary files are added to the document's file store, so the images render;
- the inserted elements are **selected**, so the user can see what arrived and move it.

## The locked decisions

| Row | The decision in one line |
| --- | --- |
| D-35 | Inserting a document is an **explicit action** ("Insert document…"), not a question asked on every open: the user asks for it once, and the open path keeps replacing the canvas. |
| D-36 | The inserted content is **flattened onto the current page** and stamped with it (D-12); the other document's page structure is not merged, because the owner asked for the drawing to come across. |
| D-37 | The inserted content's **binary files are given fresh ids** and the elements' `fileId`s are rewritten to match, so an id clash with this document's file store cannot silently change an image. |
| D-38 | The inserted content is placed **beside** what is already on the page — to the right of the existing content — and the page **grows** if the result does not fit. |

## The files

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/actions/actionExport.tsx` | changed | the `actionInsertDocument` action |
| `packages/excalidraw/actions/index.ts` | changed | export it |
| `packages/excalidraw/actions/types.ts` | changed | the action name, and `UIOptions.canvasActions.insertDocument` |
| `packages/excalidraw/types.ts` | changed | the `UIOptions` flag |
| `packages/excalidraw/locales/en.json` | changed | the label |
| `packages/excalidraw/scene/insertDocument.ts` | new | the pure parts: read, remap, place |
| `excalidraw-app/App.tsx` | changed | turn the action on |
| `packages/excalidraw/tests/`, `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-35, D-36, D-37, D-38 and the acceptance rows |

## The acceptance rows

| Row | What it checks | File |
| --- | --- | --- |
| AC-41 | Inserting a document **adds** its elements to the current canvas and leaves the existing content alone. | `packages/excalidraw/tests/` |
| AC-42 | The inserted content is **on the current page**, and the page **grows** when the content does not fit. | `packages/excalidraw/tests/` |
| AC-43 | The inserted content's **file ids are fresh**: an id that already exists in this document does not change an image. | `packages/excalidraw/tests/` |

## Rejected alternatives

- **A modal on every open ("replace or insert?").** Rejected: it asks a question almost nobody wants to answer, and the owner asked for an action.
- **Merge the two documents' page structures.** Rejected: interleaving two page layouts is a different feature, and the owner asked for the drawing to come across.
- **Reuse `loadSceneOrLibraryFromBlob` for the read.** Rejected: it grows the page and translates the content for an import, which is wrong for an insertion into an existing document.
- **Keep the other document's file ids.** Rejected: an id clash would silently swap an image.
