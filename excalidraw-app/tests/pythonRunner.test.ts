/**
 * AC-307 - Python runs in the browser when there is no bridge.
 *
 * The worker is a fake: what is checked here is what the runner does with
 * what a worker says - the output, the end, the time limit, a failed download -
 * and that nothing is started or fetched before a teacher presses Run.
 */

import { vi } from "vitest";

import { createPythonRunner } from "../bridge/pythonRunner";

import type { PythonWorker } from "../bridge/pythonRunner";

type FakeWorker = PythonWorker & {
  received: string[];
  terminated: boolean;
  say: (data: unknown) => void;
};

const fakeWorker = (): FakeWorker => {
  const worker = {
    received: [] as string[],
    terminated: false,
    onmessage: null as PythonWorker["onmessage"],
    onerror: null as PythonWorker["onerror"],
    postMessage: (message: { code: string }) => {
      worker.received.push(message.code);
    },
    terminate: () => {
      worker.terminated = true;
    },
    say: (data: unknown) => worker.onmessage?.({ data } as never),
  };

  return worker as unknown as FakeWorker;
};

const events = () => ({
  output: [] as Array<[string, string]>,
  notices: [] as Array<[string, string]>,
  loading: 0,
  handlers: {
    onLoading: () => {
      /* counted below */
    },
    onOutput: (_stream: "stdout" | "stderr", _text: string) => {},
    onNotice: (_kind: "timed-out" | "truncated", _text: string) => {},
  },
});

const track = () => {
  const seen = events();

  seen.handlers.onLoading = () => {
    seen.loading++;
  };
  seen.handlers.onOutput = (stream, text) => {
    seen.output.push([stream, text]);
  };
  seen.handlers.onNotice = (kind, text) => {
    seen.notices.push([kind, text]);
  };

  return seen;
};

describe("AC-307 Python in the browser", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("AC-307 nothing is started or fetched before Run", () => {
    const fetchSpy = vi.fn();
    const createWorker = vi.fn(fakeWorker);

    vi.stubGlobal("fetch", fetchSpy);

    createPythonRunner({ createWorker });

    expect(createWorker).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("AC-307 run without the bridge uses the browser runtime", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });
    const seen = track();

    const result = runner.run("print('hi')", seen.handlers);

    // the program is handed to the worker, and the first run says it is loading
    expect(worker.received).toEqual(["print('hi')"]);

    worker.say({ type: "loading" });
    worker.say({ type: "ready" });
    worker.say({ type: "output", stream: "stdout", text: "hi" });
    worker.say({ type: "done" });

    expect(await result).toEqual({ kind: "exit", code: 0 });
    expect(seen.loading).toBe(1);
    expect(seen.output).toEqual([["stdout", "hi"]]);
  });

  it("AC-307 an error in the program ends the run with its message", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });
    const seen = track();

    const result = runner.run("1/0", seen.handlers);

    worker.say({ type: "ready" });
    worker.say({ type: "error", text: "ZeroDivisionError: division by zero" });

    expect(await result).toEqual({ kind: "exit", code: 1 });
    expect(seen.output).toEqual([
      ["stderr", "ZeroDivisionError: division by zero"],
    ]);
  });

  it("AC-307 a failed download offers a retry", async () => {
    const workers: FakeWorker[] = [];
    const runner = createPythonRunner({
      createWorker: () => {
        const worker = fakeWorker();

        workers.push(worker);

        return worker;
      },
    });

    const first = runner.run("print(1)", track().handlers);

    workers[0].say({ type: "loading" });
    workers[0].say({ type: "load-failed", text: "Failed to fetch" });

    expect(await first).toEqual({
      kind: "load-failed",
      reason: "Failed to fetch",
    });
    expect(workers[0].terminated).toBe(true);

    // the next Run starts again from the beginning
    const second = runner.run("print(1)", track().handlers);

    expect(workers).toHaveLength(2);

    workers[1].say({ type: "ready" });
    workers[1].say({ type: "done" });

    expect(await second).toEqual({ kind: "exit", code: 0 });
  });

  it("AC-307 a program that does not end is stopped at the time limit", async () => {
    vi.useFakeTimers();

    const worker = fakeWorker();
    const runner = createPythonRunner({
      createWorker: () => worker,
      timeoutMs: 5000,
    });
    const seen = track();

    const result = runner.run("while True: pass", seen.handlers);

    // the clock does not run while the runtime is downloading
    worker.say({ type: "loading" });
    vi.advanceTimersByTime(60_000);
    expect(worker.terminated).toBe(false);

    worker.say({ type: "ready" });
    vi.advanceTimersByTime(5000);

    expect(await result).toEqual({ kind: "timed-out" });
    expect(worker.terminated).toBe(true);
    expect(seen.notices[0][0]).toBe("timed-out");
  });

  it("AC-307 the output is cut at the limit", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({
      createWorker: () => worker,
      maxOutputChars: 10,
    });
    const seen = track();

    const result = runner.run("print('x' * 100)", seen.handlers);

    worker.say({ type: "ready" });
    worker.say({ type: "output", stream: "stdout", text: "x".repeat(8) });
    worker.say({ type: "output", stream: "stdout", text: "y".repeat(8) });
    worker.say({ type: "output", stream: "stdout", text: "z".repeat(8) });
    worker.say({ type: "done" });
    await result;

    expect(seen.output.map(([, text]) => text).join("")).toBe(
      `${"x".repeat(8)}yy`,
    );
    expect(seen.notices.map(([kind]) => kind)).toEqual(["truncated"]);
  });
});
