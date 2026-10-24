# Wave 6g — a page has a frame, a number and a size

## Why this wave exists

This is the **owner's decision** on the question that was open, in their words:

> *"pages visible frame can be toggled on/off with a page number etc (the same options one gets in
> the microsoft word, header/fotter -> page number thingy), ok include presets for width and height.
> (this should help the export page as now the format in which the text appears would be different
> based on the preset selected)"*

So, three things, and the model the owner gave is Microsoft Word's:

1. **A visible page frame**, which can be **toggled on and off**. Today a page has no frame at all:
   the page is an invisible rectangle, and the export is the page's content without a border.
2. **A page number**, the way Word puts a page number in the header or the footer. A number the
   teacher can show on the page.
3. **A size**: the page's width and height, chosen from **presets** - A4, Letter, 16:9, 4:3, and
   the 1920x1080 the project already uses - or by hand. The owner says why the size matters:
   *"this should help the export page as now the format in which the text appears would be different
   based on the preset selected"* - the exported image must have the **page's** shape, so the text in
   a 16:9 page is not the text in an A4 page.

### What is already true (do not change it)

- **Pages are separate entities** in the model: each page has its own id, its own elements, its own
  rectangle, and the layout is cumulative. All of them are currently **1920x1080**.
- **No page frame is drawn** today, and the "grow the page" control was **removed** after the
  owner's own 38-page test (a page that grows to fit its content is a page whose shape is a
  consequence of what is on it, which makes the export unpredictable).

### The rule this wave records

| D-144 | a page has a **frame**, a **number**, and a **size** | locked | The owner's answer, and the model for it is Microsoft Word's: *"pages visible frame can be toggled on/off with a page number etc (the same options one gets in the microsoft word, header/fotter -> page number thingy), ok include presets for width and height. (this should help the export page as now the format in which the text appears would be different based on the preset selected)"*. So a page may be drawn with a visible **frame**, may carry a **page number**, and has a **size** the teacher picks - from **presets** (A4, Letter, 16:9, ...) or by hand - and the preset changes the **export**, because the text in a 16:9 page is not the text in an A4 page. The rule: **the page's shape is a fact about the page, and the export must honour it.** |

## The rows to add to SPEC.md

**D-144 is already written** - it is in `SPEC.md` on the main branch. Do not add it again; do not
change it.

Add **one** acceptance row to the section **"### Wave 6g — a page has a frame, a number and a size"**
in `SPEC.md`, using the reserved id **AC-180**:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

The shape is `| AC-n | <label> | \`<check file>\` | <detail> |` and the detail must name the test
names, which must themselves start with the row id - for example:
`Tests: \`AC-180 the page frame can be toggled on and off\`, \`AC-180 the page number can be shown\`,
\`AC-180 a size preset changes the page and the exported image\`.`

## The files to change

- `packages/excalidraw/scene/pages.ts` - the page's shape: its width, its height, whether the frame
  is drawn, and whether the number is drawn.
- `packages/excalidraw/components/App.tsx` (or wherever the page is rendered) - draw the frame and
  the number.
- `packages/excalidraw/actions/actionProperties.tsx` - the page's controls in the properties panel
  (the frame toggle, the number toggle, the size presets) - the same place the owner found the
  panel's properties.
- `packages/excalidraw/data/` - wherever the export takes the page's size from, so the export
  honours the preset.
- `packages/excalidraw/tests/pages.test.ts` - the AC-180 tests.
- `packages/excalidraw/locales/en.json` - the new labels, in a **new group called `pages`** inside
  `labels`, so that other waves editing the `panel` group do not collide.

## The constraints

- **Spec first**: the acceptance row goes in **before** the code.
- **No new dependency.**
- **The page's size is a fact about the page**, saved with the document, and the **export must
  honour it** (D-144). An export that ignores the preset is a bug.
- **Pages stay separate entities.** Do not merge them and do not give one page the elements of
  another.
- The page must still **scroll and pan** the way it does today (D-117), and the page bar must still
  work.
- The presets are a **short, fixed list** - say A4 (portrait and landscape), Letter (portrait and
  landscape), 16:9, 4:3, and the project's own 1920x1080 - plus a **free** width and height the
  teacher may type. The owner asked for presets, so the presets must be there; the free values are
  what the project already does for a page's size.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**:

1. the page's **frame** can be toggled on and off, and the frame that is drawn is the page's
   rectangle;
2. a **page number** can be shown, and it says the page's number;
3. picking a **size preset** changes the page's shape, and **exporting** the page produces an image
   with **that** shape - measure the exported image's width and height and report them.

Report the measurements.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-180 tests must FAIL. Restore the fix and they must pass again. Report both failures verbatim.
