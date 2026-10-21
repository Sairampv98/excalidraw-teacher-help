import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { PanelBridgeControls } from "@excalidraw/excalidraw";
import type { CodePanelState } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  applyCodePanelState,
  initialCodePanelState,
  reduceCodePanelState,
} from "./codePanel";
import {
  createBridgeSession,
  INITIAL_BRIDGE_SESSION_STATE,
} from "./bridgeSession";

import type { BridgeSession, BridgeSessionState } from "./bridgeSession";

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

        publish(reduceCodePanelState(panelStateRef.current, message));
      },
    });

    sessionRef.current = session;

    return () => {
      session.disconnect();
      sessionRef.current = null;
    };
  }, [publish]);

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

  return { bridge, state, startRun };
};
