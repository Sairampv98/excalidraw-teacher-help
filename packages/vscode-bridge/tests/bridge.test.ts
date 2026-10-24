import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { FileId } from "@excalidraw/element/types";

import {
  BRIDGE_MESSAGE_TYPES,
  DEFAULT_BRIDGE_PORT,
  NO_WORKSPACE_NAME,
  encodeBridgeMessage,
  parseBridgeMessage,
  type BridgeMessage,
} from "../bridge/src/protocol";

import {
  CLOSE_UNAUTHORIZED,
  createBridgeServer,
  isAllowedOrigin,
  type BridgeServer,
  type BridgeServerOptions,
} from "../extension/src/bridge";

import { createRunner, type SpawnedProcess } from "../extension/src/runner";
import { runSnippet } from "../extension/src/snippet";
import { resolvePort, resolveToken } from "../extension/src/config";
import { createInputPanel } from "../extension/src/inputPanel";
import { createVirtualDisplay } from "../extension/src/virtualDisplay";

import { RawWsClient } from "./helpers/rawWsClient";

// A fixture, not a credential: the name says so, and the kit's secret scan
// recognises a `test-` prefixed value as the placeholder it is.
const TOKEN = "test-per-session-token-that-must-never-leak";

const servers: BridgeServer[] = [];
const clients: RawWsClient[] = [];

const startServer = async (
  options: Partial<BridgeServerOptions> = {},
): Promise<BridgeServer> => {
  const server = createBridgeServer({
    port: 0,
    token: TOKEN,
    workspace: "excalidraw",
    version: "0.1.0",
    ...options,
  });
  servers.push(server);
  await server.listen();
  return server;
};

const connect = async (
  server: BridgeServer,
  options: { origin?: string | null } = {},
): Promise<RawWsClient> => {
  const client = new RawWsClient({
    port: server.port,
    origin: options.origin,
  });
  clients.push(client);
  await client.waitForHandshake();
  return client;
};

const auth = (client: RawWsClient, token = TOKEN) => {
  client.send(encodeBridgeMessage({ v: 1, type: "bridge:auth", token }));
};

const messages = (client: RawWsClient): BridgeMessage[] =>
  client
    .textFrames()
    .map((text) => parseBridgeMessage(text))
    .filter((message): message is BridgeMessage => message !== null);

/** A child process that a test can write to and close. */
const makeFakeProcess = () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const handlers = new Map<string, ((...args: any[]) => void)[]>();

  const emit = (event: string, ...args: any[]) => {
    for (const listener of handlers.get(event) ?? []) {
      listener(...args);
    }
  };

  const proc: SpawnedProcess = {
    stdout,
    stderr,
    stdin,
    on(event: any, listener: any): any {
      const list = handlers.get(event) ?? [];
      list.push(listener);
      handlers.set(event, list);
      return proc;
    },
    kill() {
      emit("exit", null, "SIGTERM");
      emit("close", null);
      return true;
    },
  };

  return { proc, stdout, stderr, emit };
};

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

