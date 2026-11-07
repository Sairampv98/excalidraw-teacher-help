/**
 * AC-558 - the list of clips: loaded from the manifest, grouped, and asked for by
 * the first screen.
 * AC-559 - "What this version adds": what the help shows, and a clip that plays.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import { FeatureClips } from "@excalidraw/excalidraw/components/FeatureClips";
import {
  groupClips,
  loadClips,
  requestClip,
  takePendingClip,
} from "@excalidraw/excalidraw/guides/featureClips";

import type { FeatureClip } from "@excalidraw/excalidraw/guides/featureClips";

const clip = (id: string, group: string): FeatureClip => ({
  id,
  title: `Title of ${id}`,
  line: `What ${id} is.`,
  group,
  seconds: 26.6,
  bytes: 1000,
  video: `clips/${id}.webm`,
  poster: `clips/${id}.jpg`,
});

const LIST = [
  clip("pages", "Pages"),
  clip("undo", "Pages"),
  clip("video", "Video and media"),
  clip("assistant", "Assistant (AI)"),
];

describe("AC-558 the list of clips", () => {
  it("AC-558 the list is read from the manifest, in its order", async () => {
    const asked: string[] = [];
    const list = await loadClips(async (url) => {
      asked.push(url);

      return { clips: LIST };
    });

    expect(list.map((c) => c.id)).toEqual([
      "pages",
      "undo",
      "video",
      "assistant",
    ]);
    expect(asked[0]).toMatch(/clips\/manifest\.json$/);
  });

  it("AC-558 a missing or damaged manifest is no list, and an entry with no video is left out", async () => {
    expect(
      await loadClips(async () => {
        throw new Error("404");
      }),
    ).toEqual([]);
    expect(await loadClips(async () => ({}))).toEqual([]);
    expect(
      await loadClips(async () => ({
        clips: [LIST[0], { id: "broken", title: "x" }, null],
      })),
    ).toHaveLength(1);
  });

  it("AC-558 the clips are grouped, the groups in the order each first appears", () => {
    expect(groupClips(LIST).map((g) => [g.group, g.items.length])).toEqual([
      ["Pages", 2],
      ["Video and media", 1],
      ["Assistant (AI)", 1],
    ]);
  });

  it("AC-558 the first screen can ask for a clip, once", () => {
    expect(takePendingClip()).toBeNull();

    requestClip("assistant");
    expect(takePendingClip()).toBe("assistant");
    expect(takePendingClip()).toBeNull();
  });
});

describe("AC-559 What this version adds", () => {
  const load = async () => LIST;

  it("AC-559 every clip is listed, by group, each with a Watch button and its length", async () => {
    render(<FeatureClips load={load} />);

    await screen.findByTestId("feature-clips");

    for (const entry of LIST) {
      expect(screen.getByText(entry.title)).not.toBeNull();
      expect(screen.getByTestId(`feature-watch-${entry.id}`).textContent).toBe(
        "Watch · 27 s",
      );
    }

    expect(screen.getByText("Assistant (AI)")).not.toBeNull();
  });

  it("AC-559 Watch plays the clip right there, with its picture, and back returns to the list", async () => {
    render(<FeatureClips load={load} />);

    fireEvent.click(await screen.findByTestId("feature-watch-video"));

    const video = screen.getByTestId("feature-video") as HTMLVideoElement;

    expect(video.getAttribute("src")).toMatch(/clips\/video\.webm$/);
    expect(video.getAttribute("poster")).toMatch(/clips\/video\.jpg$/);
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.muted).toBe(true);

    fireEvent.click(screen.getByTestId("feature-back"));
    expect(screen.queryByTestId("feature-video")).toBeNull();
    expect(screen.getByTestId("feature-watch-pages")).not.toBeNull();
  });

  it("AC-559 the next clip is a press away, and the last goes round to the first", async () => {
    render(<FeatureClips load={load} />);

    fireEvent.click(await screen.findByTestId("feature-watch-assistant"));
    fireEvent.click(screen.getByTestId("feature-next"));

    expect(
      (screen.getByTestId("feature-video") as HTMLVideoElement).getAttribute(
        "src",
      ),
    ).toMatch(/clips\/pages\.webm$/);
  });

  it("AC-559 a clip the first screen asked for plays at once", async () => {
    requestClip("assistant");
    render(<FeatureClips load={load} />);

    await waitFor(() => {
      expect(
        (screen.getByTestId("feature-video") as HTMLVideoElement).getAttribute(
          "src",
        ),
      ).toMatch(/clips\/assistant\.webm$/);
    });
  });

  it("AC-559 with no clips there is nothing in the help, and no empty heading", async () => {
    const { container } = render(<FeatureClips load={async () => []} />);

    await waitFor(() => {
      expect(container.querySelector("[data-testid=feature-clips]")).toBeNull();
    });
  });
});
