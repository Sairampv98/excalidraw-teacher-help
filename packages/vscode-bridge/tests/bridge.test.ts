import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
import {
  isStoredToken,
  resolvePort,
  resolveSessionToken,
  resolveToken,
  KEPT_SESSION_SLOT,
} from "../extension/src/config";
import {
  createInputPanel,
  isPanelAction,
  PANEL_ACTIONS,
} from "../extension/src/inputPanel";
import {
  applyMirrorMessage,
  createMirrorStore,
} from "../extension/src/mirrorRegion";
import {
  createCaptureStatePublisher,
  type CaptureStateMessage,
} from "../extension/src/captureState";

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
      type: "editor:mirror",
      region: { x: 0.25, y: 0.1, width: 0.5, height: 0.4 },
      follow: false,
    },
    { v: 1, type: "editor:control", enabled: true },
    {
      v: 1,
      type: "editor:input",
      event: { kind: "pointer", action: "down", x: 0.5, y: 0.25, mods: 0 },
    },
    { v: 1, type: "editor:window", action: "park" },
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
 * The **input panel** (D-145).
 *
 * The screen the students see and the controls the teacher uses are different
 * surfaces: the teacher drives the presenter from a small page on their real
 * screen, and parks the editor's window out of sight from the same page
 * (D-328).
 *
 * These are the extension's half of that, and the rules they keep:
 *
 *  - the panel's controls travel over the **bridge**, so there is one way to
 *    drive a presentation;
 *  - the panel's own actions are a closed list: park, and bring back;
 *  - the panel is served on 127.0.0.1 only, and it carries no token.
 */
