import React, { useMemo } from "react";

import { isPosterPanelElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
} from "@excalidraw/element/types";

import { panelCornerPosition, panelTransform } from "../scene/panelContent";
import { isBridgeCodePanel } from "../scene/panelContent";

import { t } from "../i18n";

import { LockedIcon, UnlockedIcon } from "./icons";

import type { PanelCamera } from "../scene/panelContent";
import type { PanelBridgeControls } from "../types";

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
  /** the host app's bridge controls, when the host talks to a bridge */
  bridge?: PanelBridgeControls;
};

/**
 * The **bridge field** of a code panel: the token, a button that pastes it
 * from the clipboard, and the state of the connection.
 *
 * The field is drawn by the library and driven by the **host**: the host owns
 * the token, because the token is a secret, and the host owns the connection,
 * because the host is the side that talks to the bridge (D-52).
 *
 * The token is masked in the field. It is held in memory for the session only:
 * it is never written to disk and never put in a URL (D-50).
 */
const PanelBridgeField = ({
  panel,
  camera,
  bridge,
}: {
  panel: ExcalidrawPanelElement;
  camera: PanelCamera;
  bridge: PanelBridgeControls;
}) => {
  const position = panelCornerPosition(panel, camera, "top-left");
  const inputId = `panel-bridge-token-${panel.id}`;

  return (
    <div
      className="excalidraw__panel-bridge"
      data-testid="panel-bridge"
      data-panel-id={panel.id}
      data-bridge-state={bridge.status}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        // the field is a control: it takes the pointer, unlike the outline
        pointerEvents: "auto",
      }}
    >
      <label className="excalidraw__panel-bridge-label" htmlFor={inputId}>
        {t("labels.panel.bridge.label")}
      </label>
      <input
        id={inputId}
        className="excalidraw__panel-bridge-token"
        data-testid="panel-bridge-token"
        type="password"
        value={bridge.token}
        placeholder={t("labels.panel.bridge.placeholder")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => bridge.onTokenChange?.(event.target.value)}
      />
      <button
        type="button"
        className="excalidraw__panel-bridge-paste"
        data-testid="panel-bridge-paste"
        onClick={() => bridge.onPasteToken?.()}
      >
        {t("labels.panel.bridge.paste")}
      </button>
      <button
        type="button"
        className="excalidraw__panel-bridge-connect"
        data-testid="panel-bridge-connect"
        onClick={() => bridge.onConnect?.()}
      >
        {t("labels.panel.bridge.connect")}
      </button>
      <span
        className="excalidraw__panel-bridge-state"
        data-testid="panel-bridge-state"
        data-bridge-state={bridge.status}
      >
        {bridge.message}
      </span>
    </div>
  );
};

const PanelChromeItem = ({
  panel,
  elementsMap,
  camera,
  onToggleLock,
  bridge,
}: {
  panel: ExcalidrawPanelElement;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  onToggleLock: (panelId: string) => void;
  bridge?: PanelBridgeControls;
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
      {bridge && isBridgeCodePanel(panel) && (
        <PanelBridgeField panel={panel} camera={camera} bridge={bridge} />
      )}
    </React.Fragment>
  );
};

export const PanelChrome = ({
  panels,
  elementsMap,
  camera,
  onToggleLock,
  bridge,
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
          bridge={bridge}
        />
      ))}
    </div>
  );
};
