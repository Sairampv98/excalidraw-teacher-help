import React, { useMemo, useState } from "react";

import { isPosterPanelElement } from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
} from "@excalidraw/element/types";

import {
  panelCornerPosition,
  panelScale,
  panelTransform,
} from "../scene/panelContent";
import { isBridgeCodePanel } from "../scene/panelContent";
import { canLockPanel } from "../scene/lockPanel";
import {
  PANEL_CHROME,
  panelChrome,
  panelScreenChrome,
} from "../scene/panelChrome";

import { t } from "../i18n";

import { LockedIcon, UnlockedIcon } from "./icons";

import type { PanelCamera } from "../scene/panelContent";
import type {
  BinaryFiles,
  PanelBridgeControls,
  PanelOcrControls,
  PanelOcrEngine,
} from "../types";

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
 * The lock button, the bridge box and the OCR button are drawn in viewport
 * coordinates: the panel's transform never touches them, so they are already
 * screen sized and they are **not** divided by the scale (D-92). Their sizes
 * come from `scene/panelChrome.ts` like every other size of the chrome — the
 * bridge box had none of its own, which is why its token field and its
 * Connect button were "almost invisible" (D-114).
 */
type PanelChromeProps = {
  panels: readonly ExcalidrawPanelElement[];
  elementsMap: ElementsMap;
  camera: PanelCamera;
  onToggleLock: (panelId: string) => void;
  /** the document's own files — a panel can only be locked if its content is one */
  files: BinaryFiles;
  /** the host app's bridge controls, when the host talks to a bridge */
  bridge?: PanelBridgeControls;
  /** the host app's OCR controls, when the host can read a picture (D-59) */
  ocr?: PanelOcrControls;
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
  const screen = panelScreenChrome;

  return (
    <div
      className="excalidraw__panel-bridge"
      data-testid="panel-bridge"
      data-panel-id={panel.id}
      data-bridge-state={bridge.status}
      style={{
        position: "absolute",
        // the box hangs clear of the panel's corner: the corner is where the
        // canvas draws the resize handle, and a control that sits on the
        // handle is a control that costs the teacher the handle (D-120)
        left: position.x + PANEL_CHROME.panelCornerInset,
        top: position.y,
        // the field is a control: it takes the pointer, unlike the outline
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: screen.chromeGap,
        padding: screen.bridgeBoxPadding,
        boxSizing: "border-box",
        width: `calc(${screen.bridgeFieldWidth} + 2 * ${screen.bridgeBoxPadding})`,
        borderRadius: "8px",
        background: "var(--island-bg-color)",
        boxShadow: "0 0 0 1px var(--color-surface-lowest)",
        color: "var(--text-primary-color)",
        fontSize: screen.bridgeFontSize,
      }}
    >
      <label
        className="excalidraw__panel-bridge-label"
        htmlFor={inputId}
        style={{ fontSize: screen.bridgeFontSize }}
      >
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
        style={{
          width: "100%",
          height: screen.bridgeFieldHeight,
          boxSizing: "border-box",
          padding: `0 ${screen.bridgeBoxPadding}`,
          borderRadius: "4px",
          border: "1px solid var(--input-border-color)",
          background: "var(--input-bg-color)",
          color: "inherit",
          fontSize: screen.bridgeFontSize,
          fontFamily: "inherit",
        }}
      />
      <div
        style={{
          display: "flex",
          gap: screen.chromeGap,
        }}
      >
        <button
          type="button"
          className="excalidraw__panel-bridge-paste"
          data-testid="panel-bridge-paste"
          onClick={() => bridge.onPasteToken?.()}
          style={{
            width: screen.bridgeButtonWidth,
            height: screen.bridgeButtonHeight,
            fontSize: screen.bridgeFontSize,
            fontFamily: "inherit",
            color: "inherit",
            background: "var(--button-gray-2)",
            border: "1px solid var(--default-border-color)",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {t("labels.panel.bridge.paste")}
        </button>
        <button
          type="button"
          className="excalidraw__panel-bridge-connect"
          data-testid="panel-bridge-connect"
          onClick={() => bridge.onConnect?.()}
          style={{
            width: screen.bridgeButtonWidth,
            height: screen.bridgeButtonHeight,
            fontSize: screen.bridgeFontSize,
            fontFamily: "inherit",
            color: "var(--color-primary-contrast, #fff)",
            background: "var(--color-primary)",
            border: "1px solid var(--color-primary)",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {t("labels.panel.bridge.connect")}
        </button>
      </div>
      <span
        className="excalidraw__panel-bridge-state"
        data-testid="panel-bridge-state"
        data-bridge-state={bridge.status}
        style={{
          maxWidth: screen.bridgeMessageMaxWidth,
          fontSize: screen.bridgeFontSize,
        }}
      >
        {bridge.message}
      </span>
    </div>
  );
};

/**
 * The **engine picker** of a panel (D-118).
 *
 * The engine was a VS Code setting, so choosing it meant leaving the
 * whiteboard. The picker is beside the "Read the text" button and it carries
 * the three engines, each with its **measured** speed as a colour - the
 * traffic lights the owner asked for: green for the fastest, amber for the
 * middle, red for the slowest.
 *
 * The library draws the picker; the **host** owns the engines and their
 * numbers (the engine itself never runs in the browser, D-59). The host also
 * owns the **choice**: it is per panel, and the VS Code setting stays the
 * fallback for a machine with no picker (D-118).
 */
const PanelOcrEnginePicker = ({
  panel,
  ocr,
}: {
  panel: ExcalidrawPanelElement;
  ocr: PanelOcrControls;
}) => {
  const [open, setOpen] = useState(false);

  const engines = ocr.engines ?? [];
  const screen = panelScreenChrome;

  if (!engines.length) {
    return null;
  }

  const chosenId = ocr.engineFor?.(panel.id) ?? engines[0].id;
  const chosen = engines.find((engine) => engine.id === chosenId) ?? engines[0];

  return (
    <div
      className="excalidraw__panel-ocr-engine"
      data-testid="panel-ocr-engine-picker"
      style={{ position: "relative" }}
    >
      <button
        type="button"
        className="excalidraw__panel-ocr-engine-button"
        data-testid="panel-ocr-engine-button"
        data-engine={chosen.id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        style={{
          width: screen.ocrPickerWidth,
          height: screen.ocrPickerHeight,
          display: "flex",
          alignItems: "center",
          gap: screen.chromeGap,
          padding: `0 ${screen.bridgeBoxPadding}`,
          boxSizing: "border-box",
          fontSize: screen.ocrPickerFontSize,
          fontFamily: "inherit",
          color: "inherit",
          background: "var(--island-bg-color)",
          border: "1px solid var(--default-border-color)",
          borderRadius: "4px",
          cursor: "pointer",
          // the button's size is decided (D-92): the flexbox may not take it away
          flexShrink: 0,
        }}
      >
        <PanelOcrEngineDot engine={chosen} screen={screen} />
        {chosen.label}
      </button>
      {open && (
        <div
          className="excalidraw__panel-ocr-engine-list"
          data-testid="panel-ocr-engine-list"
          role="listbox"
          style={{
            position: "absolute",
            // the list opens **upwards**: the control hangs at the panel's
            // bottom edge, and a list that opened downwards would leave the
            // screen
            bottom: "100%",
            left: 0,
            marginBottom: screen.chromeGap,
            display: "flex",
            flexDirection: "column",
            gap: screen.chromeGap,
            padding: screen.bridgeBoxPadding,
            borderRadius: "8px",
            background: "var(--island-bg-color)",
            boxShadow: "0 0 0 1px var(--color-surface-lowest)",
            color: "var(--text-primary-color)",
          }}
        >
          {engines.map((engine) => (
            <button
              key={engine.id}
              type="button"
              role="option"
              aria-selected={engine.id === chosen.id}
              className="excalidraw__panel-ocr-engine-option"
              data-testid="panel-ocr-engine"
              data-engine={engine.id}
              onClick={() => {
                ocr.onSelectEngine?.(panel.id, engine.id);
                setOpen(false);
              }}
              style={{
                height: screen.ocrPickerRowHeight,
                display: "flex",
                alignItems: "center",
                gap: screen.chromeGap,
                padding: `0 ${screen.bridgeBoxPadding}`,
                fontSize: screen.ocrPickerFontSize,
                fontFamily: "inherit",
                color: "inherit",
                background: "transparent",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <PanelOcrEngineDot engine={engine} screen={screen} />
              {engine.label}
              <span style={{ opacity: 0.7 }}>{engine.measuredMs} ms</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * The **traffic light** beside an engine's name (D-118).
 *
 * The colour is the host's: it comes from the project's own measurement, so
 * the light cannot disagree with the number beside it.
 */
const PanelOcrEngineDot = ({
  engine,
  screen,
}: {
  engine: PanelOcrEngine;
  screen: typeof panelScreenChrome;
}) => (
  <span
    className="excalidraw__panel-ocr-engine-dot"
    data-testid="panel-ocr-engine-dot"
    data-engine={engine.id}
    aria-hidden="true"
    style={{
      width: screen.ocrPickerDotSize,
      height: screen.ocrPickerDotSize,
      borderRadius: "50%",
      backgroundColor: engine.color,
      flexShrink: 0,
      display: "inline-block",
    }}
  />
);

/**
 * The **OCR option** of a panel (D-59).
 *
 * The button asks the host to read the panel's picture; the host owns the
 * read, because the engine lives in the bridge's Node process and never in the
 * browser. The message is the host's own — with no bridge it says that the
 * bridge is needed, and it never says nothing (D-59).
 *
 * The **engine picker** sits beside the button (D-118).
 */
const PanelOcrButton = ({
  panel,
  camera,
  ocr,
}: {
  panel: ExcalidrawPanelElement;
  camera: PanelCamera;
  ocr: PanelOcrControls;
}) => {
  const position = panelCornerPosition(panel, camera, "bottom-left");
  const screen = panelScreenChrome;

  return (
    <div
      className="excalidraw__panel-ocr"
      data-testid="panel-ocr"
      data-panel-id={panel.id}
      style={{
        position: "absolute",
        // the row hangs clear of the panel's corner: the corner is where the
        // canvas draws the resize handle (D-120)
        left: position.x + PANEL_CHROME.panelCornerInset,
        top: position.y,
        // the field is a control: it takes the pointer, unlike the outline
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: screen.chromeGap,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: screen.chromeGap,
        }}
      >
        <button
          type="button"
          className="excalidraw__panel-ocr-button"
          data-testid="panel-ocr-button"
          onClick={() => ocr.onOcr?.(panel.id)}
          disabled={ocr.busy || !ocr.onOcr}
          title={t("labels.panel.ocr")}
          aria-label={t("labels.panel.ocr")}
          style={{
            width: screen.ocrButtonWidth,
            height: screen.ocrButtonHeight,
            fontSize: screen.buttonFontSize,
            fontFamily: "inherit",
            color: "inherit",
            background: "var(--island-bg-color)",
            border: "1px solid var(--default-border-color)",
            borderRadius: "4px",
            cursor: ocr.busy || !ocr.onOcr ? "default" : "pointer",
            // the button's size is decided (D-92): the flexbox may not take it
            // away (D-108)
            flexShrink: 0,
          }}
        >
          {t("labels.panel.ocr")}
        </button>
        <PanelOcrEnginePicker panel={panel} ocr={ocr} />
      </div>
      <span
        className="excalidraw__panel-ocr-message"
        data-testid="panel-ocr-message"
        style={{ fontSize: screen.bridgeFontSize }}
      >
        {ocr.message}
      </span>
    </div>
  );
};

const PanelChromeItem = ({
  panel,
  elementsMap,
  camera,
  onToggleLock,
  files,
  bridge,
  ocr,
}: {
  panel: ExcalidrawPanelElement;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  onToggleLock: (panelId: string) => void;
  files: BinaryFiles;
  bridge?: PanelBridgeControls;
  ocr?: PanelOcrControls;
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
      >
        {lockable && (
          /**
           * The **lock**, inside the panel's box and clear of its corner.
           *
           * The corner is where the canvas draws the panel's resize handle,
           * and a control that sits on the handle is a control that costs the
           * teacher the handle (D-120). The camera owns the corner-most slot
           * (D-115), so the lock takes the slot beside it - and the room
           * between them is decided in `scene/panelChrome.ts` like every other
           * size.
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
      {bridge && isBridgeCodePanel(panel) && (
        <PanelBridgeField panel={panel} camera={camera} bridge={bridge} />
      )}
      {ocr && <PanelOcrButton panel={panel} camera={camera} ocr={ocr} />}
    </React.Fragment>
  );
};

export const PanelChrome = ({
  panels,
  elementsMap,
  camera,
  onToggleLock,
  files,
  bridge,
  ocr,
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
          bridge={bridge}
          ocr={ocr}
        />
      ))}
    </div>
  );
};
