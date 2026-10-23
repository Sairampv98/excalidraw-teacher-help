import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction, isPanelElement } from "@excalidraw/element";
import { clearAllPanelCaptures, setPanelCapture } from "@excalidraw/excalidraw";

import { readCodePanelState, readPanelDraft } from "@excalidraw/excalidraw";

import type {
  PanelBridgeControls,
  PanelDraftControls,
  PanelRunControls,
} from "@excalidraw/excalidraw";
import type {
  CodePanelDraft,
  CodePanelState,
  PanelCapture,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { OCR_NEEDS_BRIDGE } from "../../packages/vscode-bridge/bridge/src/ocrClient";

import {
  applyCodePanelState,
  applyPanelDraft,
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
import type {
  OcrEngineState,
  OcrRequest,
} from "../../packages/vscode-bridge/bridge/src/ocr";
import type { CaptureStateMessage } from "../../packages/vscode-bridge/extension/src/captureState";

/**
 * Are two live views the same one?
 *
 * The panel re-renders when the live view **changes**, so the app has to
 * know whether it changed: the same stream URL and the same state is the
 * same live view, and the panel must not re-render for it (D-85).
 */
const sameCapture = (a: PanelCapture | null, b: PanelCapture): boolean => {
  if (!a || a.status !== b.status) {
    return false;
  }

  if (a.status === "live" && b.status === "live") {
    return a.streamUrl === b.streamUrl;
  }

  if (a.status === "unavailable" && b.status === "unavailable") {
    return a.reason === b.reason;
  }

  return false;
};

/**
 * How many runs the app has asked for.
 *
 * The id is the request's id, and it is the **run's** id when the run happens:
 * every message about that run carries it (D-124).
 */
let runCounter = 0;

/**
 * The app's wiring for the **code panel**.
 *
 * The library draws the panel and the field; the app owns the bridge. This
 * hook is the seam: it holds the session, turns the bridge's messages into the
 * panel's plain state, and writes that state back into the element, so the
 * panel shows what the teacher is doing (D-51).
 *
 * The token never leaves this hook's session: it is in memory for the
 * session only, it lives in the **tab's** session memory (D-111) and it is
 * never written into the document (D-50).
 *
 * `publishLiveView` hands the live view's **descriptor** to the presenter
 * window (D-101): the presenter is a second JavaScript context, so the
 * registry that holds the descriptor is empty there.
 */
export const useBridgePanel = (
  api: ExcalidrawImperativeAPI | null,
  publishLiveView?: (panelId: string, capture: PanelCapture) => void,
) => {
  const [state, setState] = useState<BridgeSessionState>(
    INITIAL_BRIDGE_SESSION_STATE,
  );
  const [token, setToken] = useState("");

  /**
   * The OCR engine's **state**, as the extension last said it (D-90, D-91).
   *
   * It is a state, not a silence: the panel has to be able to say which engine
   * is in use, and - when the engine is not there - **why**, and what to
   * install (D-75).
   */
  const [ocrState, setOcrState] = useState<OcrEngineState | null>(null);

  /**
   * The runtimes that are **actually** on this machine (D-124).
   *
   * The extension detects them and offers only those, so the panel's language
   * picker never offers a language that cannot run here.
   */
  const [runtimes, setRuntimes] = useState<string[]>([]);

  const sessionRef = useRef<BridgeSession | null>(null);
  const panelStateRef = useRef<CodePanelState>(initialCodePanelState());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(api);

  /**
   * The capture's **state**, as the extension last said it (D-85).
   *
   * The picture itself is not here: the frames are served as an MJPEG stream
   * from the extension's own HTTP server, and the panel plays that stream in
   * a plain `<img>`. So the app does no per-frame work at all.
   */
  const captureRef = useRef<CaptureStateMessage | null>(null);

  /** The stream's URL, from the extension's hello. It belongs to the connection. */
  const streamUrlRef = useRef<string | null>(null);

  /** The live view as it was last published, so it is published only on a change. */
  const publishedCaptureRef = useRef<PanelCapture | null>(null);

  // the presenter's half of the live view (D-101), kept in a ref so the
  // publish path always reads the current one
  const publishLiveViewRef = useRef(publishLiveView);
  publishLiveViewRef.current = publishLiveView;

  apiRef.current = api;

  /**
   * Publish the live view into the library's registry (D-82, D-85).
   *
   * The registry is the library's own in-memory store, keyed by the panel
   * element's id. It holds the live view's **descriptor** - the capture's
   * state and the stream's URL - and never a picture: the payload is saved
   * with the document, and the picture does not even reach the app.
   *
   * It is published **only when the descriptor changes**, so the panel
   * re-renders when the state changes and not on every message.
   */
  const publishCapture = useCallback(() => {
    const current = apiRef.current;
    const message = captureRef.current;

    if (!current || !message) {
      return;
    }

    const capture = toPanelCapture(message, streamUrlRef.current);

    if (sameCapture(publishedCaptureRef.current, capture)) {
      // nothing changed: the panel must not re-render
      return;
    }

    publishedCaptureRef.current = capture;

    for (const id of bridgeCodePanelIds(current.getSceneElements())) {
      setPanelCapture(id, capture);

      // and the presenter gets the same descriptor: it is a second
      // JavaScript context, so its own registry is empty (D-101). The picture
      // does not travel - the presenter plays the same stream.
      publishLiveViewRef.current?.(id, capture);
    }
  }, []);

  /** Write the panel's state into the code panels of the scene. */
  const publish = useCallback(
    (next: CodePanelState) => {
      panelStateRef.current = next;

      // The live view is published here too, so that a panel which has just
      // become connected gets the live view with it (D-85).
      publishCapture();

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
    },
    [publishCapture],
  );

  useEffect(() => {
    const session = createBridgeSession({
      onStateChange: (next) => {
        setState(next);

        // The stream's URL is part of the CONNECTION's state (D-85): a new
        // connection gets a new capability, so the live view has to be
        // published again with the new URL.
        if (next.streamUrl !== streamUrlRef.current) {
          streamUrlRef.current = next.streamUrl;
          publishCapture();
        }

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

        if (message.type === "editor:capture") {
          // The live view of the editor's own window: the **state** only
          // (D-85). The picture is served as an MJPEG stream and never
          // reaches the app, so there is nothing per frame to do here.
          captureRef.current = message;
          publishCapture();
          return;
        }

        if (message.type === "run:runtimes") {
          // The runtimes that are actually on this machine (D-124). The panel's
          // language picker offers only these.
          setRuntimes(message.languages);
          return;
        }

        if (message.type === "ocr:state") {
          // Which engine is in use, and - when it is not there - why (D-90,
          // D-91).
          setOcrState({
            state: message.state,
            ...(message.engine === undefined ? {} : { engine: message.engine }),
            ...(message.reason === undefined ? {} : { reason: message.reason }),
          });
          return;
        }

        publish(reduceCodePanelState(panelStateRef.current, message));
      },
    });

    sessionRef.current = session;

    /**
     * The tab remembers the token (D-111).
     *
     * After a reload the teacher does not paste it again: the field shows
     * the token the tab remembers and the session connects by itself. With
     * no remembered token nothing happens here - the teacher pastes it,
     * exactly as before.
     */
    const remembered = session.getToken();

    if (remembered) {
      setToken(remembered);
      session.connect();
    }

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
   * The panel whose id this is, and the mirror it is showing.
   *
   * The draft's language comes from the mirror until the teacher picks one:
   * the mirror is what a draft **starts from** (D-123).
   */
  const panelAndMirror = useCallback((panelId: string) => {
    const current = apiRef.current;

    if (!current) {
      return null;
    }

    const elements = current.getSceneElements();
    const element = elements.find((candidate) => candidate.id === panelId);

    if (!element || !isPanelElement(element)) {
      return null;
    }

    return {
      elements,
      draft: readPanelDraft(element.panel),
      mirror: readCodePanelState(element.panel),
    };
  }, []);

  /**
   * Write the teacher's own text into the panel's payload (D-123).
   *
   * The payload is the document's own business, so the write goes through the
   * scene - and it is **undoable**, because the teacher typed it.
   */
  const writeDraft = useCallback((panelId: string, draft: CodePanelDraft) => {
    const current = apiRef.current;

    if (!current) {
      return;
    }

    const elements = current.getSceneElements();
    const updated = applyPanelDraft(elements, panelId, draft);

    if (updated === elements) {
      return;
    }

    current.updateScene({
      elements: updated,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, []);

  /**
   * The teacher typed in the editor (D-123).
   *
   * The draft becomes **theirs**: a mirror never overwrites it again.
   */
  const onDraftChange = useCallback(
    (panelId: string, text: string) => {
      const found = panelAndMirror(panelId);

      if (!found) {
        return;
      }

      writeDraft(panelId, {
        text,
        language: found.draft?.language || found.mirror?.editor.language || "",
        edited: true,
      });
    },
    [panelAndMirror, writeDraft],
  );

  /**
   * The teacher chose the language the draft is in (D-124).
   */
  const onLanguageChange = useCallback(
    (panelId: string, language: string) => {
      const found = panelAndMirror(panelId);

      if (!found) {
        return;
      }

      writeDraft(panelId, {
        text: found.draft?.text ?? found.mirror?.editor.text ?? "",
        language,
        edited: true,
      });
    },
    [panelAndMirror, writeDraft],
  );

  /**
   * The teacher pressed Run (D-124).
   *
   * The **draft** and its language go to the extension, which runs it in the
   * teacher's workspace. The app never runs anything itself.
   */
  const onRun = useCallback(
    (panelId: string) => {
      const session = sessionRef.current;
      const found = panelAndMirror(panelId);

      if (!session || !found) {
        return false;
      }

      const text = found.draft?.text ?? found.mirror?.editor.text ?? "";
      const language =
        found.draft?.language || found.mirror?.editor.language || "";

      return session.runSnippet({
        id: `code-run-${++runCounter}`,
        language,
        text,
      });
    },
    [panelAndMirror],
  );

  const panelDraft: PanelDraftControls = useMemo(
    () => ({ onChange: onDraftChange, onLanguageChange }),
    [onDraftChange, onLanguageChange],
  );

  const panelRun: PanelRunControls = useMemo(
    () => ({ languages: runtimes, onRun }),
    [runtimes, onRun],
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

  return {
    bridge,
    state,
    startRun,
    requestOcr,
    ocrState,
    panelDraft,
    panelRun,
  };
};
