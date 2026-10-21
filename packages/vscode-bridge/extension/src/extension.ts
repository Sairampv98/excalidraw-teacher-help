import { basename } from "node:path";

import * as vscode from "vscode";

import {
  BRIDGE_TASK_TYPE,
  DEFAULT_BRIDGE_HOST,
  type BridgeMessage,
} from "../../bridge/src/protocol";
import { createOcrService } from "../../bridge/src/ocr";

import { createBridgeServer, type BridgeConnection } from "./bridge";
import { resolvePort, resolveToken } from "./config";
import {
  editorContentMessage,
  editorToMirror,
  type EditorDocumentLike,
  type EditorLike,
} from "./editorState";
import { createTesseractEngine, engineSearchPaths } from "./ocrEngine";
import { portConflictMessage } from "./portConflict";
import { createRunPseudoterminal } from "./pseudoterminal";
import { createRunner, type Runner } from "./runner";

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
   */
  const activeTabDocument = (): EditorDocumentLike | undefined => {
    const tab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    const input = tab?.input as { document?: EditorDocumentLike } | undefined;

    return input?.document;
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

  const publishEditorContent = () => {
    bridgeServer?.broadcast(editorContentMessage(currentEditor()));
  };

  const sendEditorContentTo = (connection: BridgeConnection) => {
    connection.send(editorContentMessage(currentEditor()));
  };

  const runCommand = async (request: {
    command: string;
    args: string[];
    cwd?: string;
  }) => {
    if (!runner) {
      return;
    }
    const definition: vscode.TaskDefinition = {
      type: BRIDGE_TASK_TYPE,
      command: request.command,
      args: request.args,
      cwd: request.cwd,
    };
    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      `Excalidraw Bridge: ${request.command}`,
      BRIDGE_TASK_TYPE,
      new vscode.CustomExecution(async () =>
        createRunPseudoterminal({ runner: runner as Runner, request }),
      ),
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
  void bridgeServer?.close();
  bridgeServer = null;
}
