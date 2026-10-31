/**
 * Exporting an animation with GIFs and animated WebPs in it (D-391): each
 * picture of the file shows the frame of such a file that belongs to its moment,
 * chosen from the moment alone - not whichever frame the browser held.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDefaultAppState } from "../appState";
import { createFrameSource } from "../scene/flowExport/browser";
import { exportFlowAnimation } from "../scene/flowExport/exportAnimation";
import {
  animatedFileIdsOf,
  atMoment,
  frameDurationMs,
  frameIndexAt,
  mediaStateAt,
} from "../scene/flowExport/media";
import { FLOW_LOOK_DEFAULTS } from "../scene/flowLook";

import { API } from "./helpers/api";

import type { AnimatedMedia, DecoderLike } from "../scene/flowExport/media";
import type { BinaryFiles } from "../types";

const given: {
  elements: readonly { id: string; fileId?: string | null }[];
  files: BinaryFiles;
  options?: { imageCache?: Map<string, unknown> };
}[] = [];

vi.mock("../scene/export", () => ({
  exportToCanvas: vi.fn(
    async (
      elements: never,
      _appState: never,
      files: never,
      options: never,
      createCanvas?: (
        w: number,
        h: number,
      ) => { canvas: HTMLCanvasElement; scale: number },
    ) => {
      given.push({ elements, files, options });

      return createCanvas?.(0, 0).canvas ?? document.createElement("canvas");
    },
  ),
}));

vi.mock("../scene/flowExport/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scene/flowExport/runner")>()),
  runFlowExport: vi.fn(async () => new Uint8Array([1])),
}));

vi.mock("../scene/flowExport/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scene/flowExport/browser")>()),
  createFrameSource: vi.fn(
    (await importOriginal<typeof import("../scene/flowExport/browser")>())
      .createFrameSource,
  ),
}));

const clap = (durations: number[]): AnimatedMedia => ({
  fileId: "gif1",
  durations,
  total: durations.reduce((sum, each) => sum + each, 0),
  frameUrl: async (index) => `data:image/png;base64,F${index}`,
});

vi.mock("../scene/flowExport/media", async (importOriginal) => {
  const real = await importOriginal<
    typeof import("../scene/flowExport/media")
  >();

  return { ...real, loadAnimatedMedia: vi.fn(async () => []) };
});

// the reader itself, not the stand-in the export tests below use
const { loadAnimatedMedia } = await vi.importActual<
  typeof import("../scene/flowExport/media")
>("../scene/flowExport/media");

describe("frames of a moving picture", () => {
  it("AC-453 a frame that says next to nothing is shown for a tenth of a second", () => {
    expect(frameDurationMs(null)).toBe(100);
    expect(frameDurationMs(0)).toBe(100);
    expect(frameDurationMs(10_000)).toBe(100);
    expect(frameDurationMs(20_000)).toBe(20);
    expect(frameDurationMs(70_000)).toBe(70);
  });

  it("AC-453 the frame at a moment comes from the moment alone, and the file loops by its own length", () => {
    const durations = [100, 200, 100];

    expect(frameIndexAt(durations, 0)).toBe(0);
    expect(frameIndexAt(durations, 99)).toBe(0);
    expect(frameIndexAt(durations, 100)).toBe(1);
    expect(frameIndexAt(durations, 299)).toBe(1);
    expect(frameIndexAt(durations, 300)).toBe(2);
    expect(frameIndexAt(durations, 399)).toBe(2);
    // round again
    expect(frameIndexAt(durations, 400)).toBe(0);
    expect(frameIndexAt(durations, 4_150)).toBe(1);
    expect(frameIndexAt([], 50)).toBe(0);
  });

  it("AC-453 the state of the pictures changes exactly when one goes on to another frame", () => {
    const media = [clap([100, 100]), { ...clap([50, 50]), fileId: "b" }];

    expect(mediaStateAt(media, 0)).toBe("0,0");
    expect(mediaStateAt(media, 49)).toBe("0,0");
    expect(mediaStateAt(media, 50)).toBe("0,1");
    expect(mediaStateAt(media, 100)).toBe("1,0");
    expect(mediaStateAt([], 100)).toBe("");
  });

  it("AC-453 only the images that move are looked for: a GIF, an animated WebP, not a PNG", () => {
    const gif = API.createElement({ type: "image", fileId: "g" as never });
    const png = API.createElement({ type: "image", fileId: "p" as never });
    const box = API.createElement({ type: "rectangle" });
    const gone = API.createElement({
      type: "image",
      fileId: "g" as never,
      isDeleted: true,
    });
    const files = {
      g: {
        id: "g",
        mimeType: "image/gif",
        dataURL: "data:image/gif;base64,AA",
      },
      p: {
        id: "p",
        mimeType: "image/png",
        dataURL: "data:image/png;base64,AA",
      },
    } as unknown as BinaryFiles;

    expect(animatedFileIdsOf([png, box], files)).toEqual([]);
    expect(animatedFileIdsOf([gif, png, box, gif], files)).toEqual(["g"]);
    expect(animatedFileIdsOf([gone], files)).toEqual([]);
  });

  it("AC-453 at a moment each image shows its frame as a file of its own, and the rest is left alone", async () => {
    const image = API.createElement({ type: "image", fileId: "gif1" as never });
    const other = API.createElement({ type: "rectangle" });
    const files = {
      gif1: {
        id: "gif1",
        mimeType: "image/gif",
        dataURL: "data:image/gif;base64,AA",
        created: 5,
      },
    } as unknown as BinaryFiles;
    const media = [clap([100, 100, 100])];

    const at = await atMoment([image, other], files, media, 250);
    const shown = at.elements[0] as unknown as { fileId: string };

    expect(shown.fileId).toBe("gif1@2");
    expect(at.files["gif1@2"].dataURL).toBe("data:image/png;base64,F2");
    expect(at.files["gif1@2"].mimeType).toBe("image/png");
    expect(at.files["gif1@2"].created).toBe(5);
    // the others are the same objects, and the page's own element is not touched
    expect(at.elements[1]).toBe(other);
    expect((image as unknown as { fileId: string }).fileId).toBe("gif1");
    expect(files["gif1@2"]).toBeUndefined();

    // with nothing moving the elements are as they were
    const still = await atMoment([image], files, [], 250);

    expect(still.elements[0]).toBe(image);
    expect(still.files).toBe(files);
  });
});

describe("reading the frames", () => {
  const files = {
    g: {
      id: "g",
      mimeType: "image/gif",
      dataURL: `data:image/gif;base64,${btoa("GIF89a")}`,
    },
  } as unknown as BinaryFiles;

  const decoder = (
    frames: (number | null)[],
    log: number[] = [],
  ): DecoderLike => ({
    tracks: {
      ready: Promise.resolve(),
      selectedTrack: { frameCount: frames.length },
    },
    decode: async ({ frameIndex }) => {
      log.push(frameIndex);

      return {
        image: { duration: frames[frameIndex], close: () => undefined },
      };
    },
    close: () => undefined,
  });

  it("AC-453 every frame is read for its length, and a picture of a frame is made once", async () => {
    const log: number[] = [];
    const toDataUrl = vi.fn(() => "data:image/png;base64,P");

    const [media] = await loadAnimatedMedia(["g"], files, {
      createDecoder: () => decoder([100_000, null, 30_000], log),
      toDataUrl,
    });

    expect(media.durations).toEqual([100, 100, 30]);
    expect(media.total).toBe(230);
    expect(log).toEqual([0, 1, 2]);
    expect(toDataUrl).not.toHaveBeenCalled();

    expect(await media.frameUrl(1)).toBe("data:image/png;base64,P");
    expect(await media.frameUrl(1)).toBe("data:image/png;base64,P");
    expect(toDataUrl).toHaveBeenCalledTimes(1);
    expect(log).toEqual([0, 1, 2, 1]);
  });

  it("AC-453 a file that cannot be read, or is one picture, is left out and stays one picture", async () => {
    const none = await loadAnimatedMedia(["g"], files, {
      createDecoder: () => null,
      toDataUrl: () => "",
    });
    const single = await loadAnimatedMedia(["g"], files, {
      createDecoder: () => decoder([100_000]),
      toDataUrl: () => "",
    });
    const broken = await loadAnimatedMedia(["g"], files, {
      createDecoder: () => {
        throw new Error("not a picture");
      },
      toDataUrl: () => "",
    });
    const missing = await loadAnimatedMedia(["nope"], files, {
      createDecoder: () => decoder([1, 1]),
      toDataUrl: () => "",
    });

    expect(none).toEqual([]);
    expect(single).toEqual([]);
    expect(broken).toEqual([]);
    expect(missing).toEqual([]);
  });
});

describe("an export with a moving picture in it", () => {
  const run = async (camera: boolean, media: AnimatedMedia[]) => {
    const { loadAnimatedMedia: load } = await import(
      "../scene/flowExport/media"
    );

    vi.mocked(load).mockResolvedValue(media);
    vi.mocked(createFrameSource).mockClear();
    given.length = 0;

    const box = API.createElement({
      type: "rectangle",
      id: "n1",
      x: 0,
      y: 0,
    });
    const image = API.createElement({
      type: "image",
      id: "i1",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      fileId: "gif1" as never,
    });
    const steps = [
      {
        containerId: "n1",
        elementIds: ["n1", "i1"],
        box: { x: 0, y: 0, width: 100, height: 100 },
      },
    ];

    await exportFlowAnimation({
      graph: {
        steps,
        edges: [],
        edgeArrows: [],
      },
      steps,
      elements: [box, image],
      appState: { ...getDefaultAppState(), width: 800, height: 600 } as never,
      files: {
        gif1: {
          id: "gif1",
          mimeType: "image/gif",
          dataURL: "data:image/gif;base64,AA",
          created: 1,
        },
      } as never,
      animation: {
        ...FLOW_LOOK_DEFAULTS,
        durationMs: 1000,
        nodeStyle: "focus",
        arrowStyle: "none",
        speed: 60,
      },
      options: {
        format: "gif",
        fps: 10,
        longest: 480,
        shape: "square",
        withBackground: true,
        camera,
      },
      name: "chart",
      onProgress: () => undefined,
      isStopped: () => false,
    });

    return vi.mocked(createFrameSource).mock.calls[0][0];
  };

  beforeEach(() => {
    given.length = 0;
  });

  it("AC-453 with a moving picture the chart is not drawn up front: each picture of the file draws its own frame", async () => {
    const options = await run(false, [clap([100, 100])]);

    expect(options.base).toBeNull();
    expect(given).toHaveLength(0);
    expect(options.view).toBeDefined();
    // without the camera nothing flies, but the pictures still go on
    expect(options.view!.transformAt).toBeUndefined();
    expect(options.view!.stateAt!(0)).toBe("0");
    expect(options.view!.stateAt!(150)).toBe("1");

    await options.view!.renderBase(options.transform, 150);

    const drawn = given[0];
    const shown = drawn.elements.find((e) => e.id === "i1")!;

    expect(shown.fileId).toBe("gif1@1");
    expect(drawn.files["gif1@1"].dataURL).toBe("data:image/png;base64,F1");

    await options.view!.renderBase(options.transform, 250);

    expect(given[1].elements.find((e) => e.id === "i1")!.fileId).toBe("gif1@0");
  });

  it("AC-453 the pictures the canvas has loaded are kept from one picture of the file to the next", async () => {
    const options = await run(false, [clap([100, 100])]);

    await options.view!.renderBase(options.transform, 0);
    await options.view!.renderBase(options.transform, 150);

    expect(given[0].options!.imageCache).toBeInstanceOf(Map);
    expect(given[1].options!.imageCache).toBe(given[0].options!.imageCache);
  });

  it("AC-453 with the camera as well the camera still flies and the frames still go on", async () => {
    const options = await run(true, [clap([100, 100])]);

    expect(options.view!.transformAt).toBeDefined();
    expect(options.view!.stateAt).toBeDefined();
  });

  it("AC-453 a chart with nothing that moves is drawn once, as before", async () => {
    const options = await run(false, []);

    expect(options.view).toBeUndefined();
    expect(options.base).not.toBeNull();
    expect(given).toHaveLength(1);
  });
});

describe("the frame source with a view", () => {
  it("AC-453 a moment is drawn again only when its camera or its pictures have changed", async () => {
    const real = (
      await vi.importActual<typeof import("../scene/flowExport/browser")>(
        "../scene/flowExport/browser",
      )
    ).createFrameSource;
    const renderBase = vi.fn(async () => document.createElement("canvas"));
    let key = "0";
    const source = real({
      base: null,
      scene: {} as never,
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
      size: { width: 10, height: 10 },
      view: { stateAt: () => key, renderBase },
    });

    await source.prepare!(0);
    await source.prepare!(40);
    expect(renderBase).toHaveBeenCalledTimes(1);

    key = "1";
    await source.prepare!(80);
    await source.prepare!(90);
    expect(renderBase).toHaveBeenCalledTimes(2);
    expect(renderBase).toHaveBeenLastCalledWith(expect.anything(), 80);
  });
});
