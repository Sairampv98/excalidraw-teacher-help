import type { BridgeMessage } from "../../bridge/src/protocol";

/**
 * The **editor state** the bridge publishes.
 *
 * This module deliberately imports nothing from `vscode`, so the rules can be
 * tested without an editor - the same reason `config.ts` keeps the port and
 * the token rules out of the editor's API.
 */

/**
 * The part of a VS Code text editor the rule needs.
 *
 * It is described structurally rather than imported, so a test can hand it a
 * plain object.
 */
export interface EditorLike {
  document: {
    uri: { toString(): string };
    languageId: string;
    getText(): string;
    version: number;
    offsetAt(position: unknown): number;
  };
  selection: { start: unknown; end: unknown };
}

/**
 * The `editor:content` message for the given editor.
 *
 * **There is no "nothing to say" case.** When no file is open, the message
 * says so - with an empty uri - instead of not being sent at all. The panel
 * has to be able to tell "no file is open in the editor" apart from "the
 * extension has not answered yet", and it can only do that if the extension
 * always says which of the two it is (D-75).
 *
 * A message that is not sent is a message the panel cannot explain.
 */
export const editorContentMessage = (
  editor: EditorLike | undefined | null,
): Extract<BridgeMessage, { type: "editor:content" }> => {
  if (!editor) {
    return {
      v: 1,
      type: "editor:content",
      uri: "",
      language: "",
      text: "",
      version: 0,
    };
  }

  const document = editor.document;

  return {
    v: 1,
    type: "editor:content",
    uri: document.uri.toString(),
    language: document.languageId,
    text: document.getText(),
    selection: {
      start: document.offsetAt(editor.selection.start),
      end: document.offsetAt(editor.selection.end),
    },
    version: document.version,
  };
};

/**
 * Which editor the panel should mirror.
 *
 * `active` is the editor the teacher is looking at. It is `undefined` far
 * more often than it looks: the focus moves to the terminal, to the
 * explorer, to the extensions view - and the file the teacher is teaching
 * from is still open, still on a tab, and still what the panel should show.
 *
 * Publishing the empty state in that moment **erases the mirror** - the code
 * the panel was showing vanishes, for a reason the teacher cannot see and
 * cannot undo. So the last editor is **remembered**, and it keeps being
 * mirrored for as long as its document is open. Only a document that is
 * actually **closed** clears it.
 *
 * `isStillOpen` is asked about the remembered editor, so the rule can be
 * tested without an editor.
 */
export const editorToMirror = (
  last: EditorLike | undefined | null,
  active: EditorLike | undefined | null,
  isStillOpen: (editor: EditorLike) => boolean,
): EditorLike | undefined => {
  if (active) {
    return active;
  }

  if (last && isStillOpen(last)) {
    return last;
  }

  return undefined;
};