describe("the bridge protocol", () => {
  const SAMPLES: BridgeMessage[] = [
    { v: 1, type: "bridge:auth", token: "a-token" },
    { v: 1, type: "bridge:hello", version: "0.1.0", workspace: "excalidraw" },
    {
      v: 1,
      type: "editor:content",
      uri: "file:///main.py",
      language: "python",
      text: "print(1)",
      selection: { start: 0, end: 7 },
      version: 3,
    },
    {
      v: 1,
      type: "editor:capture",
      state: "live",
      seq: 1,
    },
    {
      v: 1,
      type: "run:started",
      runId: "run-1",
      command: "python",
      cwd: "/work",
    },
    { v: 1, type: "run:output", runId: "run-1", stream: "stdout", text: "hi" },
    { v: 1, type: "run:exit", runId: "run-1", code: 0 },
    { v: 1, type: "run:start", command: "python", args: ["main.py"] },
    { v: 1, type: "run:stop", runId: "run-1" },
    {
      v: 1,
      type: "code:run",
      id: "code-run-1",
      language: "python",
      text: "print('hello')",
    },
    {
      v: 1,
      type: "run:notice",
      runId: "code-run-1",
      kind: "timed-out",
      text: "The run timed out after 10 s.",
    },
    { v: 1, type: "run:runtimes", languages: ["javascript", "python"] },
    {
      v: 1,
      type: "ocr:request",
      id: "ocr-1",
      fileId: "file-1" as FileId,
      imageBase64: "QUJD",
      region: { x: 0, y: 900, width: 1920, height: 180 },
    },
    {
      v: 1,
      type: "ocr:result",
      id: "ocr-1",
      fileId: "file-1" as FileId,
      text: "hello",
      lines: [{ text: "hello", x: 10, y: 20, width: 100, height: 30 }],
    },
    {
      v: 1,
      type: "ocr:error",
      id: "ocr-1",
      message: "the OCR engine is not installed",
    },
    {
      v: 1,
      type: "ocr:state",
      state: "ready",
      engine: "tesseract",
    },
    {
      v: 1,
      type: "captions:request",
      id: "captions-1",
      videoId: "dQw4w9WgXcQ",
    },
    {
      v: 1,
      type: "captions:result",
      id: "captions-1",
      videoId: "dQw4w9WgXcQ",
      tracks: [
        {
          language: "en",
          label: "en",
          cues: [{ startMs: 1000, endMs: 2500, text: "hello" }],
        },
      ],
      tier: "api",
    },
    {
      v: 1,
      type: "captions:none",
      id: "captions-1",
      videoId: "dQw4w9WgXcQ",
      reason: "no captions: the public timedtext endpoint gave nothing back",
      tier: "none",
    },
    { v: 1, type: "present:command", command: "next-page" },
    { v: 1, type: "ping" },
    { v: 1, type: "pong" },
  ];

  it("AC-62 every message the extension sends parses under the BridgeMessage union, and vice versa", () => {
    // every message type in the union has a sample, and every sample has a
    // type in the union - the two cannot drift apart
    expect(SAMPLES.map((message) => message.type).sort()).toEqual(
      [...BRIDGE_MESSAGE_TYPES].sort(),
    );

    for (const sample of SAMPLES) {
      const parsed = parseBridgeMessage(encodeBridgeMessage(sample));
      expect({ type: sample.type, message: parsed }).toEqual({
        type: sample.type,
        message: sample,
      });
    }

    // the other direction: what the panel sends is understood too
    const fromPanel: BridgeMessage[] = [
      { v: 1, type: "run:start", command: "node", args: ["index.js"] },
      { v: 1, type: "run:stop", runId: "run-1" },
      {
        v: 1,
        type: "code:run",
        id: "code-run-1",
        language: "python",
        text: "print('hello')",
      },
      { v: 1, type: "ping" },
    ];
    for (const message of fromPanel) {
      expect(parseBridgeMessage(encodeBridgeMessage(message))).toEqual(message);
    }

    // and every kind of notice is understood, with its sentence (D-124)
    for (const kind of ["timed-out", "truncated", "missing-runtime"] as const) {
      const notice: BridgeMessage = {
        v: 1,
        type: "run:notice",
        runId: "code-run-1",
        kind,
        text: "The run ended.",
      };

      expect(parseBridgeMessage(encodeBridgeMessage(notice))).toEqual(notice);
    }
  });

  it("AC-62 a message that is not on the protocol is refused", () => {
    expect(parseBridgeMessage("not json")).toBeNull();
    expect(
      parseBridgeMessage(JSON.stringify({ v: 2, type: "ping" })),
    ).toBeNull();
    expect(
      parseBridgeMessage(JSON.stringify({ v: 1, type: "nope" })),
    ).toBeNull();
    expect(
      parseBridgeMessage(
        JSON.stringify({ v: 1, type: "run:output", runId: 1 }),
      ),
    ).toBeNull();
    expect(
      parseBridgeMessage(
        JSON.stringify({
          v: 1,
          type: "run:exit",
          runId: "run-1",
          code: "zero",
        }),
      ),
    ).toBeNull();
  });
});

