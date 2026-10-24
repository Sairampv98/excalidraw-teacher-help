---
id: wave6d-presenter-works
paths: excalidraw-app,SPEC.md
read: 
base: main
status: open
---

# Wave 6d — the presenter view works

## Why this wave exists

The owner's review of 2026-10-24, in their words:

> *"somehow the presenter view is dead this is what the failure is about"*

- and the screenshot they sent with it is the failure.

So the presenter view is **broken** and the owner has shown what broken looks like. The waves before
this one (5m - the presenter publishes the capture descriptor; 5d - the presenter) built the feature;
something since has broken it, or it was never working end to end.

### The rule this wave records

| D-141 | the presenter view **works**, and it is the same canvas the teacher is teaching | locked | The owner reported, with the failure in a screenshot, that *"somehow the presenter view is dead"*. A presenter view that does not open, or opens onto a different canvas than the teacher's, is worse than none: the teacher's students see something else. So the presenter view opens, shows the **same** scene and the **same** page, and its own controls work. The rule: **the presenter view is the teacher's canvas, seen by someone else.** |

## The rows to add to SPEC.md

**D-141 is already written** - it is in `SPEC.md` on the main branch. Do not add it again; do not
change it.

Add **one** acceptance row to the section **"### Wave 6d — the presenter view works"** in
`SPEC.md`, using the reserved id **AC-177**:

| Row | The acceptance | Check | Detail |
| --- | --- | --- | --- |

The shape is `| AC-n | <label> | \`<check file>\` | <detail> |` and the detail must name the test
names, which must themselves start with the row id - for example:
`Tests: \`AC-177 the presenter view opens and shows the current scene\`, \`AC-177 the presenter view
follows the page the teacher is on\`.`

## The files to change

- `excalidraw-app/presenter/PresenterView.tsx` - and whatever it needs beside it.
- `excalidraw-app/tests/presenter.test.tsx` - the AC-177 tests (create the file if it is not
  there).

`packages/excalidraw` is **not** in this wave's paths unless you find that the presenter cannot work
without a library change - in that case write it in the close note and stop.

## The constraints

- **Spec first**: the acceptance row goes in **before** the code.
- **No new dependency.**
- The presenter view must show the teacher's **same scene** and the **same page**, and follow the
  teacher when they move to another page (D-141).
- The presenter view's **own** controls must work. A control that does nothing is worse than no
  control (D-120).
- **Text in `packages/excalidraw/locales/en.json`** if the presenter needs a new string - put your
  new labels in a **new group called `presenter`** inside `labels`, so that other waves editing the
  `panel` group do not collide.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

Do NOT run `yarn test:app` bare: it is `vitest` in WATCH mode and never exits. Use
`npx vitest run <file> --watch=false`.

**The real proof, beyond the tests**: in a **real browser**, open the presenter view from the app's
menu, put a panel and a page on the canvas, and show that:

1. the presenter view **opens** at all - and say exactly what was broken before your fix;
2. it shows the **same** scene and the **same** page the teacher is on;
3. it **follows** the teacher when they move to the next page;
4. its own controls work.

Report what you saw and, above all, **the cause** of the failure - the owner needs to know why it
was dead, not only that it works now.

**The teeth check** (the kit's rule, and the only proof that matters): revert the fix and the
AC-177 tests must FAIL. Restore the fix and they must pass again. Report both failures verbatim.

