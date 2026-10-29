/**
 * AC-337 - a program that asks for input waits for the answer.
 *
 * The worker says when the program is at a question nobody has answered; the
 * runner stops the program there and tells the page; the page asks, and runs the
 * program again from the top with the answer added.
 */

import { vi } from "vitest";

import { renderHook, act, waitFor } from "@testing-library/react";

import { newPanelElement } from "@excalidraw/element";
import {
  codePanelContent,
  emptyCodePanelState,
  readCodePanelState,
  withPanelDraft,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  NEEDS_INPUT_GRACE_MS,
  createPythonRunner,
  pythonRunner,
  workerSource,
} from "../bridge/pythonRunner";
import { useBridgePanel } from "../bridge/useBridgePanel";

import type { PythonWorker } from "../bridge/pythonRunner";

type Fake = PythonWorker & {
  terminated: boolean;
  say: (data: unknown) => void;
};

const fakeWorker = (): Fake => {
  const worker = {
    terminated: false,
    onmessage: null as PythonWorker["onmessage"],
    onerror: null as PythonWorker["onerror"],
    postMessage: () => {},
    terminate: () => {
      worker.terminated = true;
    },
    say: (data: unknown) => worker.onmessage?.({ data } as never),
  };

  return worker as unknown as Fake;
};

describe("AC-337 the runner stops a program at its question", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC-337 a program stopped at a question ends as needing input, and the error that ends it is not shown", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });
    const onOutput = vi.fn();

    const result = runner.run(
      "n = int(input('Enter n: '))",
      { onOutput, onNotice: vi.fn() },
      { stdin: [] },
    );

    worker.say({ type: "ready" });
    worker.say({ type: "output", stream: "stdout", text: "Enter n: " });
    worker.say({ type: "needs-input" });
    // what ends the program at its question: the end of its input
    worker.say({ type: "error", text: "EOFError: EOF when reading a line" });

    await expect(result).resolves.toEqual({ kind: "needs-input" });

    // the question is shown, and the error that is not the program's is not
    expect(onOutput).toHaveBeenCalledTimes(1);
    expect(onOutput).toHaveBeenCalledWith("stdout", "Enter n: ");
  });

  it("AC-337 a program that goes on after its question is stopped, and the question is asked", async () => {
    vi.useFakeTimers();

    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });

    const result = runner.run(
      "while True: pass",
      { onOutput: vi.fn(), onNotice: vi.fn() },
      { stdin: [] },
    );

    worker.say({ type: "ready" });
    worker.say({ type: "needs-input" });

    expect(worker.terminated).toBe(false);

    vi.advanceTimersByTime(NEEDS_INPUT_GRACE_MS + 1);

    await expect(result).resolves.toEqual({ kind: "needs-input" });
    expect(worker.terminated).toBe(true);
  });

  it("AC-337 a program that catches the end of its input is still asked for it", async () => {
    const worker = fakeWorker();
    const runner = createPythonRunner({ createWorker: () => worker });

    const result = runner.run(
      "try: input()\nexcept EOFError: pass",
      { onOutput: vi.fn(), onNotice: vi.fn() },
      { stdin: [] },
    );

    worker.say({ type: "ready" });
    worker.say({ type: "needs-input" });
    worker.say({ type: "done" });

    await expect(result).resolves.toEqual({ kind: "needs-input" });
  });
});

describe("AC-337 the worker shows what is read and says when the input ran out", () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  /** the worker's own source, run against a stand-in for Pyodide */
  const runWorker = async (
    program: (pyodide: {
      out: { write: (bytes: Uint8Array) => number };
      err: { write: (bytes: Uint8Array) => number };
      stdin: () => string | null;
    }) => void,
    stdin: string[],
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

  const shown = (messages: Array<Record<string, unknown>>) =>
    messages
      .filter((message) => message.type === "output")
      .map((message) => message.text)
      .join("");

  it("AC-337 a line that is read is shown after its question, as a terminal shows it", async () => {
    const messages = await runWorker(
      (py) => {
        py.out.write(encode("Enter n: "));

        const answer = py.stdin();

        py.out.write(encode(`you said ${answer}\n`));
      },
      ["21"],
    );

    expect(shown(messages)).toBe("Enter n: 21\nyou said 21\n");
    expect(messages.some((message) => message.type === "needs-input")).toBe(
      false,
    );
  });

  it("AC-337 when the lines run out the page is told once, and nothing more is shown", async () => {
    const messages = await runWorker(
      (py) => {
        py.out.write(encode("Enter n: "));
        py.stdin();
        // the next question has no answer
        py.stdin();
        py.out.write(encode("never shown\n"));
        py.err.write(encode("Traceback: EOFError\n"));
        py.stdin();
      },
      ["21"],
    );

    expect(shown(messages)).toBe("Enter n: 21\n");
    expect(
      messages.filter((message) => message.type === "needs-input"),
    ).toHaveLength(1);
  });
});

