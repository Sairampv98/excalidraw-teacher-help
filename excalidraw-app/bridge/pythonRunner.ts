/**
 * Runs Python in the browser, for a code panel with no bridge.
 *
 * The runtime is Pyodide, and it is fetched **the first time a teacher presses
 * Run**, never when the page loads, and it is not an npm dependency: a teacher
 * who never runs code without the bridge never pays for it. It runs in a
 * **worker**, so a loop that never ends can be stopped at the timeout without
 * freezing the page.
 */

import { ENGINE_FILES, engineUrl } from "../engines/enginePaths";

/** the version of the runtime the app carries (the file is in `scripts/vendor/engines.manifest.json`) */
export const PYODIDE_VERSION = "0.26.4";
/** the runtime is carried by the app (D-460), so Python runs with no internet */
export const pyodideIndexUrl = () => engineUrl(ENGINE_FILES.pyodide.folder);

/** the program is stopped after this long, as the extension's run is */
export const PYTHON_TIMEOUT_MS = 10_000;

/** the output is cut after this many characters, as the extension's is */
export const PYTHON_MAX_OUTPUT_CHARS = 20_000;

/** what the worker says to the page */
type WorkerMessage =
  | { type: "loading" }
  | { type: "ready" }
  | { type: "load-failed"; text: string }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  /** the program asked for a line of input and there was none to give (D-298) */
  | { type: "needs-input" }
  | { type: "done" }
  | { type: "error"; text: string };

/** what a run reports while it goes on */
export type PythonRunEvents = {
  /** the runtime is being downloaded (first run only) */
  onLoading?: () => void;
  onOutput: (stream: "stdout" | "stderr", text: string) => void;
  /** something about the run itself: it was cut, or stopped */
  onNotice: (kind: "timed-out" | "truncated", text: string) => void;
};

export type PythonRunResult =
  /** the program ended; `code` is 0 or 1 */
  | { kind: "exit"; code: number }
  /** the program was stopped at the timeout */
  | { kind: "timed-out" }
  /** the program was stopped because its output reached the limit */
  | { kind: "stopped" }
  /** the runtime could not be downloaded */
  | { kind: "load-failed"; reason: string }
  /** the program's worker died while it ran: it used more memory than it may */
  | { kind: "crashed"; reason: string }
  /**
   * the program asked for a line of input that nobody has typed yet (D-298):
   * it was stopped at the question, and it is run again from the top once the
   * answer is there
   */
  | { kind: "needs-input" };

/** how long a program that was stopped at a question may take to end by itself */
export const NEEDS_INPUT_GRACE_MS = 1500;

/** the worker's own source, as a string: it is built into a blob at run time */
export const workerSource = (indexUrl: string) => `
importScripts(${JSON.stringify(`${indexUrl}pyodide.js`)});
let pyodide = null;
// a program that prints for ever must not flood the page: past the cap nothing
// more is sent (the page cuts the output at its own limit and stops the run)
let sent = 0;
// set when the program asks for a line of input that was not given: what it
// prints after that, and the error that ends it, are not shown (the page asks
// for the answer and runs the program again)
let needInput = false;
const send = (stream, text) => {
  if (needInput || sent > ${OUTPUT_FLOOD_CAP}) return;
  sent += text.length;
  self.postMessage({ type: "output", stream, text });
};
const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
self.onmessage = async (event) => {
  const code = event.data.code;
  const input = (event.data.stdin || []).slice();
  sent = 0;
  needInput = false;
  if (!pyodide) {
    self.postMessage({ type: "loading" });
    try {
      pyodide = await loadPyodide({ indexURL: ${JSON.stringify(indexUrl)} });
    } catch (error) {
      self.postMessage({ type: "load-failed", text: String(error && error.message || error) });
      return;
    }
    self.postMessage({ type: "ready" });
  }
  // the output is taken as bytes, so a newline, or its absence (end=""), comes
  // out exactly as the program wrote it
  pyodide.setStdout({ write: (bytes) => { send("stdout", decoders.stdout.decode(bytes, { stream: true })); return bytes.length; } });
  pyodide.setStderr({ write: (bytes) => { send("stderr", decoders.stderr.decode(bytes, { stream: true })); return bytes.length; } });
  // input() reads the lines that were typed: in advance, or as answers to the
  // questions it asked before. The console shows each line as a terminal does.
  // With none left the program is at a question: the page is told, and the
  // program meets the end of its input (D-298).
  pyodide.setStdin({
    stdin: () => {
      if (input.length) {
        const line = input.shift();
        send("stdout", line + "\\n");
        return line;
      }
      if (!needInput) {
        needInput = true;
        self.postMessage({ type: "needs-input" });
      }
      return null;
    },
  });
  try {
    await pyodide.runPythonAsync(code);
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({ type: "error", text: String(error && error.message || error) });
  }
};
`;

