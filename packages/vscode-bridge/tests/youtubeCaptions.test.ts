/**
 * The **YouTube caption tiers** (D-129).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 *
 * The fetch is a **fake** here: the tiers are about what the service does with
 * the answers, and a fake fetch measures that without a network.
 */

import {
  CAPTIONS_API_FAILED,
  CAPTIONS_NO_KEY,
  captionMessage,
  parseCaptionCues,
  resolveYouTubeCaptions,
} from "../extension/src/youtubeCaptions";
import { youtubeVideoId } from "../bridge/src/youtube";
import { isBridgeMessage } from "../bridge/src/protocol";

import type {
  CaptionAnswer,
  CaptionFetch,
} from "../extension/src/youtubeCaptions";

/** the tracks of an answer — the ones the tiers found */
const tracksOf = (answer: CaptionAnswer) =>
  answer.tier === "none" ? [] : answer.tracks;

/** the reason of an answer — empty when there are captions */
const reasonOf = (answer: CaptionAnswer) =>
  answer.tier === "none" ? answer.reason : "";

/** the video the test asks about */
const VIDEO_ID = "dQw4w9WgXcQ";

/** the teacher's own key */
const API_KEY = "test-key";

/**
 * A fetch that answers with what the test says it answers.
 *
 * The URL is the whole story: the Data API v3 is asked for the list of the
 * tracks and then for each track's text, and the public endpoint is asked for
 * the text of a track.
 */
const fakeFetch = (
  answers: Record<string, { ok?: boolean; body?: string }> = {},
): { fetchImpl: CaptionFetch; asked: string[] } => {
  const asked: string[] = [];

  const fetchImpl: CaptionFetch = async (url) => {
    asked.push(url);

    const answer = answers[url] ??
      answers[
        Object.keys(answers).find((key) => url.startsWith(key)) ?? ""
      ] ?? { ok: true, body: "" };

    return {
      ok: answer.ok ?? true,
      status: answer.ok === false ? 500 : 200,
      text: async () => answer.body ?? "",
    };
  };

  return { fetchImpl, asked };
};

const CAPTION_LIST = JSON.stringify({
  items: [
    {
      id: "caption-1",
      snippet: { language: "en", trackKind: "standard" },
    },
  ],
});

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
the first cue

00:00:05.500 --> 00:00:08.000
the second cue
`;

const TIMEDTEXT = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="1.5" dur="2.0">the public cue</text>
</transcript>`;

