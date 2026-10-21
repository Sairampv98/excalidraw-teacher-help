# Builder brief — Wave 4b, reformat a selection as a code card or as a table

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

Two of the fork owner's nine observations from their 2026-10-21 test session.

- **Observation 3** — "In PDF files, if I copy code parts only and paste it into the canvas, then I should be given the option to reformat it after selecting the entire group of text boxes into the same format as when I paste markdown code that was copied and pasted using keyboard shortcut."
- **Observation 4** — "In Markdown files, whenever there is a table and it is copied into the canvas it does not turn into a table automatically — only turns into text boxes right now. I want it to be selectable and an option to turn it into a smart table with all the text boxes filled in and tables drawn automatically and appropriately. Check if the same can be done to text copied from pdf as well."

The owner's decision (2026-10-21): the two are **one action over a selection**, offering both formats.

The full design, with the reasoning, the algorithm and the rejected alternatives, is `docs/superpowers/specs/2026-10-21-reformat-selection-design.md`. **Read it first.**

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-21 | Reformatting is **one action over a selection** — "Reformat as…" in the canvas context menu, offering _Code card_ and _Table_ — and the library asks the app to do it through a new `onReformatSelection` prop. |
| D-22 | Reformatting **replaces** the selection: the original text elements are deleted and the reformatted content takes their place, at the selection's own position. |
| D-23 | A table is read from the pasted text by **recovering the cells from each line** (markdown pipes, or tabs for a spreadsheet/PDF copy), dropping the markdown separator row, and the table is **drawn** as a rectangle per cell behind ordinary, selectable text elements. |

Add these three rows to `SPEC.md` in the Decisions table (after `D-20`), and the three acceptance rows below to the Wave 4 acceptance table.

## The extension point

The context menu is the **library's** (`packages/excalidraw/components/App.tsx` → `getContextMenuItems` → `packages/excalidraw/components/ContextMenu.tsx`). The code card is the **app's** (`excalidraw-app/sidebar/codeCard.ts`, which needs `shiki` — an app dependency, not a library one). So the library must be able to ask the app to do the work.

The fork already extends the library through props (`onDuplicate`, `onPaste`, `onLibraryChange`), so this follows the established pattern: one new prop in `packages/excalidraw/types.ts`:

```ts
/**
 * The host app's own "reformat this selection" request.
 *
 * The library shows a "Reformat as..." entry in the canvas context menu when
 * this is supplied and the selection holds at least one text element. The
 * library knows nothing about the formats on offer — the app decides, and the
 * app owns the chooser that asks.
 */
onReformatSelection?: (params: {
  /** the selected, non-deleted elements, in the scene's order */
  selectedElements: readonly NonDeletedExcalidrawElement[];
  appState: AppState;
}) => void;
```

The library's context-menu entry is one action whose `perform` calls the prop. The app shows its own chooser, because the formats are the app's business.

**Why the app and not the library.** `shiki` is a dependency of `excalidraw-app`, not of `packages/excalidraw`. Moving the code card into the library would mean moving the dependency with it, and the library is published to npm. The library stays generic: it offers the hook, the app fills it.

Look at how the fork's existing context-menu items are built (`getContextMenuItems` in `packages/excalidraw/components/App.tsx`) and at the `Action` type in `packages/excalidraw/actions/types.ts` — an entry is an `Action`, and `Action.perform` may be async.

## Part A — reformat as a code card

The app already has the machinery: `insertCodeIntoScene(api, rawCode, { fileName, language, at })` in `excalidraw-app/sidebar/insertIntoScene.ts`, which highlights the snippet and lays it out as real text elements on a dark card.

The reformat is therefore:

1. take the selected text elements **in the scene's order**;
2. join their texts with `\n`;
3. call `insertCodeIntoScene` with that text;
4. **delete** the original text elements.

