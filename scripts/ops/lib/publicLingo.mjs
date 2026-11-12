/**
 * The warnings about public wording (D-594).
 *
 * The mirror publishes what the scrubber leaves (D-592, D-593). These functions
 * tell an author, before a gate, where the public wording is missing or has
 * gone out of date. They only WARN: nothing here fails a gate.
 *
 * Pure: the old and the new text of a file in, the warnings out.
 */

import { hasPublicSection } from "../../public-sync/message.mjs";
import { kindOf, scrubFile } from "../../public-sync/scrub.mjs";

/** the leader of a comment line in the languages the mirror reads */
const LEADER = /^\s*(?:\/\/\/?|#+|\*(?!\/)|\{?\/\*\*?)[ \t]?/;
const PUBLIC_LINE = /^\s*public:[ \t]+\S/;

const squash = (text) => text.replace(/\s+/g, " ").trim();

/** the lines of every run of comment lines, the leaders off; a document is one run */
const commentRuns = (path, text) => {
  const lines = text.split(/\r?\n/);

  if (kindOf(path) === "markdown") {
    return [lines];
  }

  const runs = [];
  let current = [];

  for (const line of lines) {
    if (LEADER.test(line)) {
      current.push(line.replace(LEADER, "").replace(/\s*\*\/\}?\s*$/, ""));
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }

  if (current.length) {
    runs.push(current);
  }

  return runs;
};

/**
 * The partner pairs of a file: for each `public:` paragraph, the private text
 * directly above it (back to a blank line or the previous partner).
 */
export const pairsOf = (path, text) => {
  const pairs = [];

  for (const run of commentRuns(path, text)) {
    // paragraphs: a blank line or a partner line starts a new one
    const paragraphs = [];
    let current = [];

    const flush = () => {
      if (current.length) {
        paragraphs.push({ lines: current, blank: false });
        current = [];
      }
    };

    for (const line of run) {
      if (line.trim() === "") {
        flush();
        paragraphs.push({ lines: [], blank: true });
      } else if (PUBLIC_LINE.test(line) && current.length) {
        flush();
        current.push(line);
      } else {
        current.push(line);
      }
    }

    flush();

    let from = 0;

    paragraphs.forEach((paragraph, k) => {
      if (paragraph.blank || !PUBLIC_LINE.test(paragraph.lines[0])) {
        return;
      }

      const above = [];

      for (let j = k - 1; j >= from && !paragraphs[j].blank; j--) {
        above.unshift(...paragraphs[j].lines);
      }

      if (above.length) {
        pairs.push({
          private: squash(above.join(" ")),
          public: squash(
            paragraph.lines.join(" ").replace(/^\s*public:[ \t]+/, ""),
          ),
        });
      }

      from = k + 1;
    });
  }

  return pairs;
};

/**
 * Comments this change added that name the method and have no public partner:
 * the sentences the scrubber cannot publish and the map does not hold, now, and
 * not before (what was already unmapped is old debt, not this change's).
 */
export const unpairedComments = ({ path, oldText, newText, map = null }) => {
  const before = new Set(scrubFile(path, oldText ?? "", { map }).unmapped);

  return scrubFile(path, newText, { map }).unmapped.filter(
    (sentence) => !before.has(sentence),
  );
};

/**
 * Partners that went stale: the private comment of a pair was edited and the
 * `public:` wording under it was left as it was.
 */
export const stalePartners = ({ path, oldText, newText }) => {
  const old = pairsOf(path, oldText ?? "");

  return pairsOf(path, newText).filter((pair) =>
    old.some(
      (before) =>
        before.public === pair.public && before.private !== pair.private,
    ),
  );
};

/** the warnings of one changed, published file, as lines for a person */
export const warningsForFile = ({ path, oldText, newText, map = null }) => {
  const warnings = [];

  for (const sentence of unpairedComments({ path, oldText, newText, map })) {
    warnings.push(
      `${path}: a comment that names the method has no public wording: "${sentence.slice(
        0,
        80,
      )}". Add a line under it that starts with "public:".`,
    );
  }

  for (const pair of stalePartners({ path, oldText, newText })) {
    warnings.push(
      `${path}: the private comment "${pair.private.slice(
        0,
        60,
      )}" was changed but its "public:" line was not: "${pair.public.slice(
        0,
        60,
      )}".`,
    );
  }

  return warnings;
};

/** a task that publishes files and has no `## Public` section in its file (D-593) */
export const missingPublicSection = ({ taskText, publishedFiles }) =>
  publishedFiles.length > 0 && !hasPublicSection(taskText ?? "")
    ? [
        `the task publishes ${publishedFiles.length} file(s) and its file has no "## Public" section: the public message will be written from the paths.`,
      ]
    : [];
