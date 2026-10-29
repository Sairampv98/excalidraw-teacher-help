import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertTextBoxIntoScene } from "./insertIntoScene";
import { insertTextAsCodeCard, insertTextAsTable } from "./reformat";

/**
 * What a teacher can do with the text they just selected in the viewer: it is
 * already on the clipboard, and here it can also go straight onto the page as
 * a code card or as a table.
 */
export const SelectionBar = ({
  api,
  text,
  onDone,
}: {
  api: ExcalidrawImperativeAPI | null;
  text: string;
  onDone: () => void;
}) => {
  const run = async (as: "codeCard" | "table" | "textBox") => {
    if (!api) {
      return;
    }

    try {
      const placed =
        as === "table"
          ? await insertTextAsTable(api, text)
          : as === "textBox"
          ? !!insertTextBoxIntoScene(api, text)
          : await insertTextAsCodeCard(api, text);

      if (!placed) {
        api.setToast({
          message: "There is no table in the selected text",
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

  return (
    <div className="app-doc-selection" role="group" aria-label="Selected text">
      <span className="app-doc-selection__label">Selected text (copied)</span>
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
    </div>
  );
};
