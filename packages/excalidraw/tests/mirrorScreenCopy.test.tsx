/**
 * The mirror panel says so when its picture is a **copy of the screen**
 * (Windows 7, D-493, AC-591): the window must be visible and not covered.
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
import { clearAllPanelCaptures, setPanelCapture } from "../scene/panelFrames";

import { API } from "./helpers/api";
import { act, fireEvent, render, waitFor } from "./test-utils";

import type { PanelCapture } from "../scene/panelFrames";

const STREAM = "http://127.0.0.1:47511/s/a-capability/frame";

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

const note = () =>
  document.querySelector('[data-testid="code-panel-screen-copy"]');

describe("the screen copy note", () => {
  it("AC-591 the panel says the window must be visible and not covered while the picture is a copy, and says nothing otherwise", async () => {
    const panel = mirror();

    await render(
      <Excalidraw
        panelBridge={{
          status: "connected",
          phase: "connected",
          message: "state: connected",
          token: "",
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    const live: PanelCapture = { status: "live", streamUrl: STREAM };

    act(() => {
      setPanelCapture(panel.id, live);
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="code-panel-live-window"]'),
      ).not.toBeNull(),
    );

    // a picture of the window itself: nothing to say
    expect(note()).toBeNull();

    // a copy of the screen: the teacher is told what it needs
    act(() => {
      setPanelCapture(panel.id, { ...live, screenCopy: true });
    });

    await waitFor(() => expect(note()).not.toBeNull());
    expect(note()?.textContent).toMatch(/visible/i);
    expect(note()?.textContent).toMatch(/not covered/i);
    expect(note()?.getAttribute("role")).toBe("status");

    // and when the window draws itself again, the note goes
    act(() => {
      setPanelCapture(panel.id, live);
    });

    await waitFor(() => expect(note()).toBeNull());

    act(() => {
      clearAllPanelCaptures();
    });
  });

  it("AC-591 while the picture is a copy of the screen the window cannot be parked out of sight, and the button says why", async () => {
    const panel = mirror();
    const onWindow = vi.fn();

    await render(
      <Excalidraw
        panelControl={{ onToggle: vi.fn(), onInput: vi.fn(), onWindow }}
        panelMirror={{ onChange: vi.fn() }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });
    API.setElements([asElement(panel)]);

    const live: PanelCapture = {
      status: "live",
      streamUrl: STREAM,
      width: 1000,
      height: 500,
      control: { enabled: false, route: "background", reason: "" },
    };

    act(() => {
      setPanelCapture(panel.id, { ...live, screenCopy: true });
    });

    const park = (await waitFor(() => {
      const found = document.querySelector('[data-testid="code-panel-park"]');

      expect(found).not.toBeNull();

      return found;
    })) as HTMLButtonElement;

    expect(park.disabled).toBe(true);
    expect(park.getAttribute("title")).toMatch(/copy of the screen/i);

    fireEvent.click(park);
    expect(onWindow).not.toHaveBeenCalled();

    // an ordinary picture: the button parks again
    act(() => {
      setPanelCapture(panel.id, live);
    });

    await waitFor(() => expect(park.disabled).toBe(false));

    act(() => {
      clearAllPanelCaptures();
    });
  });
});
