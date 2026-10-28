/**
 * Runs Python in the browser, for a code panel with no bridge.
 *
 * The runtime is Pyodide, and it is fetched **the first time a teacher presses
 * Run**, never when the page loads, and it is not an npm dependency: a teacher
 * who never runs code without the bridge never pays for it. It runs in a
 * **worker**, so a loop that never ends can be stopped at the timeout without
 * freezing the page.
 */

/** where the runtime comes from, and the version it is pinned to */
export const PYODIDE_VERSION = "0.26.4";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

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
  | { kind: "load-failed"; reason: string };

/** the worker's own source, as a string: it is built into a blob at run time */
const workerSource = (indexUrl: string) => `
importScripts(${JSON.stringify(`${indexUrl}pyodide.js`)});
let pyodide = null;
// a program that prints for ever must not flood the page: past the cap nothing
// more is sent (the page cuts the output at its own limit and stops the run)
let sent = 0;
const send = (stream, text) => {
  if (sent > ${OUTPUT_FLOOD_CAP}) return;
  sent += text.length;
  self.postMessage({ type: "output", stream, text });
};
self.onmessage = async (event) => {
  const code = event.data.code;
  sent = 0;
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
  pyodide.setStdout({ batched: (text) => send("stdout", text) });
  pyodide.setStderr({ batched: (text) => send("stderr", text) });
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
  postMessage: (message: { code: string }) => void;
  terminate: () => void;
  onmessage: ((event: { data: WorkerMessage }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
};

const createBlobWorker = (): PythonWorker => {
  const url = URL.createObjectURL(
    new Blob([workerSource(PYODIDE_INDEX_URL)], { type: "text/javascript" }),
  );

  return new Worker(url) as unknown as PythonWorker;
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

  const run = (code: string, events: PythonRunEvents) =>
    new Promise<PythonRunResult>((resolve) => {
      worker ??= createWorker();

      const current = worker;
      let written = 0;
      let cut = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (result: PythonRunResult) => {
        if (timer) {
          clearTimeout(timer);
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
            )} seconds.`,
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
          case "done":
            finish({ kind: "exit", code: 0 });
            break;
          case "error":
            emit("stderr", data.text);
            finish({ kind: "exit", code: 1 });
            break;
        }
      };

      current.onerror = (event) => {
        stop();
        finish({
          kind: "load-failed",
          reason: event.message || "the Python runtime did not start",
        });
      };

      // a worker that has loaded before is ready already: the clock starts now
      if (ready) {
        startClock();
      }

      current.postMessage({ code });
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
