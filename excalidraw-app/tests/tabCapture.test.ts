/**
 * The picture of a part of the tab: where an element is in a frame of the tab,
 * and what is said when the browser cannot or the teacher did not allow it
 * (D-352).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TabCaptureError,
  captureTabRegion,
  captureYoutubePicture,
  fitAspect,
  regionInFrame,
  releaseTabCapture,
} from "../bridge/tabCapture";

afterEach(() => {
  releaseTabCapture();
  vi.unstubAllGlobals();
});

describe("the part of the tab that is the player", () => {
  it("AC-412 an element is found in a frame whose scale is measured, not assumed", () => {
    // a 1000x600 viewport that the frame shows at twice the size
    expect(
      regionInFrame(
        { left: 100, top: 50, width: 300, height: 200 },
        { width: 1000, height: 600 },
        { width: 2000, height: 1200 },
      ),
    ).toEqual({ x: 200, y: 100, width: 600, height: 400 });

    // a frame that is not the viewport's shape is scaled on each axis
    expect(
      regionInFrame(
        { left: 100, top: 50, width: 300, height: 200 },
        { width: 1000, height: 600 },
        { width: 1500, height: 600 },
      ),
    ).toEqual({ x: 150, y: 50, width: 450, height: 200 });
  });

  it("AC-412 the part that is outside the viewport is cut off, and an element outside is nothing", () => {
    const viewport = { width: 1000, height: 600 };
    const frame = { width: 1000, height: 600 };

    // half of it is past the left edge and the top
    expect(
      regionInFrame(
        { left: -100, top: -50, width: 300, height: 200 },
        viewport,
        frame,
      ),
    ).toEqual({ x: 0, y: 0, width: 200, height: 150 });

    // and past the right and the bottom
    expect(
      regionInFrame(
        { left: 900, top: 500, width: 300, height: 200 },
        viewport,
        frame,
      ),
    ).toEqual({ x: 900, y: 500, width: 100, height: 100 });

    // none of it is inside: there is no picture
    expect(
      regionInFrame(
        { left: 1200, top: 0, width: 300, height: 200 },
        viewport,
        frame,
      ),
    ).toBeNull();
    expect(
      regionInFrame(
        { left: 0, top: 0, width: 300, height: 200 },
        { width: 0, height: 0 },
        frame,
      ),
    ).toBeNull();
  });

  it("AC-412 a browser that cannot share the tab says so, and so does a teacher who did not allow it", async () => {
    // no way to ask
    vi.stubGlobal("navigator", { mediaDevices: undefined });

    await expect(
      captureTabRegion({ left: 0, top: 0, width: 10, height: 10 }),
    ).rejects.toMatchObject({ reason: "unsupported" });

    // the teacher pressed "Don't allow"
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: () => Promise.reject(new Error("NotAllowedError")),
      },
    });

    const refused = await captureTabRegion({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    }).catch((error) => error);

    expect(refused).toBeInstanceOf(TabCaptureError);
    expect(refused.reason).toBe("not-shared");

    // the teacher chose a window or a screen, and not this tab: its geometry is
    // not the tab's, so it is not used - and it is stopped
    const stop = vi.fn();

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: () =>
          Promise.resolve({
            getVideoTracks: () => [
              { getSettings: () => ({ displaySurface: "monitor" }), stop },
            ],
            getTracks: () => [{ stop }],
          }),
      },
    });

    await expect(
      captureTabRegion({ left: 0, top: 0, width: 10, height: 10 }),
    ).rejects.toMatchObject({ reason: "not-shared" });
    expect(stop).toHaveBeenCalled();
  });
});

describe("the YouTube player full screen (D-362)", () => {
  it("AC-422 the picture is the player's own shape, in the middle of the screen", () => {
    // a 16:9 player on a 16:10 screen: bars above and below
    expect(
      fitAspect({ left: 0, top: 0, width: 1600, height: 1000 }, 16 / 9),
    ).toEqual({ left: 0, top: 50, width: 1600, height: 900 });

    // on a screen wider than the player: bars at the sides
    const wide = fitAspect(
      { left: 0, top: 0, width: 2000, height: 900 },
      16 / 9,
    );

    expect(wide.height).toBe(900);
    expect(wide.width).toBeCloseTo(1600, 5);
    expect(wide.left).toBeCloseTo(200, 5);

    // and one that is the player's shape is the whole of it
    expect(
      fitAspect({ left: 10, top: 20, width: 1920, height: 1080 }, 16 / 9),
    ).toEqual({ left: 10, top: 20, width: 1920, height: 1080 });
  });

  it("AC-422 a refused tab leaves full screen, and a browser with no full screen still answers", async () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    const frame = document.createElement("div");
    let fullscreenElement: Element | null = null;

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: () => {
        fullscreenElement = null;

        return exitFullscreen();
      },
    });

    (
      frame as unknown as { requestFullscreen: () => Promise<void> }
    ).requestFullscreen = () => {
      fullscreenElement = frame;

      return Promise.resolve();
    };

    // the teacher said "Don't allow" while the player was full screen
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: () => Promise.reject(new Error("NotAllowedError")),
      },
    });

    await expect(captureYoutubePicture(frame, 16 / 9, 0)).rejects.toMatchObject(
      { reason: "not-shared" },
    );

    // full screen is left, and not left behind
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();

    // a player that cannot go full screen does not stop the picture: the tab
    // is asked for all the same
    const plain = document.createElement("div");

    await expect(captureYoutubePicture(plain, null, 0)).rejects.toMatchObject({
      reason: "not-shared",
    });
  });
});
