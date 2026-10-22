---
id: wave5h-native-editor
paths: packages/excalidraw,excalidraw-app,SPEC.md
read: SPEC.md,packages/excalidraw/scene/panelContent.ts,packages/excalidraw/components/PanelOverlay.tsx,packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx,packages/excalidraw/components/PanelChrome.tsx,packages/excalidraw/scene/panelFrames.ts,excalidraw-app/sidebar/codeCard.ts
base: main
status: open
---

Wave 5h: the NATIVE editor is the code panel's default again, and it knows the language.

WHY THIS WAVE EXISTS
The owner asked two things in one breath:

1. "what happened to native code editor inside the canvas which was the fallback lets make it default" - the CodeMirror editor inside the code panel was the FALLBACK for the live window stream (wave 5g) and it became the fallback. It goes back to being the DEFAULT, and the live window becomes the opt-in alternative.
2. "day 1 support for javascript, java, python, c, c++ and rust languages" - the editor must highlight those six languages properly, from day one.

AND THE MEASURED REASON WHY #2 IS NEEDED: the editor applies ONE grammar to everything, and that grammar is the hand-written MERMAID one. So a Python file is highlighted as if it were a mermaid diagram: `def` and `import` are matched by the "Node IDs (alphanumeric)" rule and come out as VARIABLE names, not keywords. That is the bug the owner is seeing. The mermaid grammar belongs to the text-to-diagram dialog, which is the only thing that speaks mermaid.

THE TWO FACTS THAT SHAPE EVERYTHING (already verified - do not re-derive them)

1. THE CODE CARD IS ALREADY FINE. The card that paste creates in the canvas is NOT a CodeMirror editor: it is canvas TEXT ELEMENTS, coloured by SHIKI in the app (`excalidraw-app/sidebar/codeCard.ts` - `highlightCode(code, language)` -> `codeToTokens(code, { lang, theme: "dark-plus" })`, with an alias table `LANGUAGE_ALIASES` at `:51-78` and `normalizeLanguage` at `:81-99`). Shiki bundles VS Code's own TextMate grammars, so the CARD already has real highlighting for javascript, java, python, c, cpp and rust. This wave is about the PANEL's editor, not the card. Do not change the card.

2. THE PANEL'S EDITOR IS THE ONE THAT IS WRONG. `packages/excalidraw/components/TTDDialog/CodeMirrorEditor.tsx:292` applies `mermaidLite()` UNCONDITIONALLY to every CodeMirror instance. There is no `language` prop on `CodeMirrorEditorProps` (`:35-49`). The only two call sites are the TTD dialog input (`TTDDialogInput.tsx:101-113`) and the code panel (`PanelOverlay.tsx:233-241`). The panel's mirror has no language at all - `CodePanelEditor` takes only `{ value }` (`:196`) and never sees `state.editor.language`.

THE LANGUAGE STRING IS ALREADY THERE, UNUSED
The bridge sends VS Code's `document.languageId` verbatim:
- the extension: `packages/vscode-bridge/extension/src/editorState.ts:62` -> `language: document.languageId`
- the protocol: `packages/vscode-bridge/bridge/src/protocol.ts:104-112` -> `language: string`
- the app reducer: `excalidraw-app/bridge/codePanel.ts:55-65` -> `state.editor.language = message.language`
- the payload: `packages/excalidraw/scene/panelContent.ts:277-283` -> `editor: { uri, language, text, selection, version }`
- rendered (as text only): `packages/excalidraw/components/PanelOverlay.tsx:334-342` -> the `code-panel-language` span.

So the panel ALREADY knows the file is `python`. It just never tells the editor.

The values are VS Code language ids: `python`, `java`, `javascript`, `javascriptreact`, `typescript`, `typescriptreact`, `c`, `cpp`, `rust`, `plaintext`, ...

PART A - THE NATIVE EDITOR IS THE DEFAULT, THE LIVE WINDOW IS OPT-IN

A1. THE PANEL SHOWS THE EDITOR UNLESS THE TEACHER ASKS FOR THE LIVE VIEW.
Today the condition is exactly one expression, at `PanelOverlay.tsx:360`:
    {capture?.status === "live" ? (<img data-testid="code-panel-live-frame" .../>) : (hasFile ? <CodePanelEditor .../> : <no-editor/>)}
The live frame wins AUTOMATICALLY and unconditionally whenever the bridge produced one. That is the opposite of what the owner wants.

The new rule: the panel's VIEW decides.
- view = "editor" (THE DEFAULT) -> the mirrored text, in the editor, with the file's own grammar.
- view = "live" -> the live frame when a capture is live; when there is no capture, the text mirror AND the reason (the existing `code-panel-live-status` block at `:397-408`), because a fallback the teacher cannot explain is a broken panel (D-75).
- The reason line is shown ONLY in the live view. In the default view there is nothing to explain - the teacher did not ask for the live view.

