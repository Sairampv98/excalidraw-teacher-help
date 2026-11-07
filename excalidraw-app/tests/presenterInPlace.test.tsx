/**
 * AC-543 - an element that is edited IN PLACE reaches the projector (D-449).
 *
 * The follow mode of the VS Code mirror moves the part of the editor's window
 * that is shown by editing the panel element where it stands: the editor hands
 * the same list of elements, with one of them changed. The broadcaster took "the
 * same list" to mean "the same elements" and sent the view alone, so the
 * projector kept showing the part it had.
 *
 * Both sides of the channel are played, as in presenterViewOnly.test.tsx: the
 * editor, with the broadcaster wired as the app wires it, and the real
 * `PresenterView`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import React from "react";

import { mutateElement } from "@excalidraw/element";
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
import { elementsFingerprint } from "../presenter/presenterChannel";
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
  getSceneElements: () => { id: string; x: number; customData?: unknown }[];
};

const presenterApp = () => window.h.app as unknown as PresenterApp;

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

/** past the publish interval, so that what follows goes out at once */
const pause = (ms = 80) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

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

describe("AC-543 an element edited in place reaches the projector", () => {
  it("AC-543 the same list with one element changed goes as a scene, and the projector shows the change", async () => {
    const { editor, rect } = await connect();

    await pause();
    editor.posted = [];

    // what a follow step does: the element is edited where it stands, and the
    // editor hands over the very list it handed over before
    const elementsMap = new Map(latest.elements.map((e) => [e.id, e]));
    const before = latest.elements;

    mutateElement(elementsMap.get(rect.id)!, elementsMap as never, {
      x: 640,
    });

    await act(async () => {
      publishScene!(before, latest.appState);
    });

    await waitFor(() => {
      expect(sent(editor, "presenter:scene")).toHaveLength(1);
    });

    expect(sent(editor, "presenter:camera")).toHaveLength(0);

    await waitFor(() => {
      expect(
        presenterApp()
          .getSceneElements()
          .find((e) => e.id === rect.id)!.x,
      ).toBe(640);
    });
  });

  it("AC-543 nothing changed at all is still only the view", async () => {
    const { editor } = await connect();

    await pause();
    editor.posted = [];

    await act(async () => {
      publishScene!(latest.elements, {
        ...latest.appState,
        scrollX: latest.appState.scrollX + 30,
      });
    });

    await waitFor(() => {
      expect(sent(editor, "presenter:camera")).toHaveLength(1);
    });

    expect(sent(editor, "presenter:scene")).toHaveLength(0);
  });
});

describe("AC-544 the fingerprint of the elements", () => {
  it("AC-544 changes when an element is edited where it stands, and not when nothing changed", () => {
    const rect = API.createElement({ type: "rectangle", x: 1, y: 2 });
    const other = API.createElement({ type: "ellipse", x: 9, y: 9 });
    const list = [rect, other] as readonly OrderedExcalidrawElement[];

    const before = elementsFingerprint(list);

    // nothing changed: the same string, from the same list or a copy of it
    expect(elementsFingerprint(list)).toBe(before);
    expect(elementsFingerprint([...list])).toBe(before);

    // an element is edited in place: the list is the same object, the string is not
    mutateElement(rect, new Map(list.map((e) => [e.id, e])) as never, {
      x: 50,
    });
    expect(elementsFingerprint(list)).not.toBe(before);

    // an element added or taken away is a change too
    const edited = elementsFingerprint(list);

    expect(elementsFingerprint([rect] as never)).not.toBe(edited);
  });

  it("AC-544 notices a change of the version alone, and of the version nonce alone", () => {
    const at = (version: number, versionNonce: number) => [
      { version, versionNonce },
    ];

    expect(elementsFingerprint(at(1, 5))).toBe(elementsFingerprint(at(1, 5)));
    expect(elementsFingerprint(at(1, 5))).not.toBe(
      elementsFingerprint(at(2, 5)),
    );
    expect(elementsFingerprint(at(1, 5))).not.toBe(
      elementsFingerprint(at(1, 6)),
    );
  });
});
