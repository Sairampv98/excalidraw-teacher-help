import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction, isPanelElement } from "@excalidraw/element";
import { clearAllPanelCaptures, setPanelCapture } from "@excalidraw/excalidraw";

import {
  isStandaloneCodePanel,
  readCodePanelState,
  readPanelConsole,
  readPanelDraft,
  readPanelReadLanguage,
} from "@excalidraw/excalidraw";

import type {
  PanelBridgeControls,
  PanelCaptionControls,
  PanelControlControls,
  PanelControlState,
  PanelDraftControls,
  PanelInputEvent,
  PanelMirrorControls,
  PanelMirror,
  PanelRunControls,
  PanelWindowAction,
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
  applyConnectionTruth,
  applyPanelDraft,
  bridgeCodePanelIds,
  connectionLine,
  initialCodePanelState,
  reduceCodePanelState,
  toPanelCapture,
  withConnectionTruth,
} from "./codePanel";
import {
  createBridgeSession,
  INITIAL_BRIDGE_SESSION_STATE,
} from "./bridgeSession";
import { languagePacks } from "./languagePacks";
import { applyYoutubeCaptions, isVideoCaptionMessage } from "./videoCaptions";
import {
  BROWSER_LANGUAGES,
  isJavascript,
  javascriptRunner,
  pythonRunner,
  runsInBrowser,
} from "./pythonRunner";

import type { BridgeSession, BridgeSessionState } from "./bridgeSession";
import type { ConnectionTruth } from "./codePanel";
import type {
  OcrEngineState,
  OcrRequest,
} from "../../packages/vscode-bridge/bridge/src/ocr";
import type { BridgeMessage } from "../../packages/vscode-bridge/bridge/src/protocol";
import type { CaptureStateMessage } from "../../packages/vscode-bridge/extension/src/captureState";

/**
 * Are two live views the same one?
 *
 * The panel re-renders when the live view **changes**, so the app has to
 * know whether it changed: the same stream URL and the same state is the
 * same live view, and the panel must not re-render for it (D-85).
 */
const sameControl = (
  a: PanelControlState | undefined,
  b: PanelControlState | undefined,
): boolean =>
  a?.enabled === b?.enabled && a?.route === b?.route && a?.reason === b?.reason;

