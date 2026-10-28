/**
 * AC-287 - the words of a node that holds media (D-248).
 *
 * The real editor: a picture is put in a node and what happens to the node's
 * words is read back from the scene - a caption under the node, or hidden and
 * locked under the media - with the choice made in the Edit chart panel, and the
 * words back in the node when the picture is taken out.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import { applyFlowScript } from "@excalidraw/excalidraw/scene/flowApply";
import { buildFlowGraph } from "@excalidraw/excalidraw/scene/flowOrder";
import { buildFlowPreset } from "@excalidraw/excalidraw/scene/flowPresets";
import { flowOfSelection } from "@excalidraw/excalidraw/scene/flowSelection";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import {
  closeFlowScriptEditor,
  openFlowScriptEditor,
} from "@excalidraw/excalidraw/components/FlowScriptEditorState";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";
import { arrayToMap } from "@excalidraw/common";
import { captionOf, mediaOf, newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { NodeMediaDrop } from "../sidebar/NodeMediaPanel";
import {
  addMediaToNode,
  applyMediaWords,
  mediaElementsOfNode,
  removeMediaFromNode,
} from "../sidebar/nodeMedia";
import {
  CAPTION_GAP,
  ensureWords,
  followCaptions,
  wordsOf,
  wordsStateOf,
} from "../sidebar/nodeWords";

class FakeImage {
  naturalWidth = 400;

  naturalHeight = 200;

  onload: null | (() => void) = null;

  onerror: null | (() => void) = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let api: ExcalidrawImperativeAPI;

const SCRIPT = ["Start", "Work", "Finish"].join(String.fromCharCode(10));

const chart = () => {
  const built = buildFlowPreset("process", SCRIPT, {
    seed: 5,
    chartId: "chart-1",
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  return built.elements as ExcalidrawElement[];
};

const all = () => api.getSceneElementsIncludingDeleted();

const live = () => api.getSceneElements();

const byId = (id: string) => all().find((element) => element.id === id)!;

const firstNode = () =>
  live().find(
    (element) =>
      element.type !== "arrow" &&
      element.type !== "text" &&
      !mediaOf(element) &&
      element.customData?.flow?.role === "node",
  )!;

const mount = async (children: React.ReactNode = null) => {
  await render(
    <Excalidraw
      onExcalidrawAPI={(value) => {
        api = value!;
      }}
      initialData={{ elements: chart() }}
    >
      <NodeMediaDrop />
      {children}
    </Excalidraw>,
  );
  API.setAppState({ width: 1000, height: 1000 });
};

const png = () => new File(["x"], "a.png", { type: "image/png" });

/** a node with a picture in it: the words are under it as a caption */
const nodeWithPicture = async () => {
  await mount();

  const node = firstNode();
  const words = wordsOf(all(), node)!;

  await act(async () => {
    await addMediaToNode(api, node.id, png());
  });

  return { node, words };
};

const caption = (nodeId: string) => wordsOf(all(), byId(nodeId))!;

const moveScene = (updates: Record<string, Record<string, unknown>>) =>
  act(() => {
    api.updateScene({
      elements: all().map((element) =>
        updates[element.id]
          ? newElementWith(element, updates[element.id] as never)
          : element,
      ),
    });
  });

