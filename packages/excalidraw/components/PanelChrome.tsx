import React, { useMemo } from "react";

import { isPosterPanelElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
} from "@excalidraw/element/types";

import { panelScale, panelTransform } from "../scene/panelContent";
import { canLockPanel } from "../scene/lockPanel";
import { panelChrome } from "../scene/panelChrome";

import { t } from "../i18n";

import { LockedIcon, UnlockedIcon } from "./icons";

import type { PanelCamera } from "../scene/panelContent";
import type { BinaryFiles } from "../types";

/**
 * The chrome of the panel layer: the outline of a selected panel and its lock
 * button.
 *
 * The canvas paints nothing for a **live** panel, and a live panel's own
 * surface may be transparent, so the selected panel needs a visible boundary
 * of its own. The lock button is a DOM button, because the canvas cannot draw
 * an interactive control.
 *
 * The positions come from the library's own `sceneCoordsToViewportCoords` —
 * the oracle (D-34) — exactly as the panel's own placement does, so the
 * chrome and the panel cannot drift apart.
 *
 * ## The chrome that lives OUTSIDE the panel
 *
 * The lock button is drawn in viewport coordinates: the panel's transform
 * never touches it, so it is already screen sized and it is **not** divided by
 * the scale (D-92). Its size comes from `scene/panelChrome.ts` like every
 * other size of the chrome.
 *
 * The **camera**, the **read** and the **bridge box** are not here either:
 * they are actions of a panel, so they live in the panel's **properties**
 * (D-135, D-136) — see `components/PanelActions.tsx`. The chrome never
 * covers the picture it describes.
 */
type PanelChromeProps = {
  panels: readonly ExcalidrawPanelElement[];
  elementsMap: ElementsMap;
  camera: PanelCamera;
  onToggleLock: (panelId: string) => void;
  /** the document's own files — a panel can only be locked if its content is one */
  files: BinaryFiles;
};

const PanelChromeItem = ({
  panel,
  elementsMap,
  camera,
  onToggleLock,
  files,
}: {
  panel: ExcalidrawPanelElement;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  onToggleLock: (panelId: string) => void;
  files: BinaryFiles;
}) => {
  const { zoom, scrollX, scrollY } = camera;

  const transform = useMemo(
    () => panelTransform(panel, elementsMap, camera),
    // `camera` is rebuilt on every app state change; only its fields can change
    // what the transform comes out as
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      panel,
      elementsMap,
      zoom.value,
      scrollX,
      scrollY,
      camera.offsetLeft,
      camera.offsetTop,
    ],
  );

  const isPoster = isPosterPanelElement(panel);
  const label = isPoster ? t("labels.panel.unlock") : t("labels.panel.lock");

  /**
   * A control that cannot act must not be drawn (D-120).
   *
   * The lock freezes a panel into a poster, and a poster is a **picture** of
   * the panel's content. A panel whose content lives in another process - a
   * code panel, whose content is the editor's own window - has no picture to
   * freeze, so the lock is not drawn for it: the teacher gets a click that
   * teaches them nothing otherwise.
   */
  const lockable = isPoster || canLockPanel(panel, files);

  /**
   * The chrome's sizes, in the panel's own units (D-92).
   *
   * The lock hangs inside the panel's box, so its sizes are the screen sizes
   * divided by the scale - the very scale the panel's transform carries.
   */
  const chrome = panelChrome(panelScale(camera));

  return (
    <div
      className="excalidraw__panel-outline"
      data-testid="panel-outline"
      data-panel-id={panel.id}
      style={{
        position: "absolute",
        width: panel.width,
        height: panel.height,
        transform,
        transformOrigin: "0 0",
        pointerEvents: "none",
      }}
    >
      {lockable && (
        /**
         * The **lock**, inside the panel's box and clear of its corner.
         *
         * The corner is where the canvas draws the panel's resize handle,
         * and a control that sits on the handle is a control that costs the
         * teacher the handle (D-120). The lock takes the slot the camera
         * used to take (D-115, D-135), and the room between them is decided
         * in `scene/panelChrome.ts` like every other size.
         */
        <button
          type="button"
          className="excalidraw__panel-lock-button"
          data-testid="panel-lock-button"
          data-panel-id={panel.id}
          onClick={() => onToggleLock(panel.id)}
          title={label}
          aria-label={label}
          style={{
            position: "absolute",
            right: chrome.lockOffset,
            top: chrome.panelCornerInset,
            width: chrome.buttonSize,
            height: chrome.buttonSize,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            color: "var(--icon-fill-color)",
            background: "var(--island-bg-color)",
            border: "1px solid var(--default-border-color)",
            borderRadius: "4px",
            cursor: "pointer",
            // the button is a control: it takes the pointer, unlike the
            // outline
            pointerEvents: "auto",
            // the button's size is decided (D-92): the flexbox may not take
            // it away (D-108)
            flexShrink: 0,
          }}
        >
          {isPoster ? LockedIcon : UnlockedIcon}
        </button>
      )}
    </div>
  );
};

export const PanelChrome = ({
  panels,
  elementsMap,
  camera,
  onToggleLock,
  files,
}: PanelChromeProps) => {
  if (panels.length === 0) {
    return null;
  }

  return (
    <div
      className="excalidraw__panel-chrome"
      data-testid="panel-chrome"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        // the chrome must not steal the canvas's pointer: only the buttons
        // take it
        pointerEvents: "none",
      }}
    >
      {panels.map((panel) => (
        <PanelChromeItem
          key={panel.id}
          panel={panel}
          elementsMap={elementsMap}
          camera={camera}
          onToggleLock={onToggleLock}
          files={files}
        />
      ))}
    </div>
  );
};
