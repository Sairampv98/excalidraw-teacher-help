import React, { useMemo } from "react";

import { isPosterPanelElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
} from "@excalidraw/element/types";

import { panelCornerPosition, panelTransform } from "../scene/panelContent";

import { t } from "../i18n";

import { LockedIcon, UnlockedIcon } from "./icons";

import type { PanelCamera } from "../scene/panelContent";

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
 */
type PanelChromeProps = {
  panels: readonly ExcalidrawPanelElement[];
  elementsMap: ElementsMap;
  camera: PanelCamera;
  onToggleLock: (panelId: string) => void;
};

const PanelChromeItem = ({
  panel,
  elementsMap,
  camera,
  onToggleLock,
}: {
  panel: ExcalidrawPanelElement;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  onToggleLock: (panelId: string) => void;
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

  const buttonPosition = panelCornerPosition(panel, camera, "top-right");

  const isPoster = isPosterPanelElement(panel);
  const label = isPoster ? t("labels.panel.unlock") : t("labels.panel.lock");

  return (
    <React.Fragment>
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
      />
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
          left: buttonPosition.x,
          top: buttonPosition.y,
          transform: "translate(-50%, -50%)",
          pointerEvents: "auto",
        }}
      >
        {isPoster ? LockedIcon : UnlockedIcon}
      </button>
    </React.Fragment>
  );
};

export const PanelChrome = ({
  panels,
  elementsMap,
  camera,
  onToggleLock,
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
        />
      ))}
    </div>
  );
};