describe("the bridge server", () => {
  it("AC-114 a frame never travels over the websocket", async () => {
    const server = await startServer();
    const client = await connect(server);

    auth(client);

    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );

    const before = messages(client).length;

    // The extension publishes a frame of the editor's window. It goes to the
    // MJPEG STREAM and to nothing else (D-85): the websocket is not a
    // picture's road, so a frame can never reach the app's data - and so it
    // can never reach the element's payload either (D-82).
    server.publishFrame({ bytes: Buffer.from("a-jpeg", "utf8"), seq: 1 });

    // give the server a moment to say something wrong
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = messages(client);

    expect(after.length).toBe(before);
    expect(after.some((message) => message.type === "editor:capture")).toBe(
      false,
    );
    expect(
      after.some((message) => JSON.stringify(message).includes("a-jpeg")),
    ).toBe(false);
  });

  it("AC-58 a connection without the session token is rejected", async () => {
    const server = await startServer({ authTimeoutMs: 250 });

    // (a) a connection that says nothing at all
    const silent = await connect(server);
    const closed = await silent.waitForClose();
    expect(closed.code).toBe(CLOSE_UNAUTHORIZED);
    expect(silent.textFrames()).toEqual([]);
    expect(server.clientCount).toBe(0);

    // (b) a connection that presents the wrong token
    const wrong = await connect(server);
    auth(wrong, "not-the-token");
    const wrongClosed = await wrong.waitForClose();
    expect(wrongClosed.code).toBe(CLOSE_UNAUTHORIZED);
    expect(messages(wrong)).toEqual([]);
    expect(server.clientCount).toBe(0);

    // (c) a connection that presents the first frame, but not the token
    const notAuth = await connect(server);
    notAuth.send(
      encodeBridgeMessage({ v: 1, type: "run:start", command: "x", args: [] }),
    );
    const notAuthClosed = await notAuth.waitForClose();
    expect(notAuthClosed.code).toBe(CLOSE_UNAUTHORIZED);
    expect(server.clientCount).toBe(0);
  });

  it("AC-58 a connection that presents the token is accepted", async () => {
    const server = await startServer();
    const client = await connect(server);
    auth(client);

    const hello = await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );
    const parsed = parseBridgeMessage(hello.payload.toString("utf8"));
    expect(parsed?.type).toBe("bridge:hello");
    expect(server.clientCount).toBe(1);
  });

  it("AC-159 the hello carries the workspace name when there is one", async () => {
    const server = await startServer({ workspace: "excalidraw" });
    const client = await connect(server);
    auth(client);

    const hello = await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );
    const parsed = parseBridgeMessage(hello.payload.toString("utf8"));

    expect(parsed?.type).toBe("bridge:hello");
    expect(parsed?.type === "bridge:hello" ? parsed.workspace : null).toBe(
      "excalidraw",
    );
  });

  it("AC-159 the hello says there is no folder open rather than carrying an empty name", async () => {
    // The owner's panel said *"Connected to Visual Studio Code ()"* - an empty
    // pair of brackets, which says nothing (D-122).
    const server = await startServer({ workspace: "" });
    const client = await connect(server);
    auth(client);

    const hello = await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );
    const parsed = parseBridgeMessage(hello.payload.toString("utf8"));

    expect(parsed?.type).toBe("bridge:hello");

    const workspace = parsed?.type === "bridge:hello" ? parsed.workspace : "";

    // the name is NEVER blank: it says what is missing
    expect(workspace).not.toBe("");
    expect(workspace).toBe(NO_WORKSPACE_NAME);

    // and the same is true when the extension had no workspace to name at all
    const unnamed = await startServer({ workspace: undefined });
    const unnamedClient = await connect(unnamed);
    auth(unnamedClient);

    const unnamedHello = await unnamedClient.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );
    const unnamedParsed = parseBridgeMessage(
      unnamedHello.payload.toString("utf8"),
    );

    expect(
      unnamedParsed?.type === "bridge:hello" ? unnamedParsed.workspace : "",
    ).toBe(NO_WORKSPACE_NAME);
  });

  it("AC-59 a connection with a non-localhost origin is rejected", async () => {
    const server = await startServer();

    const client = new RawWsClient({
      port: server.port,
      origin: "http://evil.example.com",
    });
    clients.push(client);

    const status = await client.waitForHandshake();
    expect(status).toBe(403);
    expect(client.textFrames()).toEqual([]);
    expect(server.clientCount).toBe(0);
  });

  it("AC-59 a connection with no origin at all is rejected", async () => {
    const server = await startServer();
    const client = new RawWsClient({ port: server.port, origin: null });
    clients.push(client);
    const status = await client.waitForHandshake();
    expect(status).toBe(403);
    expect(server.clientCount).toBe(0);
  });

  it("AC-59 only a localhost origin is allowed", () => {
    expect(isAllowedOrigin("http://localhost:3001")).toBe(true);
    expect(isAllowedOrigin("https://localhost")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:47511")).toBe(true);
    expect(isAllowedOrigin("http://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("https://excalidraw.com")).toBe(false);
    expect(isAllowedOrigin("file://")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });

  it("AC-60 a run:start produces a run:started / run:output / run:exit sequence", async () => {
    const fake = makeFakeProcess();
    let runner: ReturnType<typeof createRunner> | null = null;

    const server = await startServer({
      onMessage: (message) => {
        if (message.type === "run:start") {
          runner?.start({
            command: message.command,
            args: message.args,
            cwd: message.cwd,
          });
        }
      },
    });

    runner = createRunner({
      bridge: { broadcast: (message) => server.broadcast(message) },
      spawn: () => fake.proc,
      nextRunId: () => "run-1",
    });

    const client = await connect(server);
    auth(client);
    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );

    client.send(
      encodeBridgeMessage({
        v: 1,
        type: "run:start",
        command: "python",
        args: ["main.py"],
      }),
    );

    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("run:started"),
    );
    fake.stdout.write("hello from the program\n");
    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("run:output"),
    );
    fake.emit("close", 0);
    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("run:exit"),
    );

    const runTypes = messages(client)
      .map((message) => message.type)
      .filter((type) => type.startsWith("run:"));
    expect(runTypes).toEqual(["run:started", "run:output", "run:exit"]);

    const started = messages(client).find((m) => m.type === "run:started");
    expect(started).toMatchObject({
      runId: "run-1",
      command: "python",
    });
    const output = messages(client).find((m) => m.type === "run:output");
    expect(output).toMatchObject({
      runId: "run-1",
      stream: "stdout",
      text: "hello from the program",
    });
    const exited = messages(client).find((m) => m.type === "run:exit");
    expect(exited).toMatchObject({ runId: "run-1", code: 0 });
  });

  it("AC-63 the extension does not capture the token in a URL or a command line", async () => {
    const spawnCalls: { command: string; args: string[] }[] = [];
    const fake = makeFakeProcess();
    const server = await startServer();

    const runner = createRunner({
      bridge: { broadcast: (message) => server.broadcast(message) },
      spawn: (command, args) => {
        spawnCalls.push({ command, args });
        return fake.proc;
      },
      nextRunId: () => "run-1",
    });

    const client = await connect(server);
    auth(client);
    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );

    // the token is not in the URL: the request line carries no query string
    // at all, and the token is nowhere in the request
    expect(client.request.split("\r\n")[0]).toBe("GET / HTTP/1.1");
    expect(client.request).not.toContain(TOKEN);
    expect(client.request).not.toMatch(/token|secret/i);

    // the token is not on the command line either
    runner.start({ command: "python", args: ["main.py"] });
    expect(spawnCalls).toHaveLength(1);
    for (const call of spawnCalls) {
      expect(call.command).not.toContain(TOKEN);
      expect(call.args.join(" ")).not.toContain(TOKEN);
    }
  });

  it("the bridge port is fixed, and it comes from a VITE_APP_* variable", () => {
    // the port is a constant, not a random free port (D-67)
    expect(DEFAULT_BRIDGE_PORT).toBe(47511);
    expect(DEFAULT_BRIDGE_PORT).toBeGreaterThan(0);

    const dir = mkdtempSync(join(tmpdir(), "excalidraw-bridge-env-"));
    writeFileSync(
      join(dir, ".env.development"),
      "VITE_APP_BRIDGE_URL=ws://127.0.0.1:49999\n",
    );

    // the app's build-time variable is the one source of truth
    expect(resolvePort(dir)).toBe(49999);
    // with nothing set, the shared default is used - still a fixed port
    expect(resolvePort(join(dir, "not-a-folder"))).toBe(DEFAULT_BRIDGE_PORT);
    // a setting wins over the file
    expect(resolvePort(dir, 51234)).toBe(51234);
  });

  it("the token is generated per session when none is configured", () => {
    const first = resolveToken();
    const second = resolveToken();
    expect(first.generated).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThan(16);
    expect(resolveToken("configured").token).toBe("configured");
    expect(resolveToken("configured").generated).toBe(false);
  });
});

