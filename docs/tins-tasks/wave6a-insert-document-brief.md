# Builder brief — Wave 6a, insert a document into the current canvas

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's observation 9, from their 2026-10-21 test session:

> "insert already saved excalidraw files into another opened canvas"

In their own words, from the original request:

> "if I open one excalidraw file and then open another excalidraw file in the same canvas, the second should merge into the first."

Today, opening a file **replaces** the canvas — `loadFileToCanvas` calls `syncActionResult` with the file's elements and `replaceFiles: true` — so the first document is gone.

The full design is `docs/superpowers/specs/2026-10-21-insert-document-design.md`. **Read it first** — it carries the reasoning, the file-by-file breakdown and the rejected alternatives.

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-35 | Inserting a document is an **explicit action** ("Insert document…"), not a question asked on every open: the user asks for it once, and the open path keeps replacing the canvas. |
| D-36 | The inserted content is **flattened onto the current page** and stamped with it (D-12); the other document's page structure is not merged, because the owner asked for the drawing to come across. |
| D-37 | The inserted content's **binary files are given fresh ids** and the elements' `fileId`s are rewritten to match, so an id clash with this document's file store cannot silently change an image. |
| D-38 | The inserted content is placed **beside** what is already on the page — to the right of the existing content — and the page **grows** if the result does not fit. |

Add these four rows to `SPEC.md` in the Decisions table, and the three acceptance rows below to the acceptance table for this wave.

## The action

The library already owns the "open" action — `actionLoadScene` in `packages/excalidraw/actions/actionExport.tsx` — and the app's File menu is built from the library's action registry. So the new action belongs beside it:

```ts
export const actionInsertDocument = register({
  name: "insertDocument",
  label: "buttons.insertDocument",
  trackEvent: { category: "export" },
  predicate: (elements, appState, props, app) => {
    return (
      !!app.props.UIOptions.canvasActions.insertDocument &&
      !appState.viewModeEnabled &&
      elements.length > 0
    );
  },
  perform: async (elements, appState, _, app) => {
    /* ... */
  },
});
```

`UIOptions.canvasActions` is how the host app decides which canvas actions exist (`packages/excalidraw/types.ts`); the fork's app turns `loadScene` on today, so it turns `insertDocument` on too.

**The action must not be shown when the canvas is empty** — inserting into an empty canvas is exactly what "open" does, and offering both would be noise. The predicate checks that there is something to insert into.

The action name also goes into `packages/excalidraw/actions/types.ts` (the action-name union) and the action is exported from `packages/excalidraw/actions/index.ts`.

## What the action does

### 1. Read the file, without the import's page logic

`loadSceneOrLibraryFromBlob` is the **import** path: it restores the file, grows the page to contain the content and translates the content to follow the grown page. None of that applies here — the content goes into an existing document and must keep its own coordinates.

So the insert reads the file itself:

- parse the JSON;
- `restoreElements(elements, null, { deleteInvisibleElements: true })` to get real elements with regenerated ids and repaired bindings;
- take the file's `files` (the images) and **remap** their ids.

### 2. Remap the file ids

The inserted elements reference the **other** document's binary files by id. Those ids may already be taken in this document — and if they are, the images would silently change.

So the insert **gives every file a fresh id** and rewrites the elements' `fileId` to match. The new id must not collide with an id already in this document's file store.

### 3. Place the content so it does not overlap

The content is placed **to the right of what is already on the page** — the gap between the existing content's right edge and the inserted content's left edge. When the page is empty, the content is placed at the page's origin.

Compute the placement with the **library's own** `getCommonBounds` — the same function the paste path uses — never with a re-derived formula.

### 4. Stamp the current page

An insertion into the **live** scene belongs to the page the user is acting on (D-12). Stamp the inserted elements with the current page using the same authoritative helper every other insertion path uses: `stampCurrentPage(elements, currentPageId)` in `packages/excalidraw/scene/pages.ts`.

The other document's own pages are **not** merged: the content is flattened onto the current page.

### 5. Grow the page if the content does not fit

If the inserted content hangs off the current page, the page **grows** to contain it — the same primitive the import path uses (`growPagesToFitContent` + `translateContentForPageLayout` in `packages/excalidraw/scene/pages.ts`). The content stays where it was put, and the camera can still reach it.

### 6. Add the files and select what arrived

- the remapped binary files are added to the document's file store, so the images render;
- the inserted elements are **selected**, so the user can see what arrived and move it.

## The files you own

Everything below is inside the task scope `packages/excalidraw,excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/actions/actionExport.tsx` | changed | the `actionInsertDocument` action |
| `packages/excalidraw/actions/index.ts` | changed | export it |
| `packages/excalidraw/actions/types.ts` | changed | the action name |
| `packages/excalidraw/types.ts` | changed | the `UIOptions.canvasActions.insertDocument` flag |
| `packages/excalidraw/locales/en.json` | changed | the label |
| `packages/excalidraw/scene/insertDocument.ts` | new | the pure parts: read, remap, place |
| `excalidraw-app/App.tsx` | changed | turn the action on |
| `packages/excalidraw/tests/`, `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-35, D-36, D-37, D-38 and the acceptance rows |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-41 | `packages/excalidraw/tests/` | Inserting a document **adds** its elements to the current canvas and leaves the existing content alone. |
| AC-42 | `packages/excalidraw/tests/` | The inserted content is **on the current page**, and the page **grows** when the content does not fit. |
| AC-43 | `packages/excalidraw/tests/` | The inserted content's **file ids are fresh**: an id that already exists in this document does not change an image. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-41 inserting a document adds its elements and leaves the canvas alone', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

## The house rules

- `yarn`, never `npm` or `bun`. No new dependency.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has (`getCommonBounds`, `getPageRect`, `growPagesToFitContent`, `translateContentForPageLayout`).
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your three new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the existing content is replaced instead of kept, (b) the elements are not stamped with the current page, (c) the file ids are not remapped. Record what you broke and what failed — the orchestrator needs that in the close note.
