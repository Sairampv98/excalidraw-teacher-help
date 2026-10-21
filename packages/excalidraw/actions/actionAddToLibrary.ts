import { LIBRARY_DISABLED_TYPES, randomId } from "@excalidraw/common";
import { deepCopyElement } from "@excalidraw/element";
import { isLivePanelElement } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import { t } from "../i18n";

import { register } from "./register";

export const actionAddToLibrary = register({
  name: "addToLibrary",
  trackEvent: { category: "element" },
  perform: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    });

    for (const type of LIBRARY_DISABLED_TYPES) {
      if (selectedElements.some((element) => element.type === type)) {
        return {
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
          appState: {
            ...appState,
            errorMessage: t(`errors.libraryElementTypeError.${type}`),
          },
        };
      }
    }

    // DECISION: a **live** panel may not be added to the library — a live
    // surface is not meaningful in a shared library, and its content would be
    // a dead reference there. A **poster** panel may: at that point it is an
    // ordinary picture, exactly like an image.
    //
    // (`LIBRARY_DISABLED_TYPES` lives in `packages/common`, outside this
    // wave's scope, and it cannot name "panel" — the check is here.)
    if (selectedElements.some((element) => isLivePanelElement(element))) {
      return {
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
        appState: {
          ...appState,
          errorMessage: t("errors.libraryElementTypeError.panel"),
        },
      };
    }

    return app.library
      .getLatestLibrary()
      .then((items) => {
        return app.library.setLibrary([
          {
            id: randomId(),
            status: "unpublished",
            elements: selectedElements.map(deepCopyElement),
            created: Date.now(),
          },
          ...items,
        ]);
      })
      .then(() => {
        return {
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
          appState: {
            ...appState,
            toast: { message: t("toast.addedToLibrary") },
          },
        };
      })
      .catch((error) => {
        return {
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
          appState: {
            ...appState,
            errorMessage: error.message,
          },
        };
      });
  },
  label: "labels.addToLibrary",
});
