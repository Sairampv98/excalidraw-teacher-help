/**
 * The page's end of the link to the MCP server (D-397, D-398): it presents the
 * pairing code first, says it is connected only when the server has accepted it,
 * answers calls in order, and tells a refused code from a server that is not
 * there.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import {
  MCP_RETRY_FIRST_MS,
  MCP_RETRY_MAX_MS,
  createMcpClient,
} from "../mcp/client";
import { MCP_CLOSE_UNAUTHORIZED, MCP_MAX_MESSAGE_BYTES } from "../mcp/protocol";

import type { McpClientState, McpWebSocketLike } from "../mcp/client";
import type { McpRunOutcome } from "../mcp/runner";

class FakeSocket implements McpWebSocketLike {
  static all: FakeSocket[] = [];

  readyState = 0;
  sent: any[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** the server's side of it ends, with a code */
  serverCloses(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (
  onCall: (
    tool: string,
    args: unknown,
  ) => Promise<McpRunOutcome> = async () => ({
    ok: true,
    result: "done",
  }),
) => {
  FakeSocket.all = [];

  const states: McpClientState[] = [];
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  let allowChanges = true;
  const client = createMcpClient({
    url: "ws://127.0.0.1:47711",
    getCode: () => "ABCD2345",
    getState: () => ({ allowChanges, app: "test", features: ["canvas"] }),
    onCall,
    onStateChange: (state) => states.push(state),
    WebSocketImpl: FakeSocket,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, live: true };

      timers.push(timer);

      return timer;
    },
    clearTimer: (handle) => {
      (handle as { live: boolean }).live = false;
    },
  });

  return {
    client,
    states,
    timers,
    setAllow: (value: boolean) => {
      allowChanges = value;
    },
    last: () => FakeSocket.all[FakeSocket.all.length - 1],
  };
};

describe("the page's link to the MCP server", () => {
  it("AC-468 presents the pairing code first, and is connected only once the server says it is ready", () => {
    const { client, last, states } = setup();

    client.start();

    const socket = last();

    expect(socket.url).toBe("ws://127.0.0.1:47711");
    expect(client.state().status).toBe("connecting");

    socket.open();
    expect(socket.sent).toEqual([{ v: 1, type: "mcp:auth", code: "ABCD2345" }]);
    expect(client.state().status).toBe("connecting");

    socket.receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });
    expect(client.state().status).toBe("connected");
    expect(socket.sent[1]).toEqual({
      v: 1,
      type: "mcp:state",
      allowChanges: true,
      app: "test",
      features: ["canvas"],
    });
    expect(states.every((state) => state.message.length > 0)).toBe(true);
  });

  it("AC-468 tells the server again when Allow changes is turned off, and answers a ping", () => {
    const { client, last, setAllow } = setup();

    client.start();
    last().open();
    last().receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });

    setAllow(false);
    client.pushState();
    expect(last().sent[last().sent.length - 1]).toMatchObject({
      type: "mcp:state",
      allowChanges: false,
    });

    last().receive({ v: 1, type: "ping" });
    expect(last().sent[last().sent.length - 1]).toEqual({ v: 1, type: "pong" });
  });

  it("AC-468 runs the calls one at a time, in the order they came, and sends each answer back with its id", async () => {
    const order: string[] = [];
    const { client, last } = setup(async (tool) => {
      order.push(`start ${tool}`);
      await new Promise((resolve) =>
        setTimeout(resolve, tool === "slow" ? 30 : 0),
      );
      order.push(`end ${tool}`);

      return { ok: true, result: tool };
    });

    client.start();
    last().open();
    last().receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });
    last().receive({ v: 1, type: "mcp:call", id: "1", tool: "slow", args: {} });
    last().receive({ v: 1, type: "mcp:call", id: "2", tool: "fast", args: {} });

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(order).toEqual(["start slow", "end slow", "start fast", "end fast"]);

    const results = last().sent.filter(
      (message) => message.type === "mcp:result",
    );

    expect(results).toEqual([
      { v: 1, type: "mcp:result", id: "1", ok: true, result: "slow" },
      { v: 1, type: "mcp:result", id: "2", ok: true, result: "fast" },
    ]);
  });

  it("AC-468 a tool that throws is an error answer, and a call before the server is ready is not run", async () => {
    let ran = 0;
    const { client, last } = setup(async () => {
      ran += 1;
      throw new Error("boom");
    });

    client.start();
    last().open();
    last().receive({
      v: 1,
      type: "mcp:call",
      id: "early",
      tool: "t",
      args: {},
    });
    await flush();
    expect(ran).toBe(0);

    last().receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });
    last().receive({ v: 1, type: "mcp:call", id: "3", tool: "t", args: {} });
    await flush();
    await flush();

    expect(last().sent[last().sent.length - 1]).toEqual({
      v: 1,
      type: "mcp:result",
      id: "3",
      ok: false,
      error: { code: "failed", message: "boom" },
    });
  });

  it("AC-468 an answer too large for a message is an error that says to ask for less", async () => {
    const { client, last } = setup(async () => ({
      ok: true,
      result: "x".repeat(MCP_MAX_MESSAGE_BYTES + 10),
    }));

    client.start();
    last().open();
    last().receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });
    last().receive({ v: 1, type: "mcp:call", id: "big", tool: "t", args: {} });
    await flush();
    await flush();

    expect(last().sent[last().sent.length - 1]).toMatchObject({
      id: "big",
      ok: false,
      error: { code: "too-large" },
    });
  });

  it("AC-468 a code the server refuses is a state of its own and is not tried again, until the person starts again", () => {
    const { client, last, timers } = setup();

    client.start();
    last().open();
    last().serverCloses(MCP_CLOSE_UNAUTHORIZED);

    expect(client.state().status).toBe("refused");
    expect(client.state().message).toMatch(/did not accept/);
    expect(timers).toHaveLength(0);

    client.start();
    expect(FakeSocket.all).toHaveLength(2);
    expect(client.state().status).toBe("connecting");
  });

  it("AC-468 a server that is not there is tried again, slower each time up to a limit, and stopping ends it", () => {
    const { client, timers, last } = setup();

    client.start();
    last().serverCloses(1006);

    expect(client.state().status).toBe("connecting");
    expect(timers.map((timer) => timer.ms)).toEqual([MCP_RETRY_FIRST_MS]);

    for (let i = 0; i < 8; i++) {
      timers[timers.length - 1].fn();
      last().serverCloses(1006);
    }

    const waits = timers.map((timer) => timer.ms);

    expect(waits.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
    expect(Math.max(...waits)).toBe(MCP_RETRY_MAX_MS);
    expect(client.state().message).toMatch(
      /Waiting for the assistant's server/,
    );

    client.stop();
    expect(client.state().status).toBe("idle");
    expect(timers[timers.length - 1].live).toBe(false);
    expect(FakeSocket.all.length).toBe(9);
  });

  it("AC-468 after a connection that worked and went away it connects again from the first wait", () => {
    const { client, timers, last } = setup();

    client.start();
    last().open();
    last().receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });
    last().serverCloses(1006);

    expect(client.state().status).toBe("connecting");
    expect(timers[timers.length - 1].ms).toBe(MCP_RETRY_FIRST_MS);
  });
});
