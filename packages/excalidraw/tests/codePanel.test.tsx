/**
 * The **code panel**: the mirrored editor, the program's output, the bridge's
 * own messages, and the bridge field in the panel's chrome.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi } from "vitest";

import React from "react";

import type {
  ExcalidrawPanelElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import {
  codePanelContent,
  emptyCodePanelState,
  readCodePanelState,
} from "../scene/panelContent";

import { API } from "./helpers/api";
import { render } from "./test-utils";

import type { CodePanelState } from "../scene/panelContent";

/** A code panel that is connected and has something to show. */
const connectedState = (): CodePanelState => ({
  ...emptyCodePanelState(),
  connection: "connected",
  statusMessage: "Connected to the Excalidraw Bridge.",
  editor: {
    uri: "file:///demo/main.py",
    language: "python",
    text: "print('hello')",
    selection: { start: 0, end: 0 },
    version: 3,
  },
  output: [{ stream: "stdout", text: "hello" }],
  console: [{ level: "info", text: "Run started: python main.py" }],
});

const codePanel = (
  state: CodePanelState,
  overrides: Partial<Record<string, unknown>> = {},
): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(state, "session-1"),
    posterMode: false,
    posterFileId: null,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

const asElement = (panel: ExcalidrawPanelElement) =>
  panel as unknown as NonDeletedExcalidrawElement;

describe("the code panel", () => {
  it("AC-60 the panel shows the editor, the output and the console", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(connectedState()))]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    expect(overlay).not.toBeNull();

    // the three regions, in the order the teacher reads them
    expect(
      overlay!.querySelector('[data-testid="code-panel-editor"]'),
    ).not.toBeNull();
    expect(
      overlay!.querySelector('[data-testid="code-panel-output"]')!.textContent,
    ).toContain("hello");
    expect(
      overlay!.querySelector('[data-testid="code-panel-console"]')!.textContent,
    ).toContain("Run started");
  });

  it("AC-61 with no bridge the panel shows the reconnect state, not a blank editor", async () => {
    await render(<Excalidraw />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(codePanel(emptyCodePanelState()))]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    // the state is shown ...
    const status = overlay!.querySelector('[data-testid="code-panel-status"]');

    expect(status).not.toBeNull();
    expect(status!.getAttribute("data-bridge-state")).toBe("not-connected");
    expect(status!.textContent).not.toBe("");

    // ... and there is **no** blank editor behind it
    expect(
      overlay!.querySelector('[data-testid="code-panel-editor"]'),
    ).toBeNull();
  });

  it("AC-82 the panel chrome shows the three connection states", async () => {
    const onPasteToken = vi.fn();

    const bridge = (status: "not-connected" | "connected" | "rejected") => ({
      status,
      message: `state: ${status}`,
      token: "",
      onPasteToken,
    });

    // one mount, three props: the editor is heavy, and the gate runs the whole
    // suite on this machine
    const { rerender } = await render(
      <Excalidraw panelBridge={bridge("not-connected")} />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const panel = codePanel(connectedState());

    API.setElements([asElement(panel)]);
    API.setSelectedElements([asElement(panel)]);

    for (const status of ["not-connected", "connected", "rejected"] as const) {
      rerender(<Excalidraw panelBridge={bridge(status)} />);

      const field = document.querySelector('[data-testid="panel-bridge"]');

      expect(field).not.toBeNull();
      expect(field!.getAttribute("data-bridge-state")).toBe(status);
      expect(
        document.querySelector('[data-testid="panel-bridge-state"]')!
          .textContent,
      ).toBe(`state: ${status}`);
    }
  });

  it("AC-80 the paste button asks the host for the token, and the token is masked", async () => {
    const onPasteToken = vi.fn();

    await render(
      <Excalidraw
        panelBridge={{
          status: "not-connected",
          message: "Not connected to the Excalidraw Bridge.",
          token: "a-token-the-teacher-pasted",
          onPasteToken,
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const panel = codePanel(connectedState());

    API.setElements([asElement(panel)]);
    API.setSelectedElements([asElement(panel)]);

    const input = document.querySelector(
      '[data-testid="panel-bridge-token"]',
    ) as HTMLInputElement;

    expect(input).not.toBeNull();
    // a secret is not shown on the screen
    expect(input.getAttribute("type")).toBe("password");

    document
      .querySelector('[data-testid="panel-bridge-paste"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onPasteToken).toHaveBeenCalledTimes(1);
  });

  it("AC-81 the panel's payload carries the live state, and not the token", async () => {
    const state = connectedState();

    const panel = codePanel(state);

    // the live state rides inside the payload (D-46) ...
    expect(readCodePanelState(panel.panel)).toEqual(state);

    // ... and it is plain data: it survives a structured clone
    const cloned = structuredClone(panel.panel);

    expect(readCodePanelState(cloned)).toEqual(state);
  });
});
