/**
 * File-type rules for the sidebar's one picker.
 *
 * Note on video: a video is now a **video panel** — a live surface on the
 * canvas (D-53) — so it is a file the app can use, not one it reports as
 * unusable. Its captions, when it has any, come from a **sidecar** next to it
 * (a `.srt` or a `.vtt`), which is a kind of its own: it is read *by* the
 * video, never inserted on its own.
 */

import { Marked } from "marked";
import { codeToHtml } from "shiki";

import type { RendererObject, Token, Tokens } from "marked";

/** every kind of file the picker knows */
export type ScannedKind =
  | "image"
  | "gif"
  | "video"
  | "captions"
  | "pdf"
  | "markdown"
  | "code"
  | "text";

/** why a file cannot be used */
export type UnsupportedReason = "unknown-type" | "read-failed";

export type ScannedFile = {
  file: File;
  name: string;
  /** the path relative to the picked root, e.g. "notes/plan.md" */
  path: string;
  /** the directory the file sits in, relative to the picked root */
  dir: string[];
  kind: ScannedKind;
  /** shiki language id, for the text-ish kinds */
  language?: string;
};

export type ScannedUnsupported = {
  file: File;
  name: string;
  path: string;
  dir: string[];
  /** the kind it was classified as, when it has one */
  kind?: ScannedKind;
  /** why it cannot be used */
  reason: UnsupportedReason;
};

export type ScanResult = {
  /** every file the app can use, in every directory of the picked root */
  files: ScannedFile[];
  /** every file it cannot use, each with the reason why */
  unsupported: ScannedUnsupported[];
  /** every directory of the picked root, relative to it */
  directories: string[][];
  /** the picked root's own name, when the browser gives one */
  rootName: string | null;
};

/** renderable by an Excalidraw image element (a GIF and an animated WebP animate, AVIF does not) */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "svg",
  "bmp",
  "apng",
  "avif",
  "ico",
]);

/** a GIF is an image, but it is its own kind: it animates on the canvas */
const GIF_EXTENSIONS = new Set(["gif"]);

/** detected so we can report them as unsupported rather than silently drop */
const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "mov",
  "avi",
  "mkv",
  "m4v",
  "ogv",
  "wmv",
]);

/**
 * The caption sidecars: a `.srt` or a `.vtt` file that sits next to a video.
 *
 * They are a kind of their own because they are not documents: a sidecar is
 * read **by** the video next to it, and it is never inserted on its own.
 */
const CAPTION_EXTENSIONS = new Set(["srt", "vtt"]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  sql: "sql",
  html: "html",
  htm: "html",
  xhtml: "html",
  vue: "html",
  svelte: "html",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  jsonc: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  xml: "xml",
  svg: "xml",
  dockerfile: "dockerfile",
  lua: "lua",
  r: "r",
  scala: "scala",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  zig: "zig",
};

const PLAIN_TEXT_EXTENSIONS = new Set(["txt", "log", "env", "gitignore"]);

export const getExtension = (name: string) =>
  name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";

export const classify = (
  name: string,
  mimeType?: string,
): ScannedKind | null => {
  const ext = getExtension(name);

  // a GIF first: it is an image, but it is a kind of its own
  if (GIF_EXTENSIONS.has(ext) || mimeType === "image/gif") {
    return "gif";
  }
  if (IMAGE_EXTENSIONS.has(ext) || mimeType?.startsWith("image/")) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(ext) || mimeType?.startsWith("video/")) {
    return "video";
  }
  if (CAPTION_EXTENSIONS.has(ext)) {
    return "captions";
  }
  if (ext === "pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    return "text";
  }
  if (CODE_LANGUAGE_BY_EXTENSION[ext]) {
    return "code";
  }
  if (
    name.toLowerCase() === "dockerfile" ||
    name.toLowerCase() === "makefile"
  ) {
    return "code";
  }

  return null;
};

export const languageFor = (name: string) => {
  const ext = getExtension(name);

  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  if (CODE_LANGUAGE_BY_EXTENSION[ext]) {
    return CODE_LANGUAGE_BY_EXTENSION[ext];
  }
  if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
    return "text";
  }
  if (name.toLowerCase() === "dockerfile") {
    return "dockerfile";
  }
  if (name.toLowerCase() === "makefile") {
    return "makefile";
  }

  return "text";
};

