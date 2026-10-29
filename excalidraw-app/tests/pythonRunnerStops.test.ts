/**
 * AC-323 - what a run says when it ends badly, and that its output and its input
 * are exact.
 *
 * The worker is a fake, and the worker's own source is run against a stand-in
 * for Pyodide, so what is checked is what the page and the worker do with what
 * they are given.
 */

import { vi } from "vitest";

import {
  createPythonRunner,
  explainError,
  workerSource,
} from "../bridge/pythonRunner";

import type { PythonWorker } from "../bridge/pythonRunner";

type Fake = PythonWorker & {
  messages: Array<{ code: string; stdin?: string[] }>;
  terminated: boolean;
  say: (data: unknown) => void;
  fail: (message?: string) => void;
};

const fakeWorker = (): Fake => {
  const worker = {
    messages: [] as Fake["messages"],
    terminated: false,
    onmessage: null as PythonWorker["onmessage"],
    onerror: null as PythonWorker["onerror"],
    postMessage: (message: { code: string; stdin?: string[] }) => {
      worker.messages.push(message);
    },
    terminate: () => {
      worker.terminated = true;
    },
    say: (data: unknown) => worker.onmessage?.({ data } as never),
    fail: (message?: string) => worker.onerror?.({ message }),
  };

  return worker as unknown as Fake;
};

const noEvents = () => ({
  onOutput: () => {},
  onNotice: vi.fn(),
});

describe("AC-323 a run that ends badly says why", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-323 a program that is stopped at the limit says it may be an infinite loop", async () => {
    vi.useFakeTimers();

    const worker = fakeWorker();
    const runner = createPythonRunner({
      createWorker: () => worker,
      timeoutMs: 5000,
    });
    const events = noEvents();

    const result = runner.run("while True: pass", events);

    worker.say({ type: "ready" });
    vi.advanceTimersByTime(5000);

    expect(await result).toEqual({ kind: "timed-out" });

    const [kind, text] = events.onNotice.mock.calls[0];

    expect(kind).toBe("timed-out");
    expect(text).toContain("5 seconds");
    expect(text).toContain("infinite loop");
  });

  it("AC-323 the errors a teacher cannot read are explained", () => {
    expect(
      explainError("RecursionError: maximum recursion depth exceeded"),
    ).toContain("calls itself too deeply");
    expect(
      explainError("RangeError: Maximum call stack size exceeded"),
    ).toContain("calls itself too deeply");
    expect(explainError("MemoryError")).toContain("more memory");
    expect(explainError("RangeError: Invalid array length")).toContain(
      "more memory",
    );
    expect(explainError("EOFError: EOF when reading a line")).toContain(
      "Input box",
    );
    expect(explainError("NameError: name 'x' is not defined")).toBeNull();
  });

  it("AC-323 an error of the program ends the run with its message and the hint", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });
    const out: string[] = [];

    const result = runner.run("def f(n): return f(n)", {
      onOutput: (_stream, text) => out.push(text),
      onNotice: () => {},
    });

    worker.say({ type: "ready" });
    worker.say({
      type: "error",
      text: "RecursionError: maximum recursion depth exceeded",
    });

    expect(await result).toEqual({ kind: "exit", code: 1 });
    expect(out.join("")).toContain("RecursionError");
    expect(out.join("")).toContain("Hint: a function calls itself too deeply");
  });

  it("AC-323 a worker that dies while the program runs is a crash, not a failed download", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });

    const result = runner.run("x = [0] * 10**12", noEvents());

    worker.say({ type: "ready" });
    worker.fail("out of memory");

    expect(await result).toEqual({ kind: "crashed", reason: "out of memory" });
    expect(worker.terminated).toBe(true);
  });

  it("AC-323 a worker that dies before it is ready is a failed download", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });

    const result = runner.run("print(1)", noEvents());

    worker.fail("network error");

    expect(await result).toEqual({
      kind: "load-failed",
      reason: "network error",
    });
  });
});

describe("AC-323 the output and the input of Python are exact", () => {
  /** the worker's own source, run against a stand-in for Pyodide */
  const runWorker = async (
    program: (pyodide: {
      out: { write: (bytes: Uint8Array) => number };
      err: { write: (bytes: Uint8Array) => number };
      stdin: () => string | null;
    }) => void,
    stdin: string[] = [],
  ) => {
    const messages: Array<Record<string, unknown>> = [];
    const scope = {
      postMessage: (message: Record<string, unknown>) => {
        messages.push(message);
      },
      onmessage: null as null | ((event: { data: unknown }) => Promise<void>),
    };

    const pyodide = {
      out: null as never,
      err: null as never,
      stdin: null as never,
      setStdout(options: never) {
        pyodide.out = options;
      },
      setStderr(options: never) {
        pyodide.err = options;
      },
      setStdin(options: { stdin: () => string | null }) {
        pyodide.stdin = options.stdin as never;
      },
      runPythonAsync: async () => program(pyodide as never),
    };

    // eslint-disable-next-line no-new-func
    new Function(
      "self",
      "importScripts",
      "loadPyodide",
      workerSource("https://example/"),
    )(
      scope,
      () => {},
      async () => pyodide,
    );

    await scope.onmessage!({ data: { code: "print()", stdin } });

    return messages;
  };

  it("AC-323 print with end='' and a newline come out exactly as written", async () => {
    const encode = (text: string) => new TextEncoder().encode(text);

    const messages = await runWorker((py) => {
      // for j in range(3): print("*", end="")   then   print("\n", end="")
      for (let i = 0; i < 3; i++) {
        py.out.write(encode("*"));
      }

      py.out.write(encode("\n"));
      py.out.write(encode("**"));
    });

    const text = messages
      .filter((message) => message.type === "output")
      .map((message) => message.text)
      .join("");

    // a line of three, a line break, then two more: not one line of five
    expect(text).toBe("***\n**");
    expect(messages.at(-1)).toEqual({ type: "done" });
  });

  it("AC-323 input() reads the lines that were typed, and then meets the end", async () => {
    const seen: Array<string | null> = [];

    await runWorker(
      (py) => {
        seen.push(py.stdin(), py.stdin(), py.stdin());
      },
      ["Ada", "7"],
    );

    expect(seen).toEqual(["Ada", "7", null]);
  });

  it("AC-323 the runner hands the lines of input to the worker", () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });

    void runner.run("print(input())", noEvents(), { stdin: ["Ada", "7"] });

    expect(worker.messages).toEqual([
      { code: "print(input())", stdin: ["Ada", "7"] },
    ]);
  });
});
