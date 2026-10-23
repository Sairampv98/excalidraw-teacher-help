---
id: wave5p-chrome-collapse
paths: packages/excalidraw,excalidraw-app,SPEC.md
base: main
status: merged
---

# Wave 5p — the chrome's icon-only buttons must not collapse

## Why this wave exists

Wave 5n added the screenshot button to a panel's chrome. It was **measured** in the app
after 5n merged, and the button came out **zero pixels wide** — unclickable. This is the
same class of defect the owner complained about on 2026-10-22 ("there is a extra options
panel and i dont undertand y there are unclickable buttons"), and it survived the unit
tests because **jsdom does not lay out flexboxes**: the test read the button's inline
`width` and called it 24x24 on screen, while the browser laid it out at 0.

### What the browser actually measured

In the owner's own app (`http://localhost:3001/`, main at `c40f3e8`), at 10% zoom:

```
button: <button class="excalidraw__panel-screenshot-button" data-testid="panel-screenshot-button"
                style="width: 233.167px; height: 233.167px; font-size: 116.584px;">
  getBoundingClientRect()  ->  width 0, height 24        <- the width is GONE
  computed width           ->  1.33333px
  the svg inside           ->  width 0, height 139.094px
```

The inline width is right (233.167 panel units = 24 screen px at this panel's scale), and
the **stylesheet** never gives the button a width of its own - so the width was lost in the
**layout**, not in the style.

### The cause

`packages/excalidraw/css/styles.scss`:

```scss
&__panel-screenshot-button {
  display: flex;
  ...
  svg { width: 60%; height: 60%; }
}
```

The button is a flex item of the panel's header, and its `flex` is `0 1 auto` - it may
**shrink**. Its content is an `<svg>` with a `viewBox` and **no intrinsic width**, and the
stylesheet sizes that svg with a **percentage** of the button. So:

1. the svg's width depends on the button's width, and
2. the button's width depends on its content (the svg).

That is a circular dependency, and the browser resolves it to **zero**. The button's
min-content width is 0, the header is tight (a long file name, a toggle and a button), the
flexbox shrinks the button to 0, and the icon disappears with it.

The two other chrome buttons - the video's **play** and **mute** - use the same
`chrome.buttonSize`, but they carry a **glyph** (`❚❚`, `▶`, `🔇`, `🔊`) as text, so their
min-content width is the glyph and they do not collapse. Only the **icon-only** button is
affected.

---

## The decision to record in `SPEC.md`

Add this row to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-108 | the chrome's **icon-only** buttons have a definite width that the flexbox may not shrink | locked | A chrome control that is sized for the **screen** (D-92) must be exactly that size on screen, and an icon-only button is the one case where a flexbox can quietly take that size away: the button's content is an `<svg>` with a `viewBox` and no intrinsic width, and the stylesheet sizes that svg in **percentages** of the button - so the button's width depends on its content and its content depends on its width, and the browser resolves the circle to **zero**. The fix is two rules, both mechanical: the button's **inline** style carries `flex-shrink: 0` (so the flexbox may not shrink a control whose size is already decided), and the stylesheet gives the icon an **absolute** size instead of a percentage (so it never depends on the button's width at all). The rule is the chrome's own: **a control's size is decided by `scene/panelChrome.ts` and nothing may take it away**. It is recorded here because jsdom cannot lay out a flexbox, so the check has to be a **style** check - the button's inline style must carry the rule - and because the defect was invisible to every unit test and only a real browser saw it. |

### The acceptance row

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-145 | the screenshot button keeps its width on screen, and it is **measured** in a real browser | `packages/excalidraw/tests/screenshot.test.tsx` | The button must not collapse (D-108). The unit test asserts the **style** that makes it impossible (the inline `flex-shrink: 0` and the width in panel units); the **on-screen** size is a separate, recorded measurement - jsdom cannot lay out a flexbox, so the screen measurement is made in the real app and recorded in the close note, not asserted by the test. Tests: `AC-145 the screenshot button's inline style keeps its width and cannot be shrunk`, `AC-145 the stylesheet gives the chrome's icon an absolute size, not a percentage`. |

### The second thing this wave fixes: the benchmark record lies about paddle

`excalidraw-app/ocr/benchmark-result.json` says:

```json
"paddle": {
  "name": "paddle",
  "available": false,
  "reason": "paddleocr is not installed - pip install paddleocr paddlepaddle. PaddlePaddle has no build for Python 3.14; it needs Python 3.12 or 3.13"
}
```

That was true when it was written (the benchmark ran under Python 3.14, which has no paddle wheel).
It is **false now**: the owner installed `paddleocr 3.7.0` / `paddlepaddle 3.3.1` under **Python 3.12.10**, and wave 5o measured it **for real** through the shipped sidecar:

| what | measured |
| --- | --- |
| the first read (the fast path crashed, the fall-back rebuilt the model) | **36,086 ms**, 54 lines, 658 chars read |
| the second read (the model reused, nothing rebuilt) | **30,601 ms** |
| the same through the **shipped** sidecar inside the built `.vsix` | **34,668 ms**, 54 lines, `mkldnn false` |

So add this row to the Decisions table:

| D-109 | the benchmark record must say **where** each engine was measured, and a number measured on another machine is still a number | locked | A record that says "paddle is unavailable" reads as a fact about paddle, and it is not one - it is a fact about the machine the record was written on (Python 3.14, no paddle wheel). The record therefore names, for every engine, **where** it was measured and **what** it was measured with, and an engine measured **elsewhere** is recorded with its numbers, its Python and its date, and is marked as such. A missing engine is still a **missing** engine on the machine that runs the benchmark - that stays "unavailable, and here is why" - but it is no longer allowed to stand as the engine's verdict. The benchmark's own test therefore checks that the record is **internally true** (every engine either carries measured numbers with its provenance, or says plainly that it could not be measured **here** and why), and not that a particular engine is absent. |

And this acceptance row:

| AC-146 | the benchmark record tells the truth about paddle, with its provenance | `excalidraw-app/tests/ocrBenchmark.test.ts` | The record must not claim paddle is unavailable when it was measured (D-109). Tests: `AC-146 the benchmark record names paddle as measured elsewhere, with its numbers and its Python`, `AC-146 the benchmark test passes whether or not an engine is installed here`. |

---

## The file map (read before writing)

- `packages/excalidraw/components/PanelOverlay.tsx:298-323` - `PanelScreenshotButton`, whose
  inline style is `width/height: chrome.buttonSize` and `fontSize: chrome.buttonFontSize`.
- `packages/excalidraw/css/styles.scss:454-475` - `&__panel-screenshot-button`.
- `packages/excalidraw/scene/panelChrome.ts` - the chrome's sizes (wave 5k). The fix does
  **not** change a size; it stops the size from being taken away.
- `packages/excalidraw/components/PanelOverlay.tsx:1160-1215` - the video's play and mute
  buttons, which use the same `chrome.buttonSize` and carry a glyph. They are the
  **control group**: check them, and give them the same rule if they need it.
- `excalidraw-app/ocr/benchmark-result.json` - the benchmark record that lies about paddle.
- `excalidraw-app/ocr/benchmark.mjs` - the script that writes it (the `paddle` entry and
  the `pythonEngines` list at line 376).
- `excalidraw-app/tests/ocrBenchmark.test.ts` - the test that reads the record; the
  assertion that says paddle is unavailable is the one to change.

## The constraints

- **Spec first.** The row above goes into `SPEC.md` **before** the code.
- **No new dependency**, no change to any size in `panelChrome.ts`.
- The fix must be in **both** places: the inline style (so it is testable and survives a
  stylesheet that has not loaded) and the stylesheet (so the rule is visible to a reader).
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-145 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: remove the `flex-shrink: 0` from the inline style and show the test fails; put
  the percentage back in the stylesheet and show the test fails; put the old "paddle is
  unavailable" claim back into the record and show AC-146 fails.
- The scope is `packages/excalidraw`, `excalidraw-app` and `SPEC.md`. Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof, beyond the tests**: measure the button in a **real browser** and record
the number in the close note. The app is running on `http://localhost:3001/` (the owner's
port) and on `http://localhost:47311/` (the parent's). In the browser, zoom the canvas to
10% and read:

```js
const b = document.querySelector('[data-testid="panel-screenshot-button"]');
b.getBoundingClientRect();   // width must be 24 (the chrome's size), NOT 0
```

Report the measured width at **two** zooms. If the width is still 0, the wave is not done.
