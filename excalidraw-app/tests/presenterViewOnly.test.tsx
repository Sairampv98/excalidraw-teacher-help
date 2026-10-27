/**
 * AC-238 - a change of the view alone sends the view alone (D-212).
 *
 * Both sides of the channel are played: the editor, with the broadcaster wired
 * as the app wires it, and the presenter, the real `PresenterView`. What the
 * editor sends is read from the messages it posts; what the presenter does is
 * read from the calls it makes on its own editor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { Excalidraw, ExcalidrawAPIProvider } from "@excalidraw/excalidraw";
import {
  act,
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";

import type { AppState } from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/element/types";

import { PresenterView } from "../presenter/PresenterView";
import { usePresenterBroadcaster } from "../presenter/usePresenterBroadcaster";

const VIEWPORT = {
  width: 1920,
  height: 1080,
  top: 0,
  left: 0,
  bottom: 1080,
  right: 1920,
};

type Message = { type: string; [key: string]: unknown };

/** delivers a message to every other channel of the name, as the browser does */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  onmessage: ((event: { data: unknown }) => void) | null = null;

  posted: Message[] = [];

  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: Message) {
    this.posted.push(data);

    for (const other of FakeBroadcastChannel.instances) {
      if (other !== this && other.name === this.name) {
        setTimeout(() => other.onmessage?.({ data }), 0);
      }
    }
  }

  close() {}
}

let publishScene:
  | ((
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
    ) => void)
  | null = null;

let latest: {
  elements: readonly OrderedExcalidrawElement[];
  appState: AppState;
};

const Broadcaster = () => {
  publishScene = usePresenterBroadcaster(false).publishScene;

  return null;
};

type PresenterApp = {
  state: { scrollX: number; scrollY: number; zoom: { value: number } };
  getSceneElements: () => { id: string }[];
};

const presenterApp = () => window.h.app as unknown as PresenterApp;

/** the editor's side, mounted, and the presenter's, mounted and connected */
const connect = async () => {
  const rect = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 120,
  });

  await render(
    <Excalidraw
      initialData={{ elements: [rect] as never }}
      onChange={(elements, appState) => {
        latest = { elements, appState };
        publishScene?.(elements, appState);
      }}
    >
      <Broadcaster />
    </Excalidraw>,
  );

  const editor = FakeBroadcastChannel.instances[0];

  await render(
    <ExcalidrawAPIProvider>
      <PresenterView />
    </ExcalidrawAPIProvider>,
  );

  // the presenter has the scene: the connection is made
  await waitFor(() => {
    expect(
      presenterApp()
        .getSceneElements()
        .map((e) => e.id),
    ).toEqual([rect.id]);
  });

  return { editor, rect };
};

const sent = (editor: FakeBroadcastChannel, type: string) =>
  editor.posted.filter((message) => message.type === type);

/** the editor's view moves: the same elements, another place */
const moveView = async (dx: number) => {
  // past the publish interval, so that the view goes out at once
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
  await act(async () => {
    publishScene!(latest.elements, {
      ...latest.appState,
      scrollX: latest.appState.scrollX + dx,
    });
  });
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

describe("AC-238 a view change alone sends the view alone", () => {
  it("AC-238 a view change alone sends the view alone", async () => {
    const { editor } = await connect();

    editor.posted = [];

    await moveView(80);

    await waitFor(() => {
      expect(sent(editor, "presenter:camera")).toHaveLength(1);
    });

    expect(
      (sent(editor, "presenter:camera")[0].camera as { scrollX: number })
        .scrollX,
    ).toBe(latest.appState.scrollX + 80);
  });

  it("AC-238 the scene is not sent for a view change", async () => {
    const { editor } = await connect();

    editor.posted = [];

    // a fly-to is many frames of the view
    for (const dx of [20, 40, 60, 80]) {
      // eslint-disable-next-line no-await-in-loop
      await moveView(dx);
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    }

    expect(sent(editor, "presenter:camera").length).toBeGreaterThanOrEqual(3);
    expect(sent(editor, "presenter:scene")).toHaveLength(0);
  });

  it("AC-238 the presenter moves only its view", async () => {
    await connect();

    const before = presenterApp().state.scrollX;
    const elementsBefore = presenterApp().getSceneElements();

    await moveView(120);

    await waitFor(() => {
      expect(presenterApp().state.scrollX).toBe(before + 120);
    });

    // the scene it holds is the very one it had: nothing of it was replaced
    expect(presenterApp().getSceneElements()).toBe(elementsBefore);
  });

  it("AC-238 the scene goes when elements change", async () => {
    const { editor } = await connect();

    editor.posted = [];

    const added = API.createElement({
      type: "ellipse",
      x: 400,
      y: 300,
      width: 80,
      height: 80,
    });

    await act(async () => {
      publishScene!([...latest.elements, added as never], latest.appState);
    });

    await waitFor(() => {
      expect(sent(editor, "presenter:scene")).toHaveLength(1);
    });

    expect(sent(editor, "presenter:camera")).toHaveLength(0);
  });

  it("AC-238 the scene goes when a presenter connects", async () => {
    const { editor } = await connect();

    editor.posted = [];

    // a second presenter says hello, and nothing has changed since
    await act(async () => {
      editor.onmessage?.({
        data: { type: "presenter:hello", presenterId: "another" },
      });
    });

    expect(sent(editor, "presenter:scene")).toHaveLength(1);
    expect(sent(editor, "presenter:camera")).toHaveLength(0);
  });
});

describe("AC-245 the view goes at the screen's rate", () => {
  it("AC-245 camera messages go at the screen's rate", async () => {
    const { editor } = await connect();

    // past the publish interval, so that the first goes out at once
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    editor.posted = [];

    const began = performance.now();

    // a flight: a new view every 10 ms for 300 ms
    for (let i = 1; i <= 30; i++) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        publishScene!(latest.elements, {
          ...latest.appState,
          scrollX: latest.appState.scrollX + i * 5,
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    const seconds = (performance.now() - began) / 1000;
    const cameras = sent(editor, "presenter:camera").length;

    // at 25 a second a run gives at most 25 a second; the screen's rate gives well over 30
    // it is more than half of what the frames could carry at 60
    expect(cameras).toBeGreaterThanOrEqual(Math.floor(seconds * 30));
    expect(sent(editor, "presenter:scene")).toHaveLength(0);
  });
});
