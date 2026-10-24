/**
 * The **actions** of a panel: the camera, the read and the bridge box.
 *
 * These three controls used to be drawn INSIDE the panel's overlay, and that
 * made every one of them a button on top of a picture (D-135): on a YouTube
 * panel the picture is an **iframe** - a foreign document - and the iframe
 * takes the click and gives it to YouTube. The control was visible and dead,
 * and a teacher cannot tell a dead button from a broken one. The bridge box
 * was worse: it covered the VS Code editor and the live window, the very
 * things the teacher is looking at (D-136).
 *
 * So the actions live in the panel's **properties**: the panel's own fieldset
 * in the properties panel, which is ordinary DOM beside the canvas, where a
 * button always works. The rule: **the chrome never covers the picture it
 * describes.**
 *
 * ## The sizes are SCREEN sizes
 *
 * The controls live outside the panel's transform now, so they are not
 * divided by the panel's scale - they are the same size at every zoom
 * (`scene/panelChrome.ts`, D-92). The container publishes `--panel-scale: 1`,
 * so the stylesheet's `calc(14px / var(--panel-scale))` resolves to the icon's
 * own screen size.
 */

import React, { useState } from "react";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import { isBridgeCodePanel } from "../scene/panelContent";
import { PANEL_SCALE_PROPERTY, panelScreenChrome } from "../scene/panelChrome";

import { t } from "../i18n";

import { ScreenshotIcon } from "./icons";

import type {
  ExcalidrawProps,
  PanelBridgeControls,
  PanelOcrControls,
  PanelOcrEngine,
  PanelScreenshotControls,
} from "../types";

/**
 * The **camera** of a panel (D-102, D-135).
 *
 * The camera is a choice about a **panel**, so it belongs where the panel's
 * other choices are - in the panel's properties. It is drawn for every panel
 * kind, and it asks the **host** to take the picture: the host owns the
 * bridge, the pages and the files.
 *
 * The button keeps its decided size (D-92) and the flexbox may not take it
 * away (D-108).
 */
const PanelScreenshotButton = ({
  panel,
  screenshot,
}: {
  panel: ExcalidrawPanelElement;
  screenshot: PanelScreenshotControls;
}) => {
  const screen = panelScreenChrome;

  return (
    <button
      type="button"
      className="excalidraw__panel-screenshot-button"
      data-testid="panel-screenshot-button"
      data-panel-id={panel.id}
      onClick={() => screenshot.onCapture?.(panel.id)}
      title={t("labels.panel.screenshot.button")}
      aria-label={t("labels.panel.screenshot.button")}
      style={{
        width: screen.buttonSize,
        height: screen.buttonSize,
        fontSize: screen.buttonFontSize,
        // The chrome's size is DECIDED (D-92), and the flexbox may not take it
        // away (D-108).
        flexShrink: 0,
      }}
    >
      {ScreenshotIcon}
    </button>
  );
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
 *
 * The box is an ordinary block in the panel's own column now (D-136): it is
 * not floating over the picture any more, so it needs no position of its own.
 */
const PanelBridgeField = ({
  panel,
  bridge,
}: {
  panel: ExcalidrawPanelElement;
  bridge: PanelBridgeControls;
}) => {
  const inputId = `panel-bridge-token-${panel.id}`;
  const screen = panelScreenChrome;

  return (
    <div
      className="excalidraw__panel-bridge"
      data-testid="panel-bridge"
      data-panel-id={panel.id}
      data-bridge-state={bridge.status}
      style={{
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
            // the list opens **downwards**: the control sits in the panel's own
            // column in the properties panel, and there is room below it
            top: "100%",
            left: 0,
            marginTop: screen.chromeGap,
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
 * browser. The message is the host's own - with no bridge it says that the
 * bridge is needed, and it never says nothing (D-59).
 *
 * The **engine picker** sits beside the button (D-118).
 */
const PanelOcrButton = ({
  panel,
  ocr,
}: {
  panel: ExcalidrawPanelElement;
  ocr: PanelOcrControls;
}) => {
  const screen = panelScreenChrome;

  return (
    <div
      className="excalidraw__panel-ocr"
      data-testid="panel-ocr"
      data-panel-id={panel.id}
      style={{
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

/**
 * The panel's **actions**, in the panel's own column of the properties panel.
 *
 * The camera, the read and the bridge box are choices about a panel, and a
 * choice about a panel belongs where the panel's other choices are (D-135,
 * D-136). The controls are ordinary DOM beside the canvas, so a click on them
 * always reaches them - even when the panel's picture is an iframe.
 *
 * The host owns the behaviour: the library draws the controls and asks the
 * host to act.
 */
export const PanelActions = ({
  panel,
  appProps,
}: {
  panel: ExcalidrawPanelElement;
  appProps: ExcalidrawProps;
}) => {
  const screenshot = appProps.panelScreenshot;
  const ocr = appProps.panelOcr;
  const bridge = appProps.panelBridge;

  // the bridge belongs to a code panel that is backed by a bridge session
  const hasBridge = !!bridge && isBridgeCodePanel(panel);

  if (!screenshot && !ocr && !hasBridge) {
    return null;
  }

  return (
    <div
      className="excalidraw__panel-actions"
      data-testid="panel-actions"
      data-panel-id={panel.id}
      style={
        {
          // the actions live outside the panel, so there is no scale to divide
          // by: the stylesheet's icon size resolves to its own screen size
          [PANEL_SCALE_PROPERTY]: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: panelScreenChrome.chromeGap,
        } as React.CSSProperties
      }
    >
      {screenshot && (
        <PanelScreenshotButton panel={panel} screenshot={screenshot} />
      )}
      {ocr && <PanelOcrButton panel={panel} ocr={ocr} />}
      {hasBridge && <PanelBridgeField panel={panel} bridge={bridge!} />}
    </div>
  );
};
