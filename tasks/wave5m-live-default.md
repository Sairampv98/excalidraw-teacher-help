---
id: wave5m-live-default
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: 
base: main
status: open
---

# Wave 5m — the live window is the default, and the presenter shows it

## Why this wave exists

The owner, testing on 2026-10-22, reported (in one message, three separate symptoms):

> "1. i need to click live editor (why is it not on by default) to check the output. dont u see the presenter doesnot show the editor view."
> "2. as u can see the vscode is visible in the normal editor but not visible on the presenter"

Measured in the real app: the code panel's header carries the toggle `Live window` / `Show the mirrored editor` — i.e. the panel is showing the **editor** and the live window is one click away. And in the presenter window the live view is **black**.

### The cause, read in the code

**Why it is not on by default.** `packages/excalidraw/scene/panelContent.ts:338`:

```ts
export const DEFAULT_CODE_PANEL_VIEW: CodePanelView = "editor";
```

Wave 5h made the native editor the default at the owner's request (D-83). The owner has now said the opposite: the live window is what they want to see. The default flips, and the flip must also reach the panels that **already exist** — their payload says `view: "editor"` because that is what the old default wrote, not because the teacher ever chose it.

**Why the presenter is black.** The live view's descriptor is **not** in the document and **not** in the element's payload. `excalidraw-app/bridge/useBridgePanel.ts:112-132` publishes it into the **library's own in-memory registry**, keyed by the panel element's id (`packages/excalidraw/scene/panelFrames.ts:89`, `setPanelCapture`). The registry lives in one JavaScript context. The presenter window is a **second context**, so its registry is empty, and the panel there has no live view to draw — which is a black region.

The presenter does get the **mirrored text** (that is written into the elements' payloads by `applyCodePanelState`), which is why the presenter's panel is not empty but simply has no live picture.

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-99 | the code panel's **default view is the live window**, and a panel the teacher never switched follows the default | locked | The owner asked for the opposite of D-83 on 2026-10-22 ("i need to click live editor (why is it not on by default) to check the output"), so `DEFAULT_CODE_PANEL_VIEW` becomes `"live"`. The default alone is not enough: wave 5h wrote `view: "editor"` into every panel's payload, and that was the **old default**, not a choice the teacher made. So the panel records whether the view was **chosen**: a panel whose payload carries no choice follows the default, and a panel the teacher switched keeps what the teacher switched to (D-83's promise — the teacher's choice survives a reload — stands, and gets stronger). The choice is a **flag beside** the view, not a second view string, so a payload written before this wave still loads. |
| D-100 | the editor publishes the live view's **descriptor** to the presenter, and the presenter writes it into its own registry | locked | The live view is a **descriptor** — the capture's state and the stream's URL — and it lives in the library's in-memory registry because a picture must never reach the document (D-82, D-85). The presenter is a second context, so it needs the descriptor **handed to it**. The editor publishes it over the **presenter channel** it already has (the same `BroadcastChannel` that carries the scene), and the presenter writes it into **the same registry** the editor uses (`setPanelCapture`, one call per bridge code panel). The URL carries the connection's **capability** (D-86) and the **session token is never in a URL** (D-50) — handing the descriptor to a **same-origin window the teacher opened** does not widen it: a `BroadcastChannel` is readable only by this origin's own pages. The capability still dies with its connection: when the bridge reconnects the editor gets a new URL and publishes it, and the presenter follows. A presenter that has heard nothing yet shows **why** (D-75), never a black rectangle. |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-137 | a new code panel shows the **live window**, and a panel the teacher switched keeps the teacher's choice | `packages/excalidraw/tests/codePanel.test.tsx` | The default flips, and the flip reaches the panels that already exist (D-99). Tests: `AC-137 a new code panel shows the live window by default`, `AC-137 a panel the teacher switched to the editor keeps the editor across a reload`. |
| AC-138 | the **presenter** shows the live window, and says why when it has nothing to show | `excalidraw-app/tests/presenterPanels.test.tsx` | The presenter writes the editor's descriptor into its own registry (D-100). Tests: `AC-138 the presenter shows the live window from the editor's descriptor`, `AC-138 a presenter with no descriptor says why instead of showing black`. |

---

## The file map (read before writing)

- `packages/excalidraw/scene/panelContent.ts:330-410` — `CodePanelView`, `DEFAULT_CODE_PANEL_VIEW`, `readPanelView`, `withPanelView`, `panelViewUpdate`, `codePanelContent`.
- `packages/excalidraw/scene/panelFrames.ts:80-110` — `setPanelCapture` / `getPanelCapture`, the registry.
- `packages/excalidraw/components/PanelOverlay.tsx` — `CodePanelSurface`, where the toggle writes the view.
- `excalidraw-app/bridge/codePanel.ts:180-235` — `toPanelCapture` (the descriptor), `bridgeCodePanelIds`.
- `excalidraw-app/bridge/useBridgePanel.ts:100-165` — `publishCapture`, the only place the descriptor is published today.
- `excalidraw-app/presenter/presenterChannel.ts:140-160` — the `PresenterMessage` union; the new message goes beside `presenter:files-request`.
- `excalidraw-app/presenter/usePresenterBroadcaster.ts` — the editor's side of the channel.
- `excalidraw-app/presenter/PresenterView.tsx:250-310` — the presenter's side, where `presenter:files` is handled.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency** anywhere.
- **Text in `packages/excalidraw/locales/en.json`**, never in a component.
- LF endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits — run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-137 ...`), or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: at minimum, put the default back to `"editor"` (AC-137 must fail), and stop the editor publishing the descriptor (AC-138 must fail).
- The scope is `excalidraw-app`, `packages/excalidraw` and `SPEC.md`. Nothing else may be touched. If a change needs a path outside that, **say so in the note** rather than reaching for it.

## The gates

`node scripts/tins-gate.mjs` must pass 4/4 (typecheck, eslint, prettier, vitest) and `node scripts/rowcheck.mjs --all` must exit 0. The kit's own SPEC lint must pass. In the close note, report **measured** evidence: the panel's header before and after (the toggle's own label and which view a fresh panel opens on), and the presenter's registry before and after.