/** the browser's own relative path, when it gives one */
const relativePathOf = (file: File) =>
  (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
  file.name;

/**
 * The one scan entry point.
 *
 * Every picked file is classified, and every file that cannot be used is kept
 * with the reason why — nothing is dropped on the way to the list.
 *
 * The picked root is kept whole, because a `webkitdirectory` pick hands over a
 * *flat* list of files that carry their relative paths: without the whole list
 * there is no way to browse into a subfolder without the File System Access
 * API.
 */
export const scanFiles = (files: FileList | File[]): ScanResult => {
  const scanned: ScannedFile[] = [];
  const unsupported: ScannedUnsupported[] = [];
  const directories = new Set<string>();
  let rootName: string | null = null;

  for (const file of Array.from(files)) {
    const segments = relativePathOf(file).split("/").filter(Boolean);

    // a picked folder's own name is the first segment of every relative path
    if (!rootName && segments.length > 1) {
      rootName = segments[0];
    }

    const dir = segments.slice(1, -1);

    // every ancestor of the file's directory is a directory of the root
    for (let i = 1; i <= dir.length; i++) {
      directories.add(dir.slice(0, i).join("/"));
    }

    const path = dir.length ? `${dir.join("/")}/${file.name}` : file.name;
    const kind = classify(file.name, file.type);

    if (!kind) {
      unsupported.push({
        file,
        name: file.name,
        path,
        dir,
        kind: undefined,
        reason: "unknown-type",
      });
      continue;
    }

    scanned.push({
      file,
      name: file.name,
      path,
      dir,
      kind,
      language:
        kind === "code" || kind === "markdown" || kind === "text"
          ? languageFor(file.name)
          : undefined,
    });
  }

  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path.localeCompare(b.path);

  return {
    files: scanned.sort(byPath),
    unsupported: unsupported.sort(byPath),
    directories: [...directories].sort().map((dir) => dir.split("/")),
    rootName,
  };
};

/**
 * The accept list of the file picker, **derived from the classifier** so the
 * two cannot drift apart again: every extension `classify` knows, plus the
 * mime types that carry a kind on their own.
 */
export const FILE_ACCEPT = [
  ...new Set([
    ...IMAGE_EXTENSIONS,
    ...GIF_EXTENSIONS,
    ...VIDEO_EXTENSIONS,
    ...CAPTION_EXTENSIONS,
    ...MARKDOWN_EXTENSIONS,
    ...PLAIN_TEXT_EXTENSIONS,
    ...Object.keys(CODE_LANGUAGE_BY_EXTENSION),
    "pdf",
  ]),
]
  .map((ext) => `.${ext}`)
  .concat(["image/*", "video/*", "application/pdf", "text/*"])
  .join(",");

/** the label a kind's badge carries — one per kind, so a `.ts` is not a "TXT" */
export const kindLabel = (kind: ScannedKind) =>
  kind === "image"
    ? "IMG"
    : kind === "gif"
    ? "GIF"
    : kind === "pdf"
    ? "PDF"
    : kind === "markdown"
    ? "MD"
    : kind === "code"
    ? "CODE"
    : kind === "text"
    ? "TXT"
    : kind === "captions"
    ? "CAP"
    : "VID";

/** the sentence the list shows next to a file it cannot use */
export const reasonText = (reason: UnsupportedReason) =>
  reason === "read-failed" ? "could not be read" : "unknown file type";

/** the icon each group header carries */
export type GroupIconId =
  | "image"
  | "document"
  | "markdown"
  | "code"
  | "video"
  | "unsupported";

export type FileGroupId =
  | "images"
  | "documents"
  | "markdown"
  | "code"
  | "video"
  | "unsupported";

/** a row of the list: either a file the app can use, or one it cannot */
export type GroupEntry =
  | { type: "file"; file: ScannedFile }
  | { type: "unsupported"; file: ScannedUnsupported };

export type FileGroup = {
  id: FileGroupId;
  label: string;
  icon: GroupIconId;
  entries: GroupEntry[];
};

/** the fixed order of the groups (D-40) */
const GROUPS: readonly {
  id: FileGroupId;
  label: string;
  icon: GroupIconId;
  kinds: ScannedKind[];
}[] = [
  { id: "images", label: "Images", icon: "image", kinds: ["image", "gif"] },
  { id: "documents", label: "Documents", icon: "document", kinds: ["pdf"] },
  {
    id: "markdown",
    label: "Markdown",
    icon: "markdown",
    kinds: ["markdown", "text"],
  },
  { id: "code", label: "Code", icon: "code", kinds: ["code"] },
  // the video group holds the videos and their caption sidecars: a sidecar is
  // read by the video next to it, so it belongs with the video
  {
    id: "video",
    label: "Video",
    icon: "video",
    kinds: ["video", "captions"],
  },
  { id: "unsupported", label: "Unsupported", icon: "unsupported", kinds: [] },
];

const samePath = (a: string[], b: string[]) =>
  a.length === b.length && a.every((part, index) => part === b[index]);

/** the directories that sit directly under `cwd` */
export const directoriesAt = (scan: ScanResult, cwd: string[]) =>
  scan.directories.filter(
    (dir) =>
      dir.length === cwd.length + 1 && samePath(dir.slice(0, cwd.length), cwd),
  );

/** the listing of one directory, grouped by type */
export const groupsAt = (
  scan: ScanResult,
  cwd: string[],
  /** the files that could not be read — they are not usable any more */
  unreadable: string[] = [],
): FileGroup[] => {
  const failed = new Set(unreadable);

  const files = scan.files.filter(
    (file) => samePath(file.dir, cwd) && !failed.has(file.path),
  );
  const unsupported = scan.unsupported.filter((file) =>
    samePath(file.dir, cwd),
  );

  // a file we could not read is named with the reason, like any other file we
  // cannot use
  const readFailures: GroupEntry[] = scan.files
    .filter((file) => samePath(file.dir, cwd) && failed.has(file.path))
    .map((file) => ({
      type: "unsupported" as const,
      file: {
        file: file.file,
        name: file.name,
        path: file.path,
        dir: file.dir,
        kind: file.kind,
        reason: "read-failed" as const,
      },
    }));

  return GROUPS.map((group) => {
    const entries: GroupEntry[] = [];

    if (group.id === "unsupported") {
      entries.push(
        ...unsupported.map((file) => ({ type: "unsupported" as const, file })),
        ...readFailures,
      );
    } else {
      entries.push(
        ...files
          .filter((file) => group.kinds.includes(file.kind))
          .map((file) => ({ type: "file" as const, file })),
      );
    }

    return { id: group.id, label: group.label, icon: group.icon, entries };
  }).filter((group) => group.entries.length > 0);
};

// --- markdown ---------------------------------------------------------------

/**
 * Markdown is rendered with `marked` (already in the tree, now declared as a
 * direct dependency) rather than being thrown at shiki like a source file: a
 * document has to look like a document.
 *
 * The output is injected into the DOM with `dangerouslySetInnerHTML`, and the
 * `.md` file is arbitrary, untrusted input — so the renderer overrides below
 * are the sanitiser. There is exactly one: raw HTML tokens are escaped to
 * visible text, and link/image URLs are replaced unless they are ordinary
 * http(s), relative or anchor links. Everything else marked emits (escaped
 * text, generated tags) is inert by construction.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/** schemes a document has no business linking to from inside the viewer */
const UNSAFE_URL_SCHEME = /^(?:javascript|vbscript|data|blob|file):/i;

const safeUrl = (url: string) => {
  // the scheme parser skips whitespace and control characters, so strip them
  // before deciding whether this URL is dangerous
  // eslint-disable-next-line no-control-regex -- these are exactly the chars a browser skips
  const normalized = url.replace(/[\u0000-\u0020\u007f]/g, "");

  return UNSAFE_URL_SCHEME.test(normalized) ? "#" : url.trim();
};

const titleAttribute = (title: string | null | undefined) =>
  title ? ` title="${escapeHtml(title)}"` : "";

/** a fenced block, carrying the HTML we highlighted for it */
type FenceToken = Tokens.Code & { highlighted?: string };

/** every nested token, whether marked hangs it off `tokens` or `items` */
const nestedTokens = (token: Token): Token[] => {
  const nested = token as unknown as { tokens?: Token[]; items?: Token[] };

  return [...(nested.tokens ?? []), ...(nested.items ?? [])];
};

const collectFences = (
  tokens: Token[],
  found: FenceToken[] = [],
): FenceToken[] => {
  for (const token of tokens) {
    if (token.type === "code") {
      found.push(token as FenceToken);
    }

    const nested = nestedTokens(token);

    if (nested.length) {
      collectFences(nested, found);
    }
  }

  return found;
};

/**
 * Fenced code is the one part of a document that stays shiki-highlighted.
 * Highlighting is async, so it happens on the tokens before they are parsed;
 * a language this shiki build doesn't know falls back to escaped plain text.
 */
const highlightFences = (fences: FenceToken[]) =>
  Promise.all(
    fences.map(async (fence) => {
      const lang = (fence.lang ?? "").trim().split(/\s+/)[0];

      try {
        fence.highlighted = await codeToHtml(fence.text, {
          lang: lang || "text",
          theme: "github-dark",
        });
      } catch {
        fence.highlighted = undefined;
      }
    }),
  );

/**
 * Copy affordance for a fenced block.
 *
 * The button is emitted as part of the HTML the viewer already injects, and is
 * picked up by a single delegated listener on the markdown body rather than by
 * a React handler per block. It carries no code of its own: the block's own
 * `<pre>` holds the verbatim source (shiki only wraps tokens in spans and never
 * rewrites the text), so the handler reads it back from there.
 */
const copyCodeButton = () =>
  '<button type="button" class="app-doc-copy-code" title="Copy code" aria-label="Copy code">' +
  '<span class="app-doc-copy-code__label">Copy code</span></button>';

/**
 * `language` is recorded on the wrapper because the rendered HTML cannot be
 * asked for it later: a highlighted block's `<pre>` is shiki's own output and
 * carries no `language-*` class, so a copy button handler has no way to tell
 * whether the block it belongs to is Python or TypeScript.
 */
const wrapCodeBlock = (blockHtml: string, language?: string) => {
  const lang = language?.trim()
    ? ` data-language="${escapeHtml(language)}"`
    : "";

  return `<div class="app-doc-codeblock"${lang}>${copyCodeButton()}${blockHtml}</div>`;
};

const markdownRenderer = (): RendererObject => ({
  html({ text }) {
    return escapeHtml(text);
  },
  code(token) {
    const fence = token as FenceToken;

    if (fence.highlighted) {
      return wrapCodeBlock(fence.highlighted, fence.lang);
    }

    const language = fence.lang
      ? ` class="language-${escapeHtml(fence.lang)}"`
      : "";

    return wrapCodeBlock(
      `<pre class="md-code"><code${language}>${escapeHtml(
        fence.text,
      )}</code></pre>`,
      fence.lang,
    );
  },
  link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);

    // not draggable (D-309): the browser drags a link instead of selecting
    // its text, and a link in a table could not be selected or pasted
    return `<a href="${escapeHtml(safeUrl(href))}"${titleAttribute(
      title,
    )} target="_blank" rel="noreferrer noopener" draggable="false">${label}</a>`;
  },
  image({ href, title, text }) {
    return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(
      text,
    )}"${titleAttribute(title)} loading="lazy" />`;
  },
});

