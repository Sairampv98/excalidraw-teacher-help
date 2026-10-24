/**
 * The **YouTube panel**: the embed, the focus it borrows (D-128, D-130), and
 * the shape of the panel it lives in (D-131, D-132).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * The reason the extension gives when a video has no captions (D-129).
 *
 * It is a **sentence**, and it is the one the note has to carry: the line says
 * what fits and the tooltip says it all (D-132).
 */
const REASON =
  "no captions: the YouTube API key is not set and the public timedtext endpoint gave nothing back. Set excalidraw-bridge.youtubeApiKey to read them";

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

/** the panel's caption note, once it is on the page */
const captionNote = () =>
  document.querySelector(
    '[data-testid="panel-youtube-captions"]',
  ) as HTMLElement | null;

/** the stylesheet the panel's rules live in */
const stylesheet = () =>
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "css", "styles.scss"),
    "utf8",
  );

/** the body of one rule of the stylesheet, by its selector */
const rule = (selector: string): string => {
  const css = stylesheet();
  const start = css.indexOf(selector);

  if (start < 0) {
    return "";
  }

  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);

  return css.slice(open + 1, close);
};

/**
 * The row the note took of the panel, when the note was in the flow.
 *
 * The wave 5s live pass measured it in the browser on 2026-10-24: the reason
 * wrapped to five lines of 12px text at the panel's width, and the row it took
 * was 130 of the panel's 270 - so the iframe was 480x140, a 3.45:1 box, and
 * YouTube's own player filled it and stretched the video.
 *
 * The row is a **screen** height (the note's text is a screen size), so what it
 * costs in scene units depends on the zoom. The defect does not: a note in the
 * flow always takes a row of the panel, and the player is never 16:9 again.
 */
const NOTE_ROW_HEIGHT = 130;

/**
 * The geometry the stylesheet gives the panel (D-131).
 *
 * jsdom has no layout, so the numbers are computed from the rules themselves:
 * the panel is 480x270 - 16:9, the aspect YouTube's own player renders at. An
 * inset frame IS the panel's box; a note in the flow takes a row of the panel
 * and the frame gets what is left.
 */
const panelGeometry = () => {
  const frameRule = rule("&__panel-youtube-frame");
  const noteRule = rule("&__panel-youtube-note");

  const frameFillsThePanel =
    /position:\s*absolute/.test(frameRule) && /inset:\s*0/.test(frameRule);

  return {
    frame: {
      width: DISPLAY_WIDTH,
      height: frameFillsThePanel
        ? DISPLAY_HEIGHT
        : DISPLAY_HEIGHT - NOTE_ROW_HEIGHT,
    },
    // the note is out of the flow: it takes no row of the panel
    noteTakesRow: !/position:\s*absolute/.test(noteRule),
  };
};

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

  it("AC-171 the youtube iframe fills the whole panel", async () => {
    // the panel holds a video AND a note: the note is what used to take a row
    // of the panel and squeeze the player into a 3.45:1 box
    const panel = youtubePanel({
      panel: youtubePanelContent({
        videoId: VIDEO_ID,
        tier: "none",
        reason: REASON,
      }),
    });

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const frame = embed();

    expect(frame).not.toBeNull();

    // the iframe is in the panel's surface
    const surface = document.querySelector('[data-testid="panel-youtube"]');

    expect(surface).not.toBeNull();
    expect(surface!.contains(frame)).toBe(true);

    // and the geometry the stylesheet gives it: the frame IS the panel's box -
    // 480x270, 16:9, the aspect YouTube's own player renders at - and the note
    // takes no row of it (D-131)
    expect(
      panelGeometry(),
      "the youtube iframe must fill the panel (480x270, 16:9): a note in the flow takes a row of the panel and leaves the iframe 480x140 - a 3.45:1 box, and YouTube's own player is stretched by it",
    ).toEqual({
      frame: { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT },
      noteTakesRow: false,
    });
  });

  it("AC-171 the caption note overlays the video and carries the whole reason as its tooltip", async () => {
    const panel = youtubePanel({
      panel: youtubePanelContent({
        videoId: VIDEO_ID,
        tier: "none",
        reason: REASON,
      }),
    });

    await render(
      <Excalidraw
        initialData={{
          elements: [panel] as unknown as ExcalidrawElement[],
        }}
      />,
    );

    API.setAppState({ width: 1000, height: 1000 });

    const note = captionNote();

    expect(note).not.toBeNull();

    // out of the flow: the note overlays the video's top edge and takes no row
    // of the panel. A note in the flow takes 130 of the panel's 270 units and
    // leaves the iframe 480x140 - a 3.45:1 box (D-131)
    expect(
      panelGeometry().noteTakesRow,
      "the caption note must overlay the video's top edge: a note in the flow takes a row of the panel (480x130 of the 270) and leaves the iframe 480x140 - a 3.45:1 box, and the video is stretched",
    ).toBe(false);

    const noteRule = rule("&__panel-youtube-note");

    expect(noteRule).toMatch(/position:\s*absolute/);
    expect(noteRule).toMatch(/top:\s*0/);

    // ONE line: what does not fit is an ellipsis, so five lines of the reason
    // never cover a third of the video (D-132)
    expect(noteRule).toMatch(/white-space:\s*nowrap/);
    expect(noteRule).toMatch(/text-overflow:\s*ellipsis/);

    // the note is rendered after the frame, so it paints over it (D-131)
    expect(note!.previousElementSibling).toBe(embed());

    // the WHOLE reason is the tooltip, and the line carries the short truth -
    // the beginning of the reason, which is the part that matters (D-132)
    expect(note!.getAttribute("title")).toBe(REASON);
    expect(note!.textContent).toBe(REASON);
  });
});
