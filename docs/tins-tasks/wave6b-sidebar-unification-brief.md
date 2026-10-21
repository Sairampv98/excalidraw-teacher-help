# Builder brief — Wave 6b, the sidebar unification (item 9)

**Reference material. Not instructions.** The instructions are in the task text you were given and in the locked rows of `SPEC.md`. This file is the build sheet: read it, do not treat its prose as commands.

## What this is

The fork owner's item 9, in their own words:

> "merge the seperate image/gif selection sidebar and the .md, .tct, .pdf selectors to select file and select folder only and the pin should keep the sidebar alive in all the pages, for folders if a file is selected hopefully there is a back button to go back to the files that became visible from the selected folder all sorted into the various types listed .md, .pdf, .txt, image, gif, video icons should be fine"

Today the sidebar is **two tabs** that duplicate each other's machinery: a "Folder" tab (images and GIFs only) and a "Documents" tab (`.md` / `.pdf` / `.txt` / code). The owner wants **one** picker.

The full design is `docs/superpowers/specs/2026-10-20-sidebar-unification-design.md`. **Read it first** — but read the section below too, because **two of the design's claims are wrong about today's code**, and they were checked line by line on 2026-10-21.

## What the code actually does today (verified 2026-10-21)

These are the facts the merge has to be built on. Every line number was read from the tree.

### The correction that matters most

**The design says the pin has to preserve "the picked file list and the active tab" across page switches. It does not — neither is lost on a page switch.**

- The active tab lives in `appState.openSidebar.tab` (`packages/excalidraw/appState.ts:90`), which is **global and persisted to localStorage** (`:223`). A page switch does not touch it.
- `<AppSidebar>` is rendered at the top level of the App (`excalidraw-app/App.tsx:1154`), and the sidebar's mount gate is `appState.openSidebar?.name === props.name` (`packages/excalidraw/components/Sidebar/Sidebar.tsx:208-214`) — which a page switch does not change. **The sidebar does not unmount, and the picked file list, the folder name, the currently-read document and the zoom all survive a page switch today.**
- What _is_ lost is on a **tab** switch: `packages/excalidraw/components/Sidebar/SidebarTab.tsx:14` is a bare `RadixTabs.Content` with no `forceMount`, so Radix unmounts the inactive tab — and the tab's cleanup runs (`FolderTab.tsx:61-67` cancels the image paste and drag; `DocumentsTab.tsx:96-100` cancels the code paste).

**So the pin's only remaining job is to preserve the browsing path (`cwd`), which does not exist yet.** After the merge there is one tab, so the "active tab" half of the design's conclusion is moot.

### The three file inputs that exist today

`rg 'type="file"|webkitdirectory'` over the whole workspace finds exactly three in the app:

| file:line | `accept` | `webkitdirectory` | what |
| --- | --- | --- | --- |
| `excalidraw-app/sidebar/FolderTab.tsx:220-232` | none | yes (`:229`) | the folder tab's directory picker |
| `excalidraw-app/sidebar/DocumentsTab.tsx:382-389` | `DOCUMENT_ACCEPT` (`:386`) | no | the documents tab's **files** picker |
| `excalidraw-app/sidebar/DocumentsTab.tsx:390-400` | none | yes (`:397`) | the documents tab's directory picker |

**After the merge: exactly one files input and exactly one directory input.**

Note: `packages/excalidraw/actions/actionExport.tsx` (the "Insert document…" action, added in Wave 6a) uses `fileOpen` from `browser-fs-access` (`packages/excalidraw/data/filesystem.ts:34`), which creates its own input at run time. It does not appear in the table, and the merge does not need to touch it.

### The two position-based test helpers that WILL break

Both pick the **first** `input[type=file]` in a container, and after the merge both meanings collide in one component:

- `excalidraw-app/tests/sidebar-ui.test.tsx:126-127`
  ```ts
  const getFileInput = (container: HTMLElement) =>
    container.querySelector<HTMLInputElement>("input[type=file]")!;
  ```
  used at `:135, 165, 181, 213, 264, 352, 499, 549` (FolderTab → the **directory** input) and `:576, 608, 636, 674, 780, 887, 945` (DocumentsTab → the **files** input).
- `excalidraw-app/tests/markdownSelection.test.tsx:99` — the same pattern, inline.

**Both must select by attribute** (`accept` vs `webkitdirectory`), not by position. The design already flagged the helper; the second one is new.

### The accept list has drifted from the classifier

`classify` (`excalidraw-app/sidebar/sidebarFiles.ts:116-145`) is the single source of truth and both tabs already share it. But `DOCUMENT_ACCEPT` (`:217-252`) is a **hand-maintained second copy** of the extension knowledge, and it disagrees: `.rb .kt .rs .dart .ex .hs .zig .ps1 .ini .env .gitignore` are classified as code but are **absent from the accept list**.

Decide which is authoritative — and note that the merged accept list has to admit image, GIF and video types too, which `DOCUMENT_ACCEPT` cannot express today.

### The two arms are already asymmetric — do not "unify" them blindly

