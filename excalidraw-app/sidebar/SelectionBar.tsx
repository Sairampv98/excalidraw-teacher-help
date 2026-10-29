import { useCallback, useEffect } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { TextStyleRun } from "@excalidraw/element/types";

import {
  insertOcrLinesIntoScene,
  insertPdfPictureIntoScene,
  insertTextBoxIntoScene,
} from "./insertIntoScene";
import { insertTextAsCodeCard, insertTextAsTable } from "./reformat";
import { SidebarIcon } from "./SidebarIcons";

import type { StyledOcrLine } from "../ocr/ocrLayout";

import type { SidebarIconName } from "./SidebarIcons";

/** the picture of a part of a page, for the choice of an image (D-315) */
export type SelectionPicture = {
  dataURL: string;
  width: number;
  height: number;
};

type Choice = "codeCard" | "table" | "textBox" | "where" | "image";

/**
 * What a teacher can do with the text they just selected in the viewer: it is
 * already on the clipboard, and here it can also go straight onto the page as
 * a code card, as a text box or as a table - or, for the text of a PDF page,
 * where it was on the page (D-301), and the part of the page as an image
 * (D-315).
 *
 * The choices are icon buttons in one row (D-314, D-317): under the box that
 * was drawn on a PDF, and under the end of the text that was selected in a
 * document. Only the ones that can be made are there.
 */
export const SelectionBar = ({
  api,
  text,
  lines,
  styleRuns,
  picture,
  onDone,
}: {
  api: ExcalidrawImperativeAPI | null;
  text: string;
  /** where the selected text was on its page, when the document knows */
  lines?: readonly StyledOcrLine[];
  /**
   * the parts of `text` that are bold or italic in the document (D-321): a text
   * box made of the text has them too
   */
  styleRuns?: readonly TextStyleRun[];
  /** the picture of the selected part of a page, when the document has one */
  picture?: () => Promise<SelectionPicture | null> | SelectionPicture | null;
  onDone: () => void;
}) => {
  const run = async (as: Choice) => {
    if (!api) {
      return;
    }

    try {
      let placed: boolean;

      if (as === "image") {
        const taken = await picture?.();

        placed = !!taken && !!insertPdfPictureIntoScene(api, taken);
      } else if (as === "table") {
        placed = await insertTextAsTable(api, text);
      } else if (as === "where") {
        placed = insertOcrLinesIntoScene(api, lines ?? []).length > 0;
      } else if (as === "textBox") {
        placed = !!insertTextBoxIntoScene(api, text, { styleRuns });
      } else {
        placed = await insertTextAsCodeCard(api, text);
      }

      if (!placed) {
        api.setToast({
          message:
            as === "where"
              ? "The selected text has no place on the page to go back to"
              : as === "image"
              ? "There is no picture of the selected part of the page"
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

  const hasText = text.trim().length > 0;

  /** one icon of the row, with its name */
  const choice = (
    as: Choice,
    testId: string,
    name: string,
    icon: SidebarIconName,
    title = name,
  ) => (
    <button
      key={as}
      type="button"
      className="app-sidebar-icon app-sidebar-icon--small"
      data-testid={testId}
      title={title}
      aria-label={name}
      onClick={() => run(as)}
    >
      <SidebarIcon name={icon} size={16} />
    </button>
  );

  return (
    <div
      className="app-doc-selection"
      role="group"
      aria-label="Selected text, copied"
    >
      {hasText && (
        <>
          {choice(
            "codeCard",
            "selection-code-card",
            "As a code card",
            "codeCard",
          )}
          {choice("textBox", "selection-text-box", "As a text box", "textBox")}
          {choice("table", "selection-table", "As a table", "table")}
        </>
      )}
      {hasText &&
        !!lines?.length &&
        choice(
          "where",
          "selection-where",
          "Where it was",
          "where",
          "One text for each line, at the place it had on the page",
        )}
      {picture &&
        choice(
          "image",
          "selection-image",
          "As an image",
          "image",
          "The selected part of the page, as an image",
        )}
      <button
        type="button"
        className="app-sidebar-icon app-sidebar-icon--small app-doc-selection__close"
        data-testid="selection-close"
        title="Close"
        aria-label="Close"
        onClick={close}
      >
        <SidebarIcon name="close" size={14} />
      </button>
    </div>
  );
};
