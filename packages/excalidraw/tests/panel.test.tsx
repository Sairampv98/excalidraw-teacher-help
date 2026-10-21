/**
 * The canvas panel: the element, its restore, its two modes, and its lock
 * transition.
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { describe, expect, it } from "vitest";

import React from "react";

import { THEME } from "@excalidraw/common";
import {
  isLivePanelElement,
  isPanelElement,
  isPosterPanelElement,
  renderElement,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";
import { getDefaultAppState } from "../appState";
import {
  panelLockUpdate,
  panelPosterSpec,
  panelUnlockUpdate,
} from "../scene/lockPanel";
import { panelNativeSize } from "../scene/panelContent";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { render } from "./test-utils";

import type { StaticCanvasAppState } from "../types";
import type { StaticCanvasRenderConfig } from "../scene/types";

const POSTER_FILE_ID = "poster-file-1" as FileId;
const SOURCE_FILE_ID = "source-file-1" as FileId;

const panel = (
  overrides: Partial<Record<string, unknown>> = {},
): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 120,
    y: 80,
    width: 400,
    height: 300,
    panelKind: "video",
    panel: {
      source: { type: "file", fileId: SOURCE_FILE_ID, mimeType: "video/mp4" },
      options: {
        naturalWidth: 1920,
        naturalHeight: 1080,
        captions: null,
      },
    },
    posterMode: false,
    posterFileId: null,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

const map = (elements: NonDeletedExcalidrawElement[]) =>
  new Map(elements.map((el) => [el.id, el])) as unknown as ElementsMap;

const canvasContext = () => {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  return context as CanvasRenderingContext2D & {
    __getDrawCalls: () => { type: string; props: Record<string, unknown> }[];
  };
};

const renderConfig = (
  overrides: Partial<StaticCanvasRenderConfig> = {},
): StaticCanvasRenderConfig => ({
  canvasBackgroundColor: "#ffffff",
  imageCache: new Map(),
  renderGrid: false,
  isExporting: false,
  embedsValidationStatus: new Map(),
  elementsPendingErasure: new Set(),
  pendingFlowchartNodes: null,
  theme: THEME.LIGHT,
  ...overrides,
});

const appState = (): StaticCanvasAppState => {
  const state = getDefaultAppState();

  return {
    ...state,
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 as StaticCanvasAppState["zoom"]["value"] },
    width: 1200,
    height: 800,
    offsetLeft: 0,
    offsetTop: 0,
    theme: THEME.LIGHT,
  };
};

describe("the panel element", () => {
  it("AC-52 a panel survives a save and restore round trip", () => {
    // the case that would have caught the silent drop: without a
    // `case "panel":` in `restoreElement`, the switch falls through to
    // `return null` and `restoreElements` filters the panel out — so the
    // panel works in the editor and then vanishes on reload.
    const original = panel({
      posterMode: true,
      posterFileId: POSTER_FILE_ID,
    });

    const restored = restoreElements([original], null);

    expect(restored).toHaveLength(1);

    const restoredPanel = restored[0] as unknown as ExcalidrawPanelElement;

    expect(restoredPanel.type).toBe("panel");
    expect(restoredPanel.posterMode).toBe(true);
    expect(restoredPanel.posterFileId).toBe(POSTER_FILE_ID);
    expect(restoredPanel.panelKind).toBe("video");
    expect(restoredPanel.panel).toEqual(original.panel);
  });

  it("AC-52 a live panel survives a save and restore round trip too", () => {
    const original = panel();

    const restored = restoreElements([original], null);

    expect(restored).toHaveLength(1);

    const restoredPanel = restored[0] as unknown as ExcalidrawPanelElement;

    expect(restoredPanel.type).toBe("panel");
    expect(restoredPanel.posterMode).toBe(false);
    expect(restoredPanel.posterFileId).toBe(null);
    expect(restoredPanel.panelKind).toBe("video");
  });

  it("AC-53 a live panel is not painted by the canvas", () => {
    const live = panel() as unknown as NonDeletedExcalidrawElement;
    const elementsMap = map([live]);

    // the canvas path (not the export path): a live panel must produce no
    // draw call at all, because its content is a DOM surface
    const context = canvasContext();

    renderElement(
      live,
      elementsMap as never,
      elementsMap as never,
      null as never,
      context,
      renderConfig(),
      appState(),
    );

    expect(context.__getDrawCalls()).toHaveLength(0);

    // and the export path paints nothing either: there is no DOM overlay in
    // an export, so a live panel exports as nothing
    const exportContext = canvasContext();

    renderElement(
      live,
      elementsMap as never,
      elementsMap as never,
      null as never,
      exportContext,
      renderConfig({ isExporting: true }),
      appState(),
    );

    expect(exportContext.__getDrawCalls()).toHaveLength(0);
  });

  it("AC-53 a poster panel is painted at the panel's bounds", () => {
    const poster = panel({
      posterMode: true,
      posterFileId: POSTER_FILE_ID,
    }) as unknown as NonDeletedExcalidrawElement;

    const elementsMap = map([poster]);

    const image = new Image();
    // jsdom's <img> has no intrinsic size, and the canvas mock refuses
    // anything that is not a real image source
    Object.defineProperty(image, "naturalWidth", { value: 1920 });
    Object.defineProperty(image, "naturalHeight", { value: 1080 });

    const context = canvasContext();

    renderElement(
      poster,
      elementsMap as never,
      elementsMap as never,
      null as never,
      context,
      renderConfig({
        isExporting: true,
        imageCache: new Map([
          [POSTER_FILE_ID, { image, mimeType: "image/png" }],
        ]) as never,
      }),
      appState(),
    );

    const drawImages = context
      .__getDrawCalls()
      .filter((call) => call.type === "drawImage");

    expect(drawImages).toHaveLength(1);

    // the poster is stretched to the panel's bounds — the poster's own
    // pixels are the source, the panel's size is the destination
    expect(drawImages[0].props).toMatchObject({
      dx: 0,
      dy: 0,
      dWidth: poster.width,
      dHeight: poster.height,
      sx: 0,
      sy: 0,
      sWidth: 1920,
      sHeight: 1080,
    });
  });

  it("AC-55 locking a panel produces a poster at the content's native resolution", () => {
    // the panel is shown at 400×300 on the canvas, but its content is
    // 1920×1080 — the poster must be the content's size, not the panel's
    const live = panel();

    expect(live.width).toBe(400);
    expect(live.height).toBe(300);

    const spec = panelPosterSpec(live);

    expect(spec.width).toBe(1920);
    expect(spec.height).toBe(1080);
    expect(spec.width).not.toBe(live.width);
    expect(spec.height).not.toBe(live.height);
  });

  it("AC-55 the poster's size comes from the content, not from the on-canvas size", () => {
    // the panel is resized on the canvas; the content's native size does not
    // move with it
    const live = panel({ width: 1000, height: 750 });

    expect(panelNativeSize(live)).toEqual({ width: 1920, height: 1080 });
    expect(panelPosterSpec(live)).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });

  it("AC-55 locking is reversible and leaves the live payload alone", () => {
    const live = panel();
    const originalPayload = live.panel;

    const locked = { ...live, ...panelLockUpdate(POSTER_FILE_ID) };

    expect(locked.posterMode).toBe(true);
    expect(locked.posterFileId).toBe(POSTER_FILE_ID);
    // the live payload is never discarded, so unlocking restores the panel
    // exactly as it was
    expect(locked.panel).toEqual(originalPayload);

    const unlocked = { ...locked, ...panelUnlockUpdate() };

    expect(unlocked.posterMode).toBe(false);
    expect(unlocked.posterFileId).toBe(null);
    expect(unlocked.panel).toEqual(originalPayload);
    expect(unlocked.width).toBe(live.width);
    expect(unlocked.height).toBe(live.height);
  });

  it("AC-57 the live/poster discriminator is posterMode and not the base locked flag", () => {
    const live = panel();

    expect(live.locked).toBe(false);
    expect(isLivePanelElement(live)).toBe(true);
    expect(isPosterPanelElement(live)).toBe(false);

    const poster = panel({
      posterMode: true,
      posterFileId: POSTER_FILE_ID,
    });

    // the base `locked` stays false in BOTH modes: a locked element is
    // un-selectable, and a poster panel has to stay selectable
    expect(poster.locked).toBe(false);
    expect(isLivePanelElement(poster)).toBe(false);
    expect(isPosterPanelElement(poster)).toBe(true);
    expect(isPanelElement(poster)).toBe(true);
  });

  it("AC-57 a panel is floating: it is not owned by its page", () => {
    // `floating` is opt-in and never set automatically, so the panel's own
    // factory has to set it — and its nine read sites already mean "not
    // owned by its page, may sit outside the page rect, and widens the
    // camera clamp"
    expect(panel().floating).toBe(true);
  });

  it("AC-57 a restored panel is floating too", () => {
    const restored = restoreElements([panel()], null);

    expect(restored[0].floating).toBe(true);
  });

  it("AC-57 the library mounts the panel overlay, so the presenter gets it for free", async () => {
    // §7 App.tsx — the overlay is mounted by the **library**, which is what
    // makes a mirrorable panel need no presenter code at all (D-64): the
    // presenter is a second Excalidraw instance, so anything the library
    // mounts is mounted there too.
    await render(<Excalidraw />);

    // jsdom has no layout, so the editor's own viewport is 0×0 and nothing
    // would be visible
    API.setAppState({ width: 1000, height: 1000 });

    API.setElements([
      panel() as unknown as NonDeletedExcalidrawElement,
      panel({
        id: "poster-panel",
        posterMode: true,
        posterFileId: POSTER_FILE_ID,
      }) as unknown as NonDeletedExcalidrawElement,
    ]);

    const overlay = document.querySelector('[data-testid="panel-overlay"]');

    expect(overlay).not.toBeNull();

    // the live panel is mounted; the poster is not — the canvas paints it
    const mounted = overlay!.querySelectorAll('[data-testid="panel"]');

    expect(mounted.length).toBe(1);
    expect(mounted[0].getAttribute("data-panel-id")).not.toBe("poster-panel");
  });
});
