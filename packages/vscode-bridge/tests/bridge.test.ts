import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { FileId } from "@excalidraw/element/types";

import {
  BRIDGE_MESSAGE_TYPES,
  DEFAULT_BRIDGE_PORT,
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
import { resolvePort, resolveToken } from "../extension/src/config";

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
      { v: 1, type: "ping" },
    ];
    for (const message of fromPanel) {
      expect(parseBridgeMessage(encodeBridgeMessage(message))).toEqual(message);
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
