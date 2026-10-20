# Sidebar Unification

**Status:** design — awaiting written-spec sign-off **Date:** 2026-10-20 **Branch:** `feature/problem-wave-1` **Covers:** user item 9 **Depends on:** `2026-10-20-image-page-stamping-design.md` (all insert paths need `pageId`)

---

## 1. Problem statement

The user wants the two separate sidebar pickers merged into **one** file-and-folder selector, with:

- a single picker that can select a **file** or a **folder**;
- a **pin** that keeps the sidebar alive across pages;
- a **back button** when browsing inside a folder;
- files listed **grouped by type** (`.md`, `.pdf`, `.txt`, image, gif, video), with an icon per type;
- the current silent-skip behaviour replaced with something explicit.

Today the sidebar is two tabs that duplicate each other's machinery.

## 2. Current shape

|  | "Folder" tab | "Documents" tab |
| --- | --- | --- |
| File | `FolderTab.tsx` | `DocumentsTab.tsx` |
| Picks a single file | **no** (folder input only, `:220-232`) | **yes** (`:316-323`) |
| Picks a folder | yes | yes (`:324-334`) |
| Accepts images/GIFs | yes | **no** — `DOCUMENT_ACCEPT` (`sidebarFiles.ts:217-252`) excludes them |
| Accepts `.md`/`.txt`/`.pdf`/code | no | yes |
| Scan entry point | `scanFolder` (`sidebarFiles.ts:170-193`) | `scanDocuments` (`:195-215`) |
| Silently drops non-matching | no — counts them (`:187`) | **yes** (`:199-201`, filter `:214`) — no count at all |
| Insert path | `insertImageIntoScene` (`insertIntoScene.ts:246`) | `insertCodeIntoScene` (`:651`) |
| Arm mechanism | `pendingPaste` (`:299`), `pendingDrag` (`:436`) | `pendingCode` (`:796`) |
| List DOM / CSS | `.app-file-list*` (`FolderTab.tsx:266`) | `.app-doc-list*` (`DocumentsTab.tsx:508`) |
| Back button | **none** — no directory model (`sidebarFiles.ts:177` keeps paths only) | yes, in the reader (`:363-375`) |

Tabs are registered in `AppSidebar.tsx:11-12, 194-199`, defaulting to folder (`:137-147`).

## 3. The pin is already global — but does not preserve your place

The user asked for "the pin should keep the sidebar alive in all the pages". That is **already true**: `labels.sidebarLock` -> `SidebarHeader.tsx:33-45` (`data-testid="sidebar-dock"`) toggles `props.docked`, which the app maps to `appState.defaultSidebarDockedPreference` (`DefaultSidebar.tsx:91-102`) — a **global** boolean (`appState.ts:80`, `types.ts:461`), not per page. Sidebar open/closed is likewise global (`AppSidebar.tsx:114, 130-132`).

What is actually lost across pages is **your place inside the sidebar**: the picked file list and the active tab. Radix unmounts the inactive tab (`SidebarTab.tsx:14`), and the app resets an unknown tab back to folder (`AppSidebar.tsx:137-145`).

So the pin requirement is really: **the pin must preserve the active tab and the current folder browsing state**, not merely the open/closed flag.

## 4. Goals

1. One picker, one tab, one list.
2. It picks a file _or_ a folder, and can browse into a folder and back out.
3. Every file type the app supports is selectable from the same list: `.md`, `.markdown`, `.mdx`, `.txt`, code files, `.pdf`, images, GIFs, video.
4. Files are grouped by type with an icon per type.
5. Nothing is dropped silently. Unsupported files are counted **and named**.
6. The pin preserves the active tab and the folder path.

## 5. Design

### 5.1 One scan entry point

