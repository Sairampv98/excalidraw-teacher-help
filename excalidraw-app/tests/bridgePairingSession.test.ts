/**
 * AC-619 - the app's side of the pairing (D-518): with no token the page asks
 * the editor to pair it, the tab remembers that it was allowed, and a refusal
 * is not asked again by itself.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BRIDGE_PAIRED_KEY,
  createBridgeSession,
  readPaired,
  writePaired,
} from "../bridge/bridgeSession";

import {
  BRIDGE_CLOSE_UNAUTHORIZED,
  parseBridgeMessage,
} from "../../packages/vscode-bridge/bridge/src/protocol";

class FakeSocket {
  static instances: FakeSocket[] = [];

  readyState = 1;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }
}

const HELLO = JSON.stringify({
  v: 1,
  type: "bridge:hello",
  version: "0.2.1",
  workspace: "class",
  streamUrl: "http://127.0.0.1:47511/s/cap/frame",
});

const last = () => FakeSocket.instances[FakeSocket.instances.length - 1];

const session = () =>
  createBridgeSession({
    url: "ws://127.0.0.1:47511/",
    WebSocketImpl: FakeSocket as any,
  });

beforeEach(() => {
  FakeSocket.instances = [];
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("AC-619 the page without a token", () => {
  it("AC-619 Connect with an empty field asks the editor to pair the page, and sends no token", () => {
    const connection = session();

    expect(connection.getToken()).toBe("");

    connection.connect();
    last().onopen?.({});

    expect(FakeSocket.instances).toHaveLength(1);
    expect(parseBridgeMessage(last().sent[0])).toEqual({
      v: 1,
      type: "bridge:pair",
    });
    expect(connection.getState().message).toMatch(/Allow/);
  });

  it("AC-619 when the editor allows it the tab remembers that, and a new session connects by asking again", () => {
    const connection = session();

    expect(connection.wasPaired()).toBe(false);

    connection.connect();
    last().onopen?.({});
    last().onmessage?.({ data: HELLO });

    expect(connection.getState().connection).toBe("connected");
    expect(readPaired()).toBe(true);
    expect(window.sessionStorage.getItem(BRIDGE_PAIRED_KEY)).toBe("yes");
    // only "yes": no secret is kept
    expect(window.sessionStorage.getItem("excalidraw-bridge.token")).toBeNull();
    expect(session().wasPaired()).toBe(true);
  });

  it("AC-619 when the editor refuses, the page says what to do and is not asked again by itself", () => {
    writePaired(true);

    const connection = session();

    connection.connect();
    last().onopen?.({});
    last().onclose?.({ code: BRIDGE_CLOSE_UNAUTHORIZED });

    const state = connection.getState();

    expect(state.connection).toBe("rejected");
    expect(state.message).toMatch(/did not allow the whiteboard/);
    expect(state.message).toMatch(/Press Connect|paste the session token/);

    // the next reload does not ask by itself
    expect(readPaired()).toBe(false);
  });

  it("AC-619 with a token nothing about pairing happens", () => {
    const connection = session();

    connection.setToken("test-token-placeholder");
    connection.connect();
    last().onopen?.({});
    last().onmessage?.({ data: HELLO });

    expect(parseBridgeMessage(last().sent[0])).toEqual({
      v: 1,
      type: "bridge:auth",
      token: "test-token-placeholder",
    });
    expect(readPaired()).toBe(false);
  });

  it("AC-619 a storage that throws is no memory, and nothing breaks", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    try {
      expect(readPaired()).toBe(false);
      expect(() => writePaired(true)).not.toThrow();
      expect(session().wasPaired()).toBe(false);
    } finally {
      Object.defineProperty(window, "sessionStorage", original!);
    }
  });
});
