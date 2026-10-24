/**
 * The **YouTube panel**: the embed, and the focus it borrows (D-128, D-130).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import React from "react";

import type {
  ExcalidrawElement,
  ExcalidrawPanelElement,
} from "@excalidraw/element/types";

import { youtubePanelContent } from "../index";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { fireEvent, render } from "./test-utils";

/** the id of the video the panel holds */
const VIDEO_ID = "dQw4w9WgXcQ";

/** the size the panel happens to be shown at on the canvas */
const DISPLAY_WIDTH = 480;
const DISPLAY_HEIGHT = 270;

/** a YouTube panel, holding only the video id */
const youtubePanel = (overrides: Record<string, unknown> = {}) =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    panelKind: "video",
    panel: youtubePanelContent({ videoId: VIDEO_ID }),
    posterMode: false,
    posterFileId: null,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

/** the panel's iframe, once it is on the page */
const embed = () =>
  document.querySelector(
    '[data-testid="panel-youtube-embed"]',
  ) as HTMLIFrameElement | null;

describe("the youtube panel", () => {
  it("AC-168 the panel renders the youtube embed for the video id it holds", async () => {
    const panel = youtubePanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    // the panel is on the canvas, and the canvas has a size: jsdom has no
    // layout, so the viewport is said here
    API.setAppState({ width: 1000, height: 1000 });

    const frame = embed();

    expect(frame).not.toBeNull();

    // the iframe is YouTube's own player, and its URL is built from the id
    // the panel holds - in one place
    expect(frame!.getAttribute("src")).toBe(
      `https://www.youtube.com/embed/${VIDEO_ID}`,
    );
    expect(frame!.getAttribute("data-video-id")).toBe(VIDEO_ID);

    // and the panel says which video it is, for the host and for the test
    expect(panel.panel.source).toEqual({
      type: "youtube",
      videoId: VIDEO_ID,
    });
  });

  it("AC-168 the panel holds no youtube url and no scraped markup", async () => {
    const panel = youtubePanel();

    // the payload is the document's own business, and it travels: it holds the
    // **id** and nothing else. No URL, no markup, nothing that YouTube could
    // change under us (D-128).
    const payload = JSON.stringify(panel.panel);

    expect(payload).not.toContain("youtube.com");
    expect(payload).not.toContain("youtube-nocookie.com");
    expect(payload).not.toContain("<");
    expect(payload).not.toContain("watch?v=");

    // the source is exactly the id
    expect(Object.keys(panel.panel.source)).toEqual(["type", "videoId"]);
    expect((panel.panel.source as unknown as { videoId: string }).videoId).toBe(
      VIDEO_ID,
    );

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    // and the embed is built from the id, not read out of a page
    expect(embed()!.getAttribute("src")).toContain(VIDEO_ID);
    expect(
      document.querySelector('[data-testid="panel-youtube"]'),
    ).not.toBeNull();
  });

  it("AC-170 the canvas takes the focus back when the pointer leaves the iframe panel", async () => {
    const panel = youtubePanel();

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const frame = embed()!;

    // the iframe's own rect: jsdom has no layout, so the panel's place on the
    // screen is said here
    Object.defineProperty(frame, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 100,
        top: 100,
        right: 300,
        bottom: 300,
        width: 200,
        height: 200,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      }),
    });

    // the teacher clicks into the video: the focus moves into YouTube's
    // document, and the whiteboard's keyboard stops reaching the canvas
    frame.focus();

    expect(document.activeElement).toBe(frame);

    // the browser can blur the iframe's own window; jsdom has no such method,
    // and it says so loudly
    Object.defineProperty(frame, "contentWindow", {
      configurable: true,
      value: { blur: () => {} },
    });

    // the pointer is still inside the panel: the iframe keeps the focus
    fireEvent(
      document,
      new MouseEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 150,
        clientY: 150,
      }),
    );

    expect(document.activeElement).toBe(frame);

    // the pointer leaves the panel: the canvas takes the focus back, and the
    // iframe's focus is blurred (D-130)
    fireEvent(
      document,
      new MouseEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 600,
        clientY: 600,
      }),
    );

    expect(document.activeElement).not.toBe(frame);

    // and the canvas holds it: the editor container is the element the editor
    // listens on
    const container = document.querySelector(".excalidraw");

    expect(container).not.toBeNull();
    expect(document.activeElement).toBe(container);
  });
});