A2. THE VIEW IS A PROPERTY OF THE PANEL, and it is persisted.
It lives beside the code panel's live state, in the code panel's own widening of the payload - NOT in the shared `PanelContent.options` and NOT in `packages/element`. The code panel already widens the payload that way: `CodePanelContent = PanelContent & { code: CodePanelState | null }` at `packages/excalidraw/scene/panelContent.ts:306-309`, written by `withCodePanelState` (`:357`) and read by `readCodePanelState` (`:344`). Add `view` the same way:
- `CodePanelContent` gains `view?: "editor" | "live"`.
- `codePanelContent(state, sessionId)` (`:326`) sets it to "editor" when it creates the panel.
- ONE writer and ONE reader, like `withCodePanelState` / `readCodePanelState`: `withPanelView(content, view)` and `readPanelView(content)`. `readPanelView` returns "editor" for a payload that says nothing - the default must be the DEFAULT even for a panel that was created before this wave.
- The element update for the change, in the same style as `panelLockUpdate` / `panelUnlockUpdate` (`packages/excalidraw/scene/lockPanel.ts:81-95`): `panelViewUpdate(view)`. The write is `this.scene.mutateElement(element, panelViewUpdate(next))` - the same path the lock button uses (`App.tsx:3746-3763`).

A3. THE VIEW MUST SURVIVE THE BRIDGE'S OWN WRITES. `codePanelContent` (`:326-337`) creates `options` fresh, and `withCodePanelState` does `{ ...content, code: state }` - so `view` survives a state update, as long as the writer is written that way. There MUST be a test that a bridge state update does not wipe the view, because the bridge writes the panel's payload on every keystroke in the teacher's editor.

A4. THE TEACHER FLIPS THE VIEW FROM THE PANEL ITSELF.
Put the toggle in the panel's OWN header - the `code-panel-header` div (`PanelOverlay.tsx:317-354`), next to the file name and the language. NOT in `PanelChrome.tsx`: the chrome is only rendered for SELECTED panels (`App.tsx:3539-3546` filters on `selectedElementIds`), so a button there would be invisible until the panel is selected, and the teacher must be able to flip the view mid-class without selecting anything. The header is always mounted, because the whole overlay is.

