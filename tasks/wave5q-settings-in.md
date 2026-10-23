---
id: wave5q-settings-in
paths: packages/vscode-bridge,excalidraw-app,SPEC.md
read: 
base: main
status: open
---

# Wave 5q — the settings come with the extension, and the token survives a reload

## Why this wave exists

The owner asked, on 2026-10-23:

> "cant u just edit and recreate the .vsix with these backed in?
> { "excalidraw-bridge.token": "<the token the bridge panel shows>",
>   "excalidraw-bridge.ocrEngine": "paddle",
>   "excalidraw-bridge.pythonPath": "C:\\Users\\user\\.pyenv\\pyenv-win\\versions\\3.12.10\\python.exe" }"

Two of those three can be shipped **in the extension**, and the third must not be - but the
friction it was meant to remove can be removed a better way.

### What can be baked in

`excalidraw-bridge.ocrEngine` and `excalidraw-bridge.pythonPath` are **settings**, and a
`.vsix` carries **defaults** for settings. The extension's manifest already declares both
(`configuration.properties`, in `packages/vscode-bridge/extension/package.json`), with the
defaults `tesseract` and `python`. Shipping the owner's values as the **defaults** means:
install the extension, and it is already configured. No `settings.json` to edit, no
mistyped path.

### What must not be baked in

`excalidraw-bridge.token` is a **secret**, and the `.vsix` is a build artifact that lives in
a **public GitHub repository** (`Sairampv98/excalidraw-teacher-help`). Shipping a token
inside it would **publish** the secret - and it would not even help, because the token's
purpose is to be **per-session** (D-50): the extension generates a new one when the setting
is empty, and the web app holds its own copy **in memory only**
(`excalidraw-app/bridge/bridgeSession.ts`: "the token lives in this closure and nowhere
else: it is never written to `localStorage`, never put in the URL and never put in the
document").

So the token stays a secret the teacher owns, and the **friction** goes instead:

- The extension's own setting already persists it - the teacher sets it **once** in VS Code's
  settings UI (Ctrl+, then search `excalidraw-bridge.token`), which is a paste into a text
  box, not a hand-edited JSON file.
- The **app** asks for the token on every page load, because the app's copy is in memory.
  That is the part worth fixing: the token should live for the **tab's session**, so a
  reload does not ask again.

---

## The decisions to record in `SPEC.md`

Add these rows to the Decisions table, in the established shape
`| D-n | <label> | locked | <detail> |`:

| D-110 | the extension ships the **engine and the Python path** as its defaults, so installing it is enough | locked | A setting's value lives in the user's settings; a **default** lives with the extension, and VS Code takes the default when the user has not chosen a value. So the two settings that name *this machine's* tools - the OCR engine and the interpreter the Python engines run in - are the extension's to ship: the manifest declares them with the owner's values, and VS Code applies them until the teacher overrides them. The **token** is the one setting the extension must NOT ship: it is a **secret**, the `.vsix` is a **published** artifact (it lives in a public repository), and the token's whole purpose is to be **per-session** (D-50) - so it stays the teacher's, set once in the settings UI. The rule this records: **a setting that names a tool ships with the extension; a setting that holds a secret never does.** |
| D-111 | the app's token lives for the **tab's session**, so a reload does not ask for it again | locked | The app holds the token in a closure and nowhere else (D-50): never in `localStorage`, never in a URL, never in the document. The cost of that strictness is that **every page reload** asks the teacher to paste the token again - and the teacher reloads the page often (the extension changes, the dev server restarts). The browser already has a memory that is exactly right for this: **`sessionStorage`**, which belongs to the **tab**, survives a reload, and is dropped when the tab closes. It is still not `localStorage` (which would outlive the tab and the session), still not a URL, still not the document - so the secret's blast radius is unchanged, and the paste becomes **once per tab** instead of once per reload. The token is still never written to the document, never put in a URL, and still dies with the tab. |

### The acceptance rows

Add to the acceptance table, in the shape
`| AC-n | <label> | \`<check file>\` | <detail> |`:

| AC-147 | the extension's manifest ships the engine and the Python path as its defaults, and ships **no** token | `packages/vscode-bridge/tests/vsix.test.ts` | The settings come with the extension (D-110). Tests: `AC-147 the manifest's default engine is paddle and the default Python path is the owner's interpreter`, `AC-147 the manifest ships no token value`. |
| AC-148 | the app's token survives a reload and dies with the tab | `excalidraw-app/tests/bridgeSession.test.ts` | The paste becomes once per tab (D-111). Tests: `AC-148 the token is restored from the tab's session memory after a reload`, `AC-148 the token is never written to localStorage and never appears in a URL`. |

---

## The file map (read before writing)

- `packages/vscode-bridge/extension/package.json` - `contributes.configuration.properties`
  (the `default` of each setting) and `contributes.configurationDefaults` (VS Code's
  contribution point for shipping defaults; set both, so the value applies whichever
  mechanism the editor uses).
- `packages/vscode-bridge/extension/src/extension.ts` - where the extension reads the
  settings and where the token comes from; the token must still be **generated** when the
  setting is empty.
- `packages/vscode-bridge/tests/vsix.test.ts` - the manifest's own test.
- `excalidraw-app/bridge/bridgeSession.ts` - `createBridgeSession`, `setToken`,
  `pasteToken`, `connect`, and the closure that holds the token.
- `excalidraw-app/bridge/useBridgePanel.ts` - `onTokenChange`, `onPasteToken`, `onConnect`.
- `excalidraw-app/tests/bridgeSession.test.ts` - the session's own test.

## The constraints

- **Spec first.** The rows above go into `SPEC.md` **before** the code.
- **No new dependency.**
- **The token is never in a URL, never in the document, never in `localStorage`**, and never
  in the built `.vsix`. The extension's own setting keeps its value in the user's settings.
- `sessionStorage` may be **unavailable** (a private window, a blocked storage API): the app
  must then behave exactly as it does today - the teacher pastes the token and it works.
- LF line endings, no BOM, `yarn` only.
- `yarn test:app` is bare `vitest` and never exits - run `npx vitest run <file> --watch=false`.
- Every acceptance row's check file must **mention the row id in a test name** (`AC-147 ...`),
  or `node scripts/rowcheck.mjs --all` fails.
- **Teeth**: put the old defaults back and show AC-147 fails; take the token out of the
  session memory and show AC-148 fails.
- The scope is `packages/vscode-bridge`, `excalidraw-app` and `SPEC.md`. Nothing else may be touched.

## The gates and the real proof

`node scripts/tins-gate.mjs` must pass 4/4 and `node scripts/rowcheck.mjs --all` must exit 0.

**The real proof**: rebuild the `.vsix` (`node packages/vscode-bridge/scripts/build-vsix.mjs`),
and report in the close note:
- the size of the built `.vsix`,
- that `excalidraw-bridge.ocrEngine` and `excalidraw-bridge.pythonPath` read the new
  defaults out of the **built** package's `package.json` (not the source),
- that **no token value** appears anywhere in the built package (grep the `.vsix`'s
  `package.json` and the extension's `out/extension.js` for a token value).

Do NOT install the `.vsix` into the owner's editors and do NOT push - the parent does that.

