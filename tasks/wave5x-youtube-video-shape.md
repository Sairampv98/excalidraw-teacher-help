---
id: wave5x-youtube-video-shape
paths: packages/excalidraw,SPEC.md
base: main
status: merged
---

# Wave 5x — the YouTube video must keep its 16:9, and the caption note must not squeeze it

## Why this wave exists

Wave 5s shipped a YouTube video as a panel: an **iframe of YouTube's own player** (D-128) and
the captions in **three tiers** (D-129). The wave passed its gates and its real proof, and the
caption path works against the **installed** `.vsix` in a real VS Code.

But the live pass in a real browser found a defect the tests could not see, and it is the kind
the owner WILL see the moment they play a video in a classroom:

**the YouTube player is squashed.**

The panel is 480x270 scene units (16:9). The caption note is stacked **below** the iframe and
takes **130** of those 270 units - so the iframe is only **480x140**, a **3.45:1** box. YouTube's
player fills it, so the video is **stretched horizontally**: the teacher sees a wide, squashed
picture instead of a 16:9 one.

Measured in the real app on this machine (Chrome, `http://localhost:47311/`, a real YouTube id):

| what | measured |
| --- | --- |
| the panel | 480 x 270 |
| the iframe | **480 x 140** (3.45:1) |
| the caption note | 480 x **130** (5 lines of 12px text) |
| the player's own aspect | 16:9 - so it is stretched, not letterboxed |

The screenshot shows it plainly: the thumbnail and the play button are visibly wider than tall.

**The rule this wave records:** the video is the panel. A caption note is an **annotation**, and
an annotation never takes the picture's space.

### What is NOT wrong (do not "fix" these)

- The iframe's `src` is built from the **video id** alone (`youtubeEmbedUrl`), there is no URL and
  no scraped markup in the payload. **Keep it that way.**
- The note's **text** is the extension's own reason, and it names the remedy. **Keep it.**
- The three tiers work end to end against the installed extension. **Keep them.**

## The rows to add to SPEC.md

Add to the Decisions table, in the established shape `| D-n | <label> | locked | <detail> |`:

| D-131 | the YouTube video keeps its **whole** panel, and the caption note **floats over** it | locked | The panel is the **video**: it is 480x270, which is 16:9, and that is the aspect YouTube's own player renders at. The caption note is an **annotation** about the video, not a second thing beside it, so it **overlays** the video's top edge instead of taking a row of the panel: the iframe fills the panel (`position: absolute; inset: 0`) and the note is `position: absolute` over it. The rule: **an annotation never takes the picture's space** - a teacher who plays the video in a classroom must see the whole 16:9 picture, and the note is told to the side of it, not at the cost of it. |
| D-132 | the caption note is **one line**, and the whole reason is its **tooltip** | locked | The reason is a **sentence** - "no captions: the YouTube API key is not set and the public timedtext endpoint gave nothing back. Set excalidraw-bridge.youtubeApiKey to read them" - and at the panel's width it is **five lines**. Five lines of overlay would cover a third of the video, so the note is **one line with an ellipsis**, and the **whole** reason is the note's `title`: the tooltip says it all, the line says what fits. The rule: **a long reason is shown in the tooltip, and the line carries the short truth** - and the short truth here is the beginning of the reason, which is the part that matters ("no captions: the YouTube API key is not set..."). |

Add to the acceptance table, in the shape `| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-171 | the YouTube panel's iframe **fills** the panel, and the note **overlays** it | `packages/excalidraw/tests/youtubePanel.test.tsx` | The video is the panel (D-131) and the note is an annotation (D-131, D-132). Tests: `AC-171 the youtube iframe fills the whole panel`, `AC-171 the caption note overlays the video and carries the whole reason as its tooltip`. |

## The files to change

- `packages/excalidraw/css/styles.scss` - the `.excalidraw__panel-youtube`, `...-frame` and
  `...-note` rules.
- `packages/excalidraw/components/PanelOverlay.tsx` - the `YoutubePanelSurface`: the note gets
  the `title` attribute, and the note is rendered **over** the video rather than beside it.
- `packages/excalidraw/tests/youtubePanel.test.tsx` - the AC-171 tests.

`packages/excalidraw/locales/en.json` only if a NEW string is needed. Do not add one if the
existing strings already say everything.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency.**
- The panel's **payload** does not change: the note's text is still the extension's reason, and
  the tier is still what the panel reads. This wave is **layout only**.
- The iframe keeps `pointer-events` as it is, and the note must **not** swallow the teacher's
  clicks on the video: the note is `pointer-events: none` where it overlays the picture, OR it
  is small enough not to matter. Say which you chose and why.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF line endings, no BOM, `yarn` only.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof, beyond the tests**: in a **real browser**, a panel holding a real YouTube id
shows the player at **480 x 270** (the iframe's rect equals the panel's rect), the note is
**one line** and sits **over** the video, and the video is visibly **16:9**. Measure it and
report the numbers.

**The teeth check** (the kit's rule, and it is the only proof that matters): revert the fix and
the AC-171 tests must **fail** with the squashed numbers (the iframe at 480 x 140, the note
taking the panel's row). Restore the fix and they must pass again. Report both failures verbatim.
