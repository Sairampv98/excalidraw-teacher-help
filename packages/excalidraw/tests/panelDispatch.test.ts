/**
 * The dispatch coverage of a canvas panel.
 *
 * The panel type dispatch checklist
 * (`docs/superpowers/specs/2026-10-21-panel-type-dispatch-checklist.md`)
 * enumerates every place in the repository that switches on an element's
 * `type`, and records, for each one, what a panel must do there. TypeScript
 * does **not** protect those places — `packages/tsconfig.base.json` sets
 * `strict` but not `noImplicitReturns`, so a switch with a `default` arm
 * fails silently — and the compiler catches only about a third of them.
 *
 * This file is what holds the rest honest: one test per recorded decision,
 * named with the row id (AC-57), so the kit's SPEC lint can find it and so a
 * future change that forgets one of these places fails here.
 */

import { describe, expect, it } from "vitest";

import { pointFrom } from "@excalidraw/math";
import {
  ShapeCache,
  distanceToElement,
  getElementBounds,
  getElementShape,
  hasBackground,
  intersectElementWithLineSegment,
  isBindableElement,
  isEligibleFrameChildType,
  isExcalidrawElement,
  isInvisiblySmallElement,
  isRectanguloidElement,
  isRectangularElement,
  shouldTestInside,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { actionToggleCropEditor } from "../actions/actionCropEditor";
import { actionChangePanel } from "../actions/actionProperties";
import { actionAddToLibrary } from "../actions/actionAddToLibrary";
import { getConversionTypeFromElements } from "../components/ConvertElementTypePopup";
import { exportToSvg } from "../scene/export";
import { getAnimatedImageElements } from "../scene/animatedImages";
import { getPanelElements, panelKeepsAspectRatio } from "../scene/panelContent";

import { API } from "./helpers/api";

const POSTER_FILE_ID = "poster-file-1" as FileId;

const panel = (
  overrides: Record<string, unknown> = {},
): ExcalidrawPanelElement =>
  API.createElement({
    type: "panel",
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    panelKind: "video",
    panel: {
      source: {
        type: "file",
        fileId: "source-file-1" as FileId,
        mimeType: "video/mp4",
      },
      options: { naturalWidth: 1920, naturalHeight: 1080, captions: null },
    },
    posterMode: false,
    posterFileId: null,
    ...overrides,
  }) as unknown as ExcalidrawPanelElement;

const poster = (overrides: Record<string, unknown> = {}) =>
  panel({ posterMode: true, posterFileId: POSTER_FILE_ID, ...overrides });

const map = (elements: NonDeletedExcalidrawElement[]) =>
  new Map(elements.map((el) => [el.id, el])) as unknown as ElementsMap;

describe("the panel's dispatch coverage", () => {
  it("AC-57 a panel is an element, a rectanguloid and a rectangle", () => {
    // §3 types.ts — the element union, the rectanguloid union
    // §5 typeChecks.ts — isExcalidrawElement, isRectanguloidElement,
    //                   isRectangularElement
    const element = panel();

    expect(isExcalidrawElement(element)).toBe(true);
    expect(isRectanguloidElement(element)).toBe(true);
    expect(isRectangularElement(element)).toBe(true);
  });

  it("AC-57 a panel is not bindable and not a frame child", () => {
    // §3 types.ts — the bindable union does NOT take the panel
    // §5 typeChecks.ts — isBindableElement, isEligibleFrameChildType
    //
    // Both are deliberate rejects: an arrow must never bind to a panel, and a
    // panel is floating — it is not owned by its page and may sit outside the
    // page rect — so it must never become a frame child.
    const element = panel();

    expect(isBindableElement(element)).toBe(false);
    expect(isEligibleFrameChildType("panel")).toBe(false);
  });

  it("AC-57 a panel has no background, no scale and no crop", () => {
    // §6 — the twelve image-gated sites. A panel is not an image element: it
    // has no `scale` (so a resize never mirrors it), no `crop` (so the
    // in-place crop ghost never applies to it) and no fill of its own.
    const element = panel();

    expect(hasBackground("panel")).toBe(false);
    expect("scale" in element).toBe(false);
    expect("crop" in element).toBe(false);
    expect("initialWidth" in element).toBe(false);
  });

  it("AC-57 a panel's bounds are its own rectangle", () => {
    // §6 bounds.ts — `_isRectanguloidElement` takes the panel
    const element = panel();

    expect(getElementBounds(element, map([element]))).toEqual([
      element.x,
      element.y,
      element.x + element.width,
      element.y + element.height,
    ]);
  });

  it("AC-57 a panel's distance and segment maths treat it as a rectangle", () => {
    // §7 distance.ts, collision.ts — the rectanguloid groups
    const element = panel();
    const elementsMap = map([element]);

    // a point far outside the panel
    expect(
      distanceToElement(element, elementsMap, [5000, 5000] as never),
    ).toBeGreaterThan(0);

    // a segment straight through the panel crosses it
    const intersections = intersectElementWithLineSegment(
      element,
      elementsMap,
      [pointFrom(0, 250), pointFrom(800, 250)] as never,
      0,
      false,
    );

    expect(intersections.length).toBeGreaterThan(0);
  });

  it("AC-57 a panel is grabbed by its interior, like an image", () => {
    // §7 collision.ts — `shouldTestInside`
    const element = panel();

    expect(shouldTestInside(element)).toBe(true);
  });

  it("AC-57 a panel has a shape, and it is the rectangle", () => {
    // §7 shape.ts — `getElementShape` puts the panel in the polygon group,
    // and `generateElementShape` returns null for it (it has no rough border)
    const element = panel();
    const elementsMap = map([element]);

    const shape = getElementShape(element, elementsMap);

    expect(shape).not.toBeNull();
    expect((shape as { type: string }).type).toBe("polygon");
    // a closed polygon: the four corners and the way back to the first
    expect(
      (shape as unknown as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(4);

    expect(ShapeCache.generateElementShape(element, null)).toBe(null);
  });

  it("AC-57 a zero-size panel is not auto-deleted", () => {
    // §7 sizeHelpers.ts — `isInvisiblySmallElement`
    //
    // A panel's size comes from the content it hosts, and a panel that has
    // not measured its content yet is still a real element.
    const element = panel({ width: 0, height: 0 });

    expect(isInvisiblySmallElement(element)).toBe(false);
  });

  it("AC-57 a poster panel keeps its aspect ratio and a live panel does not", () => {
    // §6 resizeElements.ts / Stats/Dimension.tsx — the poster rule
    expect(panelKeepsAspectRatio(poster())).toBe(true);
    expect(panelKeepsAspectRatio(panel())).toBe(false);
  });

  it("AC-57 the overlay collects the live panels and not the posters", () => {
    // §7 animatedImages.ts — the parallel `getPanelElements`, and the
    // animated-image list that a poster must NOT be in
    const live = panel();
    const posterPanel = poster();

    expect(getPanelElements([live, posterPanel])).toEqual([live]);
    expect(getAnimatedImageElements([live, posterPanel], {})).toEqual([]);
  });

  it("AC-57 a poster panel is embedded in the exported SVG", () => {
    // §6 staticSvgScene.ts — the poster must be embedded, at the panel's
    // bounds
    const posterPanel = poster();

    return exportToSvg(
      [posterPanel as unknown as NonDeletedExcalidrawElement],
      {
        exportBackground: false,
        viewBackgroundColor: "#ffffff",
        exportScale: 1,
      },
      {
        [POSTER_FILE_ID]: {
          id: POSTER_FILE_ID,
          dataURL: "data:image/png;base64,POSTER" as never,
          mimeType: "image/png",
          created: 1,
        },
      },
    ).then((svg) => {
      const images = svg.querySelectorAll("image");

      expect(images.length).toBe(1);
      expect(images[0].getAttribute("href")).toBe(
        "data:image/png;base64,POSTER",
      );
      expect(images[0].getAttribute("width")).toBe(String(posterPanel.width));
      expect(images[0].getAttribute("height")).toBe(String(posterPanel.height));
    });
  });

  it("AC-57 a live panel exports as nothing", () => {
    // §6 — there is no DOM overlay in an export, and a live panel has no
    // poster until it is locked
    const live = panel();

    return exportToSvg(
      [live as unknown as NonDeletedExcalidrawElement],
      {
        exportBackground: false,
        viewBackgroundColor: "#ffffff",
        exportScale: 1,
      },
      {},
    ).then((svg) => {
      expect(svg.querySelectorAll("image").length).toBe(0);
    });
  });

  it("AC-57 a panel is not convertible to another shape", () => {
    // §8 ConvertElementTypePopup.tsx — panels are not convertible
    expect(getConversionTypeFromElements([panel()])).toBe(null);
  });

  it("AC-57 the crop entry point accepts a poster panel", () => {
    // §6 actionCropEditor.tsx — the crop action is enabled for a poster
    // panel; the library's in-place crop handlers are all `isImageElement`-
    // guarded, so the panel itself is left untouched (D-68)
    const posterPanel = poster();

    expect(
      actionToggleCropEditor.predicate(
        [posterPanel as unknown as NonDeletedExcalidrawElement],
        {
          selectedElementIds: { [posterPanel.id]: true },
        } as never,
        {} as never,
        {
          scene: {
            getSelectedElements: () => [posterPanel],
          },
        } as never,
      ),
    ).toBe(true);
  });

  it("AC-57 the panel's chrome has a home in the properties panel", () => {
    // §8 actionProperties.tsx — the per-type property panel
    expect(actionChangePanel.name).toBe("changePanel");
    expect(typeof actionChangePanel.PanelComponent).toBe("function");
  });

  it("AC-57 a live panel may not be added to the library", () => {
    // §8 actionAddToLibrary.ts — a live surface is not meaningful in a
    // shared library; a poster is, because it is an ordinary picture
    const live = panel();

    const result = actionAddToLibrary.perform(
      [live as unknown as NonDeletedExcalidrawElement] as never,
      { selectedElementIds: { [live.id]: true } } as never,
      null,
      {
        scene: {
          getSelectedElements: () => [live],
        },
      } as never,
    ) as { appState?: { errorMessage?: string } } | undefined;

    expect(result?.appState?.errorMessage).toBeTruthy();
  });
});
