/**
 * AC-619 - the **pairing prompt** (D-518): a page with no token asks to connect,
 * the editor asks the teacher "Allow the whiteboard at 127.0.0.1:3061 to
 * connect?", and an origin that was allowed is remembered.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  createBridgeClient,
  PAIRING_OLD_EXTENSION,
  PAIRING_REFUSED,
  PAIRING_WAITING,
  type WebSocketLike,
} from "../bridge/src/client";
import {
  BRIDGE_CLOSE_UNAUTHORIZED,
  encodeBridgeMessage,
  parseBridgeMessage,
  type BridgeMessage,
} from "../bridge/src/protocol";
import {
  CLOSE_UNAUTHORIZED,
  createBridgeServer,
  type BridgeServer,
  type BridgeServerOptions,
} from "../extension/src/bridge";
import {
  createPairing,
  originLabel,
  pairingQuestion,
  PAIRING_ALLOW,
  PAIRING_DENY,
  type PairingStore,
} from "../extension/src/pairing";

import { RawWsClient } from "./helpers/rawWsClient";

const here = dirname(fileURLToPath(import.meta.url));

const TOKEN = "test-per-session-token-that-must-never-leak";
const ORIGIN = "http://127.0.0.1:3061";

const memoryStore = (initial: string[] = []) => {
  let origins = initial;
  const store: PairingStore = {
    read: () => origins,
    write: (next) => {
      origins = next;
    },
  };

  return { store, get: () => origins };
};

describe("the pairing rules", () => {
  it("AC-619 the question names the whiteboard's address, and the buttons say what they do", () => {
    expect(pairingQuestion(ORIGIN)).toBe(
      "Allow the whiteboard at 127.0.0.1:3061 to connect?",
    );
    expect(pairingQuestion("http://localhost:3000")).toBe(
      "Allow the whiteboard at localhost:3000 to connect?",
    );
    expect(originLabel("not a url")).toBe("not a url");
    expect(PAIRING_ALLOW).toBe("Allow");
    expect(PAIRING_DENY).not.toBe(PAIRING_ALLOW);
  });

  it("AC-619 an Allow is remembered for that origin, and the next page of it is not asked", async () => {
    const memory = memoryStore();
    const asked: string[] = [];
    const pairing = createPairing({
      store: memory.store,
      ask: async (question) => {
        asked.push(question);
        return true;
      },
    });

    expect(await pairing.decide(ORIGIN)).toBe(true);
    expect(asked).toEqual([
      "Allow the whiteboard at 127.0.0.1:3061 to connect?",
    ]);
    expect(memory.get()).toEqual([ORIGIN]);
    expect(pairing.isPaired(ORIGIN)).toBe(true);

    // the same origin again, even written differently: no question
    expect(await pairing.decide("HTTP://127.0.0.1:3061")).toBe(true);
    expect(asked).toHaveLength(1);

    // another origin (another port) is another whiteboard, and is asked about
    expect(await pairing.decide("http://127.0.0.1:3062")).toBe(true);
    expect(asked).toHaveLength(2);
    expect(memory.get()).toEqual([ORIGIN, "http://127.0.0.1:3062"]);
  });

  it("AC-619 a refusal is not remembered, and a prompt that fails is a refusal", async () => {
    const memory = memoryStore();
    let answer: boolean | "throw" = false;
    let asked = 0;
    const pairing = createPairing({
      store: memory.store,
      ask: async () => {
        asked++;

        if (answer === "throw") {
          throw new Error("the window went away");
        }

        return answer;
      },
    });

    expect(await pairing.decide(ORIGIN)).toBe(false);
    answer = "throw";
    expect(await pairing.decide(ORIGIN)).toBe(false);
    expect(memory.get()).toEqual([]);

    // refused twice means asked twice: a refusal does not stick
    expect(asked).toBe(2);

    answer = true;
    expect(await pairing.decide(ORIGIN)).toBe(true);
  });

  it("AC-619 two pages of one origin that ask together get one question", async () => {
    const memory = memoryStore();
    let release: (allowed: boolean) => void = () => undefined;
    let asked = 0;
    const pairing = createPairing({
      store: memory.store,
      ask: () => {
        asked++;
        return new Promise<boolean>((resolve) => {
          release = resolve;
        });
      },
    });

    const first = pairing.decide(ORIGIN);
    const second = pairing.decide(ORIGIN);

    release(true);

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(asked).toBe(1);
  });

  it("AC-619 no origin, a null origin and a broken one are never paired", async () => {
    const pairing = createPairing({
      store: memoryStore(["http://127.0.0.1:3061"]).store,
      ask: async () => true,
    });

    expect(await pairing.decide(undefined)).toBe(false);
    expect(await pairing.decide("null")).toBe(false);
    expect(await pairing.decide("not an origin")).toBe(false);
    expect(pairing.isPaired(undefined)).toBe(false);
  });

  it("AC-619 the remembered origins are limited, and they can all be forgotten", async () => {
    const memory = memoryStore();
    const pairing = createPairing({
      store: memory.store,
      ask: async () => true,
      limit: 3,
    });

    for (const port of [1, 2, 3, 4]) {
      await pairing.decide(`http://127.0.0.1:${port}`);
    }

    // the oldest was dropped
    expect(memory.get()).toEqual([
      "http://127.0.0.1:2",
      "http://127.0.0.1:3",
      "http://127.0.0.1:4",
    ]);

    expect(await pairing.forget()).toBe(3);
    expect(memory.get()).toEqual([]);
    expect(await pairing.forget()).toBe(0);
  });

  it("AC-619 a damaged memory is no memory", async () => {
    const pairing = createPairing({
      store: {
        read: () => [7, null, ORIGIN] as unknown as string[],
        write: () => undefined,
      },
      ask: async () => false,
    });

    expect(pairing.list()).toEqual([ORIGIN]);
  });
});

describe("the pairing on the bridge", () => {
  const servers: BridgeServer[] = [];
  const clients: RawWsClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close();
    }

    for (const server of servers.splice(0)) {
      await server.close();
    }
  });

  const start = async (options: Partial<BridgeServerOptions> = {}) => {
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

  const connect = async (server: BridgeServer, origin = ORIGIN) => {
    const client = new RawWsClient({ port: server.port, origin });

    clients.push(client);
    await client.waitForHandshake();

    return client;
  };

  const sentTypes = (client: RawWsClient) =>
    client
      .textFrames()
      .map((text) => parseBridgeMessage(text))
      .filter((message): message is BridgeMessage => message !== null)
      .map((message) => message.type);

  const pair = (client: RawWsClient) =>
    client.send(encodeBridgeMessage({ v: 1, type: "bridge:pair" }));

  it("AC-619 an allowed page gets the hello and is a client, with no token", async () => {
    const origins: string[] = [];
    const server = await start({
      onPair: async (origin) => {
        origins.push(origin);
        return true;
      },
    });
    const client = await connect(server);

    pair(client);
    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );

    expect(origins).toEqual([ORIGIN]);
    expect(server.clientCount).toBe(1);
    expect(sentTypes(client)).toContain("bridge:hello");
  });

  it("AC-619 a page that is not allowed is closed with the refusal code and gets nothing", async () => {
    const server = await start({ onPair: async () => false });
    const client = await connect(server);

    pair(client);

    const closed = await client.waitForClose();

    expect(closed.code).toBe(CLOSE_UNAUTHORIZED);
    expect(closed.code).toBe(BRIDGE_CLOSE_UNAUTHORIZED);
    expect(sentTypes(client)).toEqual([]);
    expect(server.clientCount).toBe(0);
  });

  it("AC-619 a prompt that fails refuses, and a bridge without pairing refuses the pair frame", async () => {
    const failing = await start({
      onPair: async () => {
        throw new Error("no window");
      },
    });
    const one = await connect(failing);

    pair(one);
    expect((await one.waitForClose()).code).toBe(CLOSE_UNAUTHORIZED);

    const none = await start();
    const two = await connect(none);

    pair(two);
    expect((await two.waitForClose()).code).toBe(CLOSE_UNAUTHORIZED);
    expect(none.clientCount).toBe(0);
  });

  it("AC-619 while the teacher is being asked the connection waits, past the token timeout, and what the page says meanwhile is not read", async () => {
    let answer: (allowed: boolean) => void = () => undefined;
    const server = await start({
      authTimeoutMs: 80,
      onPair: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    });
    const client = await connect(server);

    pair(client);
    // frames while waiting are ignored: they do not close it, and are not run
    client.send(
      encodeBridgeMessage({ v: 1, type: "run:start", command: "x", args: [] }),
    );

    // longer than the token timeout: it is still waiting for the teacher
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(server.clientCount).toBe(0);
    expect(sentTypes(client)).toEqual([]);

    answer(true);
    await client.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );
    expect(server.clientCount).toBe(1);
  });

  it("AC-619 a question nobody answers ends: the page is refused", async () => {
    const server = await start({
      pairTimeoutMs: 120,
      onPair: () => new Promise<boolean>(() => undefined),
    });
    const client = await connect(server);

    pair(client);

    expect((await client.waitForClose()).code).toBe(CLOSE_UNAUTHORIZED);
    expect(server.clientCount).toBe(0);
  });

  it("AC-619 only the localhost origins can ask: another site never reaches the prompt", async () => {
    let asked = 0;
    const server = await start({
      onPair: async () => {
        asked++;
        return true;
      },
    });
    const stranger = new RawWsClient({
      port: server.port,
      origin: "https://evil.example",
    });

    clients.push(stranger);

    expect(await stranger.waitForHandshake()).toBe(403);
    expect(asked).toBe(0);
  });

  it("AC-619 the token still works as it did, and a wrong token is still refused", async () => {
    const server = await start({ onPair: async () => false });
    const good = await connect(server);

    good.send(encodeBridgeMessage({ v: 1, type: "bridge:auth", token: TOKEN }));
    await good.waitForMessage((frame) =>
      frame.payload.toString("utf8").includes("bridge:hello"),
    );

    const bad = await connect(server);

    bad.send(
      encodeBridgeMessage({ v: 1, type: "bridge:auth", token: "wrong" }),
    );
    expect((await bad.waitForClose()).code).toBe(CLOSE_UNAUTHORIZED);
  });
});

describe("the page's side of the pairing", () => {
  class FakeWebSocket implements WebSocketLike {
    static last: FakeWebSocket | null = null;

    readyState = 0;
    sent: string[] = [];
    onopen: ((event: any) => void) | null = null;
    onmessage: ((event: { data: any }) => void) | null = null;
    onclose: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;

    constructor(public url: string) {
      FakeWebSocket.last = this;
    }

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3;
    }
  }

  const make = (token: string) => {
    const states: { status: string; message: string }[] = [];
    const client = createBridgeClient({
      url: "ws://127.0.0.1:47511/",
      token,
      WebSocketImpl: FakeWebSocket,
      onStateChange: (state) => states.push(state),
    });

    client.connect();
    FakeWebSocket.last!.readyState = 1;
    FakeWebSocket.last!.onopen?.({});

    return { client, states, socket: FakeWebSocket.last! };
  };

  it("AC-619 with no token the first frame is the pairing request and says what is being waited for", () => {
    const { client, states, socket } = make("");

    expect(parseBridgeMessage(socket.sent[0])).toEqual({
      v: 1,
      type: "bridge:pair",
    });
    expect(socket.sent[0]).not.toContain("token");
    expect(states.find((state) => state.status === "connecting")?.message).toBe(
      PAIRING_WAITING,
    );

    client.disconnect();
  });

  it("AC-619 a refused pairing says what to do next, and a refused token still says its own", () => {
    const paired = make("");

    paired.socket.onclose?.({ code: BRIDGE_CLOSE_UNAUTHORIZED });

    const last = paired.states[paired.states.length - 1];

    expect(last.status).toBe("refused");
    expect(last.message).toBe(PAIRING_REFUSED);
    expect(last.message).toMatch(/Press Connect|paste the session token/);

    const withToken = make("a-token");

    expect(parseBridgeMessage(withToken.socket.sent[0])).toEqual({
      v: 1,
      type: "bridge:auth",
      token: "a-token",
    });

    withToken.socket.onclose?.({ code: BRIDGE_CLOSE_UNAUTHORIZED });

    const tokenLast = withToken.states[withToken.states.length - 1];

    expect(tokenLast.status).toBe("refused");
    expect(tokenLast.message).toContain("did not accept this token");
  });
});

describe("an extension from before the pairing", () => {
  // how the real old extensions answer a pair request, measured against the real 0.2.0 on 2026-11-11
  // (1007: it cannot read the message) and from the code of the first ones (1008: the first frame must be bridge:auth)
  const ANSWERS = [
    { code: 1007, reason: "not a bridge message" },
    {
      code: BRIDGE_CLOSE_UNAUTHORIZED,
      reason: "the first frame must be bridge:auth",
    },
  ];

  for (const answer of ANSWERS) {
    it(`AC-619 an old extension that closes with ${answer.code} "${answer.reason}" makes the page say the bridge is old and how to update it, once, and not retry`, async () => {
      const states: { status: string; message: string }[] = [];
      const sent: string[] = [];
      let sockets = 0;

      class OldExtensionSocket {
        readyState = 1;
        onopen: ((event: any) => void) | null = null;
        onmessage: ((event: { data: any }) => void) | null = null;
        onclose: ((event: any) => void) | null = null;
        onerror: ((event: any) => void) | null = null;

        constructor(public url: string) {
          sockets++;
          setTimeout(() => this.onopen?.({}), 0);
        }

        send(data: string) {
          sent.push(data);
          setTimeout(() => this.onclose?.(answer), 0);
        }

        close() {
          this.readyState = 3;
        }
      }

      const client = createBridgeClient({
        url: "ws://127.0.0.1:47511/",
        token: "",
        retryDelayMs: 5,
        WebSocketImpl: OldExtensionSocket as unknown as new (
          url: string,
        ) => WebSocketLike,
        onStateChange: (state) => states.push(state),
      });

      client.connect();

      for (
        let attempt = 0;
        attempt < 100 && states[states.length - 1]?.status !== "refused";
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      // long enough for a retry to have happened if there were one
      await new Promise((resolve) => setTimeout(resolve, 80));

      const last = states[states.length - 1];

      expect(parseBridgeMessage(sent[0])).toEqual({
        v: 1,
        type: "bridge:pair",
      });
      expect(last.status).toBe("refused");
      expect(last.message).toBe(PAIRING_OLD_EXTENSION);
      expect(last.message).toMatch(/old version/);
      expect(last.message).toMatch(/Set up my editor/);
      expect(last.message).not.toBe(PAIRING_REFUSED);
      // asked once: an old extension gives the same answer every time
      expect(sockets).toBe(1);
    });
  }

  it("AC-619 a close that is not the old extension's (a network drop) is still retried, and pairing with a token is not affected", async () => {
    const states: string[] = [];
    let sockets = 0;

    class DroppedSocket {
      readyState = 1;
      onopen: ((event: any) => void) | null = null;
      onmessage: ((event: { data: any }) => void) | null = null;
      onclose: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;

      constructor(public url: string) {
        sockets++;
        setTimeout(() => this.onopen?.({}), 0);
      }

      send() {
        setTimeout(() => this.onclose?.({ code: 1006, reason: "" }), 0);
      }

      close() {
        this.readyState = 3;
      }
    }

    const client = createBridgeClient({
      url: "ws://127.0.0.1:47511/",
      token: "",
      retryDelayMs: 5,
      maxRetryDelayMs: 10,
      WebSocketImpl: DroppedSocket as unknown as new (
        url: string,
      ) => WebSocketLike,
      onStateChange: (state) => states.push(state.status),
    });

    client.connect();
    await new Promise((resolve) => setTimeout(resolve, 120));
    client.disconnect();

    expect(sockets).toBeGreaterThan(1);
    expect(states).not.toContain("refused");
  });
});

describe("the editor's prompt", () => {
  const source = readFileSync(
    join(here, "..", "extension", "src", "extension.ts"),
    "utf8",
  );

  it("AC-619 the extension asks in a window the teacher must answer, remembers in its own memory, and can forget", () => {
    // a modal question with the one button Allow: closing it is a refusal
    expect(source).toMatch(
      /showInformationMessage\(\s*question,\s*\{\s*modal: true,/,
    );
    expect(source).toContain("PAIRING_ALLOW");
    expect(source).toMatch(/\)\) === PAIRING_ALLOW/);

    // the origins are kept in the editor's own global state, by one key
    expect(source).toContain('"excalidraw-bridge.pairedOrigins"');
    expect(source).toContain("context.globalState");

    // the bridge asks through it, and the teacher can take every origin back
    expect(source).toMatch(/onPair: \(origin\) => pairing\.decide\(origin\)/);
    expect(source).toContain('"excalidraw-bridge.forgetPairedWhiteboards"');

    const manifest = JSON.parse(
      readFileSync(join(here, "..", "extension", "package.json"), "utf8"),
    );

    expect(
      manifest.contributes.commands.map(
        (entry: { command: string }) => entry.command,
      ),
    ).toContain("excalidraw-bridge.forgetPairedWhiteboards");
  });
});
