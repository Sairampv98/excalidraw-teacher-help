/**
 * The app's side of the VS Code bridge: the session, and the **tab's** memory.
 *
 * The token is a secret, so it never leaves the tab: it is in memory, and in
 * the tab's `sessionStorage` - which survives a reload and dies with the tab
 * (D-111). It is never in `localStorage`, never in a URL and never in the
 * document (D-50).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderHook } from "@testing-library/react";

import {
  BRIDGE_SESSION_KEY,
  createBridgeSession,
  readSessionToken,
  writeSessionToken,
} from "../bridge/bridgeSession";
import { useBridgePanel } from "../bridge/useBridgePanel";

/**
 * A token that is **obviously** not a secret: the kit's secret scanner
 * exempts values that say they are a test, a fake or a placeholder.
 */
const TEST_TOKEN = "test-token-placeholder";

/** The bridge's URL. The token is never in it (D-50). */
const BRIDGE_URL = "ws://127.0.0.1:47511/";

/**
 * The socket the app opens, standing in for the browser's `WebSocket`.
 *
 * The bridge server is in the teacher's VS Code, so the app's side is tested
 * against a socket the test drives: the test opens it and reads what the app
 * sent back.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];

  readyState = 1;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: { data: any }) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  /** every frame the app sent */
  sent: string[] = [];

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({});
  }

  /** the socket opens */
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
}

/** The clipboard the field reads. */
const mockClipboard = (text: string) => {
  const clipboard = {
    read: vi.fn(async () => []),
    readText: vi.fn(async () => text),
    writeText: vi.fn(async () => undefined),
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard,
  });

  return clipboard;
};

/**
 * The keys a `Storage` holds.
 *
 * `Object.keys(storage)` is not the way: a `Storage` is not a plain object,
 * and its keys are not own enumerable properties. The spec's own way is
 * `length` and `key(i)`.
 */
const storageKeys = (storage: Storage): string[] => {
  const keys: string[] = [];

  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);

    if (key !== null) {
      keys.push(key);
    }
  }

  return keys;
};

/** Whether any value in the storage holds the token. */
const storageHolds = (storage: Storage, token: string): boolean =>
  storageKeys(storage).some((key) =>
    (storage.getItem(key) ?? "").includes(token),
  );

/** A session on the bridge's URL, with the socket the test drives. */
const session = () =>
  createBridgeSession({
    url: BRIDGE_URL,
    WebSocketImpl: FakeSocket,
  });

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  // every test starts with a tab that remembers nothing, and with an empty
  // local storage: neither is the place a token may live
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the app's bridge session", () => {
  it("AC-148 the token is restored from the tab's session memory after a reload", async () => {
    mockClipboard(TEST_TOKEN);

    const first = session();

    // the teacher pastes the token, once
    expect(await first.pasteToken()).toBe(TEST_TOKEN);

    // and the tab remembers it
    expect(sessionStorage.getItem(BRIDGE_SESSION_KEY)).toBe(TEST_TOKEN);
    expect(readSessionToken()).toBe(TEST_TOKEN);

    // The RELOAD: a new page, a new session, the same tab. The token is
    // there, so the teacher is not asked for it again (D-111).
    const afterReload = session();

    expect(afterReload.getToken()).toBe(TEST_TOKEN);
  });

  it("AC-148 the token is restored from the tab's session memory after a reload, and the app connects by itself", async () => {
    mockClipboard(TEST_TOKEN);

    expect(await session().pasteToken()).toBe(TEST_TOKEN);

    // The RELOAD, at the app's level: the page comes back, and the panel is
    // live again without the teacher pasting anything.
    FakeSocket.instances = [];

    const { result } = renderHook(() => useBridgePanel(null));

    // the field shows the token the tab remembers
    expect(result.current.bridge.token).toBe(TEST_TOKEN);

    // and the session connects by itself
    expect(FakeSocket.instances.length).toBe(1);
    expect(FakeSocket.instances[0].url).toBe(BRIDGE_URL);
  });

  it("AC-148 the token is never written to localStorage and never appears in a URL", async () => {
    mockClipboard(TEST_TOKEN);

    const app = session();

    expect(await app.pasteToken()).toBe(TEST_TOKEN);

    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];

    socket.open();

    // the token is NOT in the URL (D-50): a URL ends up in the browser's
    // history, in a proxy log and in a Referer header
    expect(socket.url).toBe(BRIDGE_URL);
    expect(socket.url).not.toContain(TEST_TOKEN);
    expect(window.location.href).not.toContain(TEST_TOKEN);

    // it is NOT in localStorage: that would outlive the tab
    expect(storageHolds(localStorage, TEST_TOKEN)).toBe(false);

    // nor in a cookie
    expect(document.cookie).not.toContain(TEST_TOKEN);

    // it IS in the tab's own session memory - that is the whole of D-111:
    // it survives a reload and dies with the tab
    expect(storageHolds(sessionStorage, TEST_TOKEN)).toBe(true);
  });

  it("AC-148 a browser with no session memory still takes the token from the clipboard", async () => {
    // a private window, or a storage API the browser refuses: asking for it
    // throws
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("the storage is blocked");
      },
      setItem: () => {
        throw new Error("the storage is blocked");
      },
      removeItem: () => {
        throw new Error("the storage is blocked");
      },
    });

    mockClipboard(TEST_TOKEN);

    const app = session();

    // nothing is remembered, and nothing throws
    expect(app.getToken()).toBe("");
    expect(readSessionToken()).toBe("");
    expect(writeSessionToken(TEST_TOKEN)).toBe(false);

    // the teacher pastes the token and it works, exactly as it does today
    expect(await app.pasteToken()).toBe(TEST_TOKEN);
    expect(app.getToken()).toBe(TEST_TOKEN);
    expect(FakeSocket.instances.length).toBe(1);
  });

  it("AC-148 a browser with no session storage at all still takes the token from the clipboard", async () => {
    // no storage API at all
    vi.stubGlobal("sessionStorage", undefined);

    mockClipboard(TEST_TOKEN);

    const app = session();

    expect(app.getToken()).toBe("");
    expect(readSessionToken()).toBe("");
    expect(writeSessionToken(TEST_TOKEN)).toBe(false);

    // the teacher pastes the token and it works
    expect(await app.pasteToken()).toBe(TEST_TOKEN);
    expect(app.getToken()).toBe(TEST_TOKEN);
    expect(FakeSocket.instances.length).toBe(1);
  });

  it("AC-148 a token the teacher clears is forgotten by the tab", () => {
    mockClipboard(TEST_TOKEN);

    const app = session();

    app.setToken(TEST_TOKEN);

    expect(sessionStorage.getItem(BRIDGE_SESSION_KEY)).toBe(TEST_TOKEN);

    // the teacher empties the field: the tab forgets it too, so the next
    // page does not offer a token that is no longer wanted
    app.setToken("");

    expect(sessionStorage.getItem(BRIDGE_SESSION_KEY)).toBe(null);
    expect(readSessionToken()).toBe("");
  });
});
