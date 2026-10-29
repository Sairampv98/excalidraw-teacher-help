/**
 * The **VS Code mirror** panel: its states, the tools in its own header, and
 * where the bridge's field and the screenshot and the read live (D-331, D-332).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  ExcalidrawPanelElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { Excalidraw } from "../index";
import { codePanelContent, emptyCodePanelState } from "../scene/panelContent";
import { mirrorPanelView } from "../scene/mirrorPanelView";
import { clearAllPanelCaptures, setPanelCapture } from "../scene/panelFrames";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { PanelCapture } from "../scene/panelFrames";
import type { MirrorBridgePhase } from "../scene/mirrorPanelView";

const STREAM = "http://127.0.0.1:47511/s/a-capability/frame";

/** A VS Code mirror: a code panel of the bridge's kind (D-331). */
const mirror = (): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "code",
    panel: codePanelContent(emptyCodePanelState(), "session-1"),
    posterMode: false,
    posterFileId: null,
  }) as unknown as ExcalidrawPanelElement;

const asElement = (panel: ExcalidrawPanelElement) =>
  panel as unknown as NonDeletedExcalidrawElement;

const bridge = (
  status: "not-connected" | "connected" | "rejected",
  phase: MirrorBridgePhase,
) => ({
  status,
  phase,
  message: `state: ${phase}`,
  token: "",
});

const live: PanelCapture = { status: "live", streamUrl: STREAM };

describe("the VS Code mirror's states", () => {
  it("AC-383 the mirror is in exactly one state, and the state is a rule", () => {
    const rule = (
      bridgeInput: Parameters<typeof mirrorPanelView>[0]["bridge"],
      capture: PanelCapture | null,
      readOnly = false,
    ) => mirrorPanelView({ readOnly, bridge: bridgeInput, capture });

    // not connected: what the page is doing says the state
    expect(rule(bridge("not-connected", "connecting"), null)).toBe(
      "connecting",
    );
    expect(rule(bridge("rejected", "reconnecting"), null)).toBe("looking");
    expect(rule(bridge("rejected", "refused"), null)).toBe("refused");
    expect(rule(bridge("not-connected", "idle"), null)).toBe("token");
    expect(rule(bridge("not-connected", "closed"), null)).toBe("token");

    // a host that does not name the phase: a try that did not work is
    // "looking", a connection never tried is "token"
    expect(rule({ status: "rejected" }, null)).toBe("looking");
    expect(rule({ status: "not-connected" }, null)).toBe("token");

    // connected: the editor's own say
    expect(rule(bridge("connected", "connected"), null)).toBe("waiting");
    expect(rule(bridge("connected", "connected"), live)).toBe("live");
    expect(
      rule(bridge("connected", "connected"), {
        status: "unavailable",
        reason: "no window",
      }),
    ).toBe("unavailable");

    // the presenter and a host with no bridge have no connection to say
    // anything about: the registry's picture is what there is
    expect(rule(undefined, live)).toBe("live");
    expect(rule(undefined, null)).toBe("waiting");
    expect(rule(bridge("not-connected", "idle"), live, true)).toBe("live");
    expect(rule(bridge("not-connected", "idle"), null, true)).toBe("waiting");
  });

  it("AC-384 the mirror moves between its states: a spinner, an error, the live window", async () => {
    const panel = mirror();

    const { rerender } = await render(
      <Excalidraw panelBridge={bridge("not-connected", "connecting")} />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    const view = () =>
      document
        .querySelector('[data-testid="mirror-panel-status"]')
        ?.getAttribute("data-view");

    // opening the connection: a wheel and a sentence under it
    expect(view()).toBe("connecting");
    expect(
      document.querySelector('[data-testid="mirror-panel-spinner"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="mirror-panel-message"]')!
        .textContent,
    ).not.toBe("");

    // the extension did not accept the token: an error icon and a sentence
    rerender(<Excalidraw panelBridge={bridge("rejected", "refused")} />);

    await waitFor(() => expect(view()).toBe("refused"));
    expect(
      document.querySelector('[data-testid="mirror-panel-spinner"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-testid="mirror-panel-error-icon"]'),
    ).not.toBeNull();

    // connected, and the window has not come yet: the wheel again
    rerender(<Excalidraw panelBridge={bridge("connected", "connected")} />);

    await waitFor(() => expect(view()).toBe("waiting"));
    expect(
      document.querySelector('[data-testid="mirror-panel-spinner"]'),
    ).not.toBeNull();

    // the window arrives: the picture, and nothing else in the body
    act(() => {
      setPanelCapture(panel.id, live);
    });

    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="code-panel"]')
          ?.getAttribute("data-view"),
      ).toBe("live"),
    );
    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="mirror-panel-status"]'),
    ).toBeNull();

    // the connection drops: the picture goes and the state says why
    rerender(<Excalidraw panelBridge={bridge("rejected", "reconnecting")} />);

    await waitFor(() => expect(view()).toBe("looking"));
    expect(
      document.querySelector('[data-testid="code-panel-live-frame"]'),
    ).toBeNull();

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-384 the mirror has no run bar and no output console", async () => {
    const panel = mirror();

    await render(<Excalidraw panelBridge={bridge("connected", "connected")} />);

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    act(() => {
      setPanelCapture(panel.id, live);
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-frame"]'),
      ).not.toBeNull(),
    );

    for (const testId of [
      "code-panel-run",
      "code-panel-output",
      "code-panel-console",
      "code-panel-consolebox",
      "code-panel-divider",
      "code-panel-view-toggle",
    ]) {
      expect(document.querySelector(`[data-testid="${testId}"]`)).toBeNull();
    }

    act(() => {
      clearAllPanelCaptures();
    });
  });
});

