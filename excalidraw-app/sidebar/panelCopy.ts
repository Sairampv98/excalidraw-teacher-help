/**
 * The app's **copy** control for the code panel's editor (D-142).
 *
 * The library draws the control and reports what the teacher selected; the app
 * puts the code on the clipboard and arms ONE paste on the canvas - so the code
 * arrives as the **same code card** the markdown viewer's `Copy code` brings,
 * and not as a row of plain text boxes.
 *
 * The code card is the app's own: the library does not own the scene, and the
 * card is a scene thing.
 */

import type { PanelCopyControls } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { copyCodeForCanvas } from "./insertIntoScene";

/**
 * The copy control, wired to the app's own canvas.
 *
 * The api comes as a **getter**: the app's api arrives after the first render,
 * and the control must be the same control when it does.
 */
export const panelCopyControls = (
  getApi: () => ExcalidrawImperativeAPI | null,
): PanelCopyControls => ({
  onCopyAsCodeBlock: (_panelId, code, options) => {
    const api = getApi();

    if (!api) {
      return;
    }

    void copyCodeForCanvas(api, code, options);

    api.setToast({
      message: options?.language
        ? "Copied - paste on the canvas for a highlighted code card"
        : "Copied - paste on the canvas for a code card",
      closable: true,
    });
  },
});