/** the worker that runs the program; a fake one stands in for it in tests */
export type PythonWorker = {
  postMessage: (message: { code: string; stdin?: string[] }) => void;
  terminate: () => void;
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
};

const createBlobWorker = (): PythonWorker => {
  const url = URL.createObjectURL(
    new Blob([workerSource(pyodideIndexUrl())], { type: "text/javascript" }),
  );

  return new Worker(url) as unknown as PythonWorker;
};

/**
 * A sentence that says what an error of a program means, for the errors that
 * a teacher meets and cannot read (D-285), or null when there is nothing to add.
 */
export const explainError = (text: string): string | null => {
  if (/RecursionError|Maximum call stack size exceeded/.test(text)) {
    return "Hint: a function calls itself too deeply. Check that it has a case where it stops.";
  }

  if (/MemoryError|Invalid array length|out of memory/i.test(text)) {
    return "Hint: the program asked for more memory than the browser allows.";
  }

  if (/EOFError/.test(text)) {
    return "Hint: the program tried to read more input than there is.";
  }

  return null;
};

export const createPythonRunner = ({
  createWorker = createBlobWorker,
  timeoutMs = PYTHON_TIMEOUT_MS,
  maxOutputChars = PYTHON_MAX_OUTPUT_CHARS,
  reuseWorker = true,
}: {
  createWorker?: () => PythonWorker;
  timeoutMs?: number;
  maxOutputChars?: number;
  /** false: every run has a worker of its own, which ends with the run */
  reuseWorker?: boolean;
} = {}) => {
  /** kept between runs, so the runtime is downloaded once */
  let worker: PythonWorker | null = null;
  /** whether the worker has the runtime loaded */
  let ready = false;

  const stop = () => {
    worker?.terminate();
    worker = null;
    ready = false;
  };

  const run = (
    code: string,
    events: PythonRunEvents,
    options: { stdin?: string[] } = {},
  ) =>
    new Promise<PythonRunResult>((resolve) => {
      worker ??= createWorker();

      const current = worker;
      let written = 0;
      let cut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      // the program is at a question nobody has answered (D-298)
      let awaitingInput = false;
      let grace: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: PythonRunResult) => {
        if (timer) {
          clearTimeout(timer);
        }
        if (grace) {
          clearTimeout(grace);
        }
        current.onmessage = null;
        current.onerror = null;

        if (!reuseWorker && worker === current) {
          stop();
        }

        resolve(result);
      };

      // the clock starts when the program does, not while the runtime loads
      const startClock = () => {
        timer ??= setTimeout(() => {
          stop();
          events.onNotice(
            "timed-out",
            `The program was stopped after ${Math.round(
              timeoutMs / 1000,
            )} seconds. It may be stuck in an infinite loop, or it needs longer than this.`,
          );
          finish({ kind: "timed-out" });
        }, timeoutMs);
      };

      const emit = (stream: "stdout" | "stderr", text: string) => {
        if (cut) {
          return;
        }

        const room = maxOutputChars - written;

        if (text.length > room) {
          cut = true;
          written = maxOutputChars;

          if (room > 0) {
            events.onOutput(stream, text.slice(0, room));
          }

          // a program that prints this much is stopped: it would only go on
          // filling a page nobody can read
          events.onNotice(
            "truncated",
            "The output reached its limit, so the program was stopped.",
          );
          stop();
          finish({ kind: "stopped" });
          return;
        }

        written += text.length;
        events.onOutput(stream, text);
      };

      current.onmessage = ({ data }) => {
        switch (data.type) {
          case "loading":
            events.onLoading?.();
            break;
          case "ready":
            ready = true;
            startClock();
            break;
          case "load-failed":
            // the next run tries the download again
            stop();
            finish({ kind: "load-failed", reason: data.text });
            break;
          case "output":
            emit(data.stream, data.text);
            break;
          case "needs-input":
            // the program ends at the question by itself, nearly always (the
            // end of its input is an error that ends it); one that goes on
            // after it is stopped, and it is asked again with the answer
            awaitingInput = true;
            grace ??= setTimeout(() => {
              stop();
              finish({ kind: "needs-input" });
            }, NEEDS_INPUT_GRACE_MS);
            break;
          case "done":
            finish(
              awaitingInput
                ? { kind: "needs-input" }
                : { kind: "exit", code: 0 },
            );
            break;
          case "error": {
            // the error that ends a program at its question is not an error of
            // the program: the question is asked instead
            if (awaitingInput) {
              finish({ kind: "needs-input" });
              break;
            }

            const hint = explainError(data.text);

            emit("stderr", hint ? `${data.text}\n${hint}\n` : data.text);
            finish({ kind: "exit", code: 1 });
            break;
          }
        }
      };

      current.onerror = (event) => {
        const started = ready;

        stop();
        finish(
          started
            ? {
                kind: "crashed",
                reason: event.message || "the program's worker stopped",
              }
            : {
                kind: "load-failed",
                reason: event.message || "the Python runtime did not start",
              },
        );
      };

      // a worker that has loaded before is ready already: the clock starts now
      if (ready) {
        startClock();
      }

      current.postMessage({ code, stdin: options.stdin ?? [] });
    });

  return { run, stop };
};