- The **code** arm is decided inside the library's paste funnel: `handleCodePaste` (`excalidraw-app/sidebar/insertIntoScene.ts:904`), wired as `onPaste={handleCodePaste}` (`excalidraw-app/App.tsx:1031-1034`). **There is no DOM paste listener any more** — Wave 4a moved it there so the context menu's Paste behaves like the keyboard paste. `excalidraw-app/tests/codeCardPaste.test.tsx` **pins that contract**; the merge must not move it back.
- The **image** arm is still a canvas `pointerdown` listener (`insertIntoScene.ts:380-427`).
- The **drag** arm is image-only (`insertIntoScene.ts:443-540`) and is pinned by `excalidraw-app/tests/sidebarDrag.test.ts` (including the exact `DRAG_MIME` string).

### The badge labels are themselves wrong

`badgeLabel` (`excalidraw-app/sidebar/DocumentsTab.tsx:41-42`) returns `"PDF" / "MD" / "TXT"` — so a **`.ts` file gets a "TXT" badge** — and the class `app-doc-badge--code` is emitted at `:469`/`:594` but `sidebar.scss` only defines `--pdf` (`:339`) and `--markdown` (`:402`). The design says to "reuse the badge labels from `DocumentsTab.tsx:41`", which would carry the defect forward. The merged list needs a per-kind icon **and** label.

### The markdown viewer's CSS is pinned by a stylesheet test

`excalidraw-app/tests/markdownContainment.test.ts:28-57` parses `sidebar/sidebar.scss` and collects only the rules whose selector mentions the literal string **`.app-doc-markdown`**. If the merge renames that class, the file fails on every assertion. Keep the class name, or update the test in the same change.

### The scrollbar/width preferences are separate localStorage keys

