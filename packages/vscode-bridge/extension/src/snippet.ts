import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as setTimeoutNode } from "node:timers";

import type { BridgeMessage } from "../../bridge/src/protocol";
import type { SpawnLike, SpawnedProcess } from "./runner";

/**
 * The **runnable snippet**: the teacher's own text, run in the teacher's
 * workspace (D-124).
 *
 * The library draws the Run control and shows the output; the **app** sends the
 * request; the **extension** runs the code. The extension is the only one of
 * the three that can run anything, and it is the only one that knows what is
 * installed on this machine.
 *
 * The rules this file keeps:
 *
 * - the temporary file lives in the **teacher's workspace**, it is removed when
 *   the run is over, and its **name says what it is**;
 * - a run has a **timeout** and a **bounded output**, and both facts are
 *   reported;
 * - the extension offers only the runtimes it **actually found**, and a
 *   language whose runtime is missing **says so** instead of pretending to run;
 * - nothing ran means nothing is claimed: a missing runtime produces a notice
 *   and no run at all.
 *
 * The module is deliberately free of any `vscode` import, so it can be driven
 * by a test without an editor.
 */

/** How long a run may take. The teacher is not waiting on a wedged program. */
export const SNIPPET_TIMEOUT_MS = 10_000;

/** How many characters of output a run may produce. */
export const SNIPPET_MAX_OUTPUT_CHARS = 20_000;

/**
 * The name the temporary file carries.
 *
 * It says what the file is, so a teacher who finds one in their workspace
 * knows what it is and what to do with it (and the extension removes it when
 * the run is over).
 */
export const snippetFileName = (id: string, extension: string) =>
  `excalidraw-bridge-snippet-${id}.${extension}`;

/**
 * A runtime the extension can run a language with.
 *
 * `commands` are the programs to try, in order: the first one that is on this
 * machine is the runtime, and none of them being there is an **explicit**
 * state, not a silent failure (D-124).
 */
export interface SnippetRuntime {
  /** the language id, as the grammar registry names it */
  language: string;
  /** the extension of the temporary file */
  extension: string;
  /** the programs to try, in order */
  commands: string[];
  /** what to install when none of them is there */
  install: string;
  /**
   * How the program is run.
   *
   * "interpreted" - the runtime takes the file and runs it.
   * "compiled" - the runtime is a compiler: it builds the file and the program
   * that is built is what runs.
   */
  kind: "interpreted" | "compiled";
}

/**
 * The runtimes the extension knows, one per language the grammar registry
 * knows (D-124).
 *
 * The list is the **offer**: the extension detects which of these are actually
 * on this machine and offers only those, so the panel's picker never offers a
 * language that cannot run here.
 */
export const SNIPPET_RUNTIMES: SnippetRuntime[] = [
  {
    language: "javascript",
    extension: "js",
    commands: ["node"],
    install: "Node.js",
    kind: "interpreted",
  },
  {
    language: "python",
    extension: "py",
    commands: ["python", "python3", "py"],
    install: "Python",
    kind: "interpreted",
  },
  {
    // Java 11 and newer run a single source file on their own: `java Foo.java`
    language: "java",
    extension: "java",
    commands: ["java"],
    install: "a JDK (Java 11 or newer)",
    kind: "interpreted",
  },
  {
    language: "c",
    extension: "c",
    commands: ["gcc"],
    install: "GCC",
    kind: "compiled",
  },
  {
    language: "cpp",
    extension: "cpp",
    commands: ["g++"],
    install: "G++",
    kind: "compiled",
  },
  {
    language: "rust",
    extension: "rs",
    commands: ["rustc"],
    install: "Rust",
    kind: "compiled",
  },
];

/** The language ids the extension can run at all. */
export const supportedSnippetLanguages = () =>
  SNIPPET_RUNTIMES.map((runtime) => runtime.language);

export interface SnippetRequest {
  /** the request's id. It is the run's id when the run happens. */
  id: string;
  /** the language, as the grammar registry names it */
  language: string;
  /** the teacher's own text */
  text: string;
}