The button:
- only for a bridge-backed code panel (`isBridgeCodePanel(panel)` - the same predicate the chrome uses at `PanelChrome.tsx:246`),
- it says which view is on and what clicking does (an i18n label; the label keys are NEW),
- it writes the new view through the library's own write path, so the host app owns the write - the same shape as the lock button's `onToggleLock(panelId)` -> `App.togglePanelLock` -> `mutateElement`.
- it is NOT rendered on a MIRROR (the presenter shows the host's view; it does not change it). `PanelOverlay` already has a `mirror?: boolean` prop.

The write path: `App.tsx` owns the change (it owns `togglePanelLock`), so App.tsx passes a callback down to `PanelOverlay`, which passes it to the surface. The callback takes the panel id and flips the view.

A5. THE I18N LABELS. `t()` falls back to `fallbackLangData` (en.json) when a key is missing in the current language (`packages/excalidraw/i18n.ts:140-143`), so adding the key to `packages/excalidraw/locales/en.json` is ENOUGH - the other 57 locale files fall back to English, and the type `NestedKeyOf<typeof fallbackLangData>` is satisfied by en.json alone. Add the keys to en.json only.

PART B - THE EDITOR KNOWS THE LANGUAGE

B1. A LANGUAGE REGISTRY, OWNED BY THE LIBRARY, FILLED BY THE HOST.
The published package `@excalidraw/excalidraw` must NOT gain five grammar dependencies - that would add megabytes to every consumer of the library. So the library exposes a REGISTRY and the APP fills it:

    // packages/excalidraw - the registry
    export type CodeMirrorLanguageLoader = () => Promise<Extension>;
    export const registerCodeMirrorLanguage = (id: string, load: CodeMirrorLanguageLoader): void => ...
    export const loadCodeMirrorLanguage = (id: string): Promise<Extension | null> => ...
    export const codeMirrorLanguageIds = (): string[] => ...

- The library registers "mermaid" ITSELF, at module load, with the existing `mermaidLite()` (`packages/excalidraw/components/TTDDialog/mermaid-lang-lite.ts`). The mermaid grammar is the library's own - it has no dependency - and the text-to-diagram dialog needs it.
- A language that is not registered resolves to NO grammar (plain text). That is CORRECT: an unknown language must not be highlighted as something it is not. Today every file is highlighted as mermaid, which is exactly the bug.
- The registry is exported from `packages/excalidraw/index.tsx` next to the other public exports (`:486-497` shows the panel-frame exports).

B2. THE APP REGISTERS THE SIX DAY-1 LANGUAGES, LAZILY.
The new dependencies go in `excalidraw-app/package.json` - the APP, not the library:

    "@codemirror/lang-cpp": "^6.0.3"        (C and C++)
    "@codemirror/lang-java": "^6.0.2"
    "@codemirror/lang-javascript": "^6.2.5"  (JavaScript, JSX, TypeScript, TSX)
    "@codemirror/lang-python": "^6.2.1"
    "@codemirror/lang-rust": "^6.0.2"

(those are the versions on the registry today - check them yourself with `npm view <pkg> version` before you write them.)

The app registers each one with a DYNAMIC import, so a grammar is only fetched when a file of that language is actually shown:

    javascript       -> import("@codemirror/lang-javascript").then(m => m.javascript())
    javascriptreact  -> import("@codemirror/lang-javascript").then(m => m.jsx())
    typescript       -> import("@codemirror/lang-javascript").then(m => m.typescript())
    typescriptreact  -> import("@codemirror/lang-javascript").then(m => m.tsx())
    java             -> import("@codemirror/lang-java").then(m => m.java())
    python           -> import("@codemirror/lang-python").then(m => m.python())
    c                -> import("@codemirror/lang-cpp").then(m => m.c())
    cpp              -> import("@codemirror/lang-cpp").then(m => m.cpp())
    rust             -> import("@codemirror/lang-rust").then(m => m.rust())

A new module in the app (e.g. `excalidraw-app/codeLanguages.ts`) does the registering, and it is imported by the app's entry point so the registration happens before any editor mounts. The library's own `mermaid-lang-lite` must NOT be registered by the app - the library owns it.

THE OWNER ASKED FOR THE SIX LANGUAGES; TypeScript and JSX come free with the JavaScript package, so register them too.

B3. THE EDITOR USES THE LANGUAGE.
- `CodeMirrorEditorProps` gains `language?: string`.
- The editor holds the grammar in its own `Compartment` (it already has one for the theme and one for the error line - `CodeMirrorEditor.tsx:250-251`). When the language changes, the new grammar is loaded (it is async) and the compartment is reconfigured. Until it resolves, the previous grammar stays - no flash of unhighlighted text, and never the WRONG grammar.
- The grammar is REMOVED when the language is unknown or empty, and the mermaid grammar is used for "mermaid".

B4. THE TTD DIALOG MUST KEEP ITS MERMAID GRAMMAR.
`TTDDialogInput` (`:101-113`) does not pass a language, so after B3 the dialog would lose its highlighting - a REGRESSION. The dialog is the text-to-diagram prompt, so it must pass `language="mermaid"`. `MermaidToExcalidraw.tsx:278-283` renders `<TTDDialogInput ...>` - either `TTDDialogInput` passes "mermaid" itself (it is the mermaid input) or the caller does. Say which you did in the report.

B5. THE PANEL PASSES THE FILE'S LANGUAGE.
`CodePanelSurface` has `state.editor.language` (the VS Code language id) and must hand it to the editor: `CodePanelEditor` takes `{ value, language }` and passes `language={language}` to the editor. The language string is VS Code's id and it is already canonical ("python", "java", "cpp", "c", "rust", "javascript"); the registry keys above are exactly those ids. The app's existing `normalizeLanguage` / `LANGUAGE_ALIASES` (`codeCard.ts:51-99`) is the CARD's shiki path and does not need to change - but if you want the two paths to agree on one id set, say so in the report; do not silently rewrite the card's alias table.

B6. THE GRAMMAR MUST NOT BE A SECOND COPY OF THE LIBRARY'S DEPENDENCY.
`@codemirror/lang-*` v6 depends on `@codemirror/language` v6, which depends on `@codemirror/state` v6 - the same `@codemirror/state` the library already has. If the typecheck complains that a `LanguageSupport` is not an `Extension`, it is because the app resolved a SECOND copy of `@codemirror/state`: fix it by making the app resolve the same one (add the matching `@codemirror/state` to `excalidraw-app/package.json` so yarn dedupes). Do NOT paper over it with `any` or a cast - the grammar and the editor must share one CodeMirror instance or the highlighting will not work at all.

SPEC.md
Add D-83 and D-84 to the Decisions table, and the acceptance rows AC-106 to AC-112. AC-101 and AC-103 are AMENDED, not replaced - their substance survives, but the live view becomes opt-in, so their text and their tests must say so:
- AC-101 the panel draws the editor window live, at the frame's own aspect ratio - AMENDED: the live view is OPT-IN (the teacher turns it on), and when it is on the panel draws the frame at the frame's own aspect ratio.
- AC-103 with no ffmpeg, or with the capture stopped, the panel falls back to the mirrored text and says why - AMENDED: IN THE LIVE VIEW, with no capture, the panel falls back to the text and says why. In the default view the panel shows the editor and there is nothing to explain.
Their existing TESTS (AC-101 at `packages/excalidraw/tests/codePanel.test.tsx:459-520`, AC-103 at `:563-602`) encode the OLD behaviour - AC-101 asserts `.cm-editor` is NULL when a frame is live. They must be updated to turn the live view ON first, and the amendment must be visible in the SPEC text.

The new rows:
- AC-106 the code panel's DEFAULT view is the native editor, and the live window is opt-in: with a live capture arriving and the view left alone, the panel shows the EDITOR (`.cm-editor` present, no `code-panel-live-frame`).
- AC-107 the teacher can turn the live view on from the panel, and the panel then draws the frame; turning it back returns the editor. The choice is the panel's own, it is persisted in the panel's payload, and it survives a bridge state update.
- AC-108 the editor's grammar follows the file's language: a file VS Code calls `python` is highlighted with the PYTHON grammar, not the mermaid one - `def` is painted as a keyword (the VS Code keyword colour), not as a variable name. This is the symptom the owner reported, so the test must be able to tell the two apart.
- AC-109 the mermaid grammar is used for MERMAID only, and the text-to-diagram dialog keeps it (no regression).
- AC-110 a language that is not registered gets NO grammar - an unknown file is plain text, never highlighted as something it is not.
- AC-111 the six day-1 languages are registered by the app: javascript, javascriptreact, typescript, typescriptreact, java, python, c, cpp, rust. Each is a dynamic import, so a grammar is only fetched when it is needed.
- AC-112 the library's own package.json gains NO dependency: the grammars are the APP's, and the library reaches them through the registry.

Each acceptance row needs a test file, and the check file MUST mention the row id in the test name, for example `it("AC-106 the code panel's default view is the native editor", ...)`. The kit SPEC lint reads the file and fails if the id is absent. AC-106..AC-112 are RESERVED for this wave.

RULES THAT ARE NOT NEGOTIABLE
- yarn, never npm or bun. The ONLY new dependencies are the five `@codemirror/lang-*` packages in `excalidraw-app/package.json`, and the owner has asked for exactly these languages. The library's package.json gains NONE.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula.
- Run the focused tests with npx vitest run <file> --watch=false. NEVER leave vitest in watch mode.
- The gate: node scripts/tins-gate.mjs - all four must pass and the summary must show fail 0.
- node scripts/rowcheck.mjs --all - your new rows must be green.
- The gate runs prettier as --list-different, NOT --write: a file that is not already formatted FAILS the gate. Run node_modules\.bin\prettier --write on the files you touched, then --list-different on them and check that it prints nothing.
- New tests must have teeth. After they pass, revert each fix in turn and confirm the matching test FAILS. At minimum: (a) the default flipped back to the live frame, (b) the grammar not consulted (mermaid-lite applied to everything again), (c) the view option not written / wiped by a bridge update, (d) the language not passed to the editor, (e) the mermaid grammar lost from the TTD dialog.
- The machine: the gate sizes vitest from the free memory, so it takes about three to four minutes. If the vitest step fails with "still loading", that is the known load flake, not your code: re-run with GATE_JOBS=2. If the OS kills the workers (non-zero exit, NO summary line), free memory and re-run.
- There may be ANOTHER gate running when you start (the kit serialises them - it will wait for the lock). That is normal; wait it out.
- WINDOWS: the harness strips literal double quotes out of a command line, which breaks JSON arguments and even the PowerShell parser. When you build a command string that needs a quote character, use $q = [char]34 and concatenate - never type a literal quote. In a ripgrep pattern, write \x22.

DO NOT COMMIT. Leave every change in the working tree - the kit close does the committing.

REPORT BACK
1. The files you created and changed, with a one-line purpose each.
2. The exact gate summary line and the rowcheck result.
3. The teeth check: what you broke and which test failed, for each.
4. How the grammar is chosen for a given file, end to end, and how you proved AC-108 actually distinguishes the python grammar from the mermaid one.
5. Where the view lives, how the teacher flips it, and how you proved it survives a bridge state update.
6. The new dependencies, their versions, and the proof that the library's package.json gained none.
7. Anything you could not do and why, and anything in this brief you found to be wrong.
8. The final git status of the worktree, with the changes unstaged.
Do not summarise the design back. Report evidence: command output, test names, file paths.

