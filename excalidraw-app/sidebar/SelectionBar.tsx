import { useCallback, useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  insertOcrLinesIntoScene,
  insertTextBoxIntoScene,
} from "./insertIntoScene";
import { insertTextAsCodeCard, insertTextAsTable } from "./reformat";
import { SidebarIcon } from "./SidebarIcons";

import type { OcrLine } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * What a teacher can do with the text they just selected in the viewer: it is
 * already on the clipboard, and here it can also go straight onto the page as
 * a code card or as a table - or, for the text of a PDF page, where it was on
 * the page (D-301).
 */
export const SelectionBar = ({
  api,
  text,
  lines,
  onDone,
}: {
  api: ExcalidrawImperativeAPI | null;
  text: string;
  /** where the selected text was on its page, when the document knows */
  lines?: readonly OcrLine[];
  onDone: () => void;
}) => {
  const run = async (as: "codeCard" | "table" | "textBox" | "where") => {
    if (!api) {
      return;
    }

    try {
      const placed =
        as === "table"
          ? await insertTextAsTable(api, text)
          : as === "where"
          ? insertOcrLinesIntoScene(api, lines ?? []).length > 0
          : as === "textBox"
          ? !!insertTextBoxIntoScene(api, text)
          : await insertTextAsCodeCard(api, text);

      if (!placed) {
        api.setToast({
          message:
            as === "where"
              ? "The selected text has no place on the page to go back to"
              : "There is no table in the selected text",
          closable: true,
        });
        return;
      }

      onDone();
    } catch (error) {
      console.error(error);
      api.setToast({ message: "Could not insert", closable: true });
    }
  };

  /** puts the bar away, and lets go of the selection that made it (D-306) */
  const close = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    onDone();
  }, [onDone]);

  // Escape puts the bar away first; it does not also reach what else listens
  // for it, so a second one is what closes the rest
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [close]);

  return (
    <div className="app-doc-selection" role="group" aria-label="Selected text">
      <div className="app-doc-selection__head">
        <span className="app-doc-selection__label">Selected text (copied)</span>
        <button
          type="button"
          className="app-sidebar-icon app-doc-selection__close"
          data-testid="selection-close"
          title="Close"
          aria-label="Close"
          onClick={close}
        >
          <SidebarIcon name="close" size={14} />
        </button>
      </div>
      <button
        type="button"
        className="app-sidebar-secondary"
        onClick={() => run("codeCard")}
      >
        As a code card
      </button>
      <button
        type="button"
        className="app-sidebar-secondary"
        onClick={() => run("textBox")}
      >
        As a text box
      </button>
      <button
        type="button"
        className="app-sidebar-secondary"
        onClick={() => run("table")}
      >
        As a table
      </button>
      {lines?.length ? (
        <button
          type="button"
          className="app-sidebar-secondary"
          data-testid="selection-where"
          title="One text for each line, at the place it had on the page"
          onClick={() => run("where")}
        >
          Where it was
        </button>
      ) : null}
    </div>
  );
};
