# Design — reformat a selection as a code card or as a table

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`.

## What this is

Two of the fork owner's nine observations from their 2026-10-21 test session.

| # | The owner wrote | The fix |
| --- | --- | --- |
| 3 | "In PDF files, if I copy code parts only and paste it into the canvas, then I should be given the option to reformat it after selecting the entire group of text boxes into the same format as when I paste markdown code that was copied and pasted using keyboard shortcut." | Part A |
| 4 | "In Markdown files, whenever there is a table and it is copied into the canvas it does not turn into a table automatically — only turns into text boxes right now. I want it to be selectable and an option to turn it into a smart table with all the text boxes filled in and tables drawn automatically and appropriately. Check if the same can be done to text copied from pdf as well." | Part B |

The owner's decision (2026-10-21): the two are **one action over a selection**, offering both formats — not two separate actions.

## The shape of the flow

1. The user pastes text (from a PDF, from a markdown file, from anywhere). The library's `addTextFromPaste` (`packages/excalidraw/components/App.tsx`) turns it into **one text element per line**, each at most 800 px wide, stacked with a 10 px gap.
2. The user selects those text elements.
3. The **context menu** on the selection offers **Reformat as…**, which opens a small chooser: **Code card** or **Table**.
4. The chosen format replaces the selection with the reformatted content.

## The extension point

The context menu is the **library's** (`packages/excalidraw/components/App.tsx` → `getContextMenuItems` → `packages/excalidraw/components/ContextMenu.tsx`). The code card is the **app's** (`excalidraw-app/sidebar/codeCard.ts`, which needs `shiki` — an app dependency, not a library one). The library must therefore be able to ask the app to do the work.

The fork already extends the library through props (`onDuplicate`, `onPaste`, `onLibraryChange`), so this follows the established pattern: one new prop.

```ts
// packages/excalidraw/types.ts
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

**Why the app and not the library.** `shiki` (the syntax highlighter the code card needs) is a dependency of `excalidraw-app`, not of `packages/excalidraw`. Moving the code card into the library would mean moving the dependency with it, and the library is published to npm. The library stays generic: it offers the hook, the app fills it.

## Part A — reformat as a code card

The app already has the machinery: `insertCodeIntoScene(api, rawCode, { fileName, language, at })` in `excalidraw-app/sidebar/insertIntoScene.ts`, which highlights the snippet and lays it out as real text elements on a dark card.

The reformat is therefore:

1. take the selected text elements **in the scene's order**;
2. join their texts with `\n`;
3. call `insertCodeIntoScene` with that text;
4. **delete** the original text elements.

**The language.** The code card's highlighter needs a language, and a selection has no filename to read one from. The app's `codeCard.ts` highlights with a fallback when the language is unknown, so the reformat may pass no language and get the plain card. If the app already has a language detector, use it; otherwise pass nothing and let the highlighter decide.

**The placement.** The card is placed where the selection was — the top-left of the selection's bounding box — so the reformatted content lands where the user was looking, not in the middle of the view.

## Part B — reformat as a table

There is no table renderer in the fork yet: the markdown _viewer_ renders HTML tables, but nothing turns text into a table on the canvas. This part writes one.

### Reading the cells

The pasted text is one element per **line**, and a markdown table's line is a whole row:

```
| Name  | Role     |
| ----- | -------- |
| Ada   | analyst  |
```

So the cells have to be recovered from each line's text. A line is split into cells by:

1. trimming it;
2. if it starts and ends with `|`, dropping those two pipes (a markdown row) and splitting on `|`; otherwise splitting on a **tab** (what a table copied from a spreadsheet or a PDF puts between cells);
3. trimming each cell.

A line whose cells are all dashes and colons (`| --- | --- |`) is the markdown **separator row** — it is not a row of the table, and it is dropped.

A line with a different number of cells than the table's width is a row with missing or extra cells; it is padded with empty cells (or truncated) so the grid stays rectangular.

### Laying the grid out

- The number of columns is the width of the **first** row (the header), after the separator row has been dropped. A header is the one row a markdown table always has.
- If there is no header (a plain tab-separated block), the width is the **most common** row length, so one stray line does not change the table's shape.
- Column widths are proportional to the widest cell in that column, with a floor and a ceiling so one long cell cannot make the table absurdly wide.
- Row heights follow the tallest cell in the row.
- The table is placed at the top-left of the selection's bounding box.

### Drawing the table

The owner asked for the table to be **drawn**. The cells are text elements; the table is a rectangle per cell, drawn behind them:

- one rectangle per cell, with a thin stroke and no fill (or the app's "table" fill), grouped with the cell's text so they move together;
- the rectangles are **behind** the text in the z-order, so the text reads on top of the grid.

The rectangles and the text are **replaced** for the original selection — the old text elements are deleted, and the new text elements take their place. The owner said the table should be "selectable", so the new text elements are ordinary, selectable text elements — not an image, not a locked group.

## The locked decisions

| Row | The decision in one line |
| --- | --- |
| D-21 | Reformatting is **one action over a selection** — "Reformat as…" in the canvas context menu, offering _Code card_ and _Table_ — and the library asks the app to do it through a new `onReformatSelection` prop. |
| D-22 | Reformatting **replaces** the selection: the original text elements are deleted and the reformatted content takes their place, at the selection's own position. |
| D-23 | A table is read from the pasted text by **recovering the cells from each line** (markdown pipes, or tabs for a spreadsheet/PDF copy), dropping the markdown separator row, and the table is **drawn** as a rectangle per cell behind ordinary, selectable text elements. |

## The files

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

| Row | What it checks | File |
| --- | --- | --- |
| AC-26 | The context menu offers **Reformat as…** on a selection of text elements, and not otherwise. | `excalidraw-app/tests/` |
| AC-27 | Reformatting as a **code card** replaces the selection with a highlighted code card at the selection's position. | `excalidraw-app/tests/` |
| AC-28 | Reformatting as a **table** recovers the cells from a markdown table (dropping the separator row) and produces a drawn grid of selectable text cells. | `excalidraw-app/tests/` |

## Rejected alternatives

- **Two separate context-menu entries.** Rejected: the owner's decision was one action offering both formats; two entries for one selection is noise.
- **Move the code card into the library.** Rejected: it would drag `shiki` into the published package.
- **Turn a pasted table into a table automatically, with no offer.** Rejected: the owner asked for an _option_, and a paste that silently changes shape is surprising.
- **Render the table as one image.** Rejected: the owner asked for the text to stay selectable.
- **Infer the table's structure from the pasted elements' positions.** Rejected: the pasted elements are one per line, stacked — their positions carry no column information. The cells have to come from the text.
