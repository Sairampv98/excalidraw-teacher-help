/**
 * The text editor that is open, and what is selected in it (D-320).
 *
 * There is one text editor at a time. Bold and italic are for the part of the
 * text that is selected in it - which only the editor's own textarea knows - so
 * the editor says here that it is open, and the style actions ask.
 */

let activeEditor: HTMLTextAreaElement | null = null;

/** the editor says it is open; `null` when it is closed */
export const setActiveTextEditor = (editor: HTMLTextAreaElement | null) => {
  activeEditor = editor;
};

/** the textarea of the open editor, if there is one */
export const getActiveTextEditor = () => activeEditor;

/**
 * What is selected in the open editor, as the characters of the text from
 * `start` up to `end` - or `null` when nothing is: a caret selects nothing.
 */
export const getTextEditorRange = (): { start: number; end: number } | null => {
  const editor = activeEditor;

  if (!editor || !editor.isConnected) {
    return null;
  }

  const start = Math.min(editor.selectionStart, editor.selectionEnd);
  const end = Math.max(editor.selectionStart, editor.selectionEnd);

  return start < end ? { start, end } : null;
};
