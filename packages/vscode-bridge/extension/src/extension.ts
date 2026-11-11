import { basename, join } from "node:path";

import * as vscode from "vscode";

import {
  BRIDGE_TASK_TYPE,
  DEFAULT_BRIDGE_HOST,
  type BridgeMessage,
} from "../../bridge/src/protocol";

import { createBridgeServer, type BridgeConnection } from "./bridge";
import { createPairing, PAIRING_ALLOW } from "./pairing";
import { createCaptureStatePublisher } from "./captureState";
import { applyMirrorMessage, createMirrorStore } from "./mirrorRegion";
import {
  resolveCaptureFps,
  resolvePort,
  resolvePythonPath,
  resolveSessionToken,
  KEPT_SESSION_SLOT,
} from "./config";
import {
  documentForTabUri,
  editorContentMessage,
  editorToMirror,
  type EditorDocumentLike,
  type EditorLike,
} from "./editorState";
import { engineSearchPaths, resolveOcrEngine } from "./ocrEngine";
import {
  engineForRequest,
  ocrSidecar,
  readWithEngine,
  resolveEngineState,
  stopOcrSidecar,
} from "./ocrEngines";
import { installIndra, isIndraMissing, pythonForSidecar } from "./indraEnv";
import { createPerfMonitor, formatPerfReport } from "./perfMonitor";
import { portConflictMessage } from "./portConflict";
import { createRunPseudoterminal } from "./pseudoterminal";
import { createRunner, type Runner } from "./runner";
import { createSnippetService, type SnippetService } from "./snippet";
import { createBridgeTask } from "./taskPresentation";
import { captionMessage, resolveYouTubeCaptions } from "./youtubeCaptions";
import {
  createInputPanel,
  UNKNOWN_PANEL_STATE,
  type PanelState,
} from "./inputPanel";
import {
  CAPTURE_SCRIPT_RELATIVE_PATH,
  createWindowCaptureSupervisor,
  editorProcessName,
  type WindowCaptureSupervisor,
} from "./windowCapture";
import {
  createInputGate,
  createWindowInput,
  INPUT_ROUTE_CHOICES,
  INPUT_SCRIPT_RELATIVE_PATH,
  resolveInputRoute,
  type InputHelperState,
  type WindowInput,
} from "./windowInput";
import {
  createWindowPark,
  WINDOW_SCRIPT_RELATIVE_PATH,
  type WindowRule,
} from "./windowPark";
import { createCoalescedPublisher } from "./publish";

import type { OcrEngineState, OcrRequest } from "../../bridge/src/ocr";
import type { CaptureStateMessage } from "./captureState";
import type { CoalescedPublisher } from "./publish";

/**
 * The extension entry point.
 *
 * It does three things:
 *
 *  1. reads the active editor and publishes its text to the bridge;
 *  2. serves the loopback websocket the Excalidraw page connects to;
 *  3. contributes the task type `excalidraw-bridge.run`, whose pseudoterminal
 *     runs the program and tees its output to the bridge (D-51).
 *
 * It uses NO VS Code-only API, so it installs and runs in VSCodium as well.
 */

/**
 * Node's built-in `fetch` when this VS Code has it (Node 18 and later), and - on the
 * Node 16 of VS Code 1.70 - a fetch that says why it cannot (D-448): the captions of
 * a YouTube video are the only user of it, and they need the internet anyway.
 */
const globalFetch: typeof fetch =
  typeof fetch === "function"
    ? fetch
    : ((() =>
        Promise.reject(
          new Error(
            "This VS Code is too old to fetch captions: it needs Node 18 or newer.",
          ),
        )) as unknown as typeof fetch);
const CONFIG_SECTION = "excalidraw-bridge";

/** The extension's own version, from its manifest. */
let extensionVersion = "0.0.0";

let bridgeServer: ReturnType<typeof createBridgeServer> | null = null;

/** the key of the editor's own memory that holds the origins the teacher allowed (D-518) */
const PAIRED_ORIGINS_KEY = "excalidraw-bridge.pairedOrigins";

let captureSupervisor: WindowCaptureSupervisor | null = null;

/**
 * What has to happen to the editor's window when the extension goes away: the
 * input helper stops, and a window that was parked is brought back (D-328).
 */
let shutdownWindow: (() => Promise<void>) | null = null;

/**
 * The editor's text, published **at most every 100 ms** (D-88).
 *
 * It is a module-level variable so that `deactivate` can flush the last
 * state: the trailing publish is the one that carries the final text, and it
 * must not be lost when the extension goes away.
 */
let textPublisher: CoalescedPublisher | null = null;

