/**
 * The presenter view, **end to end** (D-141).
 *
 * The other presenter tests cover the pieces: the camera maths
 * (`presenterCamera.test.ts`), the files path (`presenterFiles.test.tsx`), the
 * panels (`presenterPanels.test.tsx`), the media (`presenterMedia.test.ts`) and
 * the pointer (`presenterPointer.test.ts`). None of them answers the question
 * the owner actually asked - *"somehow the presenter view is dead"* - which is
 * whether the presenter's own window shows the teacher's canvas at all.
 *
 * So this file plays **both sides of the channel**: the editor (an `Excalidraw`
 * with the broadcaster mounted and wired the way the app wires it) and the
 * presenter (the real `PresenterView`), and asserts that the presenter's own
 * app instance ends up on the teacher's scene, on the teacher's page.
 *
 * AC-177: the presenter view opens and shows the current scene, follows the
 *         page the teacher is on, and its own controls work.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import React from "react";

import {
  act,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import {
  Excalidraw,
  ExcalidrawAPIProvider,
  getCurrentPageRect,
} from "@excalidraw/excalidraw";

import { newElementWith } from "@excalidraw/element";

import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { AppState } from "@excalidraw/excalidraw/types";

import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import { PresenterView } from "../presenter/PresenterView";
import { usePresenterBroadcaster } from "../presenter/usePresenterBroadcaster";

const PAGE_ONE = "page-1";
const PAGE_TWO = "page-2";

/** the viewport both windows are given - jsdom has no layout of its own */
const VIEWPORT = {
  width: 1920,
  height: 1080,
  top: 0,
  left: 0,
  bottom: 1080,
  right: 1920,
};

/**
 * The bits of the presenter's app instance this file looks at.
 *
 * `window.h` is the library's test hook: `h.app` is the app instance that was
 * mounted last, so it is the presenter's own instance after the presenter is
 * rendered.
 */
type PresenterApp = {
  state: { currentPageId: string; viewModeEnabled: boolean; pages: unknown };
  visibleElements: { id: string }[];
  getSceneElements: () => { id: string; pageId: string }[];
};

const presenterApp = () => window.h.app as unknown as PresenterApp;

/**
 * A stand-in for the browser's `BroadcastChannel`.
 *
 * Unlike the one in `presenterFiles.test.tsx`, this one **delivers**: a
 * message posted on one channel arrives on every other channel of the same
 * name, exactly like the browser does (a channel never receives its own
 * messages). That is what makes this file an end-to-end test rather than a
 * test of one side.
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  onmessage: ((event: { data: unknown }) => void) | null = null;

  posted: unknown[] = [];

  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    this.posted.push(data);

    for (const other of FakeBroadcastChannel.instances) {
      if (other === this || other.name !== this.name) {
        continue;
      }

      // the browser delivers a message in a task, not synchronously
      setTimeout(() => {
        other.onmessage?.({ data });
      }, 0);
    }
  }

  close() {}
}

/**
 * The editor's side, wired the way `excalidraw-app/App.tsx` wires it: the
 * broadcaster publishes the scene on every change of the editor's app state.
 */
let publishScene:
  | ((
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
    ) => void)
  | null = null;

const Broadcaster = () => {
  const broadcaster = usePresenterBroadcaster(true);

  publishScene = broadcaster.publishScene;

  return null;
};

const pages = [
  { id: PAGE_ONE, name: "Page 1" },
  { id: PAGE_TWO, name: "Page 2" },
];

const rectangleOnPage = (pageId: string) => {
  const rect = getCurrentPageRect(pages, pageId);

  return newElementWith(
    API.createElement({
      type: "rectangle",
      x: rect.x + 100,
      y: rect.y + 100,
      width: 200,
      height: 120,
    }),
    { pageId },
  );
};

const ellipseOnPage = (pageId: string) => {
  const rect = getCurrentPageRect(pages, pageId);

  return newElementWith(
    API.createElement({
      type: "ellipse",
      x: rect.x + 400,
      y: rect.y + 300,
      width: 160,
      height: 160,
    }),
    { pageId },
  );
};

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  publishScene = null;
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  mockBoundingClientRect(VIEWPORT);
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreOriginalGetBoundingClientRect();
});

