import { waitFor } from "@testing-library/dom";
import { fireEvent } from "@testing-library/react";

import {
  stripIgnoredNodesFromErrorMessage,
  trimErrorStack,
} from "../test-utils";

export const TEXT_EDITOR_SELECTOR =
  ".excalidraw-textEditorContainer > textarea";

/**
 * Is this element actually an editor, rather than a placeholder that happens
 * to share the class?
 *
 * The TTD dialog renders THREE different things with the `ttd-dialog-input`
 * class: the CodeMirror container, a plain `<textarea>` fallback, and a
 * loading placeholder (`ttd-dialog-input--loading`) holding a spinner. It
 * starts in the loading state and swaps in the real editor from an effect
 * that lazy-loads CodeMirror, so the placeholder is present from the first
 * paint.
 *
 * Waiting only for the node to exist therefore returns the spinner, whose
 * textContent is the empty string - which is how the mermaid test came to
 * snapshot an empty editor and fail intermittently under load.
 */
const isEditorElement = (el: Element | null): boolean => {
  if (!el) {
    return false;
  }
  if (el.classList.contains("ttd-dialog-input--loading")) {
    return false;
  }
  return (
    el.tagName === "TEXTAREA" ||
    el.tagName === "INPUT" ||
    !!el.querySelector(".cm-content")
  );
};

export const getTextEditor = async ({
  selector = TEXT_EDITOR_SELECTOR,
  waitForEditor = true,
}: { selector?: string; waitForEditor?: boolean } = {}) => {
  const error = trimErrorStack(new Error());
  try {
    const query = () => document.querySelector(selector) as HTMLTextAreaElement;
    if (waitForEditor) {
      await waitFor(() => {
        const el = query();
        if (!isEditorElement(el)) {
          throw new Error("the text editor is not mounted yet");
        }
      });
      return query();
    }
    return query();
  } catch (err: any) {
    stripIgnoredNodesFromErrorMessage(err);
    err.stack = error.stack;
    throw err;
  }
};

export const updateTextEditor = (
  editor: HTMLTextAreaElement | HTMLInputElement,
  value: string,
) => {
  fireEvent.change(editor, { target: { value } });
  fireEvent.input(editor);
};