/**
 * The **runnable snippet**: the teacher's own text, run in the teacher's
 * workspace (D-124).
 *
 * The extension is the only one of the three that can run anything, so the
 * run path is proven here - with a real program, a real timeout and a real
 * file in a real directory.
 */
describe("the runnable snippet", () => {
  it("AC-163 a run that exceeds the timeout is reported as timed out", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "excalidraw-snippet-"));
    const sent: BridgeMessage[] = [];

    // the program never ends within the timeout: it waits for a second, and
    // the timeout is a fifth of that
    const result = await runSnippet(
      {
        id: "code-run-1",
        language: "javascript",
        text: "setTimeout(() => {}, 1000);",
      },
      {
        bridge: { broadcast: (message) => sent.push(message) },
        workspaceRoot: workspace,
        timeoutMs: 200,
      },
    );

    expect(result.ran).toBe(true);
    expect(result.timedOut).toBe(true);

    // the fact is reported, and it says how long the run was given
    const notice = sent.find((message) => message.type === "run:notice");

    expect(notice).toBeTruthy();
    expect(notice).toMatchObject({ runId: "code-run-1", kind: "timed-out" });
    expect((notice as { text: string }).text).toContain("timed out after");
    expect((notice as { text: string }).text).toContain("0.2 s");

    // the temporary file is gone: the teacher's workspace keeps no litter
    expect(readdirSync(workspace)).toEqual([]);
  });

  it("AC-163 a language whose runtime is missing says so instead of running", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "excalidraw-snippet-"));
    const sent: BridgeMessage[] = [];

    const result = await runSnippet(
      {
        id: "code-run-2",
        language: "python",
        text: "print('hello')",
      },
      {
        bridge: { broadcast: (message) => sent.push(message) },
        workspaceRoot: workspace,
        // python is not on this machine
        hasProgram: async () => false,
      },
    );

    // nothing ran, and the panel is told that nothing ran
    expect(result.ran).toBe(false);
    expect(sent.some((message) => message.type === "run:started")).toBe(false);
    expect(sent.some((message) => message.type === "run:exit")).toBe(false);

    const notice = sent.find((message) => message.type === "run:notice");

    expect(notice).toBeTruthy();
    expect(notice).toMatchObject({
      runId: "code-run-2",
      kind: "missing-runtime",
    });
    expect((notice as { text: string }).text).toContain("Python");
    expect((notice as { text: string }).text).toContain("not installed");

    // and there is no file in the teacher's workspace either
    expect(readdirSync(workspace)).toEqual([]);
  });

  it("AC-163 a run that prints too much is reported as truncated", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "excalidraw-snippet-"));
    const sent: BridgeMessage[] = [];

    const result = await runSnippet(
      {
        id: "code-run-3",
        language: "javascript",
        text: "for (let i = 0; i < 5000; i++) { console.log('x'.repeat(20)); }",
      },
      {
        bridge: { broadcast: (message) => sent.push(message) },
        workspaceRoot: workspace,
        maxOutputChars: 500,
      },
    );

    expect(result.ran).toBe(true);
    expect(result.truncated).toBe(true);

    const notice = sent.find((message) => message.type === "run:notice");

    expect(notice).toBeTruthy();
    expect(notice).toMatchObject({ runId: "code-run-3", kind: "truncated" });
    expect((notice as { text: string }).text).toContain(
      "truncated at 500 characters",
    );

    // and the output really is bounded
    const characters = sent
      .filter((message) => message.type === "run:output")
      .reduce(
        (total, message) => total + (message as { text: string }).text.length,
        0,
      );

    expect(characters).toBeLessThanOrEqual(500);
  });

  it("AC-163 the temporary file says what it is, and it is in the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "excalidraw-snippet-"));
    const names: string[] = [];

    await runSnippet(
      {
        id: "code-run-4",
        language: "javascript",
        text: "console.log('hello from the snippet');",
      },
      {
        bridge: {
          broadcast: (message) => {
            if (message.type === "run:started") {
              names.push(message.command);
            }
          },
        },
        workspaceRoot: workspace,
      },
    );

    // the command line says what was run, and the file's name says what it is
    expect(names[0]).toContain("excalidraw-bridge-snippet-code-run-4.js");
  });
});