/**
 * The worker that runs JavaScript: nothing to download, so it says it is ready
 * at once, and it carries the program's console to the page.
 */
/** the worker sends no more than this, a little over the page's own limit */
const OUTPUT_FLOOD_CAP = PYTHON_MAX_OUTPUT_CHARS + 100;

export const javascriptWorkerSource = `
const show = (value) => {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2) ?? String(value); } catch (e) { return String(value); }
};
// a program that prints for ever must not flood the page: past the cap nothing
// more is sent (the page cuts the output at its own limit and stops the run)
let sent = 0;
const say = (stream) => (...args) => {
  if (sent > ${OUTPUT_FLOOD_CAP}) return;
  const text = args.map(show).join(" ") + "\\n";
  sent += text.length;
  self.postMessage({ type: "output", stream, text });
};
console.log = console.info = console.debug = say("stdout");
console.warn = console.error = say("stderr");
self.onmessage = async (event) => {
  self.postMessage({ type: "ready" });
  try {
    await new Function("return (async () => {\\n" + event.data.code + "\\n})()")();
    self.postMessage({ type: "done" });
  } catch (error) {
    self.postMessage({ type: "error", text: String((error && error.stack) || error) });
  }
};
`;

const createJavascriptWorker = (): PythonWorker => {
  const url = URL.createObjectURL(
    new Blob([javascriptWorkerSource], { type: "text/javascript" }),
  );

  return new Worker(url) as unknown as PythonWorker;
};

/** the one runner of each language in the page */
export const pythonRunner = createPythonRunner();

export const javascriptRunner = createPythonRunner({
  createWorker: createJavascriptWorker,
  reuseWorker: false,
});

/** the languages that run in the browser (D-272) */
export const BROWSER_LANGUAGES = ["python", "javascript"];

/** the language ids that run in the browser */
export const runsInBrowser = (language: string) =>
  language === "" ||
  language === "python" ||
  language === "py" ||
  isJavascript(language);

/** JavaScript is run in a worker of its own, one for each run */
export const isJavascript = (language: string) =>
  language === "javascript" || language === "js";
