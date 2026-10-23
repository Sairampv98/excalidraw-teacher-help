import { CaptureUpdateAction } from "@excalidraw/element";

import type { Action } from "./types";

/**
 * "Read the text" — hands an ordinary **image** over to the host app (D-105).
 *
 * The owner asked for the OCR of a screenshot to be available for "regular
 * images aswell": a screenshot the teacher pasted in by hand is an ordinary
 * image element, and it deserves the same choice.
 *
 * The library cannot read anything itself: the OCR engine lives in the bridge's
 * Node process and never in the browser (D-59). So the library only owns the
 * **offer** — the context menu entry — and the host owns the read, exactly as
 * `actionReformatSelection` hands a selection over.
 *
 * The entry only appears when the selection holds an image, and only when the
 * host app actually handles the hook.
 */
export const actionOcrImage: Action = {
  name: "ocrImage",
  label: "labels.ocrImage",
  trackEvent: { category: "element" },
  perform: (elements, appState, _formData, app) => {
    const image = elements.find((element) => element.type === "image");

    if (!image) {
      return false;
    }

    app.props.onOcrImage?.({ element: image, appState });

    return {
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  predicate: (elements, appState, appProps) => {
    if (!appProps.onOcrImage) {
      return false;
    }

    // The element the menu is **about**: the one under the pointer when the
    // menu opened (AC-154). The entry belongs to **that** element and not to
    // the selection, so it is still there when the selection is something
    // else - and a picture the teacher did not select first is a picture the
    // teacher still wants read.
    const contextElementId = appState.contextMenu?.elementId;

    if (contextElementId) {
      const context = elements.find(
        (element) => element.id === contextElementId,
      );

      // only a picture can be read
      return context?.type === "image";
    }

    // no menu is open: the choice is about the selection
    return elements.some(
      (element) =>
        element.type === "image" && !!appState.selectedElementIds[element.id],
    );
  },
};
