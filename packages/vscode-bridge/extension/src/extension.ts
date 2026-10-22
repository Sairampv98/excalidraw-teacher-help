import { basename, join } from "node:path";

import * as vscode from "vscode";

import {
  BRIDGE_TASK_TYPE,
  DEFAULT_BRIDGE_HOST,
  type BridgeMessage,
} from "../../bridge/src/protocol";
import { createOcrService } from "../../bridge/src/ocr";

import { createBridgeServer, type BridgeConnection } from "./bridge";
import { resolveCaptureFps, resolvePort, resolveToken } from "./config";
import {
  documentForTabUri,
  editorContentMessage,
  editorToMirror,
  type EditorDocumentLike,
  type EditorLike,
} from "./editorState";
import { createTesseractEngine, engineSearchPaths } from "./ocrEngine";
import { portConflictMessage } from "./portConflict";
import { createRunPseudoterminal } from "./pseudoterminal";
import { createRunner, type Runner } from "./runner";
import { createBridgeTask } from "./taskPresentation";
import {
  CAPTURE_SCRIPT_RELATIVE_PATH,
  createWindowCapture,
  editorProcessName,
  type WindowCapture,
} from "./windowCapture";

import type { OcrRequest, OcrResult } from "../../bridge/src/ocr";

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

let windowCapture: WindowCapture | null = null;

export function activate(context: vscode.ExtensionContext): void {
  extensionVersion = context.extension?.packageJSON?.version ?? "0.0.0";

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const port = resolvePort(workspaceRoot, configuration.get<number>("port"));
  const { token, generated } = resolveToken(configuration.get<string>("token"));
  const workspace = workspaceRoot ? basename(workspaceRoot) : "";

  let runner: Runner | null = null;

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
   * The live view of the editor's **own window** (D-82).
   *
   * The picture rides the websocket as an `editor:frame` message - it never
   * rides in the panel's payload, because the payload is saved with the
   * document.
   *
   * The capture is **one** helper for the whole session: a helper per frame
   * would spawn a process every frame for the whole lesson, and each of them
   * would capture a different moment.
   */
  let lastCaptureMessage: BridgeMessage | null = null;

  const broadcastCapture = (message: BridgeMessage) => {
    lastCaptureMessage = message;
    bridgeServer?.broadcast(message);
  };

  /**
   * The capture cannot run, and this is why.
   *
   * A failure is a **message**, not a silence: the panel has to be able to
   * say why there is no live view, and fall back to the text (D-75).
   */
  const captureUnavailable = (reason: string): BridgeMessage => ({
    v: 1,
    type: "editor:frame",
    state: "unavailable",
    data: "",
    width: 0,
    height: 0,
    seq: 0,
    reason,
  });

  const startWindowCapture = () => {
    if (process.platform !== "win32") {
      // the capture is a Windows program: `PrintWindow` is a Windows API
      broadcastCapture(
        captureUnavailable("the live view of the editor needs Windows"),
      );
      return;
    }

    // The helper ships INSIDE the extension, so there is nothing to install
    // and no dependency to add - PowerShell is on every Windows machine.
    const scriptPath = join(
      context.extensionPath,
      CAPTURE_SCRIPT_RELATIVE_PATH,
    );

    windowCapture = createWindowCapture({
      scriptPath,
      // the OS process name is not the editor's name: VS Code runs as `Code`
      processName: editorProcessName(appName),
      // the window's title holds the workspace folder's name
      titleLike: workspace,
      fps: resolveCaptureFps(configuration.get<number>("captureFps")),
      onFrame: (frame) => {
        broadcastCapture({
          v: 1,
          type: "editor:frame",
          state: "live",
          data: frame.data,
          width: frame.width,
          height: frame.height,
          seq: frame.seq,
        });
      },
      onUnavailable: (reason) => {
        broadcastCapture(captureUnavailable(reason));
      },
    });
  };

  const publishEditorContent = () => {
    bridgeServer?.broadcast(editorContentMessage(currentEditor()));
  };

  const sendEditorContentTo = (connection: BridgeConnection) => {
    connection.send(editorContentMessage(currentEditor()));

    // The capture state, so that a panel which connects **later** learns why
    // there is no live view: the reason would otherwise have been broadcast
    // into a room with nobody in it (D-75).
    if (lastCaptureMessage) {
      connection.send(lastCaptureMessage);
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
   * The engine is `tesseract.js` and it runs **here**, in the extension's Node
   * process — never in the browser (D-59). It is loaded on the first request
   * and kept afterwards, so the worker is created once and survives every
   * read.
   *
   * A failure is a **message**: the app has to be able to say why the text did
   * not arrive, so the answer is an `ocr:error` and never a silence.
   */
  let ocrService: {
    recognize: (request: OcrRequest) => Promise<OcrResult>;
  } | null = null;

  const readText = async (request: OcrRequest) => {
    try {
      if (!ocrService) {
        ocrService = createOcrService(
          await createTesseractEngine({
            searchPaths: engineSearchPaths(workspaceRoot),
          }),
        );
      }

      const result = await ocrService.recognize({
        id: request.id,
        imageBase64: request.imageBase64,
        ...(request.region ? { region: request.region } : {}),
        ...(request.language ? { language: request.language } : {}),
      });

      bridgeServer?.broadcast({ v: 1, type: "ocr:result", ...result });
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

  void bridgeServer.listen().catch((error: unknown) => {
    // The port is FIXED (D-67), so with two editors running only one of them
    // holds it - and the app reaches that one, not necessarily the one the
    // teacher has their file open in. Losing that race silently is what made
    // this take an hour to see, so the message says what to do (D-77).
    vscode.window.showErrorMessage(portConflictMessage(port, error));
  });

  // The live view of the editor's own window (D-82). It is started once, and
  // it is stopped when the extension goes away.
  startWindowCapture();

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
  windowCapture?.stop();
  windowCapture = null;

  void bridgeServer?.close();
  bridgeServer = null;
}
