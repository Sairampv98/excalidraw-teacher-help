import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as setTimeoutNode } from "node:timers";

import type { BridgeMessage } from "../../bridge/src/protocol";

/**
 * The run controller.
 *
 * The VS Code stable API cannot read an arbitrary terminal -
 * `onDidWriteTerminalData` is proposed-only - so the extension OWNS the
 * process it runs (D-51). That is what lets the panel show the program's
 * output at all.
 *
 * The controller is deliberately free of any `vscode` import, so it can be
 * driven by a test without an editor.
 */

/** The part of `child_process.ChildProcess` the controller uses. */
export interface SpawnedProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  stdin: NodeJS.WritableStream | null;
  on(
    event: "exit",
    listener: (code: number | null, signal: string | null) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: (code: number | null) => void): this;
  kill(signal?: string | number): boolean;
}

export type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => SpawnedProcess;

export interface RunRequest {
  /** The program to run, e.g. `python`. */
  command: string;
  /** Its arguments, e.g. `["main.py"]`. */
  args?: string[];
  /** Where to run it. Defaults to the workspace root. */
  cwd?: string;
}

export interface RunStarted {
  runId: string;
  command: string;
  cwd: string;
}

export interface RunOutput {
  runId: string;
  stream: "stdout" | "stderr";
  text: string;
}

export interface RunExited {
  runId: string;
  code: number | null;
}

export interface RunObserver {
  onStarted?: (info: RunStarted) => void;
  onOutput?: (info: RunOutput) => void;
  onExit?: (info: RunExited) => void;
}

export interface RunHandle {
  runId: string;
  stop: () => void;
}

export interface Runner {
  /** Start a program. The messages are broadcast to the bridge as well. */
  start: (request: RunRequest, observer?: RunObserver) => RunHandle;
  /** Stop a running program. Returns false when the run is unknown. */
  stop: (runId: string) => boolean;
  /** Forward what the teacher types in the terminal to the program. */
  sendInput: (runId: string, data: string) => boolean;
  /** The runs that are still going. */
  activeRunIds: () => string[];
}

export interface RunnerOptions {
  /** Where the run messages go. The websocket bridge, normally. */
  bridge?: { broadcast: (message: BridgeMessage) => void };
  /** Overridable for the tests. */
  spawn?: SpawnLike;
  /** Overridable for the tests. */
  nextRunId?: () => string;
  /** The working directory when a request does not name one. */
  defaultCwd?: () => string | undefined;
  /** The environment the program runs in. */
  env?: NodeJS.ProcessEnv;
}

const defaultSpawn: SpawnLike = (command, args, options) =>
  spawn(command, args, { cwd: options.cwd, env: options.env });

let runCounter = 0;

const defaultRunId = () => `run-${++runCounter}-${randomUUID().slice(0, 8)}`;

export function createRunner(options: RunnerOptions = {}): Runner {
  const spawnImpl = options.spawn ?? defaultSpawn;
  const nextRunId = options.nextRunId ?? defaultRunId;
  const children = new Map<string, SpawnedProcess>();

  const broadcast = (message: BridgeMessage) => {
    options.bridge?.broadcast(message);
  };

  const start = (request: RunRequest, observer?: RunObserver): RunHandle => {
    const runId = nextRunId();
    const args = request.args ?? [];
    const cwd = request.cwd ?? options.defaultCwd?.() ?? "";
    const command = request.command;

    broadcast({ v: 1, type: "run:started", runId, command, cwd });
    observer?.onStarted?.({ runId, command, cwd });

    let child: SpawnedProcess;
    try {
      child = spawnImpl(command, args, { cwd, env: options.env });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      broadcast({ v: 1, type: "run:output", runId, stream: "stderr", text });
      broadcast({ v: 1, type: "run:exit", runId, code: null });
      observer?.onExit?.({ runId, code: null });
      return { runId, stop: () => undefined };
    }

    children.set(runId, child);

    let finished = false;
    let exitCode: number | null = null;

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      children.delete(runId);
      broadcast({ v: 1, type: "run:exit", runId, code: exitCode });
      observer?.onExit?.({ runId, code: exitCode });
    };

    const emitLine = (stream: "stdout" | "stderr", text: string) => {
      broadcast({ v: 1, type: "run:output", runId, stream, text });
      observer?.onOutput?.({ runId, stream, text });
    };

    const attach = (
      stream: NodeJS.ReadableStream | null,
      name: "stdout" | "stderr",
    ) => {
      if (!stream) {
        return;
      }
      let pending = "";
      stream.setEncoding?.("utf8");
      stream.on("data", (chunk: Buffer | string) => {
        pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        let index = pending.indexOf("\n");
        while (index !== -1) {
          const line = pending.slice(0, index).replace(/\r$/, "");
          pending = pending.slice(index + 1);
          emitLine(name, line);
          index = pending.indexOf("\n");
        }
      });
      stream.on("end", () => {
        if (pending.length) {
          emitLine(name, pending.replace(/\r$/, ""));
          pending = "";
        }
      });
    };

    attach(child.stdout, "stdout");
    attach(child.stderr, "stderr");

    child.on("error", (error: Error) => {
      emitLine("stderr", error.message);
    });

    child.on("exit", (code: number | null) => {
      exitCode = code ?? null;
      // `close` is the honest signal - it fires after the output streams have
      // been drained. The timer is the safety net for a program that leaves a
      // background child holding the pipe open.
      const timer = setTimeoutNode(finish, 2000);
      timer.unref?.();
    });

    child.on("close", (code: number | null) => {
      exitCode = code ?? null;
      finish();
    });

    return {
      runId,
      stop: () => {
        try {
          child.kill();
        } catch {
          // already gone
        }
      },
    };
  };

  return {
    start,
    stop: (runId: string) => {
      const child = children.get(runId);
      if (!child) {
        return false;
      }
      try {
        child.kill();
      } catch {
        // already gone
      }
      return true;
    },
    sendInput: (runId: string, data: string) => {
      const child = children.get(runId);
      if (!child?.stdin) {
        return false;
      }
      child.stdin.write(data);
      return true;
    },
    activeRunIds: () => [...children.keys()],
  };
}