/**
 * Where a link of a document goes (D-308).
 *
 * - `external`: an address elsewhere; the browser opens it in a new tab
 * - `anchor`: a heading of the document itself
 * - `document`: a file of the opened folder, which the viewer opens itself
 * - `missing`: it points at a file that was not opened
 */
export type DocumentLink =
  | { type: "external" }
  | { type: "anchor"; anchor: string }
  | { type: "document"; file: ScannedFile; anchor: string | null }
  | { type: "missing"; target: string };

/** what a link written with no extension may stand for, in this order */
const LINK_SUFFIXES = [".md", ".markdown", ".mdx"];
const FOLDER_INDEXES = ["index.md", "README.md", "readme.md"];

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** `.` and `..` resolved; null when `..` leaves the opened folder */
const joinSegments = (segments: string[]): string[] | null => {
  const joined: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (!joined.length) {
        return null;
      }

      joined.pop();
    } else {
      joined.push(segment);
    }
  }

  return joined;
};

/** the id a heading has for a link to it: lower case, spaces as hyphens */
export const headingSlug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/** the heading of `body` that a link to `anchor` means */
export const findHeading = (body: ParentNode, anchor: string) => {
  const wanted = headingSlug(anchor);

  for (const heading of body.querySelectorAll<HTMLElement>(
    "h1, h2, h3, h4, h5, h6",
  )) {
    if (headingSlug(heading.textContent ?? "") === wanted) {
      return heading;
    }
  }

  return null;
};

