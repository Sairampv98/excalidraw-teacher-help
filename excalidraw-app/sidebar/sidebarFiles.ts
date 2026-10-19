/**
 * File-type rules for the sidebar's folder + documents tabs.
 *
 * Note on video: Excalidraw's `image` element model only knows how to render a
 * still frame or an animated GIF. There is no video element, so video files
 * are detected only so the UI can tell you they were skipped — instead of
 * pretending they will work.
 */

import { Marked } from "marked";
import { codeToHtml } from "shiki";

import type { RendererObject, Token, Tokens } from "marked";

export type ScannedKind = "image" | "video" | "pdf" | "markdown" | "code";

export type ScannedFile = {
  file: File;
  name: string;
  /** path relative to the picked folder, when the browser provides one */
  path: string;
  kind: ScannedKind;
  /** shiki language id, for markdown + code files */
  language?: string;
};

/** renderable by an Excalidraw image element (GIF animates, AVIF/WebP don't) */
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "apng",
  "avif",
  "ico",
]);

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

  if (IMAGE_EXTENSIONS.has(ext) || mimeType?.startsWith("image/")) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(ext) || mimeType?.startsWith("video/")) {
    return "video";
  }
  if (ext === "pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return "markdown";
  }
  if (CODE_LANGUAGE_BY_EXTENSION[ext] || PLAIN_TEXT_EXTENSIONS.has(ext)) {
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

/** the folder scan keeps images (incl. GIFs) and reports videos separately */
export const scanFolder = (files: FileList | File[]) =>
  Array.from(files).reduce<{
    images: ScannedFile[];
    videos: ScannedFile[];
    skipped: number;
  }>(
    (acc, file) => {
      const path =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      const kind = classify(file.name, file.type);

      if (kind === "image") {
        acc.images.push({ file, name: file.name, path, kind });
      } else if (kind === "video") {
        acc.videos.push({ file, name: file.name, path, kind });
      } else {
        acc.skipped += 1;
      }

      return acc;
    },
    { images: [], videos: [], skipped: 0 },
  );

export const scanDocuments = (files: FileList | File[]) =>
  Array.from(files)
    .map<ScannedFile | null>((file) => {
      const kind = classify(file.name, file.type);
      if (kind !== "pdf" && kind !== "markdown" && kind !== "code") {
        return null;
      }
      const path =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;

      return {
        file,
        name: file.name,
        path,
        kind,
        language: kind === "pdf" ? undefined : languageFor(file.name),
      };
    })
    .filter((entry): entry is ScannedFile => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

export const DOCUMENT_ACCEPT = [
  ".pdf",
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".log",
  "text/*",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".json",
  ".jsonc",
  ".yml",
  ".yaml",
  ".toml",
  ".html",
  ".css",
  ".scss",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".sh",
  ".sql",
  ".vue",
  ".svelte",
].join(",");

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

    return `<a href="${escapeHtml(safeUrl(href))}"${titleAttribute(
      title,
    )} target="_blank" rel="noreferrer noopener">${label}</a>`;
  },
  image({ href, title, text }) {
    return `<img src="${escapeHtml(safeUrl(href))}" alt="${escapeHtml(
      text,
    )}"${titleAttribute(title)} loading="lazy" />`;
  },
});

/** markdown source -> sanitised HTML, ready to be injected into the viewer */
export const renderMarkdown = async (source: string): Promise<string> => {
  const marked = new Marked({ gfm: true }, { renderer: markdownRenderer() });
  const tokens = marked.lexer(source);

  await highlightFences(collectFences(tokens));

  return marked.parser(tokens);
};
