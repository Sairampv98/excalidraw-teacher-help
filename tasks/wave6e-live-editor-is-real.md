---
id: wave6e-live-editor-is-real
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: 
base: main
status: open
---

# Wave 6e — the live editor is a real editor

## Why this wave exists

The owner's review of 2026-10-24, in their words:

> *"the live editor is weird i can see the text from the connection to vscode/vscodium scroll through
> that text, cannot select that text and paste it as a codeblock (same as when i select copy code or
> use the insert as code block in the markdown viewer), nor select the programming language of my
> choice, zoom in/ zoom out both the page and inside the editor (requires more scrolling is all)"*

So the mirrored text is **read-only**, and the teacher can do nothing with it:

1. **select** it and copy it - and paste it into the canvas **as a code block**, the way the
   markdown viewer's **Copy code** and **insert as code block** already do (that is the bar the owner
   set: *"the same as when i select copy code or use the insert as code block in the markdown
   viewer"*).
2. **choose the language** it is read as.
3. **zoom** inside the editor - the canvas's zoom is not the editor's zoom, and a long file is
   unusable without it.

The owner's last clause matters too: *"requires more scrolling is all"* - the editor is cramped, so
zooming inside it is part of the same complaint.

### The rule this wave records

| D-142 | the live editor is a **real editor**: the text can be selected, copied as a code block, and read in the language the teacher chooses | locked | The owner: *"the live editor is weird i can see the text from the connection to vscode/vscodium scroll through that text, cannot select that text and paste it as a codeblock (same as when i select copy code or use the insert as code block in the markdown viewer), nor select the programming language of my choice"*. So the mirrored text is **read-only** and the teacher can do nothing with it: not select it, not copy it as a code block, not read it as a chosen language, and not zoom into it for a long file. The rule: **text the teacher can see is text the teacher can take.** |

## The rows to add to SPEC.md

**D-142 is already written** - it is in `SPEC.md` on the main branch. Do not add it again; do not
change it.

Add **one** acceptance row to the section **"### Wave 6e — the live editor is a real editor"** in
`SPEC.md`, using the reserved id **AC-178**:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

The shape is `| AC-n | <label> | \`<check file>\` | <detail> |` and the detail must name the test
names, which must themselves start with the row id - for example:
`Tests: \`AC-178 the mirrored text can be selected and copied as a code block\`, \`AC-178 the editor's
language can be chosen\`, \`AC-178 the editor can be zoomed inside the panel\`.`

## The files to change

- `packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx` - the editor itself: the selection,
  the copy, the language, the zoom.
- `packages/excalidraw/components/PanelOverlay.tsx` - the code panel's editor region and the controls
  around it.
- `packages/excalidraw/tests/codePanel.test.tsx` - the AC-178 tests.
- `packages/excalidraw/locales/en.json` - the new labels, in a **new group called `editor`** inside
  `labels` - do not add keys to the `panel` group, another wave is editing it.

## The constraints

- **Spec first**: the acceptance row goes in **before** the code.
- **No new dependency.**
- The pasted result must be the **same code card** the markdown viewer's **Copy code** and **insert
  as code block** produce - the same look, the same card, not a row of plain bordered text boxes.
- The **teacher's own draft** (D-123) must not be damaged by any of this: if the teacher has edited
  the panel's text, that text is theirs.
- The mirror still **never overwrites** the teacher's draft (D-123).
- The editor's **zoom** is the editor's own - it does not move the canvas's zoom (D-117).
- The language the teacher chooses is the language the panel **reads** the file as; it must not
  change the file in the editor.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**, with a code panel connected to VS Code:

1. **select** a few lines of the mirrored text and copy them, and paste them on the canvas - show
   that the result is a **code card** (the dark card with the monospace), exactly like the markdown
   viewer's copy does;
2. **choose the language** the file is read as, and show that the choice sticks;
3. **zoom inside** the editor and show that the canvas's zoom does **not** move.

Report what you saw.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-178 tests must FAIL. Restore the fix and they must pass again. Report both failures verbatim.

