import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/element";
import { clearAllPanelCaptures, setPanelCapture } from "@excalidraw/excalidraw";

import type { PanelBridgeControls } from "@excalidraw/excalidraw";
import type { CodePanelState } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { OCR_NEEDS_BRIDGE } from "../../packages/vscode-bridge/bridge/src/ocrClient";

import {
  applyCodePanelState,
  bridgeCodePanelIds,
  initialCodePanelState,
  reduceCodePanelState,
  toPanelCapture,
} from "./codePanel";
import {
  createBridgeSession,
  INITIAL_BRIDGE_SESSION_STATE,
} from "./bridgeSession";

import type { BridgeSession, BridgeSessionState } from "./bridgeSession";
import type { OcrRequest } from "../../packages/vscode-bridge/bridge/src/ocr";
import type { BridgeMessage } from "../../packages/vscode-bridge/bridge/src/protocol";

/**
 * The app's wiring for the **code panel**.
 *
 * The library draws the panel and the field; the app owns the bridge. This
 * hook is the seam: it holds the session, turns the bridge's messages into the
 * panel's plain state, and writes that state back into the element, so the
 * panel shows what the teacher is doing (D-51).
 *
 * The token never leaves this hook's session: it is in memory for the session
 * only, and it is never written into the document (D-50).
 */
export const useBridgePanel = (api: ExcalidrawImperativeAPI | null) => {
  const [state, setState] = useState<BridgeSessionState>(
    INITIAL_BRIDGE_SESSION_STATE,
  );
  const [token, setToken] = useState("");

  const sessionRef = useRef<BridgeSession | null>(null);
  const panelStateRef = useRef<CodePanelState>(initialCodePanelState());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(api);

  apiRef.current = api;

  /** Write the panel's state into the code panels of the scene. */
  const publish = useCallback((next: CodePanelState) => {
    panelStateRef.current = next;

    const current = apiRef.current;

    if (!current) {
      return;
    }

    const elements = current.getSceneElements();
    const updated = applyCodePanelState(elements, next);

    if (updated === elements) {
      return;
    }

    current.updateScene({
      elements: updated,
      // the mirror is not something the teacher undoes
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  /**
   * Publish the editor's window into the library's frame registry (D-82).
   *
   * The frame does **not** go through `publish`: the element's payload is
   * saved with the document, and a frame in it would put the teacher's screen
   * into the `.excalidraw` file. The registry is the library's own in-memory
   * store, keyed by the panel element's id.
   */
  const publishCapture = useCallback(
    (message: Extract<BridgeMessage, { type: "editor:frame" }>) => {
      const current = apiRef.current;

      if (!current) {
        return;
      }

      const capture = toPanelCapture(message);

      for (const id of bridgeCodePanelIds(current.getSceneElements())) {
        setPanelCapture(id, capture);
      }
    },
    [],
  );

  useEffect(() => {
    const session = createBridgeSession({
      onStateChange: (next) => {
        setState(next);

        const current = panelStateRef.current;

        if (
          current.connection === next.connection &&
          current.statusMessage === next.message
        ) {
          return;
        }

        publish({
          ...current,
          connection: next.connection,
          statusMessage: next.message,
        });
      },
      onMessage: (message) => {
        if (message.type === "bridge:hello" && message.appName) {
          // The bridge names the editor it runs in (D-76). The port is fixed,
          // so with two editors running the app may reach the one that does
          // NOT have the teacher's file open - and the chrome is where the
          // teacher is looking, so it says which editor this is.
          setState((previous) => ({
            ...previous,
            message: `Connected to ${message.appName}.`,
          }));
        }

        if (message.type === "editor:frame") {
          // The live view of the editor's own window. It rides the registry,
          // never the payload (D-82).
          publishCapture(message);
          return;
        }

        publish(reduceCodePanelState(panelStateRef.current, message));
      },
    });

    sessionRef.current = session;

    return () => {
      session.disconnect();
      sessionRef.current = null;

      // The frames were the editor's window as it was: when the session ends,
      // they are not true any more (D-82).
      clearAllPanelCaptures();
    };
  }, [publish, publishCapture]);

  const onTokenChange = useCallback((next: string) => {
    setToken(next);
    sessionRef.current?.setToken(next);
  }, []);

  const onPasteToken = useCallback(() => {
    void sessionRef.current?.pasteToken().then((pasted) => {
      if (pasted) {
        setToken(pasted);
      }
    });
  }, []);

  const onConnect = useCallback(() => {
    sessionRef.current?.connect();
  }, []);

  const startRun = useCallback(
    (command: string, args: string[], cwd?: string) =>
      sessionRef.current?.startRun(command, args, cwd) ?? false,
    [],
  );

  /**
   * Reads the text out of an image, over the bridge (D-59).
   *
   * With no bridge the promise rejects with the sentence that says the bridge
   * is needed — the app never fails silently.
   */
  const requestOcr = useCallback((request: Omit<OcrRequest, "id">) => {
    const session = sessionRef.current;

    if (!session) {
      return Promise.reject(new Error(OCR_NEEDS_BRIDGE));
    }

    return session.requestOcr(request);
  }, []);

  const bridge: PanelBridgeControls = useMemo(
    () => ({
      status: state.connection,
      message: state.message,
      token,
      onTokenChange,
      onPasteToken,
      onConnect,
    }),
    [
      state.connection,
      state.message,
      token,
      onTokenChange,
      onPasteToken,
      onConnect,
    ],
  );

  return { bridge, state, startRun, requestOcr };
};
