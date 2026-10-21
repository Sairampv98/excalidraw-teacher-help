import { Emitter } from "./emitter";

import type { RunHandle, RunRequest, Runner } from "./runner";

/**
 * The pseudoterminal.
 *
 * This is the pattern the design calls for, and the reason the extension owns
 * the process it runs (D-51): the VS Code stable API cannot read an arbitrary
 * terminal, so the only way to know what the program printed is to be the one
 * that started it.
 *
 * The terminal the teacher sees behaves normally - every line goes to it - and
 * the SAME lines are teed to the bridge, tagged with the run id.
 */

export interface TerminalDimensions {
  columns: number;
  rows: number;
}

/** The shape VS Code expects of a pseudoterminal. */
export interface PseudoterminalLike {
  onDidWrite?: (listener: (data: string) => void) => { dispose: () => void };
  onDidClose?: (listener: (code: number | void) => void) => {
    dispose: () => void;
  };
  open: (initialDimensions?: TerminalDimensions) => void;
  close: () => void;
  handleInput?: (data: string) => void;
}

export interface RunPseudoterminalOptions {
  /** The run controller that owns the process. */
  runner: Runner;
  /** What to run. */
  request: RunRequest;
  /** Called with the run id as soon as the program starts. */
  onRunId?: (runId: string) => void;
}

export function createRunPseudoterminal(
  options: RunPseudoterminalOptions,
): PseudoterminalLike {
  const write = new Emitter<string>();
  const close = new Emitter<number | void>();
  let handle: RunHandle | null = null;

  return {
    onDidWrite: write.event,
    onDidClose: close.event,

    open: () => {
      handle = options.runner.start(options.request, {
        onOutput: ({ text }) => {
          write.fire(`${text}\n`);
        },
        onExit: ({ code }) => {
          close.fire(code ?? undefined);
        },
      });
      options.onRunId?.(handle.runId);
    },

    close: () => {
      handle?.stop();
    },

    handleInput: (data: string) => {
      if (handle) {
        options.runner.sendInput(handle.runId, data);
      }
    },
  };
}