const sameCapture = (a: PanelCapture | null, b: PanelCapture): boolean => {
  if (!a || a.status !== b.status) {
    return false;
  }

  if (a.status === "live" && b.status === "live") {
    // The control and the parking are part of the live view (D-323, D-328): a
    // panel that says Control is on has to be told when it is not.
    return (
      a.streamUrl === b.streamUrl &&
      a.width === b.width &&
      a.height === b.height &&
      a.parked === b.parked &&
      sameControl(a.control, b.control)
    );
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

/** how often the output of a run in the browser is written to the panel */
const OUTPUT_FLUSH_MS = 100;

/**
 * The lines typed in the Input box, one for each input() of the program
 * (D-283). The newline that ends the last line does not start another one.
 */
const typedLines = (input: string): string[] =>
  input === "" ? [] : input.replace(/\n$/, "").split("\n");

/**
 * The bridge's hello - the message that names the editor (D-76).
 */
type BridgeHello = Extract<BridgeMessage, { type: "bridge:hello" }>;

/**
 * The truth, as the session's state and the last hello make it (D-133).
 *
 * While the bridge is connected the panel's line is the hello's line - it
 * names the editor and the workspace (D-76). While it is not, the line is the
 * session's own sentence for the state, so a panel never claims a connection
 * it does not have.
 */
const truthOf = (
  session: BridgeSessionState,
  hello: BridgeHello | null,
): ConnectionTruth => ({
  connection: session.connection,
  statusMessage: session.message,
  line:
    hello && session.connection === "connected"
      ? connectionLine(hello)
      : session.message,
});

/**
 * The sentence the panel shows when the captions could not be asked for.
 *
 * The captions are read by the **bridge** (D-129), so with no bridge there is
 * nothing to ask — and a panel that says nothing is a panel that looks broken
 * (D-93). The sentence names the remedy, because a reason a teacher cannot
 * act on is not a reason.
 */
export const CAPTIONS_NEEDS_BRIDGE =
  "no captions: the Excalidraw Bridge is not connected, and a browser cannot read YouTube's captions. Start the Excalidraw Bridge in your editor";

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
  /** the runtimes, readable from a callback that was made earlier */
  const runtimesRef = useRef<string[]>(runtimes);

  runtimesRef.current = runtimes;

  /**
   * What the program that is waiting for an answer does with it (D-298): runs
   * the program again with the answer added. `null` when nothing is waiting.
   */
  const pendingAnswerRef = useRef<((answer: string) => void) | null>(null);

  const sessionRef = useRef<BridgeSession | null>(null);
  const panelStateRef = useRef<CodePanelState>(initialCodePanelState());
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(api);

  /**
   * The connection TRUTH, as the app knows it **now** (D-133).
   *
   * A connection line is a **status**, and a status is the truth now. The line
   * rides in the panel's payload, and the payload is saved with the document -
   * so the truth has to be written into the panels again and again, or a
   * document saved while the bridge was connected comes back claiming a
   * connection that is not there.
   */
  const truthRef = useRef<ConnectionTruth>(
    truthOf(INITIAL_BRIDGE_SESSION_STATE, null),
  );

  /** The last hello the bridge sent. It names the editor (D-76). */
  const helloRef = useRef<BridgeHello | null>(null);

  /** The session's state, as the app last heard it. */
  const sessionStateRef = useRef<BridgeSessionState>(
    INITIAL_BRIDGE_SESSION_STATE,
  );

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

  /**
   * The panels whose captions were asked for and could not be asked yet (D-129).
   *
   * The bridge may not be connected when the panel appears, and the request is
   * **remembered** rather than dropped: it goes out the moment the bridge
   * arrives.
   */
  const pendingCaptionsRef = useRef<Map<string, string>>(new Map());

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

  /**
   * Write the connection TRUTH into every bridge code panel (D-133).
   *
   * The truth is written on its own, and NOT through `publish`: a publish
   * carries the app's whole state, and the app's state has no mirror and no
   * output until the bridge sends them. The panel's own text, the run's
   * output and the teacher's draft are the document's, and they survive.
   */
  const writeTruth = useCallback(() => {
    const current = apiRef.current;

    if (!current) {
      return;
    }

    const elements = current.getSceneElements();
    const updated = applyConnectionTruth(elements, truthRef.current);

    if (updated === elements) {
      return;
    }

    current.updateScene({
      elements: updated,
      // the connection is not something the teacher undoes
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  /** Write the panel's state into the code panels of the scene. */
  const publish = useCallback(
    (next: CodePanelState) => {
      // The app's own state carries the truth too, so a publish can never put
      // an old truth back into the panels (D-133).
      const state = withConnectionTruth(next, truthRef.current);

      panelStateRef.current = state;

      // The live view is published here too, so that a panel which has just
      // become connected gets the live view with it (D-85).
      publishCapture();

      const current = apiRef.current;

      if (!current) {
        return;
      }

      const elements = current.getSceneElements();
      const updated = applyCodePanelState(elements, state);

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
        sessionStateRef.current = next;

        // the runtimes were found on a machine that is not there any more
        if (next.connection !== "connected") {
          setRuntimes([]);
        }

        // The stream's URL is part of the CONNECTION's state (D-85): a new
        // connection gets a new capability, so the live view has to be
        // published again with the new URL.
        if (next.streamUrl !== streamUrlRef.current) {
          streamUrlRef.current = next.streamUrl;
          publishCapture();
        }

        // The captions that could not be asked for are asked for now (D-129):
        // the bridge has arrived, and the panel must not stay silent.
        if (
          next.connection === "connected" &&
          pendingCaptionsRef.current.size
        ) {
          const pending = [...pendingCaptionsRef.current.entries()];

          pendingCaptionsRef.current.clear();

          for (const [panelId, videoId] of pending) {
            sessionRef.current?.requestCaptions({ id: panelId, videoId });
          }
        }

        const current = panelStateRef.current;

        // The truth is what the panels must say (D-133): the connection
        // changed, so the line the panel shows is a new one. Only the
        // connection is written - the mirrored text, the run's output and the
        // teacher's own draft survive.
        truthRef.current = truthOf(next, helloRef.current);

        panelStateRef.current = withConnectionTruth(
          {
            ...current,
            connection: next.connection,
            statusMessage: next.message,
          },
          truthRef.current,
        );

        writeTruth();
      },
      onMessage: (message) => {
        if (message.type === "bridge:hello") {
          // The hello names the editor, and the panel's connection line says
          // so (D-76). The truth is updated BEFORE the state is published, so
          // the line the panel ends up with is the hello's line and not the
          // session's (D-133).
          helloRef.current = message;
          truthRef.current = truthOf(sessionStateRef.current, message);
        }

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

        // The captions of a YouTube video (D-129). The tier travels with the
        // answer, and the panel says which tier it is.
        if (
          isVideoCaptionMessage(message) &&
          message.type !== "captions:request"
        ) {
          pendingCaptionsRef.current.delete(message.id);

          const current = apiRef.current;

          if (current) {
            applyYoutubeCaptions(current, {
              panelId: message.id,
              videoId: message.videoId,
              tracks: message.type === "captions:result" ? message.tracks : [],
              // a "no captions" answer IS the third tier
              tier:
                message.tier ??
                (message.type === "captions:none" ? ("none" as const) : null),
              reason: message.type === "captions:none" ? message.reason : null,
            });
          }

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
  }, [publish, publishCapture, writeTruth]);

  /**
   * The app writes its truth into the panels (D-133).
   *
   * Three moments: the app **starts**, the **connection changes**, and the
   * **scene** changes. The last one matters because a panel that appears
   * *after* the connection was established has never learned about it: the
   * app only writes its state into the panels when the state changes, so a
   * panel born later kept saying "not connected" while the bridge was right
   * there (D-133).
   */
  useEffect(() => {
    // the app starts: the panels are told what is true now, whatever the
    // document remembers
    writeTruth();

    const current = apiRef.current;

    if (!current) {
      return;
    }

    // the scene changed: a panel may have appeared, and a panel that appeared
    // has to learn what is true now.
    const unsubscribe = current.onChange?.(() => {
      writeTruth();
    });

    return () => {
      unsubscribe?.();
    };
  }, [api, writeTruth]);

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

  /**
   * The panel asked for the captions of its video (D-129).
   *
   * The **bridge** reads them — a browser cannot — and the answer carries the
   * tier that produced it. With no bridge the request is **remembered** and
   * the panel says why, so the teacher is not left looking at a video that
   * silently has no text.
   */
  const onCaptionRequest = useCallback((panelId: string, videoId: string) => {
    const sent =
      sessionRef.current?.requestCaptions({ id: panelId, videoId }) ?? false;

    if (sent) {
      return;
    }

    pendingCaptionsRef.current.set(panelId, videoId);

    const current = apiRef.current;

    if (current) {
      applyYoutubeCaptions(current, {
        panelId,
        videoId,
        tracks: [],
        tier: "none",
        reason: CAPTIONS_NEEDS_BRIDGE,
      });
    }
  }, []);

  const panelCaptions: PanelCaptionControls = useMemo(
    () => ({ onRequest: onCaptionRequest }),
    [onCaptionRequest],
  );

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
      /** the lines the program reads with input() (D-283) */
      input: readPanelConsole(element.panel).input,
      /** a code editor of its own always runs in the browser (D-269) */
      standalone: isStandaloneCodePanel(element),
      /** the language the panel is read as (D-270) */
      readAs: readPanelReadLanguage(element.panel) ?? "",
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
        language:
          found.draft?.language ||
          found.readAs ||
          found.mirror?.editor.language ||
          "",
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
   * Run with no bridge: Python runs in the browser, and the run is told to the
   * panel with the same messages the extension sends, so the panel shows it
   * the same way.
   */
  const runInBrowser = useCallback(
    (text: string, language: string, input = "") => {
      pendingAnswerRef.current = null;

      const say = (message: BridgeMessage) =>
        publish(reduceCodePanelState(panelStateRef.current, message));

      if (!runsInBrowser(language)) {
        say({
          v: 1,
          type: "run:notice",
          runId: `browser-run-${++runCounter}`,
          kind: "missing-runtime",
          text: `${language} cannot be run here: the browser runs Python and JavaScript. Other languages run in VS Code, when the bridge is connected and the language is installed on that machine.`,
        });
        return false;
      }

      const command = isJavascript(language)
        ? "javascript (in the browser)"
        : "python (in the browser)";

      /**
       * One run of the program, with the answers the teacher has given to its
       * questions so far (D-298). A program that asks a question nobody has
       * answered is stopped at it; the console asks, and the program is run
       * again from the top with the answer added - the lines it printed before
       * the question come out the same, and the answers are shown where it read
       * them.
       */
      const start = (answers: string[]) => {
        const runId = `browser-run-${++runCounter}`;

        if (answers.length) {
          // the same run, going on: the console starts again from the top
          const current = panelStateRef.current;

          publish({
            ...current,
            output: [],
            run: { runId, command, state: "running", exitCode: null },
          });
        } else {
          say({ v: 1, type: "run:started", runId, command, cwd: "" });
        }

        // The output arrives faster than a page can draw it: it is gathered and
        // written to the panel a few times a second, so a program that prints a
        // lot does not stall the page.
        let pending: { stream: "stdout" | "stderr"; text: string } | null =
          null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const flush = () => {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }

          if (pending) {
            say({ v: 1, type: "run:output", runId, ...pending });
            pending = null;
          }
        };

        const gather = (stream: "stdout" | "stderr", text: string) => {
          if (pending && pending.stream !== stream) {
            flush();
          }

          pending = { stream, text: (pending?.text ?? "") + text };
          timer ??= setTimeout(flush, OUTPUT_FLUSH_MS);
        };

        void (isJavascript(language) ? javascriptRunner : pythonRunner)
          .run(
            text,
            {
              onLoading: () =>
                gather("stdout", "Loading Python (the first run only)...\n"),
              onOutput: gather,
              onNotice: (kind, notice) => {
                flush();
                say({ v: 1, type: "run:notice", runId, kind, text: notice });
              },
            },
            // the lines the program reads with input(): the ones typed in advance
            // (D-283), then the answers to its questions (D-298)
            { stdin: [...typedLines(input), ...answers] },
          )
          .then((result) => {
            flush();

            if (result.kind === "needs-input") {
              // the console asks; the answer starts the program again
              pendingAnswerRef.current = (answer) =>
                start([...answers, answer]);

              const current = panelStateRef.current;

              publish({
                ...current,
                run: { ...current.run, runId, state: "waiting-input" },
              });

              return;
            }

            if (result.kind === "crashed") {
              say({
                v: 1,
                type: "run:output",
                runId,
                stream: "stderr",
                text: `The program stopped: it used more memory than the browser allows, or it crashed (${result.reason}).\n`,
              });
            }

            if (result.kind === "load-failed") {
              say({
                v: 1,
                type: "run:notice",
                runId,
                kind: "missing-runtime",
                text: `Python could not be downloaded (${result.reason}). Check the connection and press Run to try again.`,
              });
            }

            say({
              v: 1,
              type: "run:exit",
              runId,
              code: result.kind === "exit" ? result.code : null,
            });
          });
      };

      start([]);

      return true;
    },
    [publish],
  );

  /**
   * The teacher answered the question the program is waiting on (D-298).
   *
   * A program that is not waiting any more (the page was reloaded, the console
   * was cleared) cannot take the answer: it is said, and the run is over.
   */
  const onAnswer = useCallback(
    (_panelId: string, answer: string) => {
      const next = pendingAnswerRef.current;

      if (!next) {
        const current = panelStateRef.current;

        publish({ ...current, run: { ...current.run, state: "exited" } });
        apiRef.current?.setToast({
          message:
            "That program is not waiting for an answer any more. Press Run to start it again.",
          closable: true,
        });

        return;
      }

      pendingAnswerRef.current = null;
      next(answer);
    },
    [publish],
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

      if (!found) {
        return false;
      }

      if (!session) {
        return runInBrowser(
          found.draft?.text ?? found.mirror?.editor.text ?? "",
          found.draft?.language ||
            found.readAs ||
            found.mirror?.editor.language ||
            "",
          found.input,
        );
      }

      const text = found.draft?.text ?? found.mirror?.editor.text ?? "";
      const language =
        found.draft?.language ||
        found.readAs ||
        found.mirror?.editor.language ||
        "";

      const connected = sessionStateRef.current.connection === "connected";
      const bridgeHasIt = connected && runtimesRef.current.includes(language);
      const inBrowser = runsInBrowser(language);

      // Python and JavaScript run in the browser in a code editor of its own,
      // with the bridge or without it. Every other language is run natively by
      // the bridge - python, node, java, go, ... as found on the teacher's
      // machine - and the bridge says what is missing when it lacks the
      // runtime; with no bridge the panel says that the bridge is needed
      // (D-290). A mirrored editor prefers the bridge's own runtime when it has
      // one.
      if (
        !connected ||
        (found.standalone ? inBrowser : inBrowser && !bridgeHasIt)
      ) {
        return runInBrowser(text, language, found.input);
      }

      pendingAnswerRef.current = null;

      return session.runSnippet({
        id: `code-run-${++runCounter}`,
        language,
        text,
      });
    },
    [panelAndMirror, runInBrowser],
  );

  const panelDraft: PanelDraftControls = useMemo(
    () => ({ onChange: onDraftChange, onLanguageChange }),
    [onDraftChange, onLanguageChange],
  );

  /**
   * The teacher cleared the console (D-274): the program's output and the
   * bridge's messages go; the line that says whether the bridge is connected
   * stays, because that is a status, not a message.
   */
  const onClear = useCallback(() => {
    const current = panelStateRef.current;

    // a program that was waiting for an answer is over with its console
    const waiting = pendingAnswerRef.current !== null;

    pendingAnswerRef.current = null;

    publish({
      ...current,
      output: [],
      console: current.console.filter((line) => line.kind === "connection"),
      ...(waiting ? { run: { ...current.run, state: "exited" as const } } : {}),
    });
  }, [publish]);

  /** where each language stands: here, to be downloaded, or on its way (D-289) */
  const [packs, setPacks] = useState(() => languagePacks.list());

  useEffect(
    () => languagePacks.subscribe(() => setPacks(languagePacks.list())),
    [],
  );

  const onInstallPack = useCallback((id: string) => {
    languagePacks.install(id).catch((error: Error) => {
      apiRef.current?.setToast({
        message: `Could not download ${id}: ${error.message}`,
        closable: true,
      });
    });
  }, []);

  /** the packs, with the languages the bridge runs on the teacher's machine ready too */
  const allPacks = useMemo(() => {
    const named = packs.map((pack) =>
      runtimes.includes(pack.id) ? { ...pack, state: "ready" as const } : pack,
    );
    const rest = runtimes
      .filter((id) => !packs.some((pack) => pack.id === id))
      .map((id) => ({ id, name: id, state: "ready" as const }));

    return [...named, ...rest];
  }, [packs, runtimes]);

  const panelRun: PanelRunControls = useMemo(
    () => ({
      languages: runtimes,
      onRun,
      onClear,
      onAnswer,
      canRunInBrowser: true,
      browserLanguages: BROWSER_LANGUAGES,
      languagePacks: allPacks,
      onInstallPack,
    }),
    [runtimes, onRun, onClear, onAnswer, allPacks, onInstallPack],
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

  /**
   * What is **mirrored** of the editor's window (D-143).
   *
   * What is mirrored is a **choice**, and a choice can be changed as often as
   * the teacher changes their mind - so this can be sent as often as the
   * teacher likes, and the last one wins.
   *
   * The editor's window is still found **by rule** (D-112, D-113): a region
   * never changes how it is found, it only says which part of it is mirrored.
   */
  const onMirrorChange = useCallback((panelId: string, mirror: PanelMirror) => {
    void panelId;

    const session = sessionRef.current;

    if (!session) {
      return;
    }

    session.setMirror({
      region: mirror.region,
      follow: mirror.follow,
    });
  }, []);

  const panelMirror: PanelMirrorControls = useMemo(
    () => ({
      onChange: onMirrorChange,
    }),
    [onMirrorChange],
  );

  /**
   * The **control** of the editor's window (D-323).
   *
   * The library turns what the teacher does over the live view into events and
   * the session sends them: now, or not at all (D-327). The state - whether
   * Control is on, the way its input goes in, whether the window is parked -
   * comes back in the capture's descriptor, so it is the extension's word and
   * every panel says the same thing.
   */
  const panelControl: PanelControlControls = useMemo(
    () => ({
      onToggle: (panelId: string, enabled: boolean) => {
        void panelId;
        sessionRef.current?.setControl(enabled);
      },
      onInput: (panelId: string, event: PanelInputEvent) => {
        void panelId;
        sessionRef.current?.sendInput(event);
      },
      onWindow: (panelId: string, action: PanelWindowAction) => {
        void panelId;
        sessionRef.current?.windowAction(action);
      },
    }),
    [],
  );

  const bridge: PanelBridgeControls = useMemo(
    () => ({
      status: state.connection,
      // the session's own word, finer than the status (D-333)
      phase: state.status,
      message: state.message,
      token,
      onTokenChange,
      onPasteToken,
      onConnect,
    }),
    [
      state.connection,
      state.status,
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
    panelCaptions,
    panelMirror,
    panelControl,
  };
};