describe("the youtube captions", () => {
  it("AC-169 a caption answer carries the tier that produced it", async () => {
    // tier one: the official Data API v3, with the teacher's own key
    const api = fakeFetch({
      "https://www.googleapis.com/youtube/v3/captions?part=snippet": {
        body: CAPTION_LIST,
      },
      "https://www.googleapis.com/youtube/v3/captions/caption-1": {
        body: VTT,
      },
    });

    const answer = await resolveYouTubeCaptions({
      videoId: VIDEO_ID,
      apiKey: API_KEY,
      fetchImpl: api.fetchImpl,
    });

    // the tier travels with the answer — the panel says which tier it is
    expect(answer.tier).toBe("api");
    expect(tracksOf(answer)).toHaveLength(1);
    expect(tracksOf(answer)[0].language).toBe("en");
    expect(tracksOf(answer)[0].cues).toEqual([
      { startMs: 1000, endMs: 4000, text: "the first cue" },
      { startMs: 5500, endMs: 8000, text: "the second cue" },
    ]);

    // the key never leaves the extension: it is in the URL of the call to
    // YouTube's own API and nowhere else
    expect(
      api.asked.every((url) => url.startsWith("https://www.googleapis.com/")),
    ).toBe(true);
    expect(api.asked.some((url) => url.includes("key=test-key"))).toBe(true);

    // tier two: the public endpoint, when there is no key
    const publicFetch = fakeFetch({
      "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en": {
        body: TIMEDTEXT,
      },
    });

    const publicAnswer = await resolveYouTubeCaptions({
      videoId: VIDEO_ID,
      apiKey: "",
      fetchImpl: publicFetch.fetchImpl,
    });

    expect(publicAnswer.tier).toBe("public");
    expect(tracksOf(publicAnswer)[0].cues).toEqual([
      { startMs: 1500, endMs: 3500, text: "the public cue" },
    ]);

    // and the tier travels with the answer **onto the wire**: the panel says
    // which tier it is, and it can only say it if the message carries it
    const message = captionMessage({
      id: "captions-1",
      videoId: VIDEO_ID,
      answer,
    });

    if (message.type !== "captions:result") {
      throw new Error("the caption message has the wrong type");
    }

    expect(message.tier).toBe("api");
    expect(message.tracks).toHaveLength(1);
  });

  it("AC-169 a video with no captions answers with the reason", async () => {
    // nothing answers: the public endpoint gives nothing back
    const empty = fakeFetch();

    const answer = await resolveYouTubeCaptions({
      videoId: VIDEO_ID,
      apiKey: "",
      fetchImpl: empty.fetchImpl,
    });

    expect(answer.tier).toBe("none");
    expect(reasonOf(answer)).toBe(CAPTIONS_NO_KEY);
    expect(reasonOf(answer)).toContain("API key is not set");

    // the reason names the **remedy**: a reason a teacher cannot act on is
    // not a reason
    expect(reasonOf(answer)).toContain("excalidraw-bridge.youtubeApiKey");

    // with a key, and with the public endpoint empty, the reason names the
    // **Data API** — the thing that was tried first — and not the public
    // endpoint
    const withKey = fakeFetch({
      "https://www.googleapis.com/youtube/v3/captions?part=snippet": {
        body: JSON.stringify({ items: [] }),
      },
    });

    const answerWithKey = await resolveYouTubeCaptions({
      videoId: VIDEO_ID,
      apiKey: API_KEY,
      fetchImpl: withKey.fetchImpl,
    });

    expect(answerWithKey.tier).toBe("none");
    expect(reasonOf(answerWithKey)).toBe(CAPTIONS_API_FAILED);
    expect(reasonOf(answerWithKey)).toContain("Data API");
    expect(reasonOf(answerWithKey)).toContain(
      "excalidraw-bridge.youtubeApiKey",
    );

    // and the reason travels with the answer
    const noneMessage = captionMessage({
      id: "captions-1",
      videoId: VIDEO_ID,
      answer: answerWithKey,
    });

    if (noneMessage.type !== "captions:none") {
      throw new Error("the caption message has the wrong type");
    }

    expect(noneMessage.reason).toBe(CAPTIONS_API_FAILED);
    expect(noneMessage.tier).toBe("none");

    // and the reason is never empty: a panel that says nothing says nothing
    // about why
    expect(reasonOf(answerWithKey).length).toBeGreaterThan(0);

    // an id that is not an id is refused before anything is asked for
    const refused = fakeFetch();

    const refusedAnswer = await resolveYouTubeCaptions({
      videoId: "not-an-id",
      apiKey: API_KEY,
      fetchImpl: refused.fetchImpl,
    });

    expect(refusedAnswer.tier).toBe("none");
    expect(reasonOf(refusedAnswer)).toContain("not a YouTube video id");
    expect(refused.asked).toHaveLength(0);
  });

  it("AC-169 a key that does not answer names the Data API and the remedy", async () => {
    // the Data API refuses the request: the key is wrong, out of quota, or
    // the video is not on the teacher's own channel
    const api = fakeFetch({
      "https://www.googleapis.com/youtube/v3/captions?part=snippet": {
        ok: false,
      },
    });

    const answer = await resolveYouTubeCaptions({
      videoId: VIDEO_ID,
      apiKey: API_KEY,
      fetchImpl: api.fetchImpl,
    });

    expect(answer.tier).toBe("none");
    expect(reasonOf(answer)).toBe(CAPTIONS_API_FAILED);

    // the reason names the **Data API** — the thing that was tried first —
    // and not the public endpoint, which was only the fall-back
    expect(reasonOf(answer)).toContain("Data API");
    expect(reasonOf(answer)).not.toContain("timedtext");

    // and it names what can be wrong with a key, and the way to fix it
    expect(reasonOf(answer)).toContain("out of quota");
    expect(reasonOf(answer)).toContain("excalidraw-bridge.youtubeApiKey");
  });

  it("AC-169 the caption messages travel over the bridge and carry the tier", async () => {
    const request = {
      v: 1 as const,
      type: "captions:request" as const,
      id: "captions-1",
      videoId: VIDEO_ID,
    };

    // the message the extension really sends, for an answer of tier "api"
    const result = captionMessage({
      id: "captions-1",
      videoId: VIDEO_ID,
      answer: {
        tier: "api",
        tracks: [
          {
            language: "en",
            label: "en",
            cues: [{ startMs: 0, endMs: 1000, text: "hello" }],
          },
        ],
      },
    });

    // and for an answer of the third tier
    const none = captionMessage({
      id: "captions-1",
      videoId: VIDEO_ID,
      answer: { tier: "none", reason: CAPTIONS_NO_KEY },
    });

    // the protocol knows all three messages
    expect(isBridgeMessage(request)).toBe(true);
    expect(isBridgeMessage(result)).toBe(true);
    expect(isBridgeMessage(none)).toBe(true);

    // the tier travels with the answer: the panel says which tier it is
    expect(result.type).toBe("captions:result");
    expect(none.type).toBe("captions:none");

    if (result.type !== "captions:result" || none.type !== "captions:none") {
      throw new Error("the caption message has the wrong type");
    }

    expect(result.tier).toBe("api");
    expect(none.tier).toBe("none");
    expect(none.reason).toBe(CAPTIONS_NO_KEY);

    // the cues are the shape the local path produces — the panel does not know
    // where they came from
    expect(parseCaptionCues(VTT)).toEqual([
      { startMs: 1000, endMs: 4000, text: "the first cue" },
      { startMs: 5500, endMs: 8000, text: "the second cue" },
    ]);
  });

  it("AC-169 the video id is read out of a link, and nothing else", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      VIDEO_ID,
    );
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(VIDEO_ID);
    expect(youtubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      VIDEO_ID,
    );
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      VIDEO_ID,
    );
    expect(youtubeVideoId("dQw4w9WgXcQ")).toBe(VIDEO_ID);

    // and a link that carries no id is not one
    expect(
      youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"),
    ).toBeNull();
    expect(youtubeVideoId("not a link")).toBeNull();
    expect(youtubeVideoId("")).toBeNull();
  });
});