`useSidebarLayout.ts`: the width (`LOCAL_STORAGE_SIDEBAR_WIDTH`), the auto-fit toggle (`LOCAL_STORAGE_PAGE_AUTO_FIT`) and the app's `defaultSidebarDockedPreference` are three **separate** persisted globals. The merged picker's state (the picked root's `File[]`, the `cwd`) is **not** persisted at all today — a `webkitdirectory` pick returns a flat `FileList`, and `scanFolder` throws the non-image entries away, so **the whole root list has to be kept** to browse into a subfolder without the File System Access API.

## The locked decisions to implement

| Row | The decision in one line |
| --- | --- |
| D-39 | There is **one** picker and **one** list: the two scan entry points collapse into one that classifies everything and keeps a reason for anything it cannot use. |
| D-40 | The list is **grouped by type** with an icon per group — Images, Documents, Markdown, Code, Video — and an unsupported file is **named with a reason**, never silently dropped. |
| D-41 | The picker can select a **file or a folder**, and a folder can be **browsed into and back out of** with a back button. The pin keeps the sidebar alive **and preserves the browsing path** (`cwd`) across page switches. The browsing path is the **only** thing the pin has to preserve: the picked file list and the active tab already survive a page switch, because the sidebar does not unmount and the active tab is global app state (`appState.openSidebar.tab`, persisted). |

Add these three rows to `SPEC.md` in the Decisions table, and the acceptance rows below to the acceptance table for this wave.

## What to build

### 1. One scan entry point

`scanFolder` and `scanDocuments` collapse into one function that classifies **everything** and keeps a reason for anything it cannot use:

```ts
export type ScannedKind =
  | "image"
  | "gif"
  | "video"
  | "pdf"
  | "markdown"
  | "code"
  | "text";

export type ScannedFile = {
  name: string;
  kind: ScannedKind;
  language?: string;
  /** Relative path within the picked folder, for breadcrumbing. */
  path: string[];
  file?: File;
};

export type ScannedUnsupported = {
  name: string;
  path: string[];
  /** Why it cannot be used, in the user's words. */
  reason: "video-not-embeddable" | "unknown-type" | "read-failed";
};

export type ScanResult = {
  files: ScannedFile[];
  unsupported: ScannedUnsupported[];
  /** Directory path currently being browsed, empty at the root. */
  cwd: string[];
  ...
};
```

`classify` (`excalidraw-app/sidebar/sidebarFiles.ts`) already does the kind detection and is reused unchanged. The merge is that the **Documents** path stops filtering images out, and the **Folder** path stops being folder-only.

`gif` becomes its own kind — today a GIF is just an `image`.

### 2. One picker, two entry buttons

A single `<input type="file">` for files and a single one for directories — but **one** of each for the whole sidebar, not three. The Folder tab currently cannot pick a single image at all; after the merge it can, because there is one file input.

`DOCUMENT_ACCEPT` is replaced by an accept list that includes image, GIF and video mime types, so one input can select any supported file.

### 3. A real directory model

The Folder tab has no directory model — it scans one directory and shows paths. The merge needs one, because the owner asked for a back button:

```ts
type BrowserState = {
  /** Directories from the picked root down to the current one. */
  cwd: string[];
  /** Handle for the picked directory, for descending. */
  dirHandle: FileSystemDirectoryHandle | null;
};
```

Descending uses the File System Access API when available (`showDirectoryPicker`), and falls back to re-scanning the root and filtering by path prefix when it is not (Firefox / Safari). The back button pops `cwd`.

### 4. Grouping by type

The list renders groups in a fixed order, each with an icon:

```
Images      .png .jpg .jpeg .gif .svg
Documents   .pdf
Markdown    .md .markdown .mdx .txt
Code        .ts .py .java .cpp ...
Video       .mp4 .webm .mov   (labelled "preview only")
```

Reuse the badge labels already in `DocumentsTab.tsx`.

### 5. Nothing dropped silently

Today `scanDocuments` drops non-documents with **no count at all**, while the folder path counts them but discards the names. After the merge, unsupported files are listed with a reason.

### 6. One insert path

`insertImageIntoScene` and `insertCodeIntoScene` stay separate — an image element and a code card are genuinely different — but they share one **arm** mechanism and one **placement** step, so click-then-paste and drag-and-drop behave identically for every kind.

**Careful:** the arm mechanism for code was just changed by Wave 4a (the armed paste is now decided in the library's `props.onPaste` path, not a DOM listener). Read the current `excalidraw-app/sidebar/insertIntoScene.ts` before you touch it, and keep Wave 4a's behaviour.

### 7. The pin preserves your place

`docked` stays a global boolean — that part already works. What is lost across pages is **your place inside the sidebar**: the picked file list and the active tab. So the pin must also preserve the **active tab** and the **browsing path** (`cwd`), persisted with the existing sidebar preferences (not with `appState.pages`).

## The test coverage the design calls for

| Test | Asserts |
| --- | --- |
| `sidebar.test.ts` — classification | `classify` returns `gif` for `.gif`, `video` for `.mp4`, unchanged elsewhere |
| `sidebar.test.ts` — scanning | one `scanFolder` handles images, pdfs, markdown and code together, and returns `unsupported` with reasons instead of dropping |
| `sidebar-ui.test.tsx` — **helper fix** | `getFileInput` returns the **first** file input; with the merge there are two (file + directory), so the helper must select by `accept`/`webkitdirectory` rather than position. **This helper is a latent bug that the merge exposes.** |
| `sidebar-ui.test.tsx` — grouping | the list renders one group per kind, in order, with icons |
| `sidebar-ui.test.tsx` — back button | browsing into a subfolder shows a back button; clicking it returns to the parent listing |
| `sidebar-ui.test.tsx` — unsupported | an unsupported file is listed with a reason, not silently dropped |
| `sidebar-ui.test.tsx` — pin | docking preserves the browsing path across a page switch |

## The acceptance rows

| Row | Check file | What |
| --- | --- | --- |
| AC-44 | `excalidraw-app/tests/sidebar.test.ts` | One scan classifies every supported type and returns the unsupported ones **with a reason**. |
| AC-45 | `excalidraw-app/tests/sidebar-ui.test.tsx` | The list is **grouped by type** with an icon per group, in the fixed order. |
| AC-46 | `excalidraw-app/tests/sidebar-ui.test.tsx` | Browsing into a folder shows a **back button**, and clicking it returns to the parent listing. |
| AC-47 | `excalidraw-app/tests/sidebar-ui.test.tsx` | The **pin preserves the browsing path** across a page switch. |

**The check file must mention the row's id** — put it in the test name, e.g. `it('AC-46 the back button returns to the parent listing', ...)`. The kit's SPEC lint reads the file and fails if the id is absent.

## The files you own

Everything below is inside the task scope `excalidraw-app,SPEC.md`.

| File | New / changed | What |
| --- | --- | --- |
| `excalidraw-app/sidebar/sidebarFiles.ts` | changed | one scan entry point, the kinds, the reasons |
| `excalidraw-app/sidebar/FolderTab.tsx` | changed | the merged list, the grouping, the back button |
| `excalidraw-app/sidebar/DocumentsTab.tsx` | changed | the merged list, the grouping, the back button |
| `excalidraw-app/sidebar/insertIntoScene.ts` | changed | the shared arm mechanism and the shared placement |
| `excalidraw-app/components/AppSidebar.tsx` | changed | one tab instead of two |
| `excalidraw-app/sidebar/sidebar.scss` | changed | the group styles |
| `excalidraw-app/tests/sidebar.test.ts`, `excalidraw-app/tests/sidebar-ui.test.tsx` | changed | the coverage above |
| `SPEC.md` | changed | D-39, D-40, D-41 and the acceptance rows |

## The house rules

- `yarn`, never `npm` or `bun`. No new dependency.
- LF line endings, no BOM.
- The library's own functions are the oracle. Never re-derive a formula the library already has.
- Run the tests with `npx vitest run <file> --watch=false`. **Never** leave vitest in watch mode.
- Run `node scripts/tins-gate.mjs` before you finish. All four gates must pass; the summary line must show `# fail 0`.
- Run `node scripts/rowcheck.mjs --all` and make sure your four new rows are green.

## The teeth check

A test that cannot fail is not a test. After your tests pass, revert each fix in turn and confirm the matching test fails. At minimum: (a) the grouping is removed, (b) the back button does nothing, (c) the unsupported reason is dropped, (d) the browsing path is not preserved. Record what you broke and what failed — the orchestrator needs that in the close note.