export interface SnippetOptions {
  /** where the run messages go. The websocket bridge, normally. */
  bridge?: { broadcast: (message: BridgeMessage) => void };
  /**
   * The teacher's workspace.
   *
   * The temporary file goes here - it is the teacher's own workspace, and the
   * run happens in it. When there is **no** folder open there is no workspace,
   * and the run happens in the operating system's own temporary directory.
   */
  workspaceRoot?: string | undefined;
  /** Overridable for the tests. */
  spawn?: SpawnLike;
  /** Overridable for the tests. */
  timeoutMs?: number;
  /** Overridable for the tests. */
  maxOutputChars?: number;
  /** Overridable for the tests: is this program on this machine? */
  hasProgram?: (name: string) => Promise<boolean>;
  /** The environment the program runs in. */
  env?: NodeJS.ProcessEnv;
}

const defaultSpawn: SpawnLike = (command, args, options) =>
  spawn(command, args, { cwd: options.cwd, env: options.env });

/**
 * A number with the thousands separator, the way the panel writes it.
 *
 * "20,000 characters" and not "20000 characters": the number is something a
 * teacher reads, not something a machine parses.
 */
export const withThousands = (value: number): string =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * A duration in seconds, the way the panel writes it.
 *
 * "10 s" and not "10.0 s" and not "10000 ms".
 */
export const formatSeconds = (milliseconds: number): string =>
  `${Number((milliseconds / 1000).toFixed(1))} s`;

/**
 * How a program is started on this machine.
 *
 * On Windows a program may be a **batch file** - a pyenv shim is one - and
 * Windows cannot run a batch file on its own: it runs `cmd.exe`. So on Windows
 * the command goes through `cmd.exe`, and everywhere else it goes straight to
 * the program.
 *
 * The command line is built here and nowhere else, so the names are the ones
 * the teacher sees.
 */
const spawnCommand = (
  command: string,
  args: string[],
): { command: string; args: string[] } =>
  process.platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/c", [command, ...args].join(" ")] }
    : { command, args };

/**
 * Run a program and wait for it, and say how it ended.
 *
 * It is used to ASK a question (`where python`), so it says nothing: the
 * question's answer is the exit code.
 */
const exitsWith = (
  command: string,
  args: string[],
  options: { spawn?: SpawnLike; env?: NodeJS.ProcessEnv } = {},
): Promise<number | null> => {
  const spawnImpl = options.spawn ?? defaultSpawn;

  return new Promise((resolve) => {
    let child: SpawnedProcess;

    try {
      child = spawnImpl(command, args, { env: options.env });
    } catch {
      resolve(null);
      return;
    }

    // the answer is not read, so the pipes are drained
    child.stdout?.resume();
    child.stderr?.resume();

    let settled = false;

    const settle = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(code);
    };

    child.on("error", () => settle(null));
    child.on("close", (code) => settle(code ?? null));
  });
};

/**
 * Is the program on this machine?
 *
 * On Windows the question is asked with `where`: it resolves a program through
 * PATHEXT - so a **batch file** counts - and it does not run anything. A
 * program that is asked for its version instead would be RUN, and a batch file
 * cannot be run directly.
 *
 * Everywhere else the program is asked for its version: a program that is not
 * there fails to start at all, and that failure is the answer.
 */