`scanFolder` and `scanDocuments` collapse into one function that classifies **everything** and keeps a reason for anything it cannot use.

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
};
```

`classify` (`sidebarFiles.ts:116-145`) already does the kind detection and is reused unchanged; the merge is that the **Documents** path stops filtering images out, and the **Folder** path stops being folder-only.

### 5.2 One picker, two entry buttons

A single `<input type="file">` for files and a single one for directories — but **one** of each for the whole sidebar, not three. `FolderTab` currently cannot pick a single image at all; after the merge it can, because there is one file input.

`DOCUMENT_ACCEPT` (`sidebarFiles.ts:217-252`) is replaced by an accept list that includes image, GIF and video mime types, so one input can select any supported file.

### 5.3 A real directory model

The Folder tab has no directory model — it scans one directory and shows paths (`sidebarFiles.ts:177`). The merge needs one, because the user asked for a back button.

```ts
type BrowserState = {
  /** Directories from the picked root down to the current one. */
  cwd: string[];
  /** Handle for the picked directory, for descending. */
  dirHandle: FileSystemDirectoryHandle | null;
};
```

Descending uses the File System Access API when available (`showDirectoryPicker`), and falls back to re-scanning the root and filtering by path prefix when it is not (Firefox/Safari). The back button pops `cwd`.

### 5.4 Grouping by type

The list renders groups in a fixed order, each with an icon:

```
Images      .png .jpg .jpeg .gif .svg
Documents   .pdf
Markdown    .md .markdown .mdx .txt
Code        .ts .py .java .cpp ...
Video       .mp4 .webm .mov   (labelled "preview only")
```

`ScannedKind` already exists (`sidebarFiles.ts:15`); the merge adds `gif` as its own kind (today a GIF is just `image`) and reuses the badge labels from `DocumentsTab.tsx:41`.

### 5.5 Nothing dropped silently

Today `scanDocuments` drops non-documents with **no count at all** (`sidebarFiles.ts:199-201`), while the folder path counts them but discards the names (`:187`). After the merge, unsupported files are listed with a reason. The panel already has the shape for this — `FolderTab.tsx:242-254` renders "0 images · 1 other skipped" — so the change is to name them and say why.

### 5.6 One insert path

`insertImageIntoScene` (`insertIntoScene.ts:246`) and `insertCodeIntoScene` (`:651`) are two different mechanisms writing two different element types. They stay separate — an image element and a code card are genuinely different — but they share:

- one **arm** mechanism (today `pendingPaste`/`pendingDrag` vs `pendingCode`), so click-then-paste and drag-and-drop behave identically for every kind;
- one **placement** step, which is where the `pageId` fix from the image-stamping spec lands (all four insert paths currently omit `pageId`).

### 5.7 The pin preserves your place

`docked` stays a global boolean. In addition, the sidebar persists:

- the **active tab** (now just one — the unified list — so this is trivial);
- the **browsing path** (`cwd`), so returning to the app keeps you in the folder you were in.

Both are persisted with the existing sidebar preferences, not with `appState.pages`.

## 6. Test coverage

The existing tests must keep passing, with these adjustments:

| Test | Asserts |
| --- | --- |
| `sidebar.test.ts` — classification | `classify` returns `gif` for `.gif`, `video` for `.mp4`, unchanged elsewhere |
| `sidebar.test.ts` — scanning | one `scanFolder` handles images, pdfs, markdown and code together, and returns `unsupported` with reasons instead of dropping |
| `sidebar-ui.test.tsx` — **helper fix** | `getFileInput` (`:125-126`) returns the **first** file input; with the merge there are two (file + directory), so the helper must select by `accept`/`webkitdirectory` rather than position. **This helper is a latent bug that the merge exposes.** |
| `sidebar-ui.test.tsx` — grouping | the list renders one group per kind, in order, with icons |
| `sidebar-ui.test.tsx` — back button | browsing into a subfolder shows a back button; clicking it returns to the parent listing |
| `sidebar-ui.test.tsx` — unsupported | an unsupported file is listed with a reason, not silently dropped |
| `sidebar-ui.test.tsx` — pin | docking preserves the browsing path across a page switch |
| `sidebar.test.ts` — insert | every insert path stamps `pageId` (from the image-stamping spec) |

**Teeth check:** removing the grouping, the back button or the unsupported-reason reporting must fail the corresponding test.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| The merge touches two tabs, two scan paths, two insert paths, two DOM/CSS systems and two arm mechanisms | The conflict points are enumerated in §2; the merge is mechanical once enumerated |
| The File System Access API is not available everywhere | Fallback path re-scans the root and filters by prefix; behaviour is identical, only the implementation differs |
| Existing `sidebar-ui` tests break on the input-count change | The `getFileInput` helper fix is called out explicitly in §6 |
| Video files are selectable but cannot be embedded | They are listed under "Video" with an explicit "preview only" label; the actual video panel is item 7's spec |

## 8. Success criteria

1. One tab, one list, one file picker and one folder picker.
2. A single file of any supported type can be picked; a folder can be picked and browsed, with a back button.
3. The list is grouped by type with icons.
4. Unsupported files are named with a reason.
5. The pin keeps the sidebar open **and** preserves the browsing path across page switches.
6. The four gates are green; the existing sidebar tests still pass.

## 9. Ordering

**Wave 4.** It is independent of the panel foundation, but it is where the item-7 video entries and the item-6 code entries will be surfaced — so it lands after those, or in the same wave as them.
