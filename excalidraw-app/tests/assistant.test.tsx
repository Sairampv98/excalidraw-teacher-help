/**
 * The Assistant tab and the link it keeps (D-398, D-399): the person types the
 * pairing code once, the page connects to the assistant's server with it, runs
 * what the server asks against the real editor, says what it did, and obeys the
 * Allow changes switch.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { Excalidraw } from "@excalidraw/excalidraw";
import { MCP_CLOSE_UNAUTHORIZED } from "@excalidraw/excalidraw/mcp/protocol";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import { Provider, appJotaiStore } from "../app-jotai";
import { AssistantLink } from "../assistant/AssistantLink";
import {
  ASSISTANT_ALLOW_KEY,
  ASSISTANT_CODE_KEY,
  ASSISTANT_ENABLED_KEY,
  assistantActivityAtom,
  assistantAllowAtom,
  assistantCodeAtom,
  assistantEnabledAtom,
} from "../assistant/assistantState";
import { AssistantTab } from "../sidebar/AssistantTab";

const { h } = window;

class FakeSocket {
  static all: FakeSocket[] = [];

  readyState = 0;
  sent: any[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
    // the connection opens a moment after it is asked for
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
    }, 0);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const last = () => FakeSocket.all[FakeSocket.all.length - 1];

const renderAssistant = async () =>
  render(
    <Provider store={appJotaiStore}>
      <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
        <AssistantLink />
        <AssistantTab />
      </Excalidraw>
    </Provider>,
  );

const pairWith = (
  getByTestId: (id: string) => HTMLElement,
  code = "abcd-2345",
) => {
  fireEvent.change(getByTestId("assistant-code-input"), {
    target: { value: code },
  });
  fireEvent.click(getByTestId("assistant-connect"));
};

beforeEach(() => {
  localStorage.clear();
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  act(() => {
    appJotaiStore.set(assistantCodeAtom, "");
    appJotaiStore.set(assistantEnabledAtom, false);
    appJotaiStore.set(assistantAllowAtom, true);
    appJotaiStore.set(assistantActivityAtom, []);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Assistant tab", () => {
  it("AC-469 starts not connected, and connects with the code typed - kept as the system wants it - to the fixed loopback address", async () => {
    const { getByTestId } = await renderAssistant();

    expect(getByTestId("assistant-status").textContent).toMatch(
      /Not connected/,
    );
    expect(getByTestId("assistant-connect")).toBeDisabled();
    expect(FakeSocket.all).toHaveLength(0);

    pairWith(getByTestId);

    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    expect(last().url).toBe("ws://127.0.0.1:47711");
    expect(localStorage.getItem(ASSISTANT_CODE_KEY)).toBe("ABCD2345");
    expect(localStorage.getItem(ASSISTANT_ENABLED_KEY)).toBe("1");

    await waitFor(() =>
      expect(last().sent[0]).toEqual({
        v: 1,
        type: "mcp:auth",
        code: "ABCD2345",
      }),
    );
    // not connected until the server says it is ready
    expect(getByTestId("assistant-status").dataset.status).toBe("connecting");

    act(() => {
      last().receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });
    });

    expect(getByTestId("assistant-status").dataset.status).toBe("connected");
    expect(last().sent[1]).toMatchObject({
      type: "mcp:state",
      allowChanges: true,
      app: "Excalidraw classroom",
    });
  });

  it("AC-469 says when the server did not accept the code, and Disconnect turns the link off", async () => {
    const { getByTestId } = await renderAssistant();

    pairWith(getByTestId, "WRONG234");
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    await waitFor(() => expect(last().sent).toHaveLength(1));

    act(() => {
      last().readyState = 3;
      last().onclose?.({ code: MCP_CLOSE_UNAUTHORIZED });
    });

    expect(getByTestId("assistant-status").dataset.status).toBe("refused");
    expect(getByTestId("assistant-status").textContent).toMatch(
      /did not accept/,
    );

    pairWith(getByTestId, "ABCD2345");
    await waitFor(() => expect(FakeSocket.all).toHaveLength(2));

    fireEvent.click(getByTestId("assistant-disconnect"));

    await waitFor(() =>
      expect(getByTestId("assistant-status").dataset.status).toBe("idle"),
    );
    expect(localStorage.getItem(ASSISTANT_ENABLED_KEY)).toBe("0");
  });

  it("AC-469 a code that was kept connects when the app opens, with nothing typed", async () => {
    act(() => {
      appJotaiStore.set(assistantCodeAtom, "KEPT2345");
      appJotaiStore.set(assistantEnabledAtom, true);
    });

    await renderAssistant();
    await waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    await waitFor(() =>
      expect(last().sent[0]).toMatchObject({
        type: "mcp:auth",
        code: "KEPT2345",
      }),
    );
  });
});

describe("the link, with the editor", () => {
  const connected = async () => {
    const view = await renderAssistant();

    pairWith(view.getByTestId);
    await waitFor(() => expect(last()?.sent.length).toBeGreaterThan(0));
    act(() => {
      last().receive({ v: 1, type: "mcp:ready", server: "s", version: "1" });
    });

    return view;
  };

  const call = async (tool: string, args: unknown, id = tool) => {
    const before = last().sent.length;

    act(() => {
      last().receive({ v: 1, type: "mcp:call", id, tool, args });
    });

    await waitFor(() => expect(last().sent.length).toBeGreaterThan(before));

    return last().sent[last().sent.length - 1];
  };

  it("AC-470 runs what the server asks against the editor and sends the answer back, and lists it under what it did", async () => {
    const { getByTestId } = await connected();

    const pages = await call("list_pages", {});

    expect(pages).toMatchObject({
      type: "mcp:result",
      id: "list_pages",
      ok: true,
    });
    expect(pages.result.pages[0]).toMatchObject({ page: 1, width: 1920 });

    const created = await call("create_elements", {
      elements: [
        { type: "rectangle", id: "r", x: 10, y: 10, width: 100, height: 100 },
      ],
    });

    expect(created).toMatchObject({ ok: true });
    expect(h.elements.some((element) => element.id === "r")).toBe(true);

    const activity = getByTestId("assistant-activity").textContent;

    expect(activity).toMatch(/create_elements: 1 element/);
    expect(activity).toMatch(/list_pages/);
    // the person is told on the board
    expect(h.state.toast?.message).toMatch(
      /Assistant: create_elements: 1 element/,
    );
  });

  it("AC-470 an Allow changes that is off refuses the change, says so under what it did, and the server is told when it is turned off", async () => {
    const { getByTestId } = await connected();

    fireEvent.click(getByTestId("assistant-allow"));

    expect(localStorage.getItem(ASSISTANT_ALLOW_KEY)).toBe("0");
    await waitFor(() =>
      expect(last().sent[last().sent.length - 1]).toMatchObject({
        type: "mcp:state",
        allowChanges: false,
      }),
    );

    const refused = await call("create_elements", {
      elements: [{ type: "rectangle", id: "no", x: 0, y: 0 }],
    });

    expect(refused).toMatchObject({
      ok: false,
      error: { code: "changes-not-allowed" },
    });
    expect(h.elements.some((element) => element.id === "no")).toBe(false);
    expect(getByTestId("assistant-activity").textContent).toMatch(
      /changes-not-allowed/,
    );

    // reading still works
    expect(await call("list_pages", {}, "again")).toMatchObject({ ok: true });
  });
});