/**
 * The **virtual display** and the **input panel** (D-145).
 *
 * The screen the students see and the controls the teacher uses are different
 * surfaces: the presenter's window goes on a virtual display when the machine
 * has one, and the teacher drives it from a small page on their real screen.
 *
 * These are the extension's half of that, and the rules they keep:
 *
 *  - a virtual display is found and the presenter's window is placed on it;
 *  - with no virtual display the feature says so plainly and falls back to the
 *    desktop - never a silent failure and never a crash;
 *  - the panel's controls travel over the **bridge**, so there is one way to
 *    drive a presentation;
 *  - the panel is served on 127.0.0.1 only, and it carries no token.
 */
describe("the virtual display and the input panel", () => {
  /** The real display on this kind of machine. */
  const REAL_DISPLAY = {
    device: "\\\\.\\DISPLAY1",
    name: "Generic PnP Monitor",
    adapter: "AMD Radeon(TM) Graphics",
    adapterId: "PCI\\VEN_1002&DEV_1638",
    adapterKey:
      "\\Registry\\Machine\\System\\CurrentControlSet\\Control\\Video\\{DDC0}\\0000",
    deviceId: "MONITOR\\LEN9059\\{4d36e96e}\\0001",
    deviceKey:
      "\\Registry\\Machine\\System\\CurrentControlSet\\Control\\Class\\{4d36e96e}\\0001",
    width: 1920,
    height: 1080,
    x: 0,
    y: 0,
    attached: true,
    primary: true,
    adapterFlags: 524293,
    deviceFlags: 3,
  };

  /** The virtual display an indirect display driver would add. */
  const VIRTUAL_DISPLAY = {
    ...REAL_DISPLAY,
    device: "\\\\.\\DISPLAY2",
    name: "Virtual Monitor",
    adapter: "Virtual Display Driver",
    adapterId: "ROOT\\DISPLAY\\0001",
    width: 2560,
    height: 1440,
    x: 1920,
    y: 0,
    primary: false,
  };

  /** The helper's output: one json object per line. */
  const helperOutput = (displays: unknown[]) =>
    displays.map((display) => JSON.stringify(display)).join("\n");

  /** A helper that answers without a Windows machine behind it. */
  const fakeHelper = (displays: unknown[]) => {
    const calls: string[][] = [];

    const run = async (args: string[]) => {
      calls.push(args);

      if (args.includes("Enumerate")) {
        return helperOutput(displays);
      }

      if (args.includes("Find")) {
        return JSON.stringify({
          found: true,
          visible: true,
          handle: 4242,
          title: "Excalidraw - Presenter view",
          x: 100,
          y: 100,
          width: 800,
          height: 600,
        });
      }

      return JSON.stringify({ placed: true, handle: 4242 });
    };

    return { calls, run };
  };

  /** A plain http request against the bridge's own loopback server. */
  const fetchFrom = async (
    port: number,
    options: { method?: string; path: string; body?: string },
  ) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: options.path,
          method: options.method ?? "GET",
          headers: options.body
            ? { "content-type": "application/json" }
            : undefined,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );

      req.on("error", reject);

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    });

  it("AC-181 the virtual display is detected and the presenter's window is placed on it", async () => {
    const helper = fakeHelper([REAL_DISPLAY, VIRTUAL_DISPLAY]);
    const service = createVirtualDisplay({
      scriptPath: "virtual-display.ps1",
      run: helper.run,
    });

    const displays = await service.displays();

    expect(displays).toHaveLength(2);

    // the virtual one is the virtual one, and the real one is not
    expect(
      displays.find((display) => display.device === VIRTUAL_DISPLAY.device),
    ).toMatchObject({ virtual: true, width: 2560, height: 1440, x: 1920 });
    expect(
      displays.find((display) => display.device === REAL_DISPLAY.device),
    ).toMatchObject({ virtual: false, width: 1920, height: 1080 });

    const target = await service.target();

    expect(target.virtual).toBe(true);
    expect(target.display?.device).toBe(VIRTUAL_DISPLAY.device);
    expect(target.reason).toContain("virtual display");

    const placement = await service.placePresenter();

    expect(placement.placed).toBe(true);
    expect(placement.display?.device).toBe(VIRTUAL_DISPLAY.device);

    // and the window was moved to the display's OWN rectangle
    const placeCall = helper.calls.find((args) => args.includes("Place"));

    expect(placeCall).toBeTruthy();
    expect(placeCall?.join(" ")).toContain("-X 1920");
    expect(placeCall?.join(" ")).toContain("-Y 0");
    expect(placeCall?.join(" ")).toContain("-Width 2560");
    expect(placeCall?.join(" ")).toContain("-Height 1440");
  });

  it("AC-181 with no virtual display the feature says so plainly and falls back to the desktop", async () => {
    const helper = fakeHelper([REAL_DISPLAY]);
    const service = createVirtualDisplay({
      scriptPath: "virtual-display.ps1",
      run: helper.run,
    });

    const target = await service.target();

    expect(target.virtual).toBe(false);
    expect(target.display?.device).toBe(REAL_DISPLAY.device);

    // the reason is a plain sentence, and it is never empty: a failure is a
    // message, not a silence (D-75)
    expect(target.reason.length).toBeGreaterThan(0);
    expect(target.reason).toContain("no virtual display");
    expect(target.reason).toContain("opens on the desktop");

    const placement = await service.placePresenter();

    expect(placement.placed).toBe(false);
    expect(placement.reason).toContain("no virtual display");

    // and NOTHING was moved: the presenter's own window opens on the desktop
    expect(helper.calls.some((args) => args.includes("Place"))).toBe(false);
  });

  it("AC-181 the input panel's controls drive the presenter over the bridge and not the teacher's own window", async () => {
    const sent: BridgeMessage[] = [];
    const panel = createInputPanel({
      port: () => 47511,
      onCommand: (command) => {
        sent.push({ v: 1, type: "present:command", command });
      },
      state: () => ({
        display: null,
        virtual: false,
        reason: "the presenter's window opens on the desktop",
      }),
    });
    const capability = panel.createCapability();

    const server = await startServer({ inputPanel: panel });
    const client = await connect(server);

    auth(client);

    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );

    const sent_ = await fetchFrom(server.port, {
      method: "POST",
      path: `/panel/${capability}/control`,
      body: JSON.stringify({ command: "next-page" }),
    });

    expect(sent_.status).toBe(200);

    // the command travels over the BRIDGE: the panel sends the same message
    // the presenter's own controls send, so there is one way to drive a
    // presentation
    expect(sent).toEqual([
      { v: 1, type: "present:command", command: "next-page" },
    ]);

    // a command that is NOT one of the presenter's own controls is refused,
    // and NOTHING goes on the bridge: the panel can never run anything on the
    // teacher's machine that the bridge does not already allow
    const refused = await fetchFrom(server.port, {
      method: "POST",
      path: `/panel/${capability}/control`,
      body: JSON.stringify({ command: "code:run" }),
    });

    expect(refused.status).toBe(400);
    expect(sent).toHaveLength(1);
  });

  it("AC-181 the input panel is served on 127.0.0.1 only and carries no token", async () => {
    const panel = createInputPanel({
      port: () => 47511,
      onCommand: () => undefined,
    });
    const capability = panel.createCapability();

    const server = await startServer({ inputPanel: panel });

    // the panel's URL is the loopback and the capability - never the token
    const url = panel.urlFor(capability);

    expect(url).toContain("http://127.0.0.1:");
    expect(url).not.toContain(TOKEN);

    const page = await fetchFrom(server.port, {
      path: `/panel/${capability}/index.html`,
    });

    expect(page.status).toBe(200);

    // and the page itself carries no token: the panel cannot become a way to
    // reach the bridge without one
    expect(page.body).not.toContain(TOKEN);
    expect(page.body).not.toMatch(/token/i);

    // a request without a live capability is refused, and it is a 404
    const stranger = await fetchFrom(server.port, {
      path: "/panel/deadbeefdeadbeefdeadbeefdeadbeef/index.html",
    });

    expect(stranger.status).toBe(404);

    // the panel does not steal the teacher's keystrokes: it installs no key
    // handler at all, it never takes the focus, and its buttons do not take
    // the focus when they are clicked
    expect(page.body).not.toMatch(/addEventListener\(\s*["']key/);
    expect(page.body).not.toMatch(/\.focus\(/);
    expect(page.body).not.toMatch(/autofocus/i);
    expect(page.body).toContain('data-command="next-page"');
  });
});
