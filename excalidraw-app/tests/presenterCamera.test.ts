import { describe, expect, it } from "vitest";

import {
  getPageRelativeCamera,
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
} from "@excalidraw/excalidraw";

import type { AppState } from "@excalidraw/excalidraw/types";

import {
  getPresenterCamera,
  resolvePresenterCamera,
} from "../presenter/presenterChannel";

import type { PresenterCamera } from "../presenter/presenterChannel";

const PAGES = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

/**
 * Minimal stand-in for the slice of `AppState` `getPresenterCamera` reads.
 * The camera fields are the ones under test; the rest are irrelevant.
 */
const makeAppState = (overrides: Partial<AppState> = {}): AppState =>
  ({
    scrollX: 0,
    scrollY: 0,
    zoom: { value: 1 },
    viewBackgroundColor: "#ffffff",
    gridModeEnabled: false,
    gridSize: null,
    pages: PAGES,
    currentPageId: "page-1",
    width: 1000,
    height: 700,
    ...overrides,
  } as unknown as AppState);

/** scene-space extent the given camera shows on each axis */
const visibleExtent = (
  camera: Pick<AppState, "zoom" | "width" | "height">,
  viewport: { width: number; height: number },
) => ({
  width: viewport.width / camera.zoom.value,
  height: viewport.height / camera.zoom.value,
});

/**
 * The core contract: whatever size the projector window happens to be, it
 * must show exactly as much of the page as the editor does — anchored at the
 * same page-relative offset. This is the regression test for the projector
 * appearing magnified, which happened because the presenter derived its zoom
 * from a stale (editor-persisted) viewport size instead of its own.
 */
describe("resolvePresenterCamera", () => {
  const cases: Array<{
    name: string;
    editor: { width: number; height: number };
    presenter: { width: number; height: number };
    zoom: number;
    scrollX: number;
    scrollY: number;
    pageId?: string;
  }> = [
    {
      name: "editor and projector are the same size",
      editor: { width: 803, height: 531 },
      presenter: { width: 803, height: 531 },
      zoom: 0.6667,
      scrollX: 0,
      scrollY: 0,
    },
    {
      name: "projector is much larger than the editor",
      editor: { width: 803, height: 531 },
      presenter: { width: 1920, height: 1080 },
      zoom: 0.6667,
      scrollX: 0,
      scrollY: 0,
    },
    {
      name: "editor is zoomed into a corner of the page",
      editor: { width: 1200, height: 800 },
      presenter: { width: 1920, height: 1200 },
      zoom: 1.4,
      scrollX: 320,
      scrollY: 180,
    },
    {
      name: "scrolled deep into a later page",
      editor: { width: 900, height: 600 },
      presenter: { width: 1600, height: 900 },
      zoom: 0.8,
      scrollX: 0,
      scrollY: 0,
      pageId: "page-2",
    },
  ];

  it.each(cases)(
    "shows the same slice of the page: $name",
    ({ editor, presenter, zoom, scrollX, scrollY, pageId }) => {
      const appState = makeAppState({
        width: editor.width,
        height: editor.height,
        zoom: { value: zoom } as AppState["zoom"],
        scrollX,
        scrollY,
        currentPageId: pageId ?? "page-1",
      });

      const camera = getPresenterCamera(appState, true);
      const resolved = resolvePresenterCamera(camera, presenter);

      // same page-relative anchor
      const editorAnchor = getPageRelativeCamera({
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        pageRect: getPageRect(camera),
      });
      const projectorAnchor = getPageRelativeCamera({
        scrollX: resolved.scrollX,
        scrollY: resolved.scrollY,
        pageRect: getPageRect(camera),
      });

      expect(projectorAnchor.offsetX).toBeCloseTo(editorAnchor.offsetX, 6);
      expect(projectorAnchor.offsetY).toBeCloseTo(editorAnchor.offsetY, 6);

      // same fraction of the page width — the projector is zoomed so that its
      // own viewport covers exactly the editor's scene-space extent
      const editorVisible = visibleExtent(appState, editor);
      const projectorVisible = visibleExtent(
        { ...resolved, width: presenter.width, height: presenter.height },
        presenter,
      );

      expect(projectorVisible.width).toBeCloseTo(editorVisible.width, 6);
    },
  );

  it("does not blow the zoom up when the reported viewport is stale", () => {
    // what actually happened: the presenter read a persisted 1280x720 out of
    // appState while its real canvas was 803x531, inflating zoom by ~1.59x
    const editor = { width: 803, height: 531 };
    const camera = getPresenterCamera(
      makeAppState({
        ...editor,
        zoom: { value: 0.6667 } as AppState["zoom"],
      }),
      true,
    );

    const withRealViewport = resolvePresenterCamera(camera, {
      width: 803,
      height: 531,
    });
    const withStaleViewport = resolvePresenterCamera(camera, {
      width: 1280,
      height: 720,
    });

    expect(withRealViewport.zoom.value).toBeCloseTo(0.6667, 3);
    // the stale size legitimately asks for a bigger zoom (bigger window, same
    // slice), but it must never be applied on top of a scene that was already
    // measured — hence the presenter re-derives rather than caching
    expect(
      withStaleViewport.zoom.value / withRealViewport.zoom.value,
    ).toBeCloseTo(1280 / 803, 6);
  });

  it("falls back to the raw camera while the viewport is unmeasured", () => {
    const appState = makeAppState({
      width: 1000,
      height: 700,
      scrollX: -120,
      scrollY: -60,
      zoom: { value: 0.5 } as AppState["zoom"],
    });
    const camera = getPresenterCamera(appState, true);

    const resolved = resolvePresenterCamera(camera, { width: 0, height: 0 });

    expect(resolved.scrollX).toBe(appState.scrollX);
    expect(resolved.scrollY).toBe(appState.scrollY);
    expect(resolved.zoom.value).toBe(appState.zoom.value);
  });

  it("never zooms out past the whole page, even on a very wide projector", () => {
    // the editor is showing *more* than the page width, which the projector
    // cannot match — it has to fall back to the whole page instead of
    // zooming out into empty canvas around it
    const camera = getPresenterCamera(
      makeAppState({
        width: 400,
        height: 300,
        zoom: { value: 0.15 } as AppState["zoom"],
      }),
      true,
    );

    const presenter = { width: 3000, height: 1600 };
    const resolved = resolvePresenterCamera(camera, presenter);

    const fitZoom = Math.min(
      presenter.width / PAGE_WIDTH,
      presenter.height / PAGE_HEIGHT,
    );
    expect(resolved.zoom.value).toBeCloseTo(fitZoom, 6);
  });

  it("mirrors the raw camera when pages are disabled", () => {
    const appState = makeAppState({
      scrollX: -400,
      scrollY: -250,
      zoom: { value: 1.25 } as AppState["zoom"],
    });
    const camera = getPresenterCamera(appState, false);

    const resolved = resolvePresenterCamera(camera, {
      width: 1920,
      height: 1080,
    });

    expect(resolved.scrollX).toBe(appState.scrollX);
    expect(resolved.scrollY).toBe(appState.scrollY);
    expect(resolved.zoom.value).toBe(appState.zoom.value);
  });
});

/** the page rect the camera is anchored to (index-based, as the app does it) */
const getPageRect = (camera: PresenterCamera) => {
  const index = Math.max(
    0,
    camera.pages.findIndex((page) => page.id === camera.currentPageId),
  );
  return {
    x: index * PAGE_GAP,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  };
};
