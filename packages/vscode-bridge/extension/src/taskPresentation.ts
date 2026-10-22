/**
 * The bridge's task must never take the focus.
 *
 * The task `excalidraw-bridge.run` runs the program in a **pseudoterminal**,
 * and a pseudoterminal is a terminal: where it lands is decided by
 * `terminal.integrated.defaultLocation`, whose default is `view` — the
 * terminal **panel**, in which case the editor keeps the focus and
 * `vscode.window.activeTextEditor` is untouched. But that setting can be
 * `editor`, and then the terminal becomes an **editor in the editor area**:
 * the active editor becomes the terminal, and `activeTextEditor` becomes
 * `undefined` — exactly the moment the mirror used to blank (D-78).
 *
 * So the task must never **ask** for the focus, whatever the setting says.
 * That is what the presentation options below are for:
 *
 * - `reveal: Always` — the terminal is revealed, so the teacher sees the
 *   program run;
 * - `focus: false` — the terminal is **not** focused, so the editor keeps
 *   it. In VS Code's own task system this is the difference between
 *   `revealTerminal(terminal)` and `focusInstance(terminal)`: the first
 *   happens on its own, the second only when the presentation asks for the
 *   focus (`src/vs/workbench/contrib/tasks/browser/terminalTaskSystem.ts`).
 *
 * The teacher's **own** task, the one their `tasks.json` contributes, is not
 * touched: its presentation is their choice, and this module has no business
 * overriding it.
 *
 * The module imports **nothing** from `vscode`, so it is testable without an
 * editor — the same rule the rest of the extension follows (`portConflict.ts`,
 * `editorState.ts`, `runner.ts`).
 */

import { BRIDGE_TASK_TYPE } from "../../bridge/src/protocol";

/** What the bridge runs. */
export interface BridgeRunRequest {
  command: string;
  args: string[];
  cwd?: string;
}

/** The task's definition, as the task type carries it. */
export interface BridgeTaskDefinition {
  type: string;
  command: string;
  args: string[];
  cwd?: string;
}

/**
 * The presentation options of a task, in the shape the VS Code API takes
 * them. The numbers are `vscode.TaskRevealKind` and `vscode.TaskPanelKind`.
 */
export interface BridgeTaskPresentation {
  reveal?: number;
  focus?: boolean;
  panel?: number;
  echo?: boolean;
}

/** The task, as far as the bridge cares about it. */
export interface BridgeTask {
  presentationOptions?: BridgeTaskPresentation;
}

/** What the bridge needs from the `vscode` namespace to make its task. */
export interface BridgeTaskApi<T extends BridgeTask> {
  /** `vscode.TaskRevealKind` */
  TaskRevealKind: { Always: number };
  /** `vscode.TaskPanelKind` */
  TaskPanelKind: { Dedicated: number };
  /** Creates the task. The extension hands in `vscode.Task`. */
  createTask: (definition: BridgeTaskDefinition, name: string) => T;
}

/**
 * The bridge's task, with the presentation options that keep the editor's
 * focus where it is.
 *
 * `focus: false` is the whole point of this function, and it is not a
 * default that may be forgotten: it is written down here, in one place, and
 * the task carries it.
 */
export function createBridgeTask<T extends BridgeTask>(
  api: BridgeTaskApi<T>,
  request: BridgeRunRequest,
): T {
  const definition: BridgeTaskDefinition = {
    type: BRIDGE_TASK_TYPE,
    command: request.command,
    args: request.args,
    cwd: request.cwd,
  };

  const task = api.createTask(
    definition,
    `Excalidraw Bridge: ${request.command}`,
  );

  task.presentationOptions = {
    // the terminal is revealed ...
    reveal: api.TaskRevealKind.Always,
    // ... and the focus is NEVER taken from the editor.
    focus: false,
    // the bridge's own terminal, not the teacher's.
    panel: api.TaskPanelKind.Dedicated,
    echo: false,
  };

  return task;
}