describe("AC-287 the words of a node that holds media", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    act(() => closeFlowScriptEditor());
    vi.unstubAllGlobals();
  });

  it("AC-287 the words become a caption under the node, grouped with it", async () => {
    const { node, words } = await nodeWithPicture();
    const note = caption(node.id);
    const [picture] = mediaElementsOfNode(live(), node.id);

    // they are the same words, and no longer in the node
    expect((note as ExcalidrawTextElement).text).toBe(
      (words as ExcalidrawTextElement).text,
    );
    expect(note.id).toBe(words.id);
    expect(note.containerId).toBeNull();
    expect(
      (byId(node.id).boundElements ?? []).some((b) => b.id === note.id),
    ).toBe(false);
    expect(captionOf(note)?.of).toBe(node.id);
    expect(wordsStateOf(note)).toBe("caption");

    // centred under the node, a little way off
    expect(note.x + note.width / 2).toBeCloseTo(node.x + node.width / 2, 4);
    expect(note.y).toBeCloseTo(node.y + node.height + CAPTION_GAP, 4);

    // it is ordinary text: seen, and not locked, so that it can be selected and edited
    expect(note.opacity).toBeGreaterThan(0);
    expect(note.locked).toBeFalsy();

    // and it is in the group of the node and the media, so they move together
    expect(picture.groupIds[0]).toBeTruthy();
    expect(note.groupIds).toContain(picture.groupIds[0]);
    expect(byId(node.id).groupIds).toContain(picture.groupIds[0]);
  });

  it("AC-287 a caption goes with its node, and is left where the teacher put it", async () => {
    const { node } = await nodeWithPicture();
    const note = caption(node.id);

    // the node is moved by itself (by a layout, by the script): the caption goes with it
    moveScene({ [node.id]: { x: node.x + 100, y: node.y + 40 } });
    await waitFor(() =>
      expect(caption(node.id).x).toBeCloseTo(note.x + 100, 4),
    );
    expect(caption(node.id).y).toBeCloseTo(note.y + 40, 4);

    // both moved, as a group is: the caption is where the move put it, not moved again
    const moved = caption(node.id);

    moveScene({
      [node.id]: { x: node.x + 150, y: node.y + 90 },
      [moved.id]: { x: moved.x + 50, y: moved.y + 50 },
    });
    await act(async () => {});
    expect(caption(node.id).x).toBeCloseTo(moved.x + 50, 4);
    expect(caption(node.id).y).toBeCloseTo(moved.y + 50, 4);

    // the caption moved by itself: it stays there, and the node is not moved
    const there = caption(node.id);

    moveScene({ [there.id]: { x: there.x + 70, y: there.y - 30 } });
    await act(async () => {});
    expect(caption(node.id).x).toBeCloseTo(there.x + 70, 4);
    expect(byId(node.id).x).toBeCloseTo(node.x + 150, 4);

    // and a node moved after that takes it along from where it is
    const placed = caption(node.id);

    moveScene({ [node.id]: { x: node.x + 200 } });
    await waitFor(() =>
      expect(caption(node.id).x).toBeCloseTo(placed.x + 50, 4),
    );
  });

  it("AC-287 the choice is a caption or hidden, and either can be changed to the other", async () => {
    const { node, words } = await nodeWithPicture();

    // hidden: bound to the node again, unseen and locked so that a click does not find it
    expect(applyMediaWords(api, node.id, "hidden")).toBe(true);

    const hidden = caption(node.id) as ExcalidrawTextElement;

    expect(wordsStateOf(hidden)).toBe("hidden");
    expect(hidden.containerId).toBe(node.id);
    expect(hidden.opacity).toBe(0);
    expect(hidden.locked).toBe(true);
    expect(
      (byId(node.id).boundElements ?? []).some((b) => b.id === hidden.id),
    ).toBe(true);
    expect(captionOf(hidden)).toBeNull();
    // the choice is kept on the media
    expect(mediaOf(mediaElementsOfNode(live(), node.id)[0])?.words).toBe(
      "hidden",
    );

    // a caption again: out of the node, seen as it was
    expect(applyMediaWords(api, node.id, "caption")).toBe(true);

    const again = caption(node.id);

    expect(wordsStateOf(again)).toBe("caption");
    expect(again.containerId).toBeNull();
    expect(again.opacity).toBe(words.opacity);
    expect(again.locked).toBe(words.locked);
    expect(again.y).toBeCloseTo(node.y + node.height + CAPTION_GAP, 4);
  });

  it("AC-287 taking the picture out brings the words back into the node, from either state", async () => {
    for (const mode of ["caption", "hidden"] as const) {
      document.body.innerHTML = "";

      const { node, words } = await nodeWithPicture();

      applyMediaWords(api, node.id, mode);
      expect(removeMediaFromNode(api, node.id)).toBe(true);

      const back = byId(words.id) as ExcalidrawTextElement;

      expect(wordsStateOf(back), mode).toBe("shown");
      expect(back.containerId, mode).toBe(node.id);
      expect(back.opacity, mode).toBe(words.opacity);
      expect(back.locked ?? false, mode).toBe(words.locked ?? false);
      expect(back.isDeleted, mode).toBe(false);
      expect(
        (byId(node.id).boundElements ?? []).filter((b) => b.id === words.id),
        mode,
      ).toHaveLength(1);
      // centred in the node, as bound words are
      expect(back.x + back.width / 2, mode).toBeCloseTo(
        node.x + node.width / 2,
        3,
      );
      expect(back.y + back.height / 2, mode).toBeCloseTo(
        node.y + node.height / 2,
        3,
      );
      expect(captionOf(back), mode).toBeNull();
    }
  });

  it("AC-287 the words are kept as the choice says when the chart is made again", async () => {
    const { node } = await nodeWithPicture();

    // the chart's shape is changed: every node is made anew, with its words in it
    const result = applyFlowScript({
      elements: all(),
      chartId: "chart-1",
      preset: "process",
      script: SCRIPT,
      fit: "page",
      shape: "ellipse",
      page: { x: 0, y: 0, width: 1920, height: 1080 },
      seed: 9,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.rebuilt).toBe(true);

    // the new node has its words bound to it; the check puts them under it
    const fixed = ensureWords(result.elements)!;
    const picture = fixed.find(
      (element) => !element.isDeleted && mediaOf(element),
    )!;
    const owner = fixed.find((element) => element.id === mediaOf(picture)!.of)!;
    const words = wordsOf(fixed, owner)!;

    expect(owner.id).not.toBe(node.id);
    expect(wordsStateOf(words)).toBe("caption");
    expect(captionOf(words)?.of).toBe(owner.id);

    // and the choice "hidden" is kept the same way
    const hidden = fixed.map((element) =>
      mediaOf(element)
        ? newElementWith(element, {
            customData: {
              ...element.customData,
              media: { ...element.customData!.media, words: "hidden" },
            },
          })
        : element,
    );
    const settled = ensureWords(hidden) ?? hidden;
    const hiddenWords = wordsOf(
      settled,
      settled.find((element) => element.id === owner.id)!,
    )!;

    expect(wordsStateOf(hiddenWords)).toBe("hidden");
  });

  it("AC-287 the caption is part of the node's step and of its flow", async () => {
    const { node } = await nodeWithPicture();
    const elements = all().filter((element) => !element.isDeleted);
    const note = caption(node.id);
    const graph = buildFlowGraph(elements, arrayToMap(elements));
    const step = graph.steps.find((s) => s.containerId === node.id)!;

    // not a step of its own, and in the box of the node's step
    expect(step.elementIds).toContain(note.id);
    expect(graph.steps.some((s) => s.containerId === note.id)).toBe(false);
    expect(step.box.y + step.box.height).toBeGreaterThanOrEqual(
      note.y + note.height - 1e-6,
    );

    // it is so by what it is, and not by the chart's own marks on it
    const bare = elements.map((element) =>
      element.id === note.id
        ? newElementWith(element, {
            customData: { caption: captionOf(note) },
          } as never)
        : element,
    );
    const bareGraph = buildFlowGraph(bare, arrayToMap(bare));

    expect(
      bareGraph.steps.find((s) => s.containerId === node.id)!.elementIds,
    ).toContain(note.id);
    expect(bareGraph.steps.some((s) => s.containerId === note.id)).toBe(false);

    // selecting the caption selects the flow
    const flow = flowOfSelection(
      { [note.id]: true },
      elements,
      arrayToMap(elements),
    );

    expect(flow?.steps).toHaveLength(3);
  });

  it("AC-287 a node with a caption is matched by its words when the script is applied", async () => {
    const { node } = await nodeWithPicture();
    const note = caption(node.id);

    // a line is added: the node with the picture is kept, and so is its caption
    const result = applyFlowScript({
      elements: all(),
      chartId: "chart-1",
      preset: "process",
      script: [SCRIPT, "Check"].join(String.fromCharCode(10)),
      fit: "page",
      shape: "own",
      page: { x: 0, y: 0, width: 1920, height: 1080 },
      seed: 9,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.rebuilt).toBe(false);
    expect(result.removed).toBe(0);

    const kept = result.elements.find((element) => element.id === node.id)!;
    const keptWords = result.elements.find(
      (element) => element.id === note.id,
    ) as ExcalidrawTextElement;

    expect(kept.isDeleted).toBe(false);
    expect(keptWords.isDeleted).toBe(false);
    // the caption was not moved into the node
    expect(captionOf(keptWords)?.of).toBe(node.id);
    expect(keptWords.containerId).toBeNull();
    expect(keptWords.y).toBeCloseTo(note.y, 4);
  });

  it("AC-287 the Edit chart panel offers the choice", async () => {
    await mount();

    const node = firstNode();

    act(() => {
      API.setSelectedElements([node]);
      openFlowScriptEditor(node.id);
    });
    await screen.findByRole("dialog", { name: "Edit chart" });

    // no media, no choice to make
    expect(screen.queryByTestId("node-media-words")).toBeNull();

    await act(async () => {
      await addMediaToNode(api, node.id, png());
    });

    const choice = (await screen.findByTestId(
      "node-media-words",
    )) as HTMLSelectElement;

    expect(choice.value).toBe("caption");
    expect([...choice.options].map((o) => o.value)).toEqual([
      "caption",
      "hidden",
    ]);

    fireEvent.change(choice, { target: { value: "hidden" } });
    await waitFor(() => expect(wordsStateOf(caption(node.id))).toBe("hidden"));
    expect(
      (screen.getByTestId("node-media-words") as HTMLSelectElement).value,
    ).toBe("hidden");

    fireEvent.change(screen.getByTestId("node-media-words"), {
      target: { value: "caption" },
    });
    await waitFor(() => expect(wordsStateOf(caption(node.id))).toBe("caption"));
  });

  it("AC-287 the words of a node without media are left alone", async () => {
    await mount();

    const node = firstNode();
    const words = wordsOf(all(), node)!;

    expect(wordsStateOf(words)).toBe("shown");
    expect(ensureWords(all())).toBeNull();
    expect(followCaptions(all())).toBeNull();
  });
});
