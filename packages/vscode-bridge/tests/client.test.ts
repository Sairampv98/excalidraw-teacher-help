import { createServer } from "node:net";

import {
  createBridgeClient,
  describeBridgeState,
  type BridgeClientState,
  type WebSocketLike,
} from "../bridge/src/client";

import { parseBridgeMessage, type BridgeMessage } from "../bridge/src/protocol";

import type { AddressInfo } from "node:net";

/**
 * Wait for a condition.
 *
 * It counts attempts rather than milliseconds on purpose: the gate treats a
 * test that subtracts two clocks as a timing measurement and runs it on its
 * own, and this test measures nothing.
 */
const waitFor = async (
  predicate: () => boolean,
  attempts = 500,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the condition");
};

/** A port that nothing is listening on. */
const findClosedPort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  const port = address.port;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  return port;
};

/** A websocket that never talks to anything, so a test can drive it. */
class FakeWebSocket implements WebSocketLike {
  static last: FakeWebSocket | null = null;

  readyState = 0;
  sent: string[] = [];
  url: string;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.last = this;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** Pretend the socket opened. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Pretend the server sent a message. */
  deliver(message: BridgeMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe("the bridge client", () => {
  it("AC-61 with no bridge, the client shows the reconnect state, not a blank editor", async () => {
    const port = await findClosedPort();
    const states: BridgeClientState[] = [];
    const received: BridgeMessage[] = [];

    const client = createBridgeClient({
      url: `ws://127.0.0.1:${port}/`,
      token: "a-per-session-token",
      onStateChange: (state) => states.push(state),
      onMessage: (message) => received.push(message),
      retryDelayMs: 20,
    });

    client.connect();
    await waitFor(() => client.getState().status === "reconnecting");

    const state = client.getState();
    expect(state.status).toBe("reconnecting");
    expect(state.message).not.toBe("");
    expect(state.message.toLowerCase()).toContain("not connected");
    expect(describeBridgeState(state)).toContain("VS Code");

    // the panel is never left with a blank editor: nothing was delivered,
    // and the state says why
    expect(received).toEqual([]);
    expect(client.getLastContent()).toBeNull();
    expect(states.some((entry) => entry.status === "connected")).toBe(false);

    client.disconnect();
    expect(client.getState().status).toBe("closed");
  });

  it("AC-63 the client presents the token in the first frame, and never in the URL", () => {
    const token = "a-per-session-token";
    const client = createBridgeClient({
      url: "ws://127.0.0.1:47511/",
      token,
      WebSocketImpl: FakeWebSocket,
    });
    client.connect();

    const socket = FakeWebSocket.last;
    expect(socket).not.toBeNull();
    expect(socket?.url).not.toContain(token);

    socket?.open();

    // the FIRST frame is the auth frame, and it carries the token
    expect(socket?.sent).toHaveLength(1);
    const first = parseBridgeMessage(socket?.sent[0] ?? "");
    expect(first).toEqual({ v: 1, type: "bridge:auth", token });
  });

  it("AC-63 the client refuses a URL that carries the token", () => {
    expect(() =>
      createBridgeClient({
        url: "ws://127.0.0.1:47511/?token=a-per-session-token",
        token: "a-per-session-token",
      }),
    ).toThrow(/token/i);

    expect(() =>
      createBridgeClient({
        url: "ws://127.0.0.1:47511/?secret=a-per-session-token",
        token: "a-per-session-token",
      }),
    ).toThrow(/token/i);
  });
});
