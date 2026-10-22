/**
 * The bridge's task, and the focus it must never take.
 *
 * The task `excalidraw-bridge.run` runs the program in a pseudoterminal. A
 * pseudoterminal is a terminal, and where it lands is decided by
 * `terminal.integrated.defaultLocation`: `view` (the terminal panel, the
 * default) leaves the editor's focus alone, `editor` puts the terminal in the
 * editor area and takes the active editor away — `activeTextEditor` becomes
 * `undefined`, which is exactly when the mirror used to blank (D-78).
 *
 * So the task asks for the terminal and **never** for the focus (D-81). The
 * rules live in `../extension/src/taskPresentation`, which imports nothing
 * from `vscode` and is therefore testable without an editor.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import {
  createBridgeTask,
  type BridgeTask,
  type BridgeTaskApi,
} from "../extension/src/taskPresentation";

/**
 * A fake `vscode`: the task it makes is a plain object, so the test can read
 * the presentation options the bridge put on it.
 */
const fakeApi = () => {
  const created: { definition: unknown; name: string }[] = [];

  const api: BridgeTaskApi<BridgeTask> = {
    TaskRevealKind: { Always: 1 },
    TaskPanelKind: { Dedicated: 2 },
    createTask: (definition, name) => {
      created.push({ definition, name });
      return {};
    },
  };

  return { api, created };
};

describe("the bridge's task", () => {
  it("AC-100 the bridge's task reveals its terminal without ever asking for the focus", () => {
    const { api, created } = fakeApi();

    const task = createBridgeTask(api, {
      command: "python",
      args: ["main.py"],
      cwd: "/home/sai",
    });

    // the terminal is REVEALED, so the teacher sees the program run ...
    expect(task.presentationOptions?.reveal).toBe(api.TaskRevealKind.Always);

    // ... and the focus is NEVER taken from the editor.
    //
    // This is the whole rule, and it does not depend on where the terminal
    // lands: `terminal.integrated.defaultLocation` may be `view` or `editor`,
    // and the options are the same either way. In VS Code's own task system
    // this is the difference between `revealTerminal(terminal)` - which
    // happens on its own - and `focusInstance(terminal)`, which happens only
    // when the presentation asks for the focus.
    expect(task.presentationOptions?.focus).toBe(false);

    // the bridge gets its own terminal, not the teacher's
    expect(task.presentationOptions?.panel).toBe(api.TaskPanelKind.Dedicated);

    // and it is the bridge's own task type, with the command it was given
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe("Excalidraw Bridge: python");
    expect(created[0].definition).toEqual({
      type: "excalidraw-bridge.run",
      command: "python",
      args: ["main.py"],
      cwd: "/home/sai",
    });
  });
});
