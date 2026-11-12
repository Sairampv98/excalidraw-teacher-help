/**
 * The message of a public commit.
 *
 * A private commit that brought in a task carries the task's id in a trailer;
 * the description of that task - the body of its task file - says in plain
 * words what the change is for. The public message is that description, through
 * the same rewrite as the files, with a one-line subject. A commit with no
 * task gets a subject written from the paths it changed.
 */

import { matchesMethod, scrubMessage } from "./scrub.mjs";

const MAX_SUBJECT = 72;

/** the id of the task a private commit belongs to, from its trailer */
export const taskIdOf = (message) =>
  /^Tins-(?:Merge|Task):[ \t]*(\S+)/m.exec(message)?.[1] ?? null;

/** what the kit writes in a new task file until someone describes the task */
export const PLACEHOLDER_BODY = "(describe the task here)";

/**
 * The description in a task file: everything after its front matter. The kit's
 * placeholder is no description: a public commit must not say it (D-590), so it
 * counts as none and the message is written from the paths that changed.
 */
export const taskBody = (taskText) => {
  const body = taskText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();

  if (body === PLACEHOLDER_BODY) {
    return "";
  }

  // the part written for the public, when the author wrote one (D-593)
  return publicSection(body) || body;
};

/**
 * The text under a `## Public` heading of a description, up to the next `##`
 * heading: the author's own words for the public message, written in public
 * wording when the task was described. Empty when there is none.
 */
export const publicSection = (body) => {
  const match =
    /^##[ \t]+Public[ \t]*\r?\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/im.exec(body);

  return match ? match[1].trim() : "";
};

/** whether a task file has such a section with something in it */
export const hasPublicSection = (taskText) =>
  publicSection(
    taskText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim(),
  ) !== "";

/** the first sentence, or the first clause that fits a subject line */
const subjectOf = (text) => {
  // a paragraph is one line: its soft line breaks go, the blank lines stay
  const flat = text.replace(/[ \t]*\n(?!\s*\n)/g, " ").trim();
  const firstParagraph = flat.split(/\n\s*\n/)[0];
  const sentence = firstParagraph.split(/(?<=[.!?])\s+(?=[A-Z])/)[0];
  const subjectEnd = sentence.replace(/[.:;]$/, "");

  if (subjectEnd.length <= MAX_SUBJECT) {
    return {
      subject: subjectEnd,
      rest: flat.slice(sentence.length).replace(/^\s+/, ""),
    };
  }

  // too long: cut at the last comma, colon or semicolon that leaves a subject
  // worth reading, and failing that at a space; the rest goes on in the body
  const window = subjectEnd.slice(0, MAX_SUBJECT + 1);
  const mark = Math.max(
    window.lastIndexOf(","),
    window.lastIndexOf(";"),
    window.lastIndexOf(":"),
  );
  const space = window.lastIndexOf(" ");
  const at = mark > 25 ? mark : space > 20 ? space : MAX_SUBJECT;
  const subject = subjectEnd.slice(0, at).replace(/[,;:\s]+$/, "");

  return {
    subject,
    rest: flat.slice(subject.length).replace(/^[,;:\s]+/, ""),
  };
};

/** a subject written from what a commit changed, when it has no description */
export const subjectFromPaths = (paths) => {
  const places = [
    ...new Set(
      paths.map((path) => {
        const parts = path.split("/");

        return parts.length > 2 ? parts.slice(0, 2).join("/") : parts[0];
      }),
    ),
  ].slice(0, 3);

  return places.length ? `Update ${places.join(", ")}` : "Update the project";
};

/**
 * The public message for a private commit.
 *
 * Returns the message and the sentences of it that name the method and are not
 * in the map (`unmapped`); the sync stops on those unless dropping is allowed.
 */
export const deriveMessage = (
  { message, taskText, paths },
  { map = null, allowDrop = false } = {},
) => {
  const description = taskText ? taskBody(taskText) : "";
  const scrubbed = scrubMessage(description || "", { map, allowDrop });

  if (scrubbed.message) {
    const { subject, rest } = subjectOf(scrubbed.message);
    const body = rest.trim();

    return {
      message: `${subject.charAt(0).toUpperCase()}${subject.slice(1)}${
        body ? `\n\n${body}` : ""
      }\n`,
      unmapped: scrubbed.unmapped,
    };
  }

  // no usable description: the private subject through the same rewrite, or the
  // paths. A private subject that is the method's own words ("tins: merge task
  // x") says nothing a reader needs, so it is not rewritten at all.
  const subjectLine = message.split("\n")[0];

  if (matchesMethod(subjectLine)) {
    return {
      message: `${subjectFromPaths(paths)}\n`,
      unmapped: scrubbed.unmapped,
    };
  }

  const own = scrubMessage(subjectLine, { map, allowDrop });

  return {
    message: `${own.message ?? subjectFromPaths(paths)}\n`,
    unmapped: [...scrubbed.unmapped, ...own.unmapped],
  };
};
