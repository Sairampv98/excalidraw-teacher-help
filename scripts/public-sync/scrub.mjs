/**
 * The scrubber of the public mirror.
 *
 * It takes the text of one file of the private repo and gives back what the
 * public repo may hold: the references to the way this repo is developed are
 * taken out - the ids of its decisions and acceptance rows (`D-12`, `AC-8`),
 * the words of its method and its tools, and the comments that talk about them -
 * and nothing else is touched. It is pure: text in, text out.
 *
 * What it does, in order (the sentences that name the method are **rewritten**
 * through a reviewed map to ordinary wording, and a sentence that is not in the
 * map is reported as unmapped; remarks about the owner are rewritten too):
 *
 *   1. the **ids** go: a parenthesis that holds only ids, the ids in a longer
 *      parenthesis, the id a test title or a comment starts with, `D-1's`,
 *      `of D-1`, and any id that is left, with the whitespace round it;
 *   2. the **sentences** that name the method go: in a comment (or a paragraph of
 *      a document) a sentence that matches one of the method's words is taken
 *      out and the rest of the paragraph is wrapped again; a paragraph that is
 *      only such sentences goes; a comment that is left empty goes;
 *   3. the words that are left in **titles** (`"wave 7r: ..."`) go.
 *
 * Whatever this leaves of the method's words is found by `guard.mjs`, which
 * stops a publication instead of letting it through.
 */

/** the id of a decision (`D-12`) or of an acceptance row (`AC-8`, `AC-8b`) */
export const ID = "(?:D|AC)-\\d+[a-z]?";

/** what may stand between two ids of a list: commas, "and", "to", dashes, comment leaders */
const BETWEEN = "(?:[\\s,;&+/–—*#]|and\\b|or\\b|to\\b|-|//)+";

/** one id or a list of them */
const IDS = `${ID}(?:${BETWEEN}${ID})*`;

const IDS_RE = new RegExp(`\\b${IDS}`, "g");

/** the words of the method (and of its tools) that a public file does not name */
export const METHOD_WORDS = [
  /\bTINS\b/,
  /\.tins\b/,
  /\btins[-.:]/i,
  /\btins\.json\b/,
  /\bSPEC\.md\b/,
  /\bHANDOVER\.md\b/,
  /\bAGENTS\.md\b/,
  /\bCLAUDE\.md\b/,
  /\browcheck\b/,
  /\bkit\b/,
  /\bspec[- ]first\b/i,
  /\bspec lint\b/i,
  /\bSPEC lint\b/,
  /\b[Ww]ave\s?\d+[a-z]?\b/,
  /\bacceptance rows?\b/i,
];

export const matchesMethod = (text) => METHOD_WORDS.some((re) => re.test(text));

/* ------------------------------------------------------------------- 1: the ids */

