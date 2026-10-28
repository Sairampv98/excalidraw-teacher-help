/**
 * AC-282 - a GIF and a video in a node play, cut to the node's shape (D-246).
 *
 * The real editor mounts the overlay of a GIF and the overlay of a video panel;
 * what they put in the page is read back from the page.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MIME_TYPES } from "@excalidraw/common";
import { customDataWithMedia } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawPanelElement,
  FileId,
} from "@excalidraw/element/types";

import {
  stopFlowAnimation,
  setFlowClassPreview,
} from "../components/FlowAnimationState";
import { AnimationController } from "../renderer/animation";
import { withFlowClass } from "../scene/flowClass";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";
import { buildFlowPreset } from "../scene/flowPresets";

import { Excalidraw, videoPanelContent } from "../index";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

import type { FlowClassSettings } from "../scene/flowClass";

import type { BinaryFileData } from "../types";

const GIF_ID = "gif-1" as FileId;
const VIDEO_ID = "video-1" as FileId;

const files = {
  [GIF_ID]: {
    id: GIF_ID,
    mimeType: MIME_TYPES.gif,
    dataURL:
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    created: 1,
    lastRetrieved: 1,
  },
  [VIDEO_ID]: {
    id: VIDEO_ID,
    mimeType: "video/mp4" as unknown as BinaryFileData["mimeType"],
    dataURL: "data:video/mp4;base64,AAAA",
    created: 1,
    lastRetrieved: 1,
  },
} as unknown as Record<string, BinaryFileData>;

const gif = (shape: "ellipse" | "diamond" | "rectangle" | null) =>
  ({
    ...API.createElement({
      type: "image",
      fileId: GIF_ID,
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    }),
    ...(shape
      ? {
          customData: customDataWithMedia(undefined, {
            of: "node",
            shape,
            radius: 0,
          }),
        }
      : {}),
  } as ExcalidrawElement);

const video = (shape: "ellipse" | null) =>
  ({
    ...API.createElement({
      type: "panel",
      x: 100,
      y: 300,
      width: 200,
      height: 100,
      panelKind: "video",
      panel: videoPanelContent({
        source: { type: "file", fileId: VIDEO_ID, mimeType: "video/mp4" },
        tracks: [],
        language: "en",
        naturalWidth: 1920,
        naturalHeight: 1080,
      }),
      posterMode: false,
      posterFileId: null,
    }),
    ...(shape
      ? {
          customData: customDataWithMedia(undefined, {
            of: "node",
            shape,
            radius: 0,
          }),
        }
      : {}),
  } as unknown as ExcalidrawPanelElement);

const mount = async (elements: ExcalidrawElement[]) => {
  await render(<Excalidraw initialData={{ elements, files }} />);

  // jsdom has no layout, so the editor's own viewport is 0x0 and nothing
  // would be visible
  API.setAppState({ width: 1000, height: 1000 });
};

describe("AC-282 a GIF and a video in a node play, cut to the node's shape", () => {
  it("AC-282 a GIF in a node is cut to the shape and still plays", async () => {
    await mount([gif("diamond")]);

    const cut = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(
        ".excalidraw__animated-image",
      );

      expect(node).not.toBeNull();

      return node!;
    });

    expect(cut.style.clipPath).toBe(
      "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
    );
    // it is the page's own `<img>` of the GIF, which is what moves
    expect(cut.querySelector("img")).not.toBeNull();
  });

  it("AC-282 a GIF that is not in a node is not cut", async () => {
    await mount([gif(null)]);

    const node = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        ".excalidraw__animated-image",
      );

      expect(found).not.toBeNull();

      return found!;
    });

    expect(node.style.clipPath).toBe("");
  });

  it("AC-282 a video in a node fills it, is cut to the shape and plays on a silent loop", async () => {
    await mount([video("ellipse")]);

    const panel = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-testid="panel"]',
      );

      expect(found).not.toBeNull();

      return found!;
    });

    expect(panel.hasAttribute("data-node-media")).toBe(true);
    expect(panel.style.clipPath).toBe("ellipse(50% 50% at 50% 50%)");

    const player = panel.querySelector<HTMLVideoElement>(
      '[data-testid="panel-video"]',
    )!;

    expect(player).not.toBeNull();
    expect(player.loop).toBe(true);
    expect(player.autoplay).toBe(true);
    expect(player.muted).toBe(true);
  });

  it("AC-282 a video that is not in a node is as it was", async () => {
    await mount([video(null)]);

    const panel = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-testid="panel"]',
      );

      expect(found).not.toBeNull();

      return found!;
    });

    expect(panel.hasAttribute("data-node-media")).toBe(false);
    expect(panel.style.clipPath).toBe("");

    const player = panel.querySelector<HTMLVideoElement>(
      '[data-testid="panel-video"]',
    )!;

    expect(player.loop).toBe(false);
    expect(player.autoplay).toBe(false);
  });

  describe("in the presenter", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** the presenter is the editor in view mode: it mirrors what the editor published */
    const mountMirror = async (panel: ExcalidrawPanelElement) => {
      await render(
        <Excalidraw
          viewModeEnabled={true}
          initialData={{ elements: [panel as never], files }}
        />,
      );
      API.setAppState({ width: 1000, height: 1000 });

      return waitFor(() => {
        const found = document.querySelector<HTMLVideoElement>(
          '[data-testid="panel-video"]',
        );

        expect(found).not.toBeNull();

        return found!;
      });
    };

    const published = (panel: ExcalidrawPanelElement) =>
      ({
        ...panel,
        // the editor said: stopped, at 12 seconds
        playback: { time: 12, playing: false },
      } as unknown as ExcalidrawPanelElement);

    it("AC-282 the video of a node plays by itself in the presenter", async () => {
      const pause = vi
        .spyOn(HTMLMediaElement.prototype, "pause")
        .mockImplementation(() => {});

      vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
        Promise.resolve(),
      );

      const player = await mountMirror(published(video("ellipse")));

      // the editor's position is not followed: the loop is not stopped and not
      // moved to where the editor was
      expect(pause).not.toHaveBeenCalled();
      expect(player.currentTime).not.toBe(12);
      expect(player.loop).toBe(true);
      expect(player.autoplay).toBe(true);
    });

    it("AC-282 a video that is not in a node follows the editor in the presenter", async () => {
      vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
        Promise.resolve(),
      );
      vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
        () => {},
      );

      const player = await mountMirror(published(video(null)));

      // the control: the panel that is not media still takes the editor's position
      await waitFor(() => expect(player.currentTime).toBe(12));
    });
  });

  describe("the highlight of a node", () => {
    const SETTINGS: FlowClassSettings = {
      ...FLOW_LOOK_DEFAULTS,
      node: "pulse",
      arrow: "token",
      speed: 240,
      stepMs: 100000,
      loop: true,
    };

    afterEach(() => {
      stopFlowAnimation();
      setFlowClassPreview(false);
      AnimationController.cancel("flow-class");
    });

    /** a chart marked for the class view, with a picture over its first node or none */
    const chart = (withMedia: boolean) => {
      const built = buildFlowPreset(
        "process",
        ["Start", "Work", "Finish"].join(String.fromCharCode(10)),
        {
          seed: 4,
        },
      );

      if (!built.ok) {
        throw new Error(built.error);
      }

      const elements = built.elements.map((element) =>
        element.type !== "arrow" &&
        element.type !== "text" &&
        element.boundElements?.length
          ? {
              ...element,
              customData: withFlowClass(element, SETTINGS),
            }
          : element,
      ) as ExcalidrawElement[];

      if (!withMedia) {
        return elements;
      }

      // the first step is the shape at the top
      const first = elements
        .filter(
          (element) => element.type !== "arrow" && element.type !== "text",
        )
        .sort((a, b) => a.y - b.y || a.x - b.x)[0];

      return [
        ...elements,
        {
          ...API.createElement({
            type: "image",
            fileId: GIF_ID,
            x: first.x,
            y: first.y,
            width: first.width,
            height: first.height,
          }),
          customData: customDataWithMedia(undefined, {
            of: first.id,
            shape: "rectangle",
            radius: 0,
          }),
        } as ExcalidrawElement,
      ];
    };

    const outlines = async (withMedia: boolean) => {
      await render(
        <Excalidraw
          viewModeEnabled={true}
          initialData={{ elements: chart(withMedia) as never, files }}
        />,
      );
      API.setAppState({ width: 1400, height: 900 });

      return waitFor(() => {
        const shapes = [
          ...document.querySelectorAll(
            ".excalidraw__flow-class .excalidraw__flow-animation-shape",
          ),
        ];

        expect(shapes.length).toBeGreaterThan(0);

        return shapes;
      });
    };

    it("AC-282 a node that holds media is only outlined, so the picture is not washed", async () => {
      const shapes = await outlines(true);

      expect(
        shapes.some((shape) => shape.hasAttribute("data-flow-media")),
      ).toBe(true);
    });

    it("AC-282 a node without media is highlighted as it was", async () => {
      const shapes = await outlines(false);

      expect(
        shapes.some((shape) => shape.hasAttribute("data-flow-media")),
      ).toBe(false);
    });
  });
});