describe("the presenter view", () => {
  it("AC-177 the presenter view opens and shows the current scene", async () => {
    const rect = rectangleOnPage(PAGE_ONE);

    // -------------------------------------------------------------------------
    // the teacher: a canvas with one rectangle on it
    // -------------------------------------------------------------------------
    await render(
      <Excalidraw
        initialData={{
          elements: [rect] as never,
          appState: { pages, currentPageId: PAGE_ONE } as never,
        }}
        onChange={(elements, appState) => publishScene?.(elements, appState)}
      >
        <Broadcaster />
      </Excalidraw>,
    );

    // -------------------------------------------------------------------------
    // the presenter: its own window, its own Excalidraw
    // -------------------------------------------------------------------------
    await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    const presenter = presenterApp();

    // the presenter announced itself ...
    expect(
      FakeBroadcastChannel.instances.some((channel) =>
        channel.posted.some(
          (message) =>
            (message as { type?: string }).type === "presenter:hello",
        ),
      ),
    ).toBe(true);

    // ... and the teacher's canvas arrived in it
    await waitFor(() => {
      expect(presenter.getSceneElements().map((element) => element.id)).toEqual(
        [rect.id],
      );
    });

    // the presenter's window is a **mirror**, not an editor of its own
    expect(presenter.state.viewModeEnabled).toBe(true);
  });

  it("AC-177 the presenter view follows the page the teacher is on", async () => {
    const rect = rectangleOnPage(PAGE_ONE);
    const ellipseOnPageTwo = ellipseOnPage(PAGE_TWO);

    // -------------------------------------------------------------------------
    // the teacher: two pages, and the teacher is on the **second** one
    // -------------------------------------------------------------------------
    await render(
      <Excalidraw
        initialData={{
          elements: [rect, ellipseOnPageTwo] as never,
          appState: { pages, currentPageId: PAGE_TWO } as never,
        }}
        onChange={(elements, appState) => publishScene?.(elements, appState)}
      >
        <Broadcaster />
      </Excalidraw>,
    );

    await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    const presenter = presenterApp();

    // the presenter is on the teacher's page ...
    await waitFor(() => {
      expect(presenter.state.currentPageId).toBe(PAGE_TWO);
    });

    // ... and it shows **that** page's content, not the whole document: the
    // rectangle of the first page is in the viewport too, but it belongs to
    // another page, so the presenter must not draw it
    await waitFor(() => {
      expect(presenter.visibleElements.map((element) => element.id)).toEqual([
        ellipseOnPageTwo.id,
      ]);
    });

    // -------------------------------------------------------------------------
    // and it follows the teacher when the teacher moves to the other page
    // -------------------------------------------------------------------------
    await act(async () => {
      API.setAppState({ currentPageId: PAGE_ONE } as never);
    });

    await waitFor(() => {
      expect(presenter.state.currentPageId).toBe(PAGE_ONE);
    });

    await waitFor(() => {
      expect(presenter.visibleElements.map((element) => element.id)).toEqual([
        rect.id,
      ]);
    });
  });

  it("AC-177 the presenter's own controls work", async () => {
    const { container } = await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    // the hint is there, and it names the hint's own control
    const hint = container.querySelector(".presenter-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain("hide hint");

    // **H** hides the hint
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "h", bubbles: true }),
      );
    });

    await waitFor(() => {
      expect(container.querySelector(".presenter-hint")).toBeNull();
    });

    // **H** brings it back
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "h", bubbles: true }),
      );
    });

    await waitFor(() => {
      expect(container.querySelector(".presenter-hint")).not.toBeNull();
    });
  });

  it("AC-177 the presenter's fullscreen control is offered only where the browser can do it", async () => {
    // -------------------------------------------------------------------------
    // a browser with the Fullscreen API: the control is offered and it works
    // -------------------------------------------------------------------------
    const requestFullscreen = vi.fn(() => Promise.resolve() as never);
    (
      document.documentElement as unknown as { requestFullscreen: unknown }
    ).requestFullscreen = requestFullscreen;

    const withFullscreen = await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    expect(
      withFullscreen.container.querySelector(".presenter-hint")?.textContent,
    ).toContain("fullscreen");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", bubbles: true }),
      );
    });

    expect(requestFullscreen).toHaveBeenCalled();

    delete (
      document.documentElement as unknown as { requestFullscreen?: unknown }
    ).requestFullscreen;

    // -------------------------------------------------------------------------
    // a browser without it: the control is **not offered** - a control that
    // cannot have an effect must not be drawn (D-120) - and the key does not
    // throw
    // -------------------------------------------------------------------------
    const withoutFullscreen = await render(
      <ExcalidrawAPIProvider>
        <PresenterView />
      </ExcalidrawAPIProvider>,
    );

    expect(
      withoutFullscreen.container.querySelector(".presenter-hint")?.textContent,
    ).not.toContain("fullscreen");

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", bubbles: true }),
      );
    });
  });
});