**The language.** The code card's highlighter needs a language, and a selection has no filename to read one from. If the app already has a language detector, use it; otherwise pass no language and let the highlighter fall back. Do not invent a detection heuristic if one already exists in `excalidraw-app/sidebar/codeCard.ts` or `excalidraw-app/sidebar/sidebarFiles.ts`.

**The placement.** The card is placed where the selection was — the top-left of the selection's bounding box — so the reformatted content lands where the user was looking.

## Part B — reformat as a table

There is no table renderer in the fork yet: the markdown _viewer_ renders HTML tables, but nothing turns text into a table on the canvas. This part writes one.

### Reading the cells

The pasted text is one element per **line** (the library's `addTextFromPaste` in `packages/excalidraw/components/App.tsx` splits on `\n`), and a markdown table's line is a whole row:

```
| Name  | Role     |
| ----- | -------- |
| Ada   | analyst  |
```

So the cells have to be recovered from each line's text:

1. trim the line;
2. if it starts and ends with `|`, drop those two pipes (a markdown row) and split on `|`; otherwise split on a **tab** (what a table copied from a spreadsheet or a PDF puts between cells);
3. trim each cell;
4. a line whose cells are all dashes and colons (`| --- | --- |`) is the markdown **separator row** — it is not a row of the table, and it is dropped;
5. a row with a different number of cells than the table's width is padded with empty cells (or truncated) so the grid stays rectangular.

### Laying the grid out

- the number of columns is the width of the **first** row (the header), after the separator row has been dropped — a header is the one row a markdown table always has;
- if there is no header (a plain tab-separated block), the width is the **most common** row length, so one stray line does not change the table's shape;
- column widths are proportional to the widest cell in that column, with a floor and a ceiling so one long cell cannot make the table absurdly wide;
- row heights follow the tallest cell in the row;
- the table is placed at the top-left of the selection's bounding box.

### Drawing the table

The owner asked for the table to be **drawn**. The cells are text elements; the table is a rectangle per cell, drawn **behind** them:

- one rectangle per cell, with a thin stroke, grouped with the cell's text so they move together;
- the rectangles are behind the text in the z-order, so the text reads on top of the grid;
- the new text elements are ordinary, **selectable** text elements — not an image, not a locked group. The owner asked for the table to be selectable.

## The files you own

Everything below is inside the task scope `packages/excalidraw,excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `packages/excalidraw/types.ts` | changed | the `onReformatSelection` prop |
| `packages/excalidraw/components/App.tsx` | changed | the context-menu entry that calls the prop |
| `packages/excalidraw/locales/en.json` | changed | the entry's label |
| `excalidraw-app/sidebar/table.ts` | new | reading the cells, laying out the grid, drawing it |
| `excalidraw-app/sidebar/reformat.ts` | new | the chooser, and the two reformats |
| `excalidraw-app/App.tsx` | changed | pass `onReformatSelection` to `<Excalidraw>` |
| `excalidraw-app/tests/` | changed | the acceptance rows |
| `SPEC.md` | changed | D-21, D-22, D-23 and the acceptance rows |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-26 | `excalidraw-app/tests/` | The context menu offers **Reformat as…** on a selection of text elements, and not otherwise. |
| AC-27 | `excalidraw-app/tests/` | Reformatting as a **code card** replaces the selection with a highlighted code card at the selection's position. |
| AC-28 | `excalidraw-app/tests/` | Reformatting as a **table** recovers the cells from a markdown table (dropping the separator row) and produces a drawn grid of selectable text cells. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-28 reformatting a markdown table draws a grid of selectable cells', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

Read the existing tests in `excalidraw-app/tests/` before writing yours and follow their style.

## The house rules

- `yarn`, never `npm` or `bun`. No new dependency.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has (`getCommonBounds`, `getElementsForPage`, `getPageRect`).
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your three new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the context-menu entry is never shown, (b) the code-card reformat does not delete the original elements, (c) the separator row is not dropped. Record what you broke and what failed — the orchestrator needs that in the close note.
