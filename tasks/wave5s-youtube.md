---
id: wave5s-youtube
paths: packages/excalidraw,excalidraw-app,packages/vscode-bridge,SPEC.md
base: main
status: merged
---

# Wave 5s — a YouTube video in the canvas, and its captions

## Why this wave exists

The owner asked on 2026-10-22, in the same message as the video defects:

> "how do u insert outube videos"

and on 2026-10-23:

> "why not build the youtube one also (is this prone to break with any update that youtube makes ? if so hold)"

**It is not prone to breaking — if it is built the right way, and the wrong way is the one we
refuse.** The two halves of the feature have different answers, and the difference is the
whole design:

| half | how | breaks on a YouTube update? |
| --- | --- | --- |
| **the video** | an **iframe embed** - YouTube's own player, inside the panel overlay | **no** - it is their player; there is no page to scrape and nothing of ours to update |
| **the captions** | the **official Data API v3**, with the teacher's own key | **no** - it is a versioned API |
| the captions, without a key | the public `timedtext` endpoint, **best effort** | yes, sometimes - and that is why it is the **second** tier, never the only one |
| the captions, with neither | `captions:none`, with the reason | no - it is an explicit state (D-91) |

The **fragile** version - scraping the watch page or the `timedtext` endpoint for a caption
track - is the one thing this wave must not depend on. So the captions have **three tiers**,
and the panel always says which tier answered.

The protocol **already exists**: `excalidraw-app/bridge/videoCaptions.ts` defines
`captions:request` (app -> bridge) and `captions:result` / `captions:none` (bridge -> app),
and the file says so itself: *"the YouTube path itself is not this wave's job ... What is in
scope here is the shape of the other path, so that the wave that fills it in does not have to
change the panel to add it."* **This is that wave.** The messages move into the shared
protocol module and the panel learns the new source - the caption **shape does not change at
all**, because the panel does not know where the cues came from.

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-128 | a YouTube video is an **iframe of YouTube's own player**, and the panel never parses YouTube's pages | locked | The panel is a DOM overlay, so it can host an `<iframe>` exactly as it hosts the live view's `<img>`. An iframe is the **supported** way to play a YouTube video in a web page, which means the video half of this feature has **no** YouTube-specific code that can rot: there is no endpoint to call, no markup to parse, no signature to compute. The panel holds a **video id**, not a URL - the id is the only thing YouTube's own player needs - and the embed URL is built from it. The video therefore keeps working when YouTube changes anything, because nothing of ours talks to their pages. |
| D-129 | the captions have **three tiers**, and the panel says which tier answered | locked | The captions are the fragile half, so they are **best effort with an honest report**. Tier one: the **official Data API v3** with the teacher's own key (`excalidraw-bridge.youtubeApiKey`) - a versioned API, and for the teacher's **own** channel the captions are authorised by the owner, so this tier really works. Tier two: the **public `timedtext` endpoint**, best effort, and often empty for auto-generated captions. Tier three: **`captions:none`**, with the reason. The tier that answered travels with the answer, so the panel can say *"these captions came from the public endpoint, which may be incomplete"* or *"no captions: the API key is not set"* - and the teacher is never left guessing why a video has no text. The rule: **a feature that depends on someone else's page must degrade in tiers, and must say which tier it is on.** |
| D-130 | an iframe panel takes the **focus** only while the teacher is using it, and gives it back | locked | Every other panel's content is an `<img>` or a `<video>`: they take the focus, and the canvas gets it back. An **iframe** is different - clicking it moves the focus into YouTube's document, and the whiteboard's keyboard (Ctrl+V, the arrow keys, Delete) stops reaching the canvas while it does. So the iframe panel follows the **same rule the sidebar already follows** (D-73): the panel takes the focus **while the teacher is inside it** and gives it back when the pointer leaves - the canvas takes the focus back, and the iframe's focus is blurred. The teacher's typing goes to the video while they are in it, and to the whiteboard the moment they are not. That is the whole rule: **a foreign document may borrow the focus, never keep it.** |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-168 | a YouTube video plays as an **iframe**, and the panel holds only the video id | `packages/excalidraw/tests/youtubePanel.test.tsx` | The video half cannot rot (D-128). Tests: `AC-168 the panel renders the youtube embed for the video id it holds`, `AC-168 the panel holds no youtube url and no scraped markup`. |
| AC-169 | the captions answer says **which tier** answered, and "no captions" says why | `packages/vscode-bridge/tests/youtubeCaptions.test.ts` | The captions degrade in tiers and say so (D-129). Tests: `AC-169 a caption answer carries the tier that produced it`, `AC-169 a video with no captions answers with the reason`. |
| AC-170 | the iframe panel **gives the focus back** when the teacher leaves it | `packages/excalidraw/tests/youtubePanel.test.tsx` | A foreign document borrows the focus, never keeps it (D-130). Tests: `AC-170 the canvas takes the focus back when the pointer leaves the iframe panel`. |

---

## The file map (read before writing)

- `excalidraw-app/bridge/videoCaptions.ts` - the protocol types that already exist; they move
  into `packages/vscode-bridge/bridge/src/protocol.ts` (the shared module) and **do not change
  shape**.
- `packages/vscode-bridge/bridge/src/protocol.ts` - the one definition of the protocol.
- `packages/vscode-bridge/extension/src/` - the extension's side: the request handler, the
  three caption tiers, and a new setting `excalidraw-bridge.youtubeApiKey`.
- `packages/vscode-bridge/extension/src/ocrEngine.ts` - the pattern to follow: a request that
  goes out to a helper and an answer that carries **which engine ran and how long it took**
  (D-90, AC-125). The caption answer carries **which tier** answered.
- `packages/excalidraw/scene/panelContent.ts` - the panel's `source` variants; a
  `{ type: "youtube", videoId }` variant goes beside the existing ones.
- `packages/excalidraw/components/PanelOverlay.tsx` - the panel surfaces; the iframe surface
  goes beside the code and video surfaces, and it takes the focus the way D-130 says.
- `excalidraw-app/sidebar/FilesTab.tsx` - where a YouTube link is pasted and the panel is
  created (beside "Open files").
- `packages/excalidraw/locales/en.json` - every new sentence.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency**: the extension fetches with Node's **built-in** `fetch` (VS Code
  1.91 ships Node 20). The iframe is plain HTML.
- The **library** must not know what YouTube is: the panel's content is a video id and the
  embed URL is built from it, the same way the live view's URL is built from its capability.
- The caption **shape does not change** - the panel must not know where the cues came from.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-168 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: at minimum, make the caption answer carry no tier and show AC-169 fails; make the
  iframe panel keep the focus and show AC-170 fails.
- The scope is `packages/excalidraw`, `excalidraw-app`, `packages/vscode-bridge` and `SPEC.md`.
  Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof, beyond the tests**: in a **real browser**, a panel holding a real YouTube id
renders the embed and the embed loads (network + DOM, not jsdom), and the caption request
reaches the extension and comes back as one of the three tiers. Report what you measured in
the close note, and say plainly if the network could not reach YouTube from this machine.
