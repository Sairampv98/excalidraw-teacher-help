/**
 * The guide to the whiteboard's tools (D-427): what a model needs to know
 * before it draws on the board.
 *
 * It is written once, here, and two things carry it: the server serves it as a
 * resource, and the assistant's skill (D-428) is made from it. The list of the
 * tools in it is made from the groups in the code, so it cannot drift from
 * them.
 */

import { mcpToolGroupListings } from "../../excalidraw/mcp/toolGroups";

/** where the guide is served from */
export const GUIDE_URI = "excalidraw://guide/whiteboard";

/** what the guide says about the groups of the tools */
const groupsText = () =>
  mcpToolGroupListings()
    .map((group) => {
      const tools = group.tools
        .map((tool) => `- \`${tool.name}\` - ${tool.does}.`)
        .join("\n");

      return `### ${group.title}\n\n${tools}`;
    })
    .join("\n\n");

/** the guide, as plain text */
export const whiteboardGuide = (): string =>
  [
    "# The whiteboard for a class",
    "",
    "This is a running Excalidraw board - a fork of the whiteboard a teacher draws on. You draw on it with the tools below; the teacher sees every change as it happens and can undo it.",
    "",
    "## The pages and the positions",
    "",
    "The board holds pages, numbered from 1 as the teacher sees them. The page that is open is the one a tool works on when no page is named.",
    "",
    "Positions are page-relative: (0, 0) is the top-left corner of the page, in scene units. A page is at least 1920 by 1080 scene units, and a smaller page (a note, a slide) sits in the top-left of that area. A tool that says it works in scene units takes absolute positions instead.",
    "",
    "The elements come in the order they are drawn, bottom first. `list_elements` gives them in short, and `get_element` gives everything about one of them.",
    "",
    "## The tools, in groups",
    "",
    groupsText(),
    "",
    "## What is refused, and why",
    "",
    "- A change while **Allow changes** is off. The teacher turns it on in the board's Assistant panel; every tool that changes the board is refused until then.",
    "- A file outside the folders the teacher listed. The server reads and writes only in those folders, and a path that leaves them is refused.",
    "- The internet while **Allow internet** is off. It is off by default, and when it is on only https addresses that are public are fetched.",
    "- A tool that does not exist, or an argument of the wrong shape. The answer says what was expected.",
    "- A change that would be too large: more than 500 elements in one call, a document too long to read, a file too big to fetch.",
    "",
    "## How a change is undone",
    "",
    "Every change is one undo step: the teacher presses Ctrl+Z once and the whole of it goes. A deck of slides is one step and not one step per slide, and a lesson page with a chart in it is one step too.",
    "",
    "Read a page before you change it, and change as little as you can. The teacher's board is the document, not a scratchpad.",
  ].join("\n");
