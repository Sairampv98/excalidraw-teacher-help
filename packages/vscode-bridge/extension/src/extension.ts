import { basename, join } from "node:path";

import * as vscode from "vscode";

import {
  BRIDGE_TASK_TYPE,
  DEFAULT_BRIDGE_HOST,
  type BridgeMessage,
} from "../../bridge/src/protocol";

import { createBridgeServer, type BridgeConnection } from "./bridge";
import { createCaptureStatePublisher } from "./captureState";
import {
  resolveCaptureFps,
  resolvePort,
  resolvePythonPath,
  resolveToken,
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
import { portConflictMessage } from "./portConflict";
import { createRunPseudoterminal } from "./pseudoterminal";
import { createRunner, type Runner } from "./runner";
import { createSnippetService, type SnippetService } from "./snippet";
import { createBridgeTask } from "./taskPresentation";
import {
  CAPTURE_SCRIPT_RELATIVE_PATH,
  createWindowCaptureSupervisor,
  editorProcessName,
  type WindowCaptureSupervisor,
} from "./windowCapture";
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

const CONFIG_SECTION = "excalidraw-bridge";

/** The extension's own version, from its manifest. */
let extensionVersion = "0.0.0";

let bridgeServer: ReturnType<typeof createBridgeServer> | null = null;

let captureSupervisor: WindowCaptureSupervisor | null = null;

/**
 * The editor's text, published **at most every 100 ms** (D-88).
 *
 * It is a module-level variable so that `deactivate` can flush the last
 * state: the trailing publish is the one that carries the final text, and it
 * must not be lost when the extension goes away.
 */
let textPublisher: CoalescedPublisher | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extensionVersion = context.extension?.packageJSON?.version ?? "0.0.0";

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const port = resolvePort(workspaceRoot, configuration.get<number>("port"));
  const { token, generated } = resolveToken(configuration.get<string>("token"));
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
      onFrame: (frame) => {
        // The picture goes to the MJPEG STREAM and to nothing else (D-85).
        bridgeServer?.publishFrame({
          bytes: frame.bytes,
          seq: frame.seq,
          // the size rides along: a snapshot has to say how big it is (D-102)
          width: frame.width,
          height: frame.height,
        });

        // and the state says the capture is running - once, when it changes.
        captureState.live(frame.seq);
      },
      onUnavailable: (reason) => {
        // A failure is a **message**, not a silence: the panel has to be able
        // to say why there is no live view, and fall back to the text (D-75).
        // "The editor's window is not visible" is such a message, and it is a
        // different fact from "there is no window" (D-113).
        captureState.unavailable(reason);
      },
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
  const pythonPath = resolvePythonPath(configuration.get<string>("pythonPath"));

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

      vscode.window.showErrorMessage(`Excalidraw Bridge: ${message}`);
    }
  };

  const handleBridgeMessage = (message: BridgeMessage) => {
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
      case "ocr:request":
        void readText(message);
        break;
      default:
        break;
    }
  };

  bridgeServer = createBridgeServer({
    port,
    host: DEFAULT_BRIDGE_HOST,
    token,
    workspace,
    version: extensionVersion,
    appName,
    onMessage: handleBridgeMessage,
    onConnect: sendEditorContentTo,
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

  const showStatus = async () => {
    const choice = await vscode.window.showInformationMessage(
      `Excalidraw Bridge is listening on ws://${DEFAULT_BRIDGE_HOST}:${port}.${
        generated ? " This session's token is:" : " The token is:"
      } ${token}`,
      "Copy token",
    );
    if (choice === "Copy token") {
      await vscode.env.clipboard.writeText(token);
      vscode.window.showInformationMessage("Excalidraw Bridge: token copied.");
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("excalidraw-bridge.showStatus", showStatus),
    vscode.commands.registerCommand("excalidraw-bridge.copyToken", async () => {
      await vscode.env.clipboard.writeText(token);
      vscode.window.showInformationMessage("Excalidraw Bridge: token copied.");
    }),
  );
}

export function deactivate(): void {
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
}
