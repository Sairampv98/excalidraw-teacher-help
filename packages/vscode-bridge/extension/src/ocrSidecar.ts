import { spawn } from "node:child_process";

import { isOcrModel } from "../../bridge/src/ocr";

import type { OcrEngineName, OcrLine, OcrModel } from "../../bridge/src/ocr";

/**
 * The **sidecar**: the Python OCR engines, in a process of their own.
 *
 * The engines that are Python cannot be npm dependencies, so they run in a
 * Python process the extension spawns and talks to over stdio - one JSON
 * object per line, the same shape the capture helper uses (D-90).
 *
 * Two rules shape this module:
 *
 * - the sidecar is spawned **once** and reused for every read: a process per
 *   read would pay for the interpreter's start-up, and for the model's load,
 *   every single time (D-90);
 * - the report says which engines the sidecar can reach, and it says it
 *   **without importing them** - the sidecar asks the file system, not the
 *   package (D-90, D-91).
 */

/**
 * The process the sidecar runs in, as far as this module is concerned.
 *
 * It is a small interface on purpose: the tests drive a fake one, and the
 * real one is Node's child process.
 */
export type OcrSidecarProcess = {
  stdin: { write: (chunk: string) => unknown } | null;
  stdout: {
    on: (event: string, listener: (chunk: unknown) => void) => unknown;
  } | null;
  stderr: {
    on: (event: string, listener: (chunk: unknown) => void) => unknown;
  } | null;
  on: (event: string, listener: (...args: never[]) => void) => unknown;
  kill: () => unknown;
};

/** How the sidecar is spawned. The tests pass a fake one. */
export type OcrSidecarSpawn = (
  command: string,
  args: string[],
  options: { stdio: ["pipe", "pipe", "pipe"] },
) => OcrSidecarProcess;

/**
 * What the sidecar says about itself when it starts.
 *
 * The engines it can reach, and for the ones it cannot, the reason - which
 * names the command that installs it (D-91).
 */
export type OcrSidecarReport = {
  /** the interpreter's version, e.g. "3.14.7" */
  python: string;
  /**
   * What it can reach, engine by engine.
   *
   * The `model` says **how** the engine's model was built - the sidecar
   * falls back to the slow path when the fast one crashes, and the report
   * says so (D-107).
   */
  engines: Record<
    string,
    { available: boolean; reason?: string; model?: OcrModel }
  >;
};

/** The answer of one read. */
export type OcrSidecarAnswer = {
  text: string;
  lines: OcrLine[];
  confidence?: number;
  durationMs?: number;
  /** which engine read it */
  engine?: string;
  /**
   * How the engine's model was built (D-106).
   *
   * `mkldnn: false` means the engine ran **without** oneDNN: the sidecar
   * fell back to the configuration that works, and the read is slow.
   */
  model?: OcrModel;
};

export type OcrSidecar = {
  /**
   * Spawns the sidecar - **once** - and waits for its report.
   *
   * Calling it again returns the same report: the sidecar is not spawned
   * twice.
   */
  start: () => Promise<OcrSidecarReport>;
  /** whether the sidecar is running */
  isRunning: () => boolean;
  /** the report, when the sidecar has already started */
  report: () => OcrSidecarReport | null;
  /** reads the text out of an image */
  recognize: (request: {
    engine: OcrEngineName;
    imageBase64: string;
    region?: { x: number; y: number; width: number; height: number };
  }) => Promise<OcrSidecarAnswer>;
  /** stops the sidecar */
  stop: () => void;
};

/**
 * The default way to spawn the sidecar: the Python the setting named, running
 * the script that ships with the extension.
 */
export const defaultSidecarSpawn: OcrSidecarSpawn = (command, args, options) =>
  spawn(command, args, options) as unknown as OcrSidecarProcess;

/**
 * The sidecar's script, next to the extension that runs it.
 *
 * It SHIPS with the extension (D-89): without it the extension would have
 * nothing to run.
 */
export const sidecarScriptPath = (extensionDir: string): string =>
  `${extensionDir}/media/ocr_sidecar.py`;

/**
 * Creates the sidecar client.
 *
 * The client owns the process: it spawns it on the first read, keeps it for
 * every later one, and stops it when the extension goes away.
 */