describe("AC-337 the page asks the question and runs the program again with the answer", () => {
  const panelWithProgram = (text: string, typedAhead = "") => {
    const element = newPanelElement({
      type: "panel",
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      panelKind: "code",
      panel: withPanelDraft(
        codePanelContent(emptyCodePanelState(), "session-1"),
        { text, language: "python", edited: true },
      ),
      posterMode: false,
      posterFileId: null,
    });

    if (typedAhead) {
      (
        element as unknown as { panel: Record<string, unknown> }
      ).panel.consoleView = {
        dock: "bottom",
        size: 0.3,
        zoom: 1,
        input: typedAhead,
      };
    }

    const state: { elements: ExcalidrawElement[] } = {
      elements: [element as unknown as ExcalidrawElement],
    };

    const setToast = vi.fn();

    const api = {
      getSceneElements: () => state.elements,
      updateScene: (data: { elements?: readonly ExcalidrawElement[] }) => {
        if (data.elements) {
          state.elements = [...data.elements];
        }
      },
      setToast,
    } as unknown as ExcalidrawImperativeAPI;

    return { api, state, id: element.id, setToast };
  };

  const panelState = (state: { elements: ExcalidrawElement[] }) =>
    readCodePanelState(
      (state.elements[0] as unknown as { panel: never }).panel,
    )!;

  const outputText = (state: { elements: ExcalidrawElement[] }) =>
    panelState(state)
      .output.map((line) => line.text)
      .join("");

  /** a program that asks for a number and answers it; Pyodide stands out */
  const fakeProgram = () =>
    vi
      .spyOn(pythonRunner, "run")
      .mockImplementation(async (_code, events, options) => {
        const stdin = options?.stdin ?? [];

        events.onOutput("stdout", "Enter n: ");

        if (!stdin.length) {
          return { kind: "needs-input" };
        }

        events.onOutput("stdout", `${stdin[0]}\n`);
        events.onOutput("stdout", `you said ${stdin[0]}\n`);

        return { kind: "exit", code: 0 };
      });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-337 the program stops at its question, and the answer starts it again", async () => {
    const run = fakeProgram();
    const { api, state, id } = panelWithProgram("n = int(input('Enter n: '))");

    const { result } = renderHook(() => useBridgePanel(api));

    act(() => {
      result.current.panelRun.onRun!(id);
    });

    // the console shows the question and waits for the answer
    await waitFor(() =>
      expect(panelState(state).run.state).toBe("waiting-input"),
    );
    expect(outputText(state)).toBe("Enter n: ");
    expect(run.mock.calls[0][2]).toEqual({ stdin: [] });

    // the answer: the program runs again, and now it gets the line
    act(() => {
      result.current.panelRun.onAnswer!(id, "21");
    });

    await waitFor(() => expect(panelState(state).run.state).toBe("exited"));

    expect(run.mock.calls[1][2]).toEqual({ stdin: ["21"] });

    // the console starts again from the top, with the answer where it was read
    expect(outputText(state)).toBe("Enter n: 21\nyou said 21\n");

    // the second start is the same run going on: one "Run started" line
    expect(
      panelState(state).console.filter((line) =>
        line.text.includes("Run started"),
      ),
    ).toHaveLength(1);
  });

  it("AC-337 the lines typed in advance are read first, without the last empty line", async () => {
    const run = fakeProgram();
    const { api, state, id } = panelWithProgram("input()", "Ada\n");

    const { result } = renderHook(() => useBridgePanel(api));

    act(() => {
      result.current.panelRun.onRun!(id);
    });

    await waitFor(() => expect(panelState(state).run.state).toBe("exited"));

    // "Ada" and its newline are one line, not a line and an empty one
    expect(run.mock.calls[0][2]).toEqual({ stdin: ["Ada"] });
  });

  it("AC-337 pressing Run again starts the questions again, and clearing the console ends the wait", async () => {
    const run = fakeProgram();
    const { api, state, id, setToast } = panelWithProgram(
      "n = int(input('Enter n: '))",
    );

    const { result } = renderHook(() => useBridgePanel(api));

    act(() => {
      result.current.panelRun.onRun!(id);
    });
    await waitFor(() =>
      expect(panelState(state).run.state).toBe("waiting-input"),
    );

    // Run again: the answers of the first go are not kept
    act(() => {
      result.current.panelRun.onRun!(id);
    });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1][2]).toEqual({ stdin: [] });
    await waitFor(() =>
      expect(panelState(state).run.state).toBe("waiting-input"),
    );

    // clearing the console ends the wait: the program is not asked again
    act(() => {
      result.current.panelRun.onClear!(id);
    });
    expect(panelState(state).run.state).toBe("exited");

    // an answer to a program that is not waiting is not taken: it is said
    act(() => {
      result.current.panelRun.onAnswer!(id, "7");
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(setToast).toHaveBeenCalledTimes(1);
  });
});
