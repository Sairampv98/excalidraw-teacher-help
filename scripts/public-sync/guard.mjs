/**
 * The leak guard of the public mirror.
 *
 * It looks at a scrubbed tree (the files that are about to be published) and at
 * the messages of the commits that are about to be published, and finds what
 * must not leave: the words and ids of the way this repo is developed, secrets,
 * the paths of a person's own machine, and the files that are denied. A finding
 * names the file, the line and the rule, never the value of a secret.
 *
 * It is pure: files in, findings out. The sync stops on any finding.
 */

import { IDS_RE, METHOD_WORDS } from "./scrub.mjs";

/** the rules a line is held against, with the name a finding gives them */
const LINE_RULES = [
  ...METHOD_WORDS.map((re) => ({ rule: "method-word", re })),
  { rule: "id", re: new RegExp(IDS_RE.source) },
  { rule: "secret", re: /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/ },
  { rule: "secret", re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    rule: "secret",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  { rule: "secret", re: /\bsk-[A-Za-z0-9]{24,}\b/ },
  { rule: "secret", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  {
    rule: "secret",
    re: /\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{32,}["']/i,
  },
  {
    rule: "local-path",
    // the placeholder `you` is what the scrub puts where a person's name was
    re: /(?:\b[A-Za-z]:[\\/]+Users[\\/]+(?!you\b)[A-Za-z0-9._-]+|\/home\/(?!you\b)[a-z][a-z0-9._-]+\/|\/Users\/(?!you\b)[A-Za-z][A-Za-z0-9._-]+\/)/,
  },
];

/** a value that says it is a fixture is not a credential */
const PLACEHOLDER =
  /\b(?:test|fake|placeholder|example|dummy|not a (?:credential|secret))\b/i;

/** whether a path is one of the denied ones: a file, or everything under a folder */
export const isDenied = (path, deny) =>
  deny.some((entry) =>
    entry.endsWith("/") ? path.startsWith(entry) : path === entry,
  );

/** whether a path is left alone by the scrub and the guard (locale files, lock files) */
export const isUntouched = (path, untouched) =>
  untouched.some((entry) => path.includes(entry) || path.endsWith(entry));

const isBinary = (content) =>
  typeof content !== "string" && Buffer.from(content).includes(0);

/** the findings in one text, with the line each is on */
export const scanText = (path, text) => {
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const { rule, re } of LINE_RULES) {
      if (rule === "secret" && PLACEHOLDER.test(line)) {
        continue;
      }

      if (re.test(line)) {
        findings.push({ file: path, line: index + 1, rule });
        break;
      }
    }
  });

  return findings;
};

/**
 * Scans a tree: `files` maps a path to its content (a string, or a Buffer for a
 * binary). A denied file is a finding of its own; a binary or an untouched file
 * is not read.
 */
export const scanTree = (files, { deny = [], untouched = [] } = {}) => {
  const findings = [];

  for (const [path, content] of files) {
    if (isDenied(path, deny)) {
      findings.push({ file: path, line: 0, rule: "denied-file" });
      continue;
    }

    if (isUntouched(path, untouched) || isBinary(content)) {
      continue;
    }

    findings.push(...scanText(path, String(content)));
  }

  return findings;
};

/** the findings in the messages of the commits that are about to be published */
export const scanMessages = (messages) =>
  messages.flatMap(({ id, message }) =>
    scanText(`commit ${id}`, message).map((finding) => ({
      ...finding,
      file: `commit ${id}`,
    })),
  );

/** a finding as one line of a report */
export const describeFinding = ({ file, line, rule }) =>
  `${file}${line ? `:${line}` : ""}  ${rule}`;