export const removeIds = (text) => {
  let out = text;

  // (D-1, D-2) and (see AC-3): a parenthesis that holds only ids goes, and the space before it
  out = out.replace(
    new RegExp(`[ \\t]*\\(\\s*(?:(?:see|per|cf\\.)\\s+)?${IDS}\\s*\\)`, "g"),
    "",
  );

  // ids at the end of a longer parenthesis: (`ocrEngine`, D-95)
  out = out.replace(new RegExp(`\\s*[,;]\\s*${IDS}(?=\\s*\\))`, "g"), "");

  // ids at the start of a longer parenthesis: (D-95, the rule that ...)
  out = out.replace(new RegExp(`\\(\\s*${IDS}\\s*[,;:]\\s*`, "g"), "(");

  // the id a title or a comment starts with: "AC-8 a panel ..." and "* D-12: the ..."
  out = out.replace(new RegExp(`(["'\`])${IDS}\\s*[:\\-–—]?\\s+`, "g"), "$1");
  out = out.replace(
    new RegExp(
      `^([ \\t]*(?:\\*|//|#|\\*/)?[ \\t]*)${IDS}[ \\t]*[:\\-–—][ \\t]*`,
      "gm",
    ),
    "$1",
  );

  // D-1's rule -> the rule
  out = out.replace(new RegExp(`\\b${IDS}'s\\b`, "g"), "the");

  // "of D-1", "per D-1", "see D-1": the word goes with the id
  out = out.replace(
    new RegExp(
      `[ \\t]+(?:per|see|of|in|under|by|from|cf\\.)[ \\t]+${IDS}(?=[\\s,.;:)\\]]|$)`,
      "g",
    ),
    "",
  );

  // any id that is left: with the space round it, so that no gap or lonely mark is left
  out = out.replace(
    new RegExp(`([ \\t]*)(${IDS})([ \\t]*)`, "g"),
    (all, before, _ids, after, offset, whole) => {
      const lineStart = whole.lastIndexOf("\n", offset - 1) + 1;
      const sinceLineStart = whole.slice(lineStart, offset);
      const next = whole[offset + all.length] ?? "";

      // at the start of a line, or after a comment leader: the indent stays
      if (/^[ \t]*(?:\*|\/\/|#)?$/.test(sinceLineStart)) {
        return before;
      }

      // against a mark, or the end of the line: no space is left
      if (
        /[,.;:)\]}]/.test(next) ||
        next === "" ||
        next === "\n" ||
        next === "\r"
      ) {
        return "";
      }

      // after an opening bracket: nothing to separate it from
      if (/[([{]$/.test(sinceLineStart)) {
        return "";
      }

      return before || after ? " " : "";
    },
  );

  // a comment that held only an id is an empty one after code: it goes with its space
  out = out.replace(/(\S)[ 	]+\/\/[ 	]*$/gm, "$1");

  // a comma that was left against the full stop of the sentence its id was in
  out = out.replace(/(?<=[A-Za-z0-9)\]"'`])\s*,\s*(?=\.(?:\s|$))/g, "");

  return out;
};

/* ------------------------------------------------------- the owner's remarks */

/** the words that put a request in a person's mouth */
const OWNER_RE = /\bowner\b/i;

/**
 * A remark that says the owner asked for something is a feature statement:
 * "The owner asked for the panel to follow the page" -> "Provides the panel to
 * follow the page". What is left of the word (the owner's words, the owner's
 * decision) names the teacher, who is the user of the feature.
 */
export const rewriteOwner = (text) =>
  text
    .replace(
      /\b[Tt]he owner(?:'s own)? (?:asked|wanted|requested|wished) for ([^.:;,]+)/g,
      (_all, what) => `Provides ${what.trim()}`,
    )
    .replace(
      /\b[Tt]he owner(?:'s own)? (?:words?|decisions?|approval|reports?|review)\b/g,
      (m) => m.replace(/[Tt]he owner(?:'s own)?/, "the requirement for"),
    )
    .replace(/\bThe owner\b/g, "The teacher")
    .replace(/\bthe owner\b/g, "the teacher")
    .replace(/\bowner's\b/g, "teacher's")
    .replace(/\bOwner's\b/g, "Teacher's")
    .replace(/\bowner\b/g, "teacher")
    .replace(/\bOwner\b/g, "Teacher");

/**
 * The state of one scrub: the map of reviewed rewrites, what the scrub found
 * that is not in it, and whether such a sentence may be dropped instead.
 */
let context = { map: null, unmapped: [], allowDrop: false };

/** a sentence as the map keys it: one line, the spaces collapsed */
export const mapKey = (sentence) => sentence.replace(/\s+/g, " ").trim();

/** what a sentence that names the method becomes: its rewrite, "" when it is to go */
const rewriteMethodSentence = (sentence) => {
  const hit = context.map?.sentences?.[mapKey(sentence)];

  if (typeof hit === "string") {
    return hit;
  }

  context.unmapped.push(mapKey(sentence));

  // an unmapped sentence stays (and the run stops on it) unless dropping is allowed
  return context.allowDrop ? "" : sentence;
};

/* ------------------------------------------------------------- 2: the sentences */

/** sentences of a paragraph: split after . ! ? when a new sentence begins */
const sentences = (paragraph) =>
  paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9*_`"'(\[“])/);

/** wraps words to a width, with a prefix on the first line and another on the rest */
const wrap = (text, width, first, rest) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = first;
  let empty = true;

  for (const word of words) {
    if (!empty && current.length + 1 + word.length > width) {
      lines.push(current);
      current = rest;
      empty = true;
    }

    current += (empty ? "" : " ") + word;
    empty = false;
  }

  lines.push(current);

  return lines;
};

const BULLET = /^(\s*(?:[-*+]|\d+[.)])\s+|\s*@\w+\s*)/;

/**
 * A partner line (D-592). A comment that has to name the method (a row, a task,
 * the kit) is written twice by its author: once for the private source, and once
 * in public wording right under it, the second beginning with `public:` (at the
 * start of the line, in lowercase, followed by a space, so that ordinary text
 * such as "public: the visibility" in the middle of a sentence is not taken).
 * In the public text the public wording REPLACES the comment text directly
 * above it (back to a blank line or the previous `public:`), and its marker is
 * dropped. The public wording runs on until a blank comment line, so two pairs
 * in one comment have a blank comment line between them. Without a partner the
 * rules below apply as ever.
 */
const PUBLIC_MARK = /^\s*public:[ \t]+\S/;

/**
 * Takes the sentences that name the method out of lines of text (the comment
 * leaders already off). Returns the lines that are left, or null when none had
 * to go. A paragraph is the lines up to a blank one, and a bullet or a tag
 * starts a paragraph of its own.
 */
const dropSentences = (textLines) => {
  const paragraphs = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      paragraphs.push({ lines: current, blank: false });
      current = [];
    }
  };

  for (const line of textLines) {
    if (line.trim() === "") {
      flush();
      paragraphs.push({ lines: [line], blank: true });
    } else if (
      (PUBLIC_MARK.test(line) || BULLET.test(line)) &&
      current.length
    ) {
      flush();
      current.push(line);
    } else {
      current.push(line);
    }
  }

  flush();

  // the partner lines: what stands above one is replaced by it (D-592)
  let paired = false;
  let from = 0;

  paragraphs.forEach((paragraph, k) => {
    if (paragraph.blank || !PUBLIC_MARK.test(paragraph.lines[0])) {
      return;
    }

    paired = true;
    paragraph.lines[0] = paragraph.lines[0].replace(
      /^(\s*)public:[ \t]+/,
      "$1",
    );

    // the text directly above it, back to a blank line or the previous partner
    for (let j = k - 1; j >= from && !paragraphs[j].blank; j--) {
      paragraphs[j].replaced = true;
    }

    from = k + 1;
  });

  let changed = paired;
  const kept = [];

  for (const paragraph of paragraphs) {
    if (paragraph.replaced) {
      kept.push({ lines: [], blank: false, replaced: true });
      continue;
    }

    const joined = paragraph.lines.join(" ");

    if (paragraph.blank || !(matchesMethod(joined) || OWNER_RE.test(joined))) {
      kept.push(paragraph);
      continue;
    }

    changed = true;

    const bullet = BULLET.exec(paragraph.lines[0])?.[0] ?? "";
    const body = joined
      .slice(joined.indexOf(bullet) + bullet.length)
      .replace(/\s+/g, " ")
      .trim();
    const remaining = sentences(body)
      .map((s) =>
        matchesMethod(s)
          ? rewriteMethodSentence(s)
          : OWNER_RE.test(s)
          ? rewriteOwner(s)
          : s,
      )
      .filter((s) => s.trim() !== "");

    if (remaining.length === 0) {
      // the whole paragraph goes, and the blank line after it
      kept.push({ lines: [], blank: false, removed: true });
      continue;
    }

    const indent = /^\s*/.exec(paragraph.lines[0])[0];
    const width = Math.max(60, ...paragraph.lines.map((l) => l.length));
    const first = bullet || indent;
    const rest = bullet ? " ".repeat(bullet.length) : indent;

    kept.push({
      lines: wrap(remaining.join(" "), width, first, rest),
      blank: false,
    });
  }

  if (!changed) {
    return null;
  }

  // a paragraph that went takes one blank line with it, so that two do not meet
  const out = [];

  for (let i = 0; i < kept.length; i++) {
    const paragraph = kept[i];

    // a private comment that has its public partner leaves no blank line behind
    if (paragraph.replaced) {
      continue;
    }

    if (paragraph.removed) {
      if (kept[i + 1]?.blank) {
        i++;
      } else if (out.length && out[out.length - 1].trim() === "") {
        out.pop();
      }

      continue;
    }

    out.push(...paragraph.lines);
  }

  return out;
};

/** the code of a file decides how its comments are written */
export const kindOf = (path) => {
  const name = path.split("/").pop() ?? path;

  if (/\.(?:md|mdx)$/i.test(name)) return "markdown";
  if (
    /\.(?:[cm]?[jt]sx?|s?css|less|java|c|h|cpp|go|rs|kt|swift|d\.ts)$/i.test(
      name,
    )
  )
    return "c";
  if (
    /\.(?:ya?ml|sh|bash|py|toml|rb|ps1|conf)$/i.test(name) ||
    /^(?:Dockerfile|\.gitignore|\.eslintignore|\.prettierignore|\.dockerignore|\.ignore|\.npmrc|\.editorconfig|\.gitattributes|\.watchmanconfig|\.env.*)$/.test(
      name,
    )
  )
    return "hash";
  if (/\.(?:json|jsonc)$/i.test(name)) return "json";

  return "text";
};

/** the entries of an ignore file or a list in a config that name the method go, one line each */
const dropMethodLines = (lines, kind) => {
  const entry =
    kind === "hash"
      ? (line) => !/^\s*#/.test(line) && matchesMethod(line)
      : (line) =>
          /^\s*["'`][^"'`]*["'`],?\s*$/.test(line) && matchesMethod(line);
  const out = lines.filter((line) => !entry(line));

  return out.length === lines.length ? null : out;
};

/** a comment that is written after code on the same line */
const dropTrailingComment = (line, marker) => {
  const at = line.indexOf(` ${marker}`);

  if (at <= 0) {
    return null;
  }

  const code = line.slice(0, at);
  const comment = line.slice(at);
  // inside a string that is not a comment
  const quotes = (code.match(/["'`]/g) ?? []).length;

  if (quotes % 2 === 1 || !matchesMethod(comment)) {
    return null;
  }

  return code.replace(/\s+$/, "");
};

/* the comment blocks of C-like files */

const leaderOf = (line) => /^(\s*)\*(?!\/)( ?)(.*)$/.exec(line);

const processBlock = (block) => {
  const lines = [...block];
  const first = lines[0];
  const last = lines[lines.length - 1];
  const indent = /^\s*/.exec(first)[0];

  // a comment on one line: it goes whole when it names the method
  if (lines.length === 1) {
    return matchesMethod(first) ? [] : lines;
  }

  // text that shares a line with /** or */
  // (a block comment in JSX is written `{/* ... */}`: the braces stay)
  const open = /^(\s*\{?\/\*\*?)(.*)$/.exec(first);
  const close = /^(.*?)(\*\/\}?\s*)$/.exec(last);

  // a block that does not end its last line (code follows the `*/`) is left alone
  if (!open || !close) {
    return lines;
  }

  const texts = [];

  if (open[2].trim()) {
    texts.push(open[2].trim());
  }

  for (const line of lines.slice(1, -1)) {
    const parts = leaderOf(line);

    texts.push(parts ? parts[3] : line.trim());
  }

  if (close[1].replace(/\*/g, "").trim()) {
    texts.push(close[1].replace(/^\s*\*?\s?/, "").trim());
  }

  const dropped = dropSentences(texts);

  if (dropped === null) {
    return lines;
  }

  if (dropped.every((l) => l.trim() === "")) {
    return [];
  }

  const opener = open[1].trimEnd();

  return [
    `${opener}`,
    ...dropped.map((text) =>
      text.trim() === "" ? `${indent} *` : `${indent} * ${text}`,
    ),
    `${indent} ${close[2].trim()}`,
  ];
};

const processC = (lines) => {
  const out = [];
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // a block comment that starts its line
    if (/^\s*\{?\/\*/.test(line)) {
      let j = i;

      while (j < lines.length && !lines[j].includes("*/")) {
        j++;
      }

      const block = lines.slice(i, Math.min(j, lines.length - 1) + 1);
      const result = processBlock(block);

      if (
        result.length !== block.length ||
        result.some((l, k) => l !== block[k])
      ) {
        changed = true;
      }

      out.push(...result);

      // a comment that went takes one blank line with it
      if (
        result.length === 0 &&
        lines[j + 1]?.trim() === "" &&
        out.at(-1)?.trim() === ""
      ) {
        i = j + 2;
        continue;
      }

      i = j + 1;
      continue;
    }

    // a run of // comments
    if (/^\s*\/\/(?!\/)/.test(line) || /^\s*\/\/\//.test(line)) {
      let j = i;

      while (j < lines.length && /^\s*\/\//.test(lines[j])) {
        j++;
      }

      const group = lines.slice(i, j);
      const parts = group.map((l) => /^(\s*\/\/\/?)( ?)(.*)$/.exec(l));
      const dropped = dropSentences(parts.map((p) => p[3]));

      if (dropped === null) {
        out.push(...group);
      } else {
        changed = true;

        if (!dropped.every((l) => l.trim() === "")) {
          const lead = parts[0][1];
          const indent = /^\s*/.exec(group[0])[0];

          out.push(
            ...dropped.map((text) =>
              text.trim() === "" ? `${indent}//` : `${lead} ${text}`,
            ),
          );
        } else if (lines[j]?.trim() === "" && out.at(-1)?.trim() === "") {
          j++;
        }
      }

      i = j;
      continue;
    }

    // a comment after code
    const trimmed = dropTrailingComment(line, "//");

    if (trimmed !== null) {
      changed = true;
      out.push(trimmed);
    } else {
      out.push(line);
    }

    i++;
  }

  return changed ? out : null;
};

/* the comment lines of # files */

const processHash = (lines) => {
  const out = [];
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    if (/^\s*#(?!!)/.test(lines[i])) {
      let j = i;

      while (j < lines.length && /^\s*#(?!!)/.test(lines[j])) {
        j++;
      }

      const group = lines.slice(i, j);
      const parts = group.map((l) => /^(\s*#+)( ?)(.*)$/.exec(l));
      const dropped = dropSentences(parts.map((p) => p[3]));

      if (dropped === null) {
        out.push(...group);
      } else {
        changed = true;

        if (!dropped.every((l) => l.trim() === "")) {
          out.push(
            ...dropped.map((text) =>
              text.trim() === "" ? parts[0][1] : `${parts[0][1]} ${text}`,
            ),
          );
        }
      }

      i = j;
      continue;
    }

    const trimmed = dropTrailingComment(lines[i], "#");

    if (trimmed !== null) {
      changed = true;
      out.push(trimmed);
    } else {
      out.push(lines[i]);
    }

    i++;
  }

  return changed ? out : null;
};

/* markdown: paragraphs, not inside code */

const processMarkdown = (lines) => {
  const out = [];
  let changed = false;
  let fence = false;
  let paragraph = [];

  const flush = () => {
    if (!paragraph.length) {
      return;
    }

    const dropped = dropSentences(paragraph);

    if (dropped === null) {
      out.push(...paragraph);
    } else {
      changed = true;
      out.push(...dropped);
    }

    paragraph = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      fence = !fence;
      out.push(line);
      continue;
    }

    if (
      fence ||
      /^\s*\|/.test(line) ||
      /^#{1,6}\s/.test(line) ||
      /^\s*>/.test(line)
    ) {
      flush();

      // a heading or a table row that names the method goes
      if (!fence && matchesMethod(line) && /^(?:#{1,6}\s|\s*\|)/.test(line)) {
        changed = true;
        continue;
      }

      out.push(line);
      continue;
    }

    if (line.trim() === "") {
      flush();
      out.push(line);
      continue;
    }

    paragraph.push(line);
  }

  flush();

  return changed ? out : null;
};

export const dropMethod = (text, kind) => {
  if (kind === "json" || kind === "text") {
    return text;
  }

  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.split(/\r?\n/);
  let any = false;

  const entries = dropMethodLines(lines, kind === "markdown" ? "none" : kind);

  if (entries && kind !== "markdown") {
    lines = entries;
    any = true;
  }

  const processed =
    kind === "c"
      ? processC(lines)
      : kind === "hash"
      ? processHash(lines)
      : processMarkdown(lines);

  if (processed) {
    lines = processed;
    any = true;
  }

  if (!any) {
    return text;
  }

  // two blank lines where something went become one, and a file does not start
  // with a blank line it did not have
  const joined = lines.join(eol).replace(/(?:\r?\n){3,}/g, `${eol}${eol}`);

  return /^\s*\n/.test(text) ? joined : joined.replace(/^(?:\r?\n)+/, "");
};

/* ------------------------------------------------------------------ 3: titles */

const dropTitleWords = (text) =>
  text
    // "wave 7r: the tab ..." and 'wave 5o benchmark' at the start of a string
    .replace(/(["'`])[Ww]ave\s?\d+[a-z]?\s*[:,]\s*/g, "$1");

/* ---------------------------------------------------------------------- the whole */

/**
 * The name of a person in the path of their own machine becomes `you`:
 * `C:\Users\sam\work` -> `C:\Users\you\work`, `/home/sam/` -> `/home/you/`.
 */
export const scrubLocalPaths = (text) =>
  text
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)(?!you\b)[A-Za-z0-9._-]+/g, "$1you")
    .replace(/(\/home\/)(?!you\b)[a-z][a-z0-9._-]*/g, "$1you")
    .replace(/(\/Users\/)(?!you\b)[A-Za-z][A-Za-z0-9._-]*/g, "$1you");

/** the text of one file as the public repo may hold it */
export const scrubText = (path, original) => {
  const kind = kindOf(path);
  const text = scrubLocalPaths(original);

  if (kind === "text" && !/\.(?:txt|html|xml|svg)$/i.test(path)) {
    return removeIds(text);
  }

  return dropTitleWords(dropMethod(removeIds(text), kind));
};

/**
 * The text of one file as the public repo may hold it, with the map of reviewed
 * rewrites, and a report of what the map does not hold.
 *
 * `unmapped` lists the sentences that name the method and are not in the map:
 * the sync stops on them, unless `allowDrop` says they may go (a first look at
 * a tree, never a publication).
 */
export const scrubFile = (
  path,
  text,
  { map = null, allowDrop = false } = {},
) => {
  const before = context;

  context = { map, unmapped: [], allowDrop };

  try {
    const out = scrubText(path, text);

    return { text: out, unmapped: [...new Set(context.unmapped)] };
  } finally {
    context = before;
  }
};

/** a commit message as the public repo may hold it, or null when nothing of it is left */
export const scrubMessage = (
  message,
  { map = null, allowDrop = false } = {},
) => {
  const before = context;

  context = { map, unmapped: [], allowDrop };

  try {
    const cleaned = removeIds(message)
      .split("\n")
      .filter((line) => !/^Co-Authored-By:/i.test(line))
      .map((line) =>
        matchesMethod(line)
          ? rewriteMethodSentence(line)
          : OWNER_RE.test(line)
          ? rewriteOwner(line)
          : line,
      )
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      message: cleaned === "" ? null : cleaned,
      unmapped: [...new Set(context.unmapped)],
    };
  } finally {
    context = before;
  }
};

export { IDS_RE };
