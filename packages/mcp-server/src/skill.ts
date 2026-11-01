/**
 * The assistant's skill (D-428): the guide, with the name and the description
 * an assistant needs to load it.
 *
 * The file itself is made from this, by `scripts/buildMcpSkill.mjs`, and a test
 * fails when the two differ - so the skill and the guide the server serves are
 * always the same text.
 */

import { whiteboardGuide } from "./guide";

/** the name the skill is loaded under */
export const SKILL_NAME = "excalidraw-whiteboard";

/** when the skill is the right one to load */
export const SKILL_DESCRIPTION =
  "Draw on, and teach with, a running Excalidraw whiteboard: its pages and elements, its charts and their animation, a deck of slides and a lesson page. Use it when the work is a class, a lesson, a diagram, a slide deck or a handout on a whiteboard.";

/** the skill, as it is written to the file */
export const skillMarkdown = (): string =>
  [
    "---",
    `name: ${SKILL_NAME}`,
    `description: ${SKILL_DESCRIPTION}`,
    "---",
    "",
    whiteboardGuide(),
    "",
  ].join("\n");