export const hasProgram = async (
  name: string,
  options: { spawn?: SpawnLike; env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> => {
  if (process.platform === "win32") {
    return (await exitsWith("where", [name], options)) === 0;
  }

  const spawnImpl = options.spawn ?? defaultSpawn;

  return new Promise((resolve) => {
    let child: SpawnedProcess;

    try {
      child = spawnImpl(name, ["--version"], { env: options.env });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;

    const settle = (found: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(found);
    };

    // the version goes somewhere: an unread pipe would fill up and block
    child.stdout?.resume();
    child.stderr?.resume();

    child.on("error", () => settle(false));
    child.on("close", () => settle(true));
  });
};

/**
 * The languages that can **actually** be run on this machine (D-124).
 *
 * The extension offers only these, so the panel's picker never offers a
 * language whose runtime is not there.
 */
export const detectRuntimes = async (
  options: { spawn?: SpawnLike; env?: NodeJS.ProcessEnv } = {},
): Promise<string[]> => {
  const found: string[] = [];

  for (const runtime of SNIPPET_RUNTIMES) {
    for (const command of runtime.commands) {
      if (await hasProgram(command, options)) {
        found.push(runtime.language);
        break;
      }
    }
  }

  return found;
};

/**
 * The program that runs a language here, or null when there is none.
 */
export const findCommand = async (
  runtime: SnippetRuntime,
  options: SnippetOptions = {},
): Promise<string | null> => {
  const check =
    options.hasProgram ?? ((name: string) => hasProgram(name, options));

  for (const command of runtime.commands) {
    if (await check(command)) {
      return command;
    }
  }

  return null;
};

/**
 * The phases of a run.
 *
 * An interpreted program is one phase. A compiled one is two: the compiler
 * builds it, and then the program that was built runs. The **run** is both -
 * it is one thing the teacher asked for - and its exit code is the code of the
 * phase that ended it.
 */
const phasesOf = (
  runtime: SnippetRuntime,
  command: string,
  sourceName: string,
  executableName: string,
): { command: string; args: string[] }[] =>
  runtime.kind === "compiled"
    ? [
        { command, args: ["-o", executableName, sourceName] },
        { command: executableName, args: [] },
      ]
    : [{ command, args: [sourceName] }];

/**
 * Run one phase and wait for it.
 *
 * The phase is killed when the time is up, and the answer says so - a program
 * that never ends must not wedge the panel (D-124).
 */
const spawnPhase = (
  command: string,
  args: string[],
  cwd: string,
  remainingMs: number,
  emit: (stream: "stdout" | "stderr", text: string) => void,
  spawnImpl: SpawnLike,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number | null; timedOut: boolean }> =>
  new Promise((resolve) => {
    let child: SpawnedProcess;

    // on Windows the program may be a batch file, and `cmd.exe` runs it
    const started = spawnCommand(command, args);

    try {
      child = spawnImpl(started.command, started.args, { cwd, env });
    } catch (error) {
      emit("stderr", error instanceof Error ? error.message : String(error));
      resolve({ code: null, timedOut: false });
      return;
    }

    let timedOut = false;
    let settled = false;
    let exitCode: number | null = null;

    const timer = setTimeoutNode(() => {
      timedOut = true;

      if (process.platform === "win32" && child.pid) {
        // Windows: the program may be a grandchild of `cmd.exe`, and killing
        // `cmd.exe` alone leaves it running - holding the pipe open, so the
        // run would never end. The whole tree goes.
        try {
          spawnImpl("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            env,
          });
        } catch {
          // already gone
        }
      }

      try {
        child.kill();
      } catch {
        // already gone
      }
    }, Math.max(1, remainingMs));
    timer.unref?.();

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code: exitCode, timedOut });
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
          emit(name, line);
          index = pending.indexOf("\n");
        }
      });
      stream.on("end", () => {
        if (pending.length) {
          emit(name, pending.replace(/\r$/, ""));
          pending = "";
        }
      });
    };

    attach(child.stdout, "stdout");
    attach(child.stderr, "stderr");

    child.on("error", (error: Error) => {
      emit("stderr", error.message);
    });

    child.on("exit", (code: number | null) => {
      exitCode = code ?? null;
      // `close` is the honest signal - it fires after the output streams have
      // been drained. The timer is the safety net for a program that leaves a
      // background child holding the pipe open.
      const safety = setTimeoutNode(finish, 2000);
      safety.unref?.();
    });

    child.on("close", (code: number | null) => {
      exitCode = code ?? null;
      finish();
    });
  });

export interface SnippetResult {
  /** whether a run happened at all */
  ran: boolean;
  /** the run's exit code, when it ran */
  code?: number | null;
  /** whether the run was killed at the timeout */
  timedOut?: boolean;
  /** whether the output was longer than the bound */
  truncated?: boolean;
  /** the fact that stopped the run, when one did */
  reason?: "missing-runtime";
}

/**
 * Run the teacher's own text (D-124).
 *
 * The run happens in the teacher's workspace, from a temporary file that is
 * removed when the run is over. A run that cannot happen says why, and the
 * panel is told that nothing ran.
 */