/** what the panel says while the editor's window is on the virtual display (D-350) */
const VIRTUAL_REASON =
  "real input was chosen: the editor's window is brought to the front for a moment - on the virtual display, out of your way";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  extensionVersion = context.extension?.packageJSON?.version ?? "0.0.0";

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const port = resolvePort(workspaceRoot, configuration.get<number>("port"));
  // The token of the session is KEPT in the editor's secret storage (D-333):
  // a reload of the editor gives the page the token it already has, so the
  // page reconnects by itself instead of retrying a token that is gone.
  let storedToken: string | undefined;

  try {
    storedToken = await context.secrets.get(KEPT_SESSION_SLOT);
  } catch {
    // no secret storage here: the token is made for this session, as it was
    storedToken = undefined;
  }

  const { token, generated, reused } = resolveSessionToken(
    configuration.get<string>("token"),
    storedToken,
  );

  if (generated && !reused) {
    try {
      await context.secrets.store(KEPT_SESSION_SLOT, token);
    } catch {
      // not kept: the next start makes a new one
    }
  }
  /**
   * The teacher's **own** YouTube API key (D-129).
   *
   * It is a secret, and it is the teacher's: the setting is never written to
   * disk by the extension and never travels over the bridge - only the
   * captions the key unlocked do. Without it the captions fall back to the
   * public endpoint, and the panel says which tier answered.
   */
  const youtubeApiKey = configuration.get<string>("youtubeApiKey");
  // The folder's name, as it appears in the window's title. It is empty when the
  // teacher has no folder open - and the **bridge** is what turns that into a
  // name the panel can show ("no folder open", D-122). The capture keeps the
  // raw name, because that is what the window's title really carries.
  const workspace = workspaceRoot ? basename(workspaceRoot) : "";

  let runner: Runner | null = null;

  /** The runnable snippet service (D-124). */
  let snippetService: SnippetService | null = null;

  /**
   * Which editor this is: "Visual Studio Code", "VSCodium", ...
   *
   * The bridge's port is FIXED (D-67), so with two editors running only one
   * of them holds it - and the app reaches that one, not necessarily the one
   * the teacher has their file open in. The name is what makes the mismatch
   * visible (D-76).
   */
  const appName = vscode.env.appName || "the editor";

  /**
   * The editor the panel is mirroring.
   *
   * It is **remembered**: the focus moves to the terminal or the explorer
   * all the time, and the file the teacher is teaching from is still open
   * then. Publishing the empty state in that moment erases the mirror - the
   * code vanishes for a reason nobody can see (D-78).
   */
  let mirroredEditor: EditorLike | undefined;

  /**
   * The **active tab's** document, when there is no active editor.
   *
   * The teacher teaches from the editor and then switches to the BROWSER to
   * show the canvas - and the window loses the focus, so there is no active
   * editor any more. The tab is still the file they are teaching, and the
   * tab is always known. Without this, the panel goes blank exactly when the
   * teacher needs it (D-79).
   *
   * The tab API does NOT carry the document - `TabInputText` has only a
   * `uri` (verified against the installed API declaration, VSCodium
   * 1.135.06055) - so the document is resolved from the open documents by
   * that uri. The tab can also be a diff, a terminal, a notebook or a
   * webview, in which case it names no text document at all.
   */
  const activeTabDocument = (): EditorDocumentLike | undefined => {
    const tab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const input = tab?.input as { uri?: { toString(): string } } | undefined;

    return documentForTabUri(
      input?.uri?.toString(),
      vscode.workspace.textDocuments,
    );
  };

  const currentEditor = (): EditorLike | undefined => {
    mirroredEditor = editorToMirror(
      mirroredEditor,
      vscode.window.activeTextEditor as EditorLike | undefined,
      (editor) =>
        vscode.workspace.textDocuments.some(
          (document) => document === editor.document,
        ),
      activeTabDocument(),
    );

    return mirroredEditor;
  };

  /**
   * The live view of the editor's **own window** (D-82, D-85).
   *
   * The picture does **not** ride the websocket: it is served as an MJPEG
   * stream from the extension's own HTTP server, and the panel plays that
   * stream in a plain `<img>`. So a frame never enters the app's data - it
   * cannot reach the panel's payload either, and the app does no per-frame
   * work at all.
   *
   * What rides the websocket is the capture's **STATE**, and it is published
   * when the state changes: the panel re-renders when the state changes, not
   * when a picture arrives.
   *
   * The capture is **one** helper for the whole session: a helper per frame
   * would spawn a process every frame for the whole lesson, and each of them
   * would capture a different moment.
   */
  let lastCaptureMessage: CaptureStateMessage | null = null;

  /**
   * The capture's state, published only when it **changes** (D-85).
   */
  const captureState = createCaptureStatePublisher((message) => {
    lastCaptureMessage = message;
    bridgeServer?.broadcast(message);
  });

  /**
   * What is **mirrored** of the editor's window (D-143).
   *
   * The teacher's own choice: the whole window until they choose a region,
   * and a region they can change as often as they like. The editor's window
   * is still found **by rule** (D-112, D-113) - a region never changes how it
   * is found, it only says which part of it is mirrored.
   */
  const mirror = createMirrorStore();

  const startWindowCapture = () => {
    if (process.platform !== "win32") {
      // the capture is a Windows program: `PrintWindow` is a Windows API
      captureState.unavailable("the live view of the editor needs Windows");
      return;
    }

    // The helper ships INSIDE the extension, so there is nothing to install
    // and no dependency to add - PowerShell is on every Windows machine.
    const scriptPath = join(
      context.extensionPath,
      CAPTURE_SCRIPT_RELATIVE_PATH,
    );

    captureSupervisor = createWindowCaptureSupervisor({
      scriptPath,
      // the OS process name is not the editor's name: VS Code runs as `Code`
      processName: editorProcessName(appName),
      // the window's title holds the workspace folder's name
      titleLike: workspace,
      fps: resolveCaptureFps(configuration.get<number>("captureFps")),
      onPerf: (perf) => perfMonitor.recordHelper(perf),
      onFrame: (frame) => {
        // only a picture that differs gets here: the key that waited has shown
        perfMonitor.pictureChanged();

        // The picture goes to the MJPEG STREAM and to nothing else (D-85).
        bridgeServer?.publishFrame({
          bytes: frame.bytes,
          seq: frame.seq,
          // the size rides along: a snapshot has to say how big it is (D-102)
          width: frame.width,
          height: frame.height,
        });

        // and the state says the capture is running - once, when it changes.
        // The picture's own size rides with it: the crop is measured in
        // fractions of the picture, so the panel needs the size (D-143).
        captureState.live(frame.seq, {
          width: frame.width,
          height: frame.height,
        });
      },
      onUnavailable: (reason) => {
        // A failure is a **message**, not a silence: the panel has to be able
        // to say why there is no live view, and fall back to the text (D-75).
        // "The editor's window is not visible" is such a message, and it is a
        // different fact from "there is no window" (D-113).
        captureState.unavailable(reason);
      },
      // Windows 7 only (D-493): the picture is a copy of the screen, and the
      // panel says the window must be visible and not covered
      onScreenCopy: (on) => captureState.setScreenCopy(on),
    });

    captureSupervisor.ensureRunning();
  };

  /**
   * The editor's text, published **at most every 100 ms** (D-88).
   *
   * Every keystroke used to make the app rewrite the whole scene, because
   * the message carries the whole file. The trailing publish always carries
   * the LAST state, so the final text is never lost.
   */
  textPublisher = createCoalescedPublisher({
    publish: () => {
      bridgeServer?.broadcast(editorContentMessage(currentEditor()));
    },
  });

  const publishEditorContent = () => {
    // The publish is coalesced: at most one every 100 ms, and the last state
    // is always published (D-88).
    textPublisher?.request();
  };

  /**
   * The engine's **state**, published to the panel (D-90, D-91).
   *
   * The panel has to be able to say which engine is in use, and - when the
   * engine is not there - **why**, and what to install (D-75). It is a state,
   * not a silence.
   */
  let ocrState: OcrEngineState | null = null;

  const sendEditorContentTo = (connection: BridgeConnection) => {
    // A client that connects into a session whose helper had died gets a
    // capture again: the live view recovers BY ITSELF, without anybody
    // having to refocus the editor (D-112).
    captureSupervisor?.ensureRunning();

    connection.send(editorContentMessage(currentEditor()));

    // The capture state, so that a panel which connects **later** learns why
    // there is no live view: the reason would otherwise have been broadcast
    // into a room with nobody in it (D-75).
    if (lastCaptureMessage) {
      connection.send(lastCaptureMessage);
    }

    // The same for the OCR engine's state: a panel which connects later has to
    // learn which engine is in use, and why there is none (D-90, D-91).
    if (ocrState) {
      connection.send({
        v: 1,
        type: "ocr:state",
        state: ocrState.state,
        ...(ocrState.engine ? { engine: ocrState.engine } : {}),
        ...(ocrState.reason ? { reason: ocrState.reason } : {}),
      });
    }

    // The runtimes that are actually on this machine (D-124). A panel which
    // connects later has to learn them too, or its language picker would offer
    // nothing.
    const runtimes = snippetService?.runtimes() ?? [];

    if (runtimes.length) {
      connection.send({ v: 1, type: "run:runtimes", languages: runtimes });
    }
  };

  const runCommand = async (request: {
    command: string;
    args: string[];
    cwd?: string;
  }) => {
    if (!runner) {
      return;
    }
    // The task carries the presentation options that keep the EDITOR's focus:
    // the terminal is revealed, and it never asks for the focus - whatever
    // `terminal.integrated.defaultLocation` says (D-81).
    const task = createBridgeTask<vscode.Task>(
      {
        TaskRevealKind: vscode.TaskRevealKind,
        TaskPanelKind: vscode.TaskPanelKind,
        createTask: (definition, name) =>
          new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            name,
            BRIDGE_TASK_TYPE,
            new vscode.CustomExecution(async () =>
              createRunPseudoterminal({ runner: runner as Runner, request }),
            ),
          ),
      },
      request,
    );
    await vscode.tasks.executeTask(task);
  };

  /**
   * The **OCR service** of the bridge.
   *
   * The engine is **chosen** (`excalidraw-bridge.ocrEngine`, D-90):
   * `tesseract` runs here, in the extension's Node process, and `indra` and
   * `paddle` run in the Python sidecar - never in the browser (D-59).
   *
   * A failure is a **message**: the app has to be able to say why the text did
   * not arrive, so the answer is an `ocr:error` and never a silence.
   */
  const configuredEngine = resolveOcrEngine(
    configuration.get<string>("ocrEngine"),
  );
  const configuredPython = resolvePythonPath(
    configuration.get<string>("pythonPath"),
  );

  /**
   * The Python the sidecar runs in: the private environment the extension made
   * for indra once there is one, and the teacher's own Python until then
   * (D-353).
   */
  let pythonPath = pythonForSidecar({
    configured: configuredPython,
    storageDir: context.globalStorageUri.fsPath,
  });

  /**
   * Whether the teacher has already been told about the fall-back.
   *
   * The sidecar falls back to the slow path when the fast one crashes
   * (D-106), and the slow path is MUCH slower. The teacher is told **once**:
   * the fact is in every answer, but a message per read would be noise.
   */
  let toldAboutTheFallback = false;

  /**
   * The extension's own message about the fall-back.
   *
   * It says why the read was slow, in the extension's own words - not the
   * engine's, and not the library's (D-91, D-106).
   */
  const tellAboutTheFallback = (
    engine: string,
    durationMs: number | undefined,
  ) => {
    if (toldAboutTheFallback) {
      return;
    }

    toldAboutTheFallback = true;

    const seconds =
      durationMs === undefined
        ? ""
        : ` (this read took ${(durationMs / 1000).toFixed(1)} s)`;

    void vscode.window.showWarningMessage(
      `Excalidraw Bridge: ${engine} ran WITHOUT oneDNN, so it is on its slow path${seconds}. ` +
        "oneDNN is broken on this machine, so this is the only configuration that works here.",
    );
  };

  /**
   * The engine's **state**, published to the panel (D-90, D-91).
   *
   * The panel has to be able to say which engine is in use, and - when the
   * engine is not there - **why**, and what to install (D-75). It is a state,
   * not a silence.
   */
  const publishOcrState = (state: OcrEngineState) => {
    ocrState = state;
    bridgeServer?.broadcast({
      v: 1,
      type: "ocr:state",
      state: state.state,
      ...(state.engine ? { engine: state.engine } : {}),
      ...(state.reason ? { reason: state.reason } : {}),
    });
  };

  /**
   * The engine is resolved **once**, at activation: the panel is told which
   * engine is in use without waiting for a read (D-90).
   */
  const resolveTheEngine = async () => {
    const state = await resolveEngineState({
      engine: configuredEngine,
      sidecar: ocrSidecar({
        pythonPath,
        extensionDir: context.extensionPath,
      }),
      searchPaths: engineSearchPaths(workspaceRoot),
    });

    publishOcrState(state);
  };

  /**
   * Installs the indra engine in an environment of its own (D-353).
   *
   * The sidecar is stopped and started again in the new environment, and the
   * panel is told the engine is there - so the next read uses it without the
   * teacher doing anything else.
   */
  const installIndraEngine = async () => {
    const outcome = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title:
          "Excalidraw Bridge: installing the indra OCR engine (one download, about 270 MB)",
        cancellable: false,
      },
      () =>
        installIndra({
          basePython: configuredPython,
          storageDir: context.globalStorageUri.fsPath,
          extensionDir: context.extensionPath,
        }),
    );

    if (!outcome.ok || !outcome.python) {
      void vscode.window.showErrorMessage(
        `Excalidraw Bridge: ${outcome.message}`,
      );

      return;
    }

    stopOcrSidecar();
    pythonPath = outcome.python;
    await resolveTheEngine();

    void vscode.window.showInformationMessage(
      "Excalidraw Bridge: indra is installed - the next read uses it. (Its model downloads the first time it reads.)",
    );
  };

  /** the teacher is asked once whether indra is installed now (D-353) */
  let offeredIndra = false;

  const offerIndraInstall = async () => {
    if (offeredIndra) {
      return;
    }

    offeredIndra = true;

    const choice = await vscode.window.showInformationMessage(
      "Excalidraw Bridge: the indra OCR engine is not installed on this machine, so the text was read with tesseract. Install indra now? It is one download of about 270 MB, made once, in an environment of its own.",
      "Install indra",
      "Not now",
    );

    if (choice === "Install indra") {
      await installIndraEngine();
    } else {
      // asked again the next time the teacher reads with indra
      offeredIndra = false;
    }
  };

  const readText = async (request: OcrRequest) => {
    try {
      // the request may name an engine; when it does not, the setting decides
      const engine = engineForRequest(request.engine, configuredEngine);

      const result = await readWithEngine({
        engine,
        request: {
          id: request.id,
          imageBase64: request.imageBase64,
          ...(request.region ? { region: request.region } : {}),
          ...(request.language ? { language: request.language } : {}),
        },
        sidecar: ocrSidecar({
          pythonPath,
          extensionDir: context.extensionPath,
        }),
        searchPaths: engineSearchPaths(workspaceRoot),
      });

      bridgeServer?.broadcast({
        v: 1,
        type: "ocr:result",
        id: request.id,
        text: result.text,
        lines: result.lines,
        ...(result.confidence === undefined
          ? {}
          : { confidence: result.confidence }),
        // which engine ran, and how long it took (D-90)
        ...(result.engine ? { engine: result.engine } : {}),
        ...(result.durationMs === undefined
          ? {}
          : { durationMs: result.durationMs }),
        // how the engine's model was built: the truth about a slow read (D-106)
        ...(result.model ? { model: result.model } : {}),
      });

      // the engine fell back to the slow path: the teacher is told why the
      // read took so long, in the extension's own words (D-91, D-106)
      if (result.model?.mkldnn === false) {
        tellAboutTheFallback(result.engine ?? engine, result.durationMs);
      }
    } catch (error) {
      const message = (error as Error).message;

      bridgeServer?.broadcast({
        v: 1,
        type: "ocr:error",
        id: request.id,
        message,
      });

      // indra that is not installed is a choice, not an error: the read was
      // taken by the next engine, and the teacher is offered the install once
      // (D-353)
      if (isIndraMissing(message)) {
        void offerIndraInstall();
      } else {
        vscode.window.showErrorMessage(`Excalidraw Bridge: ${message}`);
      }
    }
  };

  /**
   * The captions of a YouTube video (D-129).
   *
   * A browser cannot read them, so the **bridge** does: the tiers are tried in
   * order, and the tier that answered travels with the answer - so the panel
   * can say *"these captions came from the public endpoint, which may be
   * incomplete"* or *"no captions: the API key is not set"*.
   */
  const readCaptions = async (request: { id: string; videoId: string }) => {
    const answer = await resolveYouTubeCaptions({
      videoId: request.videoId,
      apiKey: youtubeApiKey,
      fetchImpl: globalFetch,
    });

    // the message carries the tier that answered (D-129)
    bridgeServer?.broadcast(
      captionMessage({
        id: request.id,
        videoId: request.videoId,
        answer,
      }),
    );
  };

  const handleBridgeMessage = (
    message: BridgeMessage,
    connection?: BridgeConnection,
  ) => {
    switch (message.type) {
      case "run:start":
        void runCommand(message);
        break;
      case "run:stop":
        runner?.stop(message.runId);
        break;
      case "code:run":
        // The panel's Run control: the teacher's own text, run in the
        // teacher's workspace (D-124).
        void snippetService?.run(message);
        break;
      case "ping":
        bridgeServer?.broadcast({ v: 1, type: "pong" });
        break;
      case "editor:mirror":
        // What is mirrored is a **choice** (D-143): the teacher changed it, so
        // the capture descriptor says so again, and a panel that connects
        // later learns the choice.
        applyMirrorMessage(
          mirror,
          (state) => captureState.setMirror(state),
          message,
        );
        break;
      case "editor:control":
        // The canvas may touch the editor's window only when the teacher said
        // so, and the connection that said so is the one that is heard
        // (D-323, D-327).
        setControl(message.enabled, connection);
        break;
      case "editor:input": {
        // One event for the editor's window: it passes the gate or it is
        // dropped, and the gate says which (D-327).
        const verdict = inputGate.accept(message.event, connection);

        if (verdict.ok) {
          windowInput?.send(verdict.line);

          // a key (or typed text) is timed until the picture next changes
          if (
            verdict.line.startsWith("K down") ||
            verdict.line.startsWith("T ")
          ) {
            perfMonitor.keySent();
          }
        } else if (verdict.why === "limited") {
          noteLimited();
        }

        break;
      }
      case "editor:window":
        // Park the editor's window, or bring it back (D-328): the teacher's
        // choice, from the panel (D-148).
        if (message.action === "park") {
          void parkEditor();
        } else if (message.action === "virtual") {
          void moveToVirtualByChoice();
        } else {
          void bringBackByChoice();
        }
        break;
      case "ocr:request":
        void readText(message);
        break;
      case "captions:request":
        // The captions of a YouTube video, in the tiers (D-129).
        void readCaptions(message);
        break;
      default:
        break;
    }
  };

  /**
   * The editor's **own window**: parked out of sight, brought back, and
   * controlled from the canvas (D-323, D-328), and the **input panel** (D-145).
   *
   * The screen the students see and the controls the teacher uses are
   * different surfaces: the teacher's own screen is for the canvas and their
   * notes, and the editor's window can go out of sight and still be seen and
   * driven from the canvas. It needs **nothing installed** (D-329): parking is
   * a window move, and the control is posted input.
   *
   * Both are **Windows** features - they are Windows' own window APIs.
   */
  const windowPark = createWindowPark({
    scriptPath: join(context.extensionPath, WINDOW_SCRIPT_RELATIVE_PATH),
  });

  /** the editor's window, found BY RULE (D-112, D-113) */
  const editorRule: WindowRule = {
    titleLike: workspace,
    // the OS process name is not the editor's name: VS Code runs as `Code`
    processName: editorProcessName(appName),
    subject: "your editor's window",
  };

  /** the panel's capability. It lives for the session. */
  let panelCapability: string | null = null;

  /** what the input panel shows about the editor's window */
  let panelState: PanelState = UNKNOWN_PANEL_STATE;

  /**
   * Is the editor's window parked? It is READ from the window, and published
   * in the capture's descriptor so that every panel says the same thing.
   */
  const refreshWindowState = async (): Promise<PanelState> => {
    if (process.platform !== "win32") {
      panelState = {
        parked: false,
        reason:
          "parking the editor's window is a Windows feature - your editor stays on the desktop",
      };

      return panelState;
    }

    if (!workspace) {
      panelState = {
        parked: false,
        reason:
          "open a folder first - the editor's window is found by the folder's name",
      };

      return panelState;
    }

    try {
      const parked = await windowPark.isParked(editorRule);

      panelState = {
        parked,
        reason: parked
          ? "the editor's window is parked: it keeps working, out of sight"
          : "the editor's window is on a display",
      };

      captureState.setParked(parked);
      captureState.setVirtual(await windowPark.virtualState(editorRule));
    } catch (error) {
      panelState = {
        parked: false,
        reason: `the editor's window could not be read: ${
          (error as Error).message
        }`,
      };
    }

    return panelState;
  };

  /**
   * Park the editor's window (D-328).
   *
   * This is an **option the teacher chooses** (D-148): nothing moves until the
   * teacher presses the panel's button or runs this command. The window is
   * found **by rule**, and the move never takes the focus, so the teacher
   * keeps typing while their window goes (D-147).
   */
  const parkEditor = async () => {
    if (process.platform !== "win32") {
      void vscode.window.showInformationMessage(
        "Excalidraw Bridge: parking the editor's window is a Windows feature - your editor stays on the desktop.",
      );
      return;
    }

    if (!workspace) {
      void vscode.window.showInformationMessage(
        "Excalidraw Bridge: open a folder first - the editor's window is found by the folder's name.",
      );
      return;
    }

    try {
      const result = await windowPark.park(editorRule);

      await refreshWindowState();

      void vscode.window.showInformationMessage(
        `Excalidraw Bridge: ${result.reason}.`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Excalidraw Bridge: ${(error as Error).message}`,
      );
    }
  };

  /**
   * The editor's window comes BACK (D-149): the way the teacher had it, or on
   * the primary display when nothing was kept.
   */
  const bringBackEditor = async () => {
    if (process.platform !== "win32") {
      void vscode.window.showInformationMessage(
        "Excalidraw Bridge: parking the editor's window is a Windows feature - your editor is already on this screen.",
      );
      return;
    }

    if (!workspace) {
      void vscode.window.showInformationMessage(
        "Excalidraw Bridge: open a folder first - the editor's window is found by the folder's name.",
      );
      return;
    }

    try {
      const result = await windowPark.bringBack(editorRule);

      await refreshWindowState();

      void vscode.window.showInformationMessage(
        `Excalidraw Bridge: ${result.reason}.`,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Excalidraw Bridge: ${(error as Error).message}`,
      );
    }
  };

  /**
   * The teacher's own button: the window goes to the virtual display (D-351).
   *
   * It stays there - Control ending does not take it back - until the teacher
   * brings it back to the main display.
   */
  const moveToVirtualByChoice = async () => {
    if (process.platform !== "win32" || !workspace) {
      void vscode.window.showInformationMessage(
        "Excalidraw Bridge: moving the editor's window needs Windows and an open folder.",
      );
      return;
    }

    chosenVirtual = true;
    declinedVirtual = false;

    const moved = await moveToVirtual();

    if (!moved) {
      chosenVirtual = false;

      void vscode.window.showInformationMessage(
        "Excalidraw Bridge: there is no virtual display on this machine to put the editor's window on.",
      );
    }

    await refreshWindowState();
  };

  /**
   * The teacher's own button: the window comes back to the main display, from
   * the virtual display or from where it was parked (D-149, D-351).
   */
  const bringBackByChoice = async () => {
    chosenVirtual = false;
    declinedVirtual = true;
    onVirtualDisplay = false;

    await bringBackEditor();
  };

  /**
   * The **control** of the editor's window (D-323 to D-327).
   *
   * It is off until a panel turns it on, and it is off again when that panel's
   * connection ends. The helper that delivers the input runs only while
   * Control is on.
   */
  const inputGate = createInputGate();

  let windowInput: WindowInput | null = null;

  /** what the helper last said about the way in (D-326) */
  let helperState: InputHelperState = {
    route: "none",
    reason: "Control is off",
  };

  /** are events being dropped for being too many right now? (D-327) */
  let limited = false;

  /**
   * Where the mirror's time goes (D-370): the capture helper's own numbers,
   * and how far behind its timer this extension host is - the host is the one
   * thread that every extension of the editor shares, and the mirror's stream
   * is served from it.
   */
  const perfMonitor = createPerfMonitor();
  const perfChannel = vscode.window.createOutputChannel("Excalidraw Bridge");
  let lagLast = Date.now();
  const lagTimer = setInterval(() => {
    const at = Date.now();

    perfMonitor.recordHostLag(Math.max(0, at - lagLast - 100));
    lagLast = at;
  }, 100);

  lagTimer.unref?.();
  context.subscriptions.push({
    dispose: () => {
      clearInterval(lagTimer);
      perfChannel.dispose();
    },
  });

  /**
   * Whether the editor's window was put on the **virtual display** for the
   * focus route (D-350).
   *
   * Real input goes to the window in front, so on this route the window is
   * brought to the front for every burst of input - and on the teacher's own
   * screen that is a window that jumps up and goes back. On a virtual display
   * it jumps up where nobody is looking. It is put there when the route turns
   * out to be the focus route, and it is put back when Control ends.
   */
  let onVirtualDisplay = false;

  /** the move to the virtual display is tried once for each Control session */
  let virtualTried = false;

  /**
   * The teacher put the window on the virtual display themselves (D-351): it
   * stays there until they bring it back, and Control ending does not.
   */
  let chosenVirtual = false;

  /**
   * The teacher brought the window back to the main display themselves
   * (D-351): the focus route leaves it there until Control ends.
   */
  let declinedVirtual = false;

  /** the window is put on the virtual display, and the helper looks again */
  const moveToVirtual = async (): Promise<boolean> => {
    virtualTried = true;

    try {
      const result = await windowPark.moveToVirtualDisplay(editorRule);

      if (!result.ok) {
        // no virtual display: the route works on the teacher's own screen, and
        // the reason says what would make it better
        helperState = {
          route: helperState.route,
          reason:
            helperState.route === "focus"
              ? "real input was chosen: the editor's window is brought to the front for a moment - a virtual display would keep that out of your way"
              : helperState.reason,
        };
        publishControl();

        return false;
      }

      onVirtualDisplay = true;

      await refreshWindowState();

      helperState = {
        route: helperState.route,
        reason: VIRTUAL_REASON,
      };
      publishControl();

      if (result.moved) {
        windowInput?.send("R");
      }

      return true;
    } catch {
      return false;
    }
  };

  /** the window comes back from the virtual display, when it was put there */
  const leaveVirtualDisplay = async () => {
    virtualTried = false;
    declinedVirtual = false;

    // a window the teacher put there stays there until they bring it back
    if (!onVirtualDisplay || chosenVirtual) {
      return;
    }

    onVirtualDisplay = false;

    try {
      await windowPark.bringBack(editorRule);
      await refreshWindowState();
    } catch {
      // the window may be gone already
    }
  };

  const publishControl = () => {
    captureState.setControl({
      enabled: inputGate.enabled,
      route: inputGate.enabled ? helperState.route : "none",
      reason: !inputGate.enabled
        ? "Control is off"
        : limited
        ? "some input came too fast and was dropped"
        : helperState.reason,
    });
  };

  // The control is announced from the FIRST message of the descriptor, off:
  // a panel draws its Control switch only when the extension says it has one
  // (D-323), and it used to say so only once somebody had turned it on.
  publishControl();

  /** said once while the limit is dropping events, and not for every one */
  const noteLimited = () => {
    if (limited) {
      return;
    }

    limited = true;
    publishControl();

    setTimeout(() => {
      limited = false;
      publishControl();
    }, 2000);
  };

  /**
   * The helper, with the route the setting says NOW (D-335): the setting is
   * read again every time, because the pick list changes it while the editor
   * runs.
   */
  const makeWindowInput = (): WindowInput =>
    createWindowInput({
      scriptPath: join(context.extensionPath, INPUT_SCRIPT_RELATIVE_PATH),
      processName: editorProcessName(appName),
      titleLike: workspace,
      route: resolveInputRoute(
        vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<string>("inputRoute"),
      ),
      onState: (state) => {
        helperState =
          onVirtualDisplay && state.route === "focus"
            ? { route: state.route, reason: VIRTUAL_REASON }
            : state;
        publishControl();

        // the focus route: the window goes to the virtual display, if there is
        // one (D-350)
        if (
          state.route === "focus" &&
          inputGate.enabled &&
          !onVirtualDisplay &&
          !virtualTried &&
          !declinedVirtual
        ) {
          void moveToVirtual();
        }
      },
      onStatus: (text) => {
        // something the teacher should read: it replaces the reason until
        // the helper says the route again
        helperState = { ...helperState, reason: text };
        publishControl();
      },
      // Real input goes to the window in front, and a parked window is on no
      // display: the window is brought back, and the helper looks again
      // (D-336). The window is the teacher's, so it is said.
      onNeed: () => {
        void (async () => {
          // a virtual display is where the window goes when there is one
          // (D-350); the teacher's own screen when there is not (D-336)
          if (!declinedVirtual && (await moveToVirtual())) {
            return;
          }

          const result = await windowPark.bringBack(editorRule);

          await refreshWindowState();

          helperState = {
            route: helperState.route,
            reason: result.ok
              ? "real input needs the editor's window on a display, so it was brought back"
              : result.reason,
          };
          publishControl();

          if (result.ok) {
            windowInput?.send("R");
          }
        })();
      },
    });

  const setControl = (enabled: boolean, from?: BridgeConnection) => {
    if (process.platform !== "win32") {
      helperState = {
        route: "none",
        reason: "the control of the editor's window needs Windows",
      };
      publishControl();
      return;
    }

    inputGate.setEnabled(enabled, from);

    if (enabled) {
      if (!windowInput) {
        windowInput = makeWindowInput();
      }

      helperState = { route: "none", reason: "starting the input helper" };
      windowInput.start();
    } else {
      windowInput?.stop();
      windowInput = null;
      void leaveVirtualDisplay();
    }

    publishControl();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(`${CONFIG_SECTION}.inputRoute`) &&
        inputGate.enabled &&
        windowInput
      ) {
        windowInput.stop();
        windowInput = makeWindowInput();
        helperState = { route: "none", reason: "starting the input helper" };
        windowInput.start();
        publishControl();
      }
    }),
  );

  /** a connection ended: when it was the one that had Control, it is off (D-327) */
  const onBridgeDisconnect = (connection: BridgeConnection) => {
    if (inputGate.connectionEnded(connection)) {
      windowInput?.stop();
      windowInput = null;
      void leaveVirtualDisplay();
      publishControl();
    }
  };

  shutdownWindow = async () => {
    windowInput?.stop();
    windowInput = null;

    // a window that is parked - or on the virtual display - when the
    // extension ends is brought back (D-328, D-350)
    if (process.platform === "win32" && workspace) {
      try {
        if (onVirtualDisplay) {
          onVirtualDisplay = false;
          await windowPark.bringBack(editorRule);
        } else if (await windowPark.isParked(editorRule)) {
          await windowPark.bringBack(editorRule);
        }
      } catch {
        // the window may be gone already
      }
    }
  };

  const inputPanel = createInputPanel({
    port: () => bridgeServer?.port ?? port,
    // The panel's controls go onto the **bridge**: the presenter is driven the
    // one way there is, and the panel never sees the session token (D-145).
    onCommand: (command) => {
      bridgeServer?.broadcast({ v: 1, type: "present:command", command });
    },
    // The panel's own **actions** stay on the teacher's machine: the editor's
    // window parked out of sight - and brought back - is the extension's own
    // business and never goes on the bridge (D-328). Nothing moves unless the
    // teacher pressed the button (D-148).
    onAction: (action) => {
      if (action === "park-editor-window") {
        void parkEditor();
      }

      if (action === "bring-back-editor-window") {
        void bringBackEditor();
      }
    },
    state: () => panelState,
  });

  /**
   * The **input panel**: the presenter's controls, on the teacher's own
   * screen.
   */
  const openInputPanel = async () => {
    if (!panelCapability) {
      panelCapability = inputPanel.createCapability();
    }

    await refreshWindowState();

    const url = inputPanel.urlFor(panelCapability);

    await vscode.env.openExternal(vscode.Uri.parse(url));

    void vscode.window.showInformationMessage(
      `Excalidraw Bridge: the presenter's input panel is open. ${panelState.reason}.`,
    );
  };

  // The whiteboards the teacher allowed to connect without a token, remembered
  // for each origin in the editor's own memory (D-518)
  const pairing = createPairing({
    store: {
      read: () => context.globalState.get<string[]>(PAIRED_ORIGINS_KEY, []),
      write: (origins) =>
        context.globalState.update(PAIRED_ORIGINS_KEY, origins),
    },
    ask: async (question) =>
      (await vscode.window.showInformationMessage(
        question,
        {
          modal: true,
          detail:
            "It will see the text of your editor's open file and can run it. Allow it only if you opened the whiteboard yourself.",
        },
        PAIRING_ALLOW,
      )) === PAIRING_ALLOW,
  });

  bridgeServer = createBridgeServer({
    port,
    host: DEFAULT_BRIDGE_HOST,
    token,
    workspace,
    version: extensionVersion,
    appName,
    // A page with no token asks to be paired; the teacher answers here (D-518)
    onPair: (origin) => pairing.decide(origin),
    onMessage: handleBridgeMessage,
    onConnect: sendEditorContentTo,
    // Control is off again when the connection that turned it on ends (D-327)
    onDisconnect: onBridgeDisconnect,
    inputPanel,
    logger: (message) => console.info("[excalidraw-bridge]", message),
  });

  runner = createRunner({
    bridge: {
      broadcast: (message) => bridgeServer?.broadcast(message),
    },
    defaultCwd: () => workspaceRoot,
  });

  // The **runnable snippet**: the teacher's own text, run in the teacher's
  // workspace (D-124). The extension is the only one of the three that can
  // run anything, and it is the only one that knows what is installed here.
  snippetService = createSnippetService({
    bridge: {
      broadcast: (message) => bridgeServer?.broadcast(message),
    },
    workspaceRoot,
  });

  // The runtimes that are **actually** on this machine. The panel's language
  // picker offers only these, so it never offers a language that cannot run
  // here (D-124).
  void snippetService.detect().then((languages) => {
    bridgeServer?.broadcast({ v: 1, type: "run:runtimes", languages });
  });

  void bridgeServer.listen().catch((error: unknown) => {
    // The port is FIXED (D-67), so with two editors running only one of them
    // holds it - and the app reaches that one, not necessarily the one the
    // teacher has their file open in. Losing that race silently is what made
    // this take an hour to see, so the message says what to do (D-77).
    vscode.window.showErrorMessage(portConflictMessage(port, error));
  });

  // The live view of the editor's own window (D-82). It is started once, and
  // it is stopped when the extension goes away. A helper that DIES is started
  // again (D-112): one dead helper must not be dead for the rest of the
  // session.
  startWindowCapture();

  // The OCR engine is resolved ONCE, here: the panel is told which engine is
  // in use, and - when it is not there - why, and what to install (D-90, D-91).
  void resolveTheEngine();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(publishEditorContent),
    // NOT on every selection change: a cursor move fires it, and the panel
    // would then write the whole scene again for every move of the mouse.
    // The panel mirrors the TEXT, not the caret, so a text change and a
    // change of the active file are the only two things it needs (D-75).
    vscode.workspace.onDidChangeTextDocument(publishEditorContent),
  );

  // The task type. The teacher's own tasks.json can use it, and so can the
  // "Run" button in the panel.
  const provider: vscode.TaskProvider = {
    provideTasks: () => [],
    resolveTask: (task) => {
      const definition = task.definition;
      if (definition.type !== BRIDGE_TASK_TYPE) {
        return undefined;
      }
      const command =
        typeof definition.command === "string" ? definition.command : "";
      if (!command) {
        return undefined;
      }
      const args = Array.isArray(definition.args)
        ? definition.args.filter(
            (arg: unknown): arg is string => typeof arg === "string",
          )
        : [];
      const cwd =
        typeof definition.cwd === "string" ? definition.cwd : workspaceRoot;
      return new vscode.Task(
        definition,
        vscode.TaskScope.Workspace,
        `Excalidraw Bridge: ${command}`,
        BRIDGE_TASK_TYPE,
        new vscode.CustomExecution(async () =>
          createRunPseudoterminal({
            runner: runner as Runner,
            request: { command, args, cwd },
          }),
        ),
      );
    },
  };
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider(BRIDGE_TASK_TYPE, provider),
  );

  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  status.text = "$(plug) Excalidraw Bridge";
  status.tooltip = `ws://${DEFAULT_BRIDGE_HOST}:${port}`;
  status.command = "excalidraw-bridge.showStatus";
  status.show();
  context.subscriptions.push(status);

  /** the route the setting says now (D-335) */
  const currentInputRoute = () =>
    resolveInputRoute(
      vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<string>("inputRoute"),
    );

  /**
   * The teacher chooses how the canvas types into the editor, from a pick list
   * (D-335): the same setting as `excalidraw-bridge.inputRoute`, reached
   * without opening the settings page, and applied at once.
   */
  const chooseInputRoute = async () => {
    const current = currentInputRoute();

    const picked = await vscode.window.showQuickPick(
      INPUT_ROUTE_CHOICES.map((choice) => ({
        label: `${choice.value === current ? "$(check) " : ""}${choice.label}`,
        description: choice.description,
        value: choice.value,
      })),
      {
        title: "Excalidraw Bridge: how the canvas types into this editor",
        placeHolder: "Choose the way in",
      },
    );

    if (!picked || picked.value === current) {
      return;
    }

    await vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update("inputRoute", picked.value, vscode.ConfigurationTarget.Global);

    const label =
      INPUT_ROUTE_CHOICES.find((choice) => choice.value === picked.value)
        ?.label ?? picked.value;

    void vscode.window.showInformationMessage(
      `Excalidraw Bridge: the canvas types into the editor by the ${label} route from now on.`,
    );
  };

  const showStatus = async () => {
    const route = INPUT_ROUTE_CHOICES.find(
      (choice) => choice.value === currentInputRoute(),
    );

    const choice = await vscode.window.showInformationMessage(
      `Excalidraw Bridge is listening on ws://${DEFAULT_BRIDGE_HOST}:${port}.${
        generated
          ? " The token is kept in this editor, so a reload reconnects by itself:"
          : " The token is:"
      } ${token} - input route: ${route?.label ?? "Automatic"}.`,
      "Copy token",
      "Input route...",
    );
    if (choice === "Copy token") {
      await vscode.env.clipboard.writeText(token);
      vscode.window.showInformationMessage("Excalidraw Bridge: token copied.");
    }

    if (choice === "Input route...") {
      await chooseInputRoute();
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw-bridge.showStatus", showStatus),
    vscode.commands.registerCommand(
      "excalidraw-bridge.chooseInputRoute",
      chooseInputRoute,
    ),
    vscode.commands.registerCommand(
      "excalidraw-bridge.forgetPairedWhiteboards",
      async () => {
        const count = await pairing.forget();

        void vscode.window.showInformationMessage(
          count
            ? `Excalidraw Bridge: ${count} whiteboard${
                count === 1 ? "" : "s"
              } forgotten. Each will be asked about again.`
            : "Excalidraw Bridge: no whiteboard was remembered.",
        );
      },
    ),
    vscode.commands.registerCommand("excalidraw-bridge.copyToken", async () => {
      await vscode.env.clipboard.writeText(token);
      vscode.window.showInformationMessage("Excalidraw Bridge: token copied.");
    }),
    // The input panel (D-145)
    vscode.commands.registerCommand(
      "excalidraw-bridge.openInputPanel",
      openInputPanel,
    ),
    // The editor's own window is parked out of sight (D-328) - and it comes
    // back (D-149). Both are the teacher's choice (D-148).
    vscode.commands.registerCommand(
      "excalidraw-bridge.parkEditorWindow",
      parkEditor,
    ),
    vscode.commands.registerCommand(
      "excalidraw-bridge.bringBackEditorWindow",
      bringBackByChoice,
    ),
    // where the mirror's time goes, said in the Output panel (D-370)
    vscode.commands.registerCommand("excalidraw-bridge.showPerformance", () => {
      const report = perfMonitor.report();

      perfChannel.clear();

      for (const line of formatPerfReport(report)) {
        perfChannel.appendLine(line);
      }

      perfChannel.show(true);
      void vscode.window.showInformationMessage(
        `Excalidraw Bridge: ${report.verdict}`,
      );
    }),
    // the indra engine installs itself, when the teacher says so (D-353)
    vscode.commands.registerCommand(
      "excalidraw-bridge.installIndraOcr",
      installIndraEngine,
    ),
    // the virtual display is the teacher's choice too (D-351)
    vscode.commands.registerCommand(
      "excalidraw-bridge.moveEditorWindowToVirtualScreen",
      moveToVirtualByChoice,
    ),
  );

  // Whether the window is parked is read now, so that a window that was
  // parked before the extension restarted is said to be (D-328). A window that
  // the editor itself started on the virtual display - it opens where it was
  // closed - is brought to the main display: nobody can reach it there
  // (D-356).
  void (async () => {
    if (process.platform === "win32" && workspace) {
      try {
        if ((await windowPark.virtualState(editorRule)).on) {
          await windowPark.bringBack(editorRule);
        }
      } catch {
        // the window may not be there yet: it is read again below
      }
    }

    await refreshWindowState();
  })();
}

export function deactivate(): Promise<void> | void {
  // the input helper stops, and a window that was parked comes back (D-328)
  const shutdown = shutdownWindow?.();

  shutdownWindow = null;

  // the capture is a process of its own: it goes away with the extension
  captureSupervisor?.stop();
  captureSupervisor = null;

  // the OCR sidecar is a process of its own too (D-90)
  stopOcrSidecar();

  // The trailing publish carries the LAST state, so it is flushed before the
  // extension goes away - the final text is never lost (D-88).
  textPublisher?.flush();
  textPublisher?.stop();
  textPublisher = null;

  void bridgeServer?.close();
  bridgeServer = null;

  return shutdown;
}