describe("the input panel", () => {
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

  it("AC-181 the input panel's controls drive the presenter over the bridge and not the teacher's own window", async () => {
    const sent: BridgeMessage[] = [];
    const panel = createInputPanel({
      port: () => 47511,
      onCommand: (command) => {
        sent.push({ v: 1, type: "present:command", command });
      },
      state: () => ({
        parked: false,
        reason: "the editor's window is on a display",
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

  it("AC-376 the input panel's actions are park and bring back and the list is closed", async () => {
    // the closed list: the two actions of the window, and nothing else
    expect([...PANEL_ACTIONS]).toEqual([
      "park-editor-window",
      "bring-back-editor-window",
    ]);
    expect(isPanelAction("park-editor-window")).toBe(true);
    expect(isPanelAction("bring-back-editor-window")).toBe(true);
    expect(isPanelAction("move-editor-window")).toBe(false);
    expect(isPanelAction("move-to-display")).toBe(false);
    expect(isPanelAction("code:run")).toBe(false);

    const actions: string[] = [];
    const commands: string[] = [];
    const panel = createInputPanel({
      port: () => 47511,
      onCommand: (command) => commands.push(command),
      onAction: (action) => actions.push(action),
    });
    const capability = panel.createCapability();
    const server = await startServer({ inputPanel: panel });

    const post = (body: unknown) =>
      fetchFrom(server.port, {
        method: "POST",
        path: `/panel/${capability}/control`,
        body: JSON.stringify(body),
      });

    expect((await post({ action: "park-editor-window" })).status).toBe(200);
    expect((await post({ action: "bring-back-editor-window" })).status).toBe(
      200,
    );

    // an action the list does not have is refused and nothing runs
    expect((await post({ action: "move-editor-window" })).status).toBe(400);
    expect((await post({ action: "move-to-display" })).status).toBe(400);

    expect(actions).toEqual(["park-editor-window", "bring-back-editor-window"]);

    // an action is the panel's own business: it is not a presenter command and
    // it never goes on the bridge
    expect(commands).toEqual([]);

    // the page offers the two buttons, and no button that moves a window to a
    // display
    const page = await fetchFrom(server.port, {
      path: `/panel/${capability}/index.html`,
    });

    expect(page.body).toContain('data-action="park-editor-window"');
    expect(page.body).toContain('data-action="bring-back-editor-window"');
    expect(page.body).not.toMatch(/virtual/i);
    expect(page.body).not.toMatch(/Move this editor/i);
  });

  it("AC-376 the input panel's state is the window's", async () => {
    const panel = createInputPanel({
      port: () => 47511,
      onCommand: () => undefined,
      state: () => ({
        parked: true,
        reason: "the editor's window is parked: it keeps working, out of sight",
      }),
    });
    const capability = panel.createCapability();
    const server = await startServer({ inputPanel: panel });

    const state = await fetchFrom(server.port, {
      path: `/panel/${capability}/state`,
    });

    expect(JSON.parse(state.body)).toEqual({
      parked: true,
      reason: "the editor's window is parked: it keeps working, out of sight",
    });

    // the state the panel starts with says nothing about a display or a driver
    const unknown = createInputPanel({
      port: () => 47511,
      onCommand: () => undefined,
    });
    const other = unknown.createCapability();
    const second = await startServer({ inputPanel: unknown });
    const fresh = await fetchFrom(second.port, {
      path: `/panel/${other}/state`,
    });

    expect(JSON.parse(fresh.body)).toMatchObject({ parked: false });
    expect(fresh.body).not.toMatch(/virtual|display|driver/i);
  });
});

describe("the control of the editor's window (D-323, D-327)", () => {
  const POINTER = {
    kind: "pointer",
    action: "down",
    x: 0.5,
    y: 0.25,
    button: "left",
    mods: 0,
  } as const;

  const accepts = (event: unknown) =>
    parseBridgeMessage(
      JSON.stringify({ v: 1, type: "editor:input", event }),
    ) !== null;

  it("AC-369 the control's messages are in the protocol and round-trip", () => {
    for (const type of ["editor:control", "editor:input", "editor:window"]) {
      expect(BRIDGE_MESSAGE_TYPES as readonly string[]).toContain(type);
    }

    for (const message of [
      { v: 1, type: "editor:control", enabled: true },
      { v: 1, type: "editor:control", enabled: false },
      { v: 1, type: "editor:input", event: POINTER },
      { v: 1, type: "editor:window", action: "park" },
      { v: 1, type: "editor:window", action: "bring-back" },
    ] as BridgeMessage[]) {
      expect(parseBridgeMessage(encodeBridgeMessage(message))).toEqual(message);
    }

    // a control message with the wrong shape is refused
    expect(
      parseBridgeMessage('{"v":1,"type":"editor:control","enabled":"yes"}'),
    ).toBeNull();
    expect(
      parseBridgeMessage('{"v":1,"type":"editor:window","action":"move"}'),
    ).toBeNull();
    expect(
      parseBridgeMessage('{"v":1,"type":"editor:window","action":"close"}'),
    ).toBeNull();
  });

  it("AC-369 an input event is one of four kinds and the others are refused", () => {
    expect(accepts(POINTER)).toBe(true);
    expect(
      accepts({ kind: "pointer", action: "move", x: 0, y: 1, mods: 3 }),
    ).toBe(true);
    expect(
      accepts({ kind: "wheel", x: 0.2, y: 0.8, dx: 0, dy: -2.5, mods: 0 }),
    ).toBe(true);
    expect(
      accepts({
        kind: "key",
        action: "down",
        code: "KeyS",
        char: "s",
        mods: 0,
      }),
    ).toBe(true);
    expect(accepts({ kind: "key", action: "up", code: "Enter", mods: 1 })).toBe(
      true,
    );
    expect(accepts({ kind: "text", text: "héllo\nworld" })).toBe(true);

    // any other kind: a click that is not an event, a script, a command
    for (const kind of ["click", "drop", "exec", "eval", "focus", ""]) {
      expect([kind, accepts({ kind, x: 0.5, y: 0.5, mods: 0 })]).toEqual([
        kind,
        false,
      ]);
    }

    // a double click is two presses: it is not an event of its own
    expect(
      accepts({ kind: "pointer", action: "dblclick", x: 0.5, y: 0.5, mods: 0 }),
    ).toBe(false);
    expect(accepts("down")).toBe(false);
    expect(accepts(null)).toBe(false);
  });

  it("AC-369 a malformed input event is refused", () => {
    const bad = [
      // a place outside the window, or not a number
      { ...POINTER, x: 1.01 },
      { ...POINTER, y: -0.01 },
      { ...POINTER, x: Number.NaN },
      { ...POINTER, x: "0.5" },
      // a button that is not one of three
      { ...POINTER, button: "back" },
      // modifiers that are not a mask (the Windows key is never one)
      { ...POINTER, mods: 8 },
      { ...POINTER, mods: -1 },
      { ...POINTER, mods: 1.5 },
      // a wheel that turns too far
      { kind: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 21, mods: 0 },
      {
        kind: "wheel",
        x: 0.5,
        y: 0.5,
        dx: 0,
        dy: Number.POSITIVE_INFINITY,
        mods: 0,
      },
      // a key that is not in the table, a raw code, a character that is not one
      { kind: "key", action: "down", code: "MetaLeft", mods: 0 },
      { kind: "key", action: "down", code: "OSLeft", mods: 0 },
      { kind: "key", action: "down", code: 91, mods: 0 },
      { kind: "key", action: "down", code: "KeyA", char: "ab", mods: 0 },
      { kind: "key", action: "down", code: "KeyA", char: "\u0007", mods: 0 },
      { kind: "key", action: "hold", code: "KeyA", mods: 0 },
      // a text that is too long, empty or made of control characters
      { kind: "text", text: "a".repeat(257) },
      { kind: "text", text: "" },
      { kind: "text", text: "ab\u0000c" },
      { kind: "text", text: "ab\u001bc" },
      { kind: "text", text: 5 },
    ];

    for (const event of bad) {
      expect([JSON.stringify(event), accepts(event)]).toEqual([
        JSON.stringify(event),
        false,
      ]);
    }

    // and the largest a text may be is still accepted
    expect(accepts({ kind: "text", text: "a".repeat(256) })).toBe(true);
  });

  it("AC-369 the descriptor carries the control's state", () => {
    const published: CaptureStateMessage[] = [];
    const captureState = createCaptureStatePublisher((message) =>
      published.push(message),
    );

    // nothing is said about the control until it is said
    captureState.live(1, { width: 1282, height: 674 });
    expect(published[0].control).toBeUndefined();
    expect(published[0].parked).toBeUndefined();

    captureState.setControl({
      enabled: true,
      route: "background",
      reason: "input goes to the editor's window without taking the focus",
    });

    expect(published).toHaveLength(2);
    expect(published[1].control).toEqual({
      enabled: true,
      route: "background",
      reason: "input goes to the editor's window without taking the focus",
    });

    // the same thing again is not a change
    captureState.setControl({
      enabled: true,
      route: "background",
      reason: "input goes to the editor's window without taking the focus",
    });
    expect(published).toHaveLength(2);

    captureState.setParked(true);
    expect(published).toHaveLength(3);
    expect(published[2].parked).toBe(true);
    expect(published[2].control?.enabled).toBe(true);

    // and what travels is a legal message, with the route and the reason
    for (const message of published) {
      expect(parseBridgeMessage(encodeBridgeMessage(message))).toEqual(message);
    }

    expect(
      parseBridgeMessage(
        '{"v":1,"type":"editor:capture","state":"live","seq":1,"control":{"enabled":true,"route":"teleport","reason":"x"}}',
      ),
    ).toBeNull();
    expect(
      parseBridgeMessage(
        '{"v":1,"type":"editor:capture","state":"live","seq":1,"control":{"enabled":true,"route":"focus","reason":""}}',
      ),
    ).toBeNull();
  });

  /** the extension's own source, without its comments */
  const extensionCode = () =>
    readFileSync(
      join(
        process.cwd(),
        "packages",
        "vscode-bridge",
        "extension",
        "src",
        "extension.ts",
      ),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");

  it("AC-378 the first descriptor already carries the control, off", () => {
    const published: CaptureStateMessage[] = [];
    const captureState = createCaptureStatePublisher((message) =>
      published.push(message),
    );

    // the extension says it has a control BEFORE the capture's first frame,
    // and the first descriptor carries it: a panel draws its Control and Park
    // buttons from it, and used to wait for somebody to turn the control on -
    // which nobody could do without the buttons
    captureState.setControl({
      enabled: false,
      route: "none",
      reason: "Control is off",
    });

    expect(published).toHaveLength(0);

    captureState.live(1, { width: 1920, height: 1008 });

    expect(published).toHaveLength(1);
    expect(published[0].control).toEqual({
      enabled: false,
      route: "none",
      reason: "Control is off",
    });

    // and a panel that connects later is sent the same descriptor
    expect(parseBridgeMessage(encodeBridgeMessage(published[0]))).toEqual(
      published[0],
    );
  });

  it("AC-378 the extension announces the control when it starts", () => {
    const code = extensionCode();

    // a call at the level of the activation (two spaces in), not one inside a
    // handler that only runs when somebody turns the control on
    expect(code).toMatch(/^ {2}publishControl\(\);$/m);

    // and it comes after the function it calls and before the first message
    // is handled
    expect(code.search(/^ {2}publishControl\(\);$/m)).toBeGreaterThan(
      code.indexOf("const publishControl = () => {"),
    );
  });

  it("AC-379 a kept token is used again", () => {
    const kept = "ab".repeat(24);

    // a token the extension made and kept is used again - so the page, which
    // remembers it, reconnects after the editor is reloaded
    expect(isStoredToken(kept)).toBe(true);
    expect(resolveSessionToken(undefined, kept)).toEqual({
      token: kept,
      generated: true,
      reused: true,
    });
    expect(resolveSessionToken("", kept).token).toBe(kept);

    // with nothing kept a new one is made, and it is a token of ours
    const made = resolveSessionToken(undefined, undefined);

    expect(made.reused).toBe(false);
    expect(isStoredToken(made.token)).toBe(true);
    expect(resolveSessionToken(undefined, undefined).token).not.toBe(
      made.token,
    );

    // a kept value that is not a token of ours is not trusted
    for (const garbage of [
      "",
      "short",
      "zz".repeat(24),
      "AB".repeat(24),
      "ab".repeat(25),
    ]) {
      expect(isStoredToken(garbage)).toBe(false);
      expect(resolveSessionToken(undefined, garbage).token).not.toBe(garbage);
      expect(resolveSessionToken(undefined, garbage).reused).toBe(false);
    }

    // the token that was always a new one stays that for who asks for it so
    expect(resolveToken().token).not.toBe(resolveToken().token);
  });

  it("AC-379 a configured token wins and is never kept", () => {
    const kept = "cd".repeat(24);

    expect(resolveSessionToken("  my-own-token  ", kept)).toEqual({
      token: "my-own-token",
      generated: false,
      reused: false,
    });
  });

  it("AC-379 the extension reads the storage before it listens and keeps what it makes", () => {
    const code = extensionCode();

    // the activation waits for the storage, and does so before the server is made
    expect(code).toMatch(/export async function activate\(/);
    expect(code).toContain("await context.secrets.get(KEPT_SESSION_SLOT)");
    expect(code.indexOf("context.secrets.get(KEPT_SESSION_SLOT)")).toBeLessThan(
      code.indexOf("createBridgeServer({"),
    );

    // a token that was made - and not a configured one, and not one that was
    // read - is stored
    expect(code).toMatch(
      /if \(generated && !reused\) \{[\s\S]{0,80}context\.secrets\.store\(KEPT_SESSION_SLOT, token\)/,
    );

    // and the notification says the token is kept
    expect(code).toContain("The token is kept in this editor");
    expect(KEPT_SESSION_SLOT).toBe("excalidraw-bridge.kept-session");
  });
});

describe("what is mirrored (D-143)", () => {
  it("AC-182 the whole window is mirrored until the teacher chooses a region", () => {
    // The mirror starts with **no region**: the whole editor's window is
    // mirrored, which is the default.
    const mirror = createMirrorStore();

    expect(mirror.state.region).toBeNull();
    expect(mirror.state.follow).toBe(false);

    // And the capture descriptor says so: it carries **no region at all**,
    // because a region of "nothing" IS the whole window.
    const published: CaptureStateMessage[] = [];
    const captureState = createCaptureStatePublisher((message) =>
      published.push(message),
    );

    captureState.live(1, { width: 1282, height: 674 });

    expect(published).toHaveLength(1);
    expect(published[0].type).toBe("editor:capture");
    expect(published[0].state).toBe("live");
    expect(published[0].region).toBeUndefined();
    expect(published[0].follow).toBeUndefined();

    // The picture's own size rides with the state: the crop is measured in
    // fractions of the picture, so the panel needs the size to draw it.
    expect(published[0].width).toBe(1282);
    expect(published[0].height).toBe(674);
  });

  it("AC-182 the region travels to the editor and comes back in the capture descriptor", async () => {
    const region = { x: 0.25, y: 0.1, width: 0.5, height: 0.4 };

    let arrive: (message: BridgeMessage) => void = () => undefined;

    const arrived = new Promise<BridgeMessage>((resolve) => {
      arrive = resolve;
    });

    const server = await startServer({
      onMessage: (message) => {
        if (message.type === "editor:mirror") {
          arrive(message);
        }
      },
    });

    const client = await connect(server);

    auth(client);

    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );

    // The teacher's choice goes over the bridge like every other message.
    client.send(
      encodeBridgeMessage({
        v: 1,
        type: "editor:mirror",
        region,
        follow: false,
      }),
    );

    expect(await arrived).toEqual({
      v: 1,
      type: "editor:mirror",
      region,
      follow: false,
    });

    // And the editor's answer: the capture descriptor says what is mirrored
    // now, so every panel that shows the live view says the same thing.
    const mirror = createMirrorStore();
    const published: CaptureStateMessage[] = [];
    const captureState = createCaptureStatePublisher((message) =>
      published.push(message),
    );

    captureState.live(1, { width: 1282, height: 674 });

    applyMirrorMessage(mirror, (state) => captureState.setMirror(state), {
      region,
      follow: false,
    });

    expect(published).toHaveLength(2);
    expect(published[1].region).toEqual(region);
    expect(published[1].follow).toBeUndefined();
  });

  it("AC-182 the region can be changed again and again", () => {
    const mirror = createMirrorStore();

    // The teacher crops a region ...
    expect(mirror.set({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, false)).toBe(
      true,
    );
    expect(mirror.state.region).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.4,
      height: 0.4,
    });

    // ... changes their mind ...
    expect(mirror.set({ x: 0.5, y: 0.2, width: 0.3, height: 0.3 }, false)).toBe(
      true,
    );
    expect(mirror.state.region).toEqual({
      x: 0.5,
      y: 0.2,
      width: 0.3,
      height: 0.3,
    });

    // ... and asks for the whole window again.
    expect(mirror.set(null, false)).toBe(true);
    expect(mirror.state.region).toBeNull();

    // The same choice again changes nothing: the teacher may pick the same
    // crop twice, and the second pick is not a change.
    expect(mirror.set(null, false)).toBe(false);

    // A region that reaches outside the window is pulled back inside it, and
    // a region with no area is **no region** - the whole window.
    expect(mirror.set({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, false)).toBe(
      true,
    );
    expect(mirror.state.region).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });

    expect(mirror.set({ x: 0, y: 0, width: 0, height: 0 }, false)).toBe(true);
    expect(mirror.state.region).toBeNull();
  });

  it("AC-182 the follow the cursor mode is off until the teacher turns it on", () => {
    const mirror = createMirrorStore();
    const published: CaptureStateMessage[] = [];
    const captureState = createCaptureStatePublisher((message) =>
      published.push(message),
    );

    captureState.live(1, { width: 1282, height: 674 });

    // The mode is **off** by default, and the descriptor says nothing about
    // it: a mode that is off is not said.
    expect(mirror.state.follow).toBe(false);
    expect(published[0].follow).toBeUndefined();

    // The teacher turns it on ...
    mirror.set({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, true);
    captureState.setMirror(mirror.state);

    expect(mirror.state.follow).toBe(true);
    expect(published[1].follow).toBe(true);

    // ... and off again.
    mirror.set(mirror.state.region, false);
    captureState.setMirror(mirror.state);

    expect(mirror.state.follow).toBe(false);
    expect(published[2].follow).toBeUndefined();
  });
});