/**
 * Reads a link of the document at `from` against the files that were opened.
 *
 * The link is read as it is written: relative to the document's own folder, or
 * from the root of the opened folder when it starts with a slash. A link
 * written with this app's own address (`origin`) is the same thing - the
 * address is only where the browser would have looked for it. A file is found
 * as written, with a markdown extension added, or as the index of a folder.
 */
export const resolveDocumentLink = ({
  href,
  from,
  files,
  origin,
}: {
  href: string;
  /** the path of the document the link is in */
  from: string;
  /** the files a link may open */
  files: readonly ScannedFile[];
  /** this app's own address, e.g. "http://localhost:3000" */
  origin?: string;
}): DocumentLink => {
  const raw = href.trim();

  if (raw.startsWith("#")) {
    return { type: "anchor", anchor: decodeSegment(raw.slice(1)) };
  }

  let written = raw;

  if (raw.startsWith("//")) {
    return { type: "external" };
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    let url: URL;

    try {
      url = new URL(raw);
    } catch {
      return { type: "external" };
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !origin ||
      url.origin !== origin
    ) {
      return { type: "external" };
    }

    written = `${url.pathname}${url.hash}`;
  }

  const hashAt = written.indexOf("#");
  const anchor =
    hashAt >= 0 && hashAt < written.length - 1
      ? decodeSegment(written.slice(hashAt + 1))
      : null;
  let path = hashAt >= 0 ? written.slice(0, hashAt) : written;

  const queryAt = path.indexOf("?");

  if (queryAt >= 0) {
    path = path.slice(0, queryAt);
  }

  if (!path) {
    return { type: "anchor", anchor: anchor ?? "" };
  }

  const exact = new Map(files.map((file) => [file.path, file]));
  const lower = new Map(files.map((file) => [file.path.toLowerCase(), file]));
  const folder = from.split("/").slice(0, -1);
  const segments = path.split("/").map(decodeSegment);
  const folderLink = path.endsWith("/");
  // from the document's folder, and then from the root: a link that is not
  // found where it stands is looked for at the top of the opened folder
  const bases = path.startsWith("/") ? [[], folder] : [folder, []];

  for (const base of bases) {
    const resolved = joinSegments([...base, ...segments]);

    if (!resolved) {
      continue;
    }

    const joined = resolved.join("/");
    const last = resolved[resolved.length - 1];
    const candidates = [
      ...(folderLink || !joined ? [] : [joined]),
      ...(joined ? LINK_SUFFIXES.map((suffix) => `${joined}${suffix}`) : []),
      ...FOLDER_INDEXES.map((index) => (joined ? `${joined}/${index}` : index)),
      ...(last ? [`${joined}/${last}.md`] : []),
    ];

    for (const candidate of candidates) {
      const file = exact.get(candidate) ?? lower.get(candidate.toLowerCase());

      if (file) {
        return { type: "document", file, anchor };
      }
    }
  }

  return { type: "missing", target: segments.filter(Boolean).join("/") };
};

/** markdown source -> sanitised HTML, ready to be injected into the viewer */
export const renderMarkdown = async (source: string): Promise<string> => {
  const marked = new Marked({ gfm: true }, { renderer: markdownRenderer() });
  const tokens = marked.lexer(source);

  await highlightFences(collectFences(tokens));

  return marked.parser(tokens);
};