describe("the tools of the VS Code mirror", () => {
  it("AC-385 the screenshot and the read are in the mirror's own header, with no selection", async () => {
    const panel = mirror();
    const onCapture = vi.fn();
    const onOcr = vi.fn();

    await render(
      <Excalidraw
        panelBridge={bridge("connected", "connected")}
        panelScreenshot={{ onCapture }}
        panelOcr={{ message: "Read the window's text.", onOcr }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    // nothing is selected, and the tools are not there while there is no
    // picture to take or to read
    expect(
      document.querySelector('[data-testid="mirror-panel-screenshot"]'),
    ).toBeNull();

    act(() => {
      setPanelCapture(panel.id, live);
    });

    const header = await waitFor(() => {
      const found = document.querySelector(
        '[data-testid="mirror-panel-header"]',
      );

      expect(found).not.toBeNull();

      return found!;
    });

    const camera = header.querySelector(
      '[data-testid="mirror-panel-screenshot"]',
    ) as HTMLButtonElement | null;
    const read = header.querySelector(
      '[data-testid="mirror-panel-read"]',
    ) as HTMLButtonElement | null;

    expect(camera).not.toBeNull();
    expect(read).not.toBeNull();

    // and they work: the host is asked for the picture and for the read
    fireEvent.click(camera!);
    fireEvent.click(read!);

    expect(onCapture).toHaveBeenCalledWith(panel.id);
    expect(onOcr).toHaveBeenCalledWith(panel.id);

    // the header also carries the mode, the control, the park and the full
    // screen of the mirror
    for (const testId of ["code-panel-mirror-modes", "code-panel-fullscreen"]) {
      expect(header.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    }

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-386 the properties panel keeps the screenshot and the read, and the bridge field is not in it", async () => {
    const panel = mirror();

    const { container } = await render(
      <Excalidraw
        panelBridge={bridge("connected", "connected")}
        panelScreenshot={{ onCapture: () => undefined }}
        panelOcr={{ message: "Read.", onOcr: () => undefined }}
      />,
    );

    API.setAppState({
      width: 1000,
      height: 1000,
      selectedElementIds: { [panel.id]: true },
    });
    API.setElements([asElement(panel)]);

    const actions = await waitFor(() => {
      const found = container.querySelector(
        '[data-testid="panel-actions"]',
      ) as HTMLElement | null;

      expect(found).not.toBeNull();

      return found!;
    });

    // the backup: the camera and the read are in the properties too
    expect(
      actions.querySelector('[data-testid="panel-screenshot-button"]'),
    ).not.toBeNull();
    expect(
      actions.querySelector('[data-testid="panel-ocr-button"]'),
    ).not.toBeNull();

    // and the token's field is not: it is in the mirror, where it is needed
    expect(actions.querySelector('[data-testid="panel-bridge"]')).toBeNull();
    expect(
      actions.querySelector('[data-testid="panel-bridge-token"]'),
    ).toBeNull();
  });
});
