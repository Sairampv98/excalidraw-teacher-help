import { isImageElement, isPosterPanelElement } from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";

import { ToolButton } from "../components/ToolButton";
import { cropIcon } from "../components/icons";
import { t } from "../i18n";

import { register } from "./register";

export const actionToggleCropEditor = register({
  name: "cropEditor",
  label: "helpDialog.cropStart",
  icon: cropIcon,
  viewMode: true,
  trackEvent: { category: "menu" },
  keywords: ["image", "crop"],
  perform(elements, appState, _, app) {
    const selectedElement = app.scene.getSelectedElements({
      selectedElementIds: appState.selectedElementIds,
      includeBoundTextElement: true,
    })[0] as ExcalidrawImageElement;

    return {
      appState: {
        ...appState,
        isCropping: false,
        croppingElementId: selectedElement.id,
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  predicate: (elements, appState, _, app) => {
    const selectedElements = app.scene.getSelectedElements(appState);
    if (
      !appState.croppingElementId &&
      selectedElements.length === 1 &&
      (isImageElement(selectedElements[0]) ||
        // A **poster** panel is croppable too, but not by the library's
        // in-place crop mode: that mode rewrites the element's own `crop`
        // field, and a poster panel has none — and a panel must be left
        // untouched by the crop (D-68).
        //
        // So the entry point accepts the panel and puts it into crop mode;
        // every in-place crop handler is `isImageElement`-guarded and
        // therefore does nothing to it, and the **app** watches
        // `croppingElementId` and opens its own crop modal for the poster.
        isPosterPanelElement(selectedElements[0]))
    ) {
      return true;
    }
    return false;
  },
  PanelComponent: ({ appState, updateData, app }) => {
    const label = t("helpDialog.cropStart");

    return (
      <ToolButton
        type="button"
        icon={cropIcon}
        title={label}
        aria-label={label}
        onClick={() => updateData(null)}
      />
    );
  },
});