export const runSnippet = async (
  request: SnippetRequest,
  options: SnippetOptions = {},
): Promise<SnippetResult> => {
  const timeoutMs = options.timeoutMs ?? SNIPPET_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? SNIPPET_MAX_OUTPUT_CHARS;
  const spawnImpl = options.spawn ?? defaultSpawn;
  const runId = request.id;

  const broadcast = (message: BridgeMessage) =>
    options.bridge?.broadcast(message);

  const runtime = SNIPPET_RUNTIMES.find(
    (candidate) => candidate.language === request.language,
  );

  if (!runtime) {
    // Nothing ran, and the panel is told that nothing ran (D-124).
    broadcast({
      v: 1,
      type: "run:notice",
      runId,
      kind: "missing-runtime",
      text: request.language
        ? `The bridge cannot run ${
            request.language
          }. It runs ${supportedSnippetLanguages().join(", ")}.`
        : `The draft has no language. Choose the language of the draft and run it again - the bridge runs ${supportedSnippetLanguages().join(
            ", ",
          )}.`,
    });
    return { ran: false, reason: "missing-runtime" };
  }

  const command = await findCommand(runtime, options);

  if (!command) {
    broadcast({
      v: 1,
      type: "run:notice",
      runId,
      kind: "missing-runtime",
      text: `${runtime.install} is not installed on this machine, so ${runtime.language} cannot be run. Install ${runtime.install} and try again.`,
    });
    return { ran: false, reason: "missing-runtime" };
  }

  const root = options.workspaceRoot ?? tmpdir();
  const sourceName = snippetFileName(runId, runtime.extension);
  const executableName = snippetFileName(
    runId,
    process.platform === "win32" ? "exe" : "bin",
  );
  const source = join(root, sourceName);

  let emitted = 0;
  let truncated = false;

  const emit = (stream: "stdout" | "stderr", text: string) => {
    if (truncated) {
      return;
    }

    if (emitted + text.length > maxOutputChars) {
      const room = Math.max(0, maxOutputChars - emitted);

      if (room > 0) {
        broadcast({
          v: 1,
          type: "run:output",
          runId,
          stream,
          text: text.slice(0, room),
        });
        emitted += room;
      }

      truncated = true;
      broadcast({
        v: 1,
        type: "run:notice",
        runId,
        kind: "truncated",
        text: `The output was truncated at ${withThousands(
          maxOutputChars,
        )} characters.`,
      });
      return;
    }

    emitted += text.length;
    broadcast({ v: 1, type: "run:output", runId, stream, text });
  };

  const phases = phasesOf(runtime, command, sourceName, executableName);
  const deadline = Date.now() + timeoutMs;

  writeFileSync(source, request.text, "utf8");

  broadcast({
    v: 1,
    type: "run:started",
    runId,
    command: `${phases[0].command} ${phases[0].args.join(" ")}`.trim(),
    cwd: root,
  });

  try {
    let code: number | null = null;
    let timedOut = false;

    for (const phase of phases) {
      const remaining = deadline - Date.now();

      const result = await spawnPhase(
        phase.command,
        phase.args,
        root,
        remaining,
        emit,
        spawnImpl,
        options.env,
      );

      code = result.code;
      timedOut = timedOut || result.timedOut;

      if (timedOut || (result.code !== null && result.code !== 0)) {
        break;
      }
    }

    if (timedOut) {
      broadcast({
        v: 1,
        type: "run:notice",
        runId,
        kind: "timed-out",
        text: `The run timed out after ${formatSeconds(timeoutMs)}.`,
      });
    }

    broadcast({ v: 1, type: "run:exit", runId, code });

    return { ran: true, code, timedOut, truncated };
  } finally {
    // the temporary file is removed either way: the teacher's workspace does
    // not keep the litter of a run
    for (const name of [sourceName, executableName]) {
      try {
        rmSync(join(root, name), { force: true });
      } catch {
        // already gone
      }
    }
  }
};

export interface SnippetServiceOptions extends SnippetOptions {
  /** The workspace root, read when the extension activates. */
  workspaceRoot?: string | undefined;
}

export interface SnippetService {
  /** Run a `code:run` message. */
  run: (message: SnippetRequest) => Promise<SnippetResult>;
  /** The runtimes found on this machine, once they have been detected. */
  runtimes: () => string[];
  /** Detect the runtimes and remember them. */
  detect: () => Promise<string[]>;
}

/**
 * The service the extension hands its `code:run` messages to.
 *
 * It is the same code the extension runs, and the same code a test runs: the
 * service is free of any `vscode` import, so the run path can be proven
 * without an editor.
 */
export const createSnippetService = (
  options: SnippetServiceOptions = {},
): SnippetService => {
  let runtimes: string[] = [];

  const detect = async () => {
    runtimes = await detectRuntimes(options);
    return runtimes;
  };

  return {
    run: (message: SnippetRequest) =>
      runSnippet(message, { ...options, workspaceRoot: options.workspaceRoot }),
    runtimes: () => runtimes,
    detect,
  };
};