export const createOcrSidecar = ({
  pythonPath,
  scriptPath,
  spawnProcess = defaultSidecarSpawn,
}: {
  pythonPath: string;
  scriptPath: string;
  spawnProcess?: OcrSidecarSpawn;
}): OcrSidecar => {
  let child: OcrSidecarProcess | null = null;
  let started: Promise<OcrSidecarReport> | null = null;
  let lastReport: OcrSidecarReport | null = null;
  let buffer = "";
  let nextId = 0;

  let reportResolve: ((report: OcrSidecarReport) => void) | null = null;
  let reportReject: ((error: Error) => void) | null = null;
  let reportTimeout: ReturnType<typeof setTimeout> | null = null;

  const pending = new Map<
    string,
    {
      resolve: (answer: OcrSidecarAnswer) => void;
      reject: (error: Error) => void;
    }
  >();

  const failEveryRead = (message: string) => {
    for (const entry of pending.values()) {
      entry.reject(new Error(message));
    }
    pending.clear();
  };

  const takeReport = () => {
    if (reportTimeout) {
      clearTimeout(reportTimeout);
      reportTimeout = null;
    }
    const resolve = reportResolve;
    reportResolve = null;
    reportReject = null;
    return resolve;
  };

  const handleMessage = (message: Record<string, unknown>) => {
    if (message.type === "ready") {
      lastReport = message as unknown as OcrSidecarReport;
      takeReport()?.(lastReport);
      return;
    }

    const id = typeof message.id === "string" ? message.id : "";
    const entry = pending.get(id);

    if (!entry) {
      return;
    }

    pending.delete(id);

    if (typeof message.error === "string" && message.error) {
      entry.reject(new Error(message.error));
      return;
    }

    entry.resolve({
      text: typeof message.text === "string" ? message.text : "",
      lines: Array.isArray(message.lines) ? (message.lines as OcrLine[]) : [],
      ...(typeof message.confidence === "number"
        ? { confidence: message.confidence }
        : {}),
      ...(typeof message.durationMs === "number"
        ? { durationMs: message.durationMs }
        : {}),
      // which engine read it, and how its model was built (D-106)
      ...(typeof message.engine === "string" ? { engine: message.engine } : {}),
      ...(isOcrModel(message.model) ? { model: message.model } : {}),
    });
  };

  const handleChunk = (chunk: unknown) => {
    buffer += String(chunk);
    let newline = buffer.indexOf("\n");

    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (!line) {
        continue;
      }

      try {
        handleMessage(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // a line that is not JSON is not part of the protocol: ignore it
      }
    }
  };

  const spawnSidecar = (): Promise<OcrSidecarReport> =>
    new Promise<OcrSidecarReport>((resolve, reject) => {
      reportResolve = resolve;
      reportReject = reject;

      const timeout = setTimeout(() => {
        const rejectReport = reportReject;
        takeReport();
        rejectReport?.(
          new Error(
            `the OCR sidecar (${pythonPath}) did not say which engines it can reach`,
          ),
        );
      }, 30_000);
      timeout.unref?.();
      reportTimeout = timeout;

      try {
        child = spawnProcess(pythonPath, [scriptPath], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        clearTimeout(timeout);
        const rejectReport = reportReject;
        takeReport();
        rejectReport?.(
          new Error(
            `the OCR sidecar could not be started (${pythonPath}): ${
              (error as Error).message
            }`,
          ),
        );
        return;
      }

      child.stdout?.on("data", handleChunk);
      child.stderr?.on("data", () => {
        // the sidecar's own output is not the protocol: it goes to the log
      });

      child.on("exit", (code: unknown) => {
        child = null;
        started = null;
        failEveryRead(
          `the OCR sidecar stopped (exit code ${String(
            code,
          )}) before the read finished`,
        );
        clearTimeout(timeout);
        const rejectReport = reportReject;
        takeReport();
        rejectReport?.(
          new Error(
            `the OCR sidecar stopped (exit code ${String(
              code,
            )}) before it reported`,
          ),
        );
      });
    });

  return {
    start: () => {
      if (!started) {
        started = spawnSidecar();
      }
      return started;
    },

    isRunning: () => child !== null,

    report: () => lastReport,

    recognize: (request) => {
      if (!child) {
        return Promise.reject(new Error("the OCR sidecar is not running"));
      }

      const id = `${++nextId}`;

      return new Promise<OcrSidecarAnswer>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child?.stdin?.write(`${JSON.stringify({ id, ...request })}\n`);
      });
    },

    stop: () => {
      const running = child;
      child = null;
      started = null;
      failEveryRead("the OCR sidecar was stopped");
      running?.kill();
    },
  };
};
