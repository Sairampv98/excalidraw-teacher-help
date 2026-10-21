import { basename } from "node:path";

import * as vscode from "vscode";

import {
  BRIDGE_TASK_TYPE,
  DEFAULT_BRIDGE_HOST,
  type BridgeMessage,
} from "../../bridge/src/protocol";

import { createBridgeServer, type BridgeConnection } from "./bridge";
import { resolvePort, resolveToken } from "./config";
import { editorContentMessage } from "./editorState";
import { createRunPseudoterminal } from "./pseudoterminal";
import { createRunner, type Runner } from "./runner";

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

/** The active editor's text, as the panel wants it. */
function editorContent(): Extract<BridgeMessage, { type: "editor:content" }> {
  return editorContentMessage(vscode.window.activeTextEditor);
}

export function activate(context: vscode.ExtensionContext): void {
  extensionVersion = context.extension?.packageJSON?.version ?? "0.0.0";

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const port = resolvePort(workspaceRoot, configuration.get<number>("port"));
  const { token, generated } = resolveToken(configuration.get<string>("token"));
  const workspace = workspaceRoot ? basename(workspaceRoot) : "";

  let runner: Runner | null = null;

  const publishEditorContent = () => {
    bridgeServer?.broadcast(editorContent());
  };

  const sendEditorContentTo = (connection: BridgeConnection) => {
    connection.send(editorContent());
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
        // The OCR service is not part of this wave: it needs a sidecar that
        // the extension does not ship. The message is understood, so the
        // panel can already ask - the answer comes with the service.
        vscode.window.showErrorMessage(
          "Excalidraw Bridge: OCR is not available in this build yet.",
        );
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
    const text = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(
      `Excalidraw Bridge: could not listen on port ${port} - ${text}`,
    );
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
