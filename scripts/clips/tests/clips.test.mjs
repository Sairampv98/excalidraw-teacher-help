/**
 * AC-552 - how a clip is planned: the time a caption is held, the path of the
 * pointer, the list of frames, the line of the manifest, and what makes a clip
 * complete.
 * AC-553 - what is asked of ffmpeg: a small silent web video, a poster, a GIF.
 */

import { describe, expect, it } from "vitest";

import { CLIPS } from "../clips/index.mjs";
import {
  gifArgs,
  hstackArgs,
  mp4Args,
  posterArgs,
  webmArgs,
} from "../lib/ffmpeg.mjs";
import {
  checkClip,
  concatList,
  glidePoints,
  hostAllowed,
  manifestEntry,
  readingTime,
} from "../lib/plan.mjs";

describe("AC-552 how a clip is planned", () => {
  it("AC-552 a caption is held long enough to be read, never too short or too long", () => {
    expect(readingTime("Pages")).toBe(1400);
    expect(
      readingTime("Add a page with the plus in the page bar"),
    ).toBeGreaterThan(2500);
    expect(readingTime("word ".repeat(80))).toBe(6000);
  });

  it("AC-552 the pointer travels in a smooth glide that ends where it was sent", () => {
    const points = glidePoints({ x: 0, y: 0 }, { x: 100, y: 50 }, 10);

    expect(points).toHaveLength(10);
    expect(points[points.length - 1]).toEqual({ x: 100, y: 50 });

    // slow at the start and at the end, quick in the middle
    const xs = points.map((p) => p.x);

    expect(xs[1] - xs[0]).toBeLessThan(xs[5] - xs[4]);
    expect(xs[9] - xs[8]).toBeLessThan(xs[5] - xs[4]);
  });

  it("AC-552 each frame stays as long as it was on the screen, and the last file is named twice", () => {
    const list = concatList([
      { file: "a.jpg", at: 10 },
      { file: "b.jpg", at: 10.5 },
      { file: "c.jpg", at: 12 },
    ]);

    expect(list).toContain("file 'a.jpg'\nduration 0.500");
    expect(list).toContain("file 'b.jpg'\nduration 1.500");
    expect(list).toContain("file 'c.jpg'\nduration 0.500");
    expect(list.trim().split("\n").slice(-1)[0]).toBe("file 'c.jpg'");
    expect(concatList([])).toBe("\n");
  });

  it("AC-552 a clip is complete when it says what it is for, and the clips we have are", () => {
    expect(checkClip({ id: "x" })).not.toHaveLength(0);
    expect(
      checkClip({ id: "Bad Id", title: "t", line: "l", group: "g", run() {} }),
    ).toHaveLength(1);

    for (const clip of CLIPS) {
      expect(checkClip(clip)).toEqual([]);
    }

    const ids = CLIPS.map((clip) => clip.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("AC-552 the manifest names the video, the poster and what the help shows beside them", () => {
    const entry = manifestEntry(
      { id: "pages", title: "Pages", line: "L", group: "Pages" },
      { seconds: 27.2, bytes: 1000 },
    );

    expect(entry).toEqual({
      id: "pages",
      title: "Pages",
      line: "L",
      group: "Pages",
      seconds: 27.2,
      bytes: 1000,
      video: "clips/pages.webm",
      poster: "clips/pages.jpg",
    });
  });
});

describe("AC-553 what is asked of ffmpeg", () => {
  it("AC-553 the web video is silent, small and in a format Chrome 109 plays", () => {
    const args = webmArgs("in.mp4", "out.webm");

    expect(args).toContain("-an");
    expect(args).toContain("libvpx");
    expect(args[args.length - 1]).toBe("out.webm");
    expect(args.join(" ")).toContain("scale=960:-2");
  });

  it("AC-553 the MP4 starts playing before it is all there", () => {
    expect(mp4Args("in.mp4", "out.mp4")).toContain("+faststart");
  });

  it("AC-553 the poster is one picture from a chosen moment", () => {
    const args = posterArgs("in.mp4", "p.jpg", { at: 4 });

    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual([
      "-ss",
      "4",
    ]);
    expect(args).toContain("-frames:v");
  });

  it("AC-553 the GIF has a palette made for the clip and loops for ever", () => {
    const args = gifArgs("in.mp4", "out.gif");

    expect(args.join(" ")).toContain("palettegen");
    expect(args.join(" ")).toContain("paletteuse");
    expect(args[args.indexOf("-loop") + 1]).toBe("0");
  });
});

describe("AC-554 two windows side by side, and one clip online", () => {
  it("AC-554 two windows start at the same moment: the later one holds its first picture", () => {
    const list = concatList(
      [
        { file: "b1.jpg", at: 10.4 },
        { file: "b2.jpg", at: 11 },
      ],
      { startAt: 10 },
    );

    expect(list.startsWith("file 'b1.jpg'\nduration 0.400\n")).toBe(true);
    expect(list).toContain("file 'b1.jpg'\nduration 0.600");

    // the first window needs no wait
    expect(
      concatList([{ file: "a1.jpg", at: 10 }], { startAt: 10 }).startsWith(
        "file 'a1.jpg'\nduration 0.500",
      ),
    ).toBe(true);
  });

  it("AC-554 the two films are put side by side as one, as long as the shorter", () => {
    const args = hstackArgs("l.mp4", "r.mp4", "o.mp4");

    expect(args.join(" ")).toContain("hstack=inputs=2:shortest=1");
    expect(args[args.length - 1]).toBe("o.mp4");
  });

  it("AC-554 a clip reaches only the addresses it names, and their sub-addresses", () => {
    const hosts = ["youtube.com", "ytimg.com"];

    expect(hostAllowed("https://www.youtube.com/embed/x", hosts)).toBe(true);
    expect(hostAllowed("https://i.ytimg.com/vi/x.jpg", hosts)).toBe(true);
    expect(hostAllowed("https://youtube.com.evil.example/x", hosts)).toBe(
      false,
    );
    expect(hostAllowed("https://example.com/", hosts)).toBe(false);
    expect(hostAllowed("not a url", hosts)).toBe(false);

    // a clip that names nothing reaches nothing
    expect(hostAllowed("https://www.youtube.com/", undefined)).toBe(false);
  });

  it("AC-554 only the clips that need the internet name addresses, and nothing but video hosts", () => {
    for (const clip of CLIPS.filter((c) => c.allowHosts)) {
      expect(clip.id).toBe("youtube");
      expect(
        clip.allowHosts.every((host) => /youtube|ytimg|googlevideo/.test(host)),
      ).toBe(true);
    }
  });
});
