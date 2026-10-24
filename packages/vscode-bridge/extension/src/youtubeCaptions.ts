/**
 * The **YouTube caption tiers** (D-129).
 *
 * The captions are the fragile half of the YouTube path, so they degrade in
 * **tiers**, and the tier that answered travels with the answer:
 *
 *  - **tier one** — the official **Data API v3**, with the teacher's own key
 *    (`excalidraw-bridge.youtubeApiKey`). A versioned API, and for the
 *    teacher's **own** channel the captions are authorised by the owner, so
 *    this tier really works;
 *  - **tier two** — the public **`timedtext`** endpoint. Best effort, and in
 *    practice **empty**: measured on 2026-10-24 from this machine, eight
 *    probes of four videos (with and without `kind=asr`) gave eight empty
 *    bodies. It stays in the design because it costs nothing and it may work
 *    for some videos, but it is **not** a path that works today — so the
 *    reason names the **key**, which is the remedy;
 *  - **tier three** — **`captions:none`**, with the reason.
 *
 * The rule the whole path follows: **a feature that depends on someone else's
 * page must degrade in tiers, and must say which tier it is on.** The teacher
 * is never left guessing why a video has no text.
 *
 * ## Why the extension does this
 *
 * A browser cannot read YouTube's captions: they are not in the page. So the
 * **bridge** — the Node process the teacher's VS Code extension runs — asks
 * for them, and the app receives them as ordinary caption track data. The
 * fetch is Node's **built-in** `fetch` (VS Code 1.91 ships Node 20): no new
 * dependency, and nothing of ours to keep up to date.
 */

import type { PanelCaptionCue } from "@excalidraw/element/types";

import { YOUTUBE_VIDEO_ID } from "../../bridge/src/youtube";

import type {
  BridgeCaptionTrack,
  CaptionTier,
} from "../../bridge/src/protocol";

/** the official Data API v3 - the versioned one, with the teacher's own key */
export const YOUTUBE_API_ENDPOINT = "https://www.googleapis.com/youtube/v3";

/** the public timedtext endpoint - best effort, and often empty */
export const YOUTUBE_TIMEDTEXT_ENDPOINT =
  "https://www.youtube.com/api/timedtext";

/**
 * The sentences the extension sends when there are no captions.
 *
 * They name the **thing that is missing**, because a teacher who cannot read
 * the reason cannot fix it (D-91, D-129).
 *
 * A reason names the thing that is missing **and** the way to get it. The
 * remedy is the half that matters: a teacher who cannot read the reason
 * cannot act on it.
 */
export const CAPTIONS_NO_KEY =
  "no captions: the YouTube API key is not set and the public timedtext endpoint gave nothing back. Set excalidraw-bridge.youtubeApiKey to read them";

/**
 * A key **is** set, and the Data API did not answer with captions.
 *
 * The reason names the **Data API** — not the public endpoint, which is not
 * the thing that was tried first — and it names what can be wrong with a key:
 * it may be wrong, out of quota, or the video may not be on the teacher's own
 * channel, which is the only case the API can read captions for.
 */
export const CAPTIONS_API_FAILED =
  "no captions: the YouTube Data API did not answer with captions - the key may be wrong, out of quota, or the video may not be on your own channel. Set excalidraw-bridge.youtubeApiKey to a key that can read it";

export const CAPTIONS_BAD_ID = "no captions: that is not a YouTube video id";

/**
 * The shape of the `fetch` the service uses.
 *
 * It is Node's own `fetch`, and it is a **parameter** so that the tiers can be
 * tested without a network: the test gives the service a fake one and measures
 * what it does with the answers.
 */
export type CaptionFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * The answer of the caption service.
 *
 * The tier travels with it, so the panel can say which tier answered.
 */
export type CaptionAnswer =
  | { tier: "api"; tracks: BridgeCaptionTrack[] }
  | { tier: "public"; tracks: BridgeCaptionTrack[] }
  | { tier: "none"; reason: string };

/**
 * The **video id** in a YouTube link - or `null` when the text is not one.
 *
 * The reading lives in the **shared** module, because the app reads the
 * pasted link and the extension checks the id it is given: one definition, so
 * the two cannot disagree about what an id is.
 */
export { youtubeVideoId } from "../../bridge/src/youtube";

/**
 * The cues of a **VTT** caption track.
 *
 * The Data API v3 hands the track back as WebVTT when it is asked for
 * `tfmt=vtt`, and the cues are the same shape the local sidecar path
 * produces.
 */
export const parseVttCues = (text: string): PanelCaptionCue[] => {
  const cues: PanelCaptionCue[] = [];
  const lines = (text ?? "").split(/\r?\n/);

  let startMs: number | null = null;
  let endMs = 0;
  let body: string[] = [];

  const flush = () => {
    const content = body.join(" ").trim();

    if (startMs !== null && content) {
      cues.push({ startMs, endMs, text: content });
    }

    startMs = null;
    endMs = 0;
    body = [];
  };

  for (const line of lines) {
    const timing = line.match(
      /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/,
    );

    if (timing) {
      flush();
      startMs = clockMs(timing[1], timing[2], timing[3], timing[4]);
      endMs = clockMs(timing[5], timing[6], timing[7], timing[8]);
      continue;
    }

    // a cue number, a NOTE, or a header - none of them is a cue
    if (!line.trim() || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(line.trim())) {
      continue;
    }

    if (startMs !== null) {
      body.push(line.trim());
    }
  }

  flush();

  return cues;
};

const clockMs = (
  hours: string,
  minutes: string,
  seconds: string,
  millis: string,
): number =>
  (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 +
  Number(millis.padEnd(3, "0"));

/**
 * The cues of a **`timedtext`** caption track.
 *
 * The public endpoint answers with XML: a `<text>` element per cue, with its
 * start and its duration in seconds.
 */
export const parseTimedTextCues = (text: string): PanelCaptionCue[] => {
  const cues: PanelCaptionCue[] = [];
  const xml = text ?? "";

  const pattern = /<text([^>]*)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml)) !== null) {
    const attributes = match[1];
    const start = Number(attributes.match(/start="([\d.]+)"/)?.[1]);
    const duration = Number(attributes.match(/dur="([\d.]+)"/)?.[1]);

    if (!Number.isFinite(start)) {
      continue;
    }

    const content = match[2]
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    if (!content) {
      continue;
    }

    cues.push({
      startMs: Math.round(start * 1000),
      endMs: Math.round(
        (start + (Number.isFinite(duration) ? duration : 0)) * 1000,
      ),
      text: content,
    });
  }

  return cues;
};

/**
 * The cues of a caption track, whichever format it arrived in.
 *
 * The Data API v3 hands back WebVTT and the public endpoint hands back the
 * `timedtext` XML, and the two are told apart by the text itself.
 */
export const parseCaptionCues = (text: string): PanelCaptionCue[] =>
  (text ?? "").trim().startsWith("WEBVTT")
    ? parseVttCues(text)
    : parseTimedTextCues(text);

/**
 * The captions of a video, in the tiers (D-129).
 *
 * The **fetch** is a parameter, so the tiers can be measured without a
 * network: the test gives the service a fake one and reads what it does with
 * the answers.
 */
export const resolveYouTubeCaptions = async ({
  videoId,
  apiKey,
  fetchImpl,
}: {
  /** the YouTube video id */
  videoId: string;
  /** the teacher's own key, when there is one */
  apiKey?: string | null;
  /** the fetch to use - Node's own, in the extension */
  fetchImpl: CaptionFetch;
}): Promise<CaptionAnswer> => {
  const key = (apiKey ?? "").trim();

  // An id that does not look like an id is refused here, and never travels to
  // YouTube: the id is the only thing that goes into the URL.
  if (!YOUTUBE_VIDEO_ID.test(videoId ?? "")) {
    return { tier: "none", reason: CAPTIONS_BAD_ID };
  }

  // tier one: the official Data API v3
  if (key) {
    const tracks = await apiTierCaptions({ videoId, key, fetchImpl });

    if (tracks.length) {
      return { tier: "api", tracks };
    }
  }

  // tier two: the public timedtext endpoint
  const publicTracks = await publicTierCaptions({ videoId, fetchImpl });

  if (publicTracks.length) {
    return { tier: "public", tracks: publicTracks };
  }

  // tier three: no captions, and the reason
  //
  // The reason names the thing that was tried **first** and the way to get
  // it: with a key, the Data API is the thing that did not answer, and the
  // key is the remedy. Without a key, the key itself is the thing that is
  // missing, and the public endpoint is only the reason it was not asked.
  return {
    tier: "none",
    reason: key ? CAPTIONS_API_FAILED : CAPTIONS_NO_KEY,
  };
};

/**
 * Tier one: the official Data API v3.
 *
 * The **list** of the video's caption tracks, and then each track's text. The
 * list is asked for first, because it says which tracks there are and what
 * they are called - and the text of a track is a second call.
 */
const apiTierCaptions = async ({
  videoId,
  key,
  fetchImpl,
}: {
  videoId: string;
  key: string;
  fetchImpl: CaptionFetch;
}): Promise<BridgeCaptionTrack[]> => {
  const listUrl = `${YOUTUBE_API_ENDPOINT}/captions?part=snippet&videoId=${encodeURIComponent(
    videoId,
  )}&key=${encodeURIComponent(key)}`;

  const list = await readJson(fetchImpl, listUrl);

  const items = Array.isArray(list?.items) ? list.items : [];
  const tracks: BridgeCaptionTrack[] = [];

  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id : null;
    const snippet = item?.snippet ?? {};

    if (!id) {
      continue;
    }

    const text = await readText(
      fetchImpl,
      `${YOUTUBE_API_ENDPOINT}/captions/${encodeURIComponent(
        id,
      )}?tfmt=vtt&key=${encodeURIComponent(key)}`,
    );

    const cues = parseCaptionCues(text);

    if (!cues.length) {
      continue;
    }

    const language =
      typeof snippet.language === "string" ? snippet.language : "en";

    tracks.push({
      language,
      label:
        typeof snippet.trackKind === "string" && snippet.trackKind === "asr"
          ? `${language} (auto-generated)`
          : language,
      cues,
    });
  }

  return tracks;
};

/**
 * Tier two: the public `timedtext` endpoint.
 *
 * Best effort, and often empty: the endpoint answers with nothing for an
 * auto-generated track, and the service says so rather than pretending.
 */
const publicTierCaptions = async ({
  videoId,
  fetchImpl,
}: {
  videoId: string;
  fetchImpl: CaptionFetch;
}): Promise<BridgeCaptionTrack[]> => {
  const tracks: BridgeCaptionTrack[] = [];

  // the manual track first, and the auto-generated one second: the teacher's
  // own words are better than a machine's guess
  for (const kind of ["", "asr"]) {
    const url = `${YOUTUBE_TIMEDTEXT_ENDPOINT}?v=${encodeURIComponent(
      videoId,
    )}&lang=en${kind ? `&kind=${kind}` : ""}`;

    const text = await readText(fetchImpl, url);
    const cues = parseCaptionCues(text);

    if (!cues.length) {
      continue;
    }

    tracks.push({
      language: "en",
      label: kind ? "en (auto-generated)" : "en",
      cues,
    });
  }

  return tracks;
};

/**
 * The body of a response, or the empty string when there is none.
 *
 * A failure is never a crash: a tier that cannot be reached is a tier that
 * did not answer, and the next one is tried.
 */
const readText = async (
  fetchImpl: CaptionFetch,
  url: string,
): Promise<string> => {
  try {
    const response = await fetchImpl(url);

    if (!response.ok) {
      return "";
    }

    return await response.text();
  } catch {
    return "";
  }
};

/** The body of a response, parsed as JSON — or `null` when it is not one. */
const readJson = async (
  fetchImpl: CaptionFetch,
  url: string,
): Promise<Record<string, unknown> | null> => {
  const text = await readText(fetchImpl, url);

  if (!text) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * The tier of an answer, for the panel (D-129).
 *
 * The tier travels with the answer; this is only the one place that reads it
 * back, so the two cannot drift apart.
 */
export const captionTierOf = (answer: CaptionAnswer): CaptionTier =>
  answer.tier;

/**
 * The message the answer becomes (D-129).
 *
 * It is one of the protocol's own messages — the shared module owns the
 * shape, and this is the one place that builds it.
 */
export type CaptionMessage =
  | {
      v: 1;
      type: "captions:result";
      id: string;
      videoId: string;
      tracks: BridgeCaptionTrack[];
      tier: "api" | "public";
    }
  | {
      v: 1;
      type: "captions:none";
      id: string;
      videoId: string;
      reason: string;
      tier: "none";
    };

/**
 * The **message** the answer becomes (D-129).
 *
 * One place, so the tier that travelled with the answer cannot be dropped on
 * the way to the wire: the answer says which tier it is, and the message
 * says it too.
 */
export const captionMessage = ({
  id,
  videoId,
  answer,
}: {
  /** the id of the request this answers */
  id: string;
  /** the video the answer is for */
  videoId: string;
  /** the answer the tiers produced */
  answer: CaptionAnswer;
}): CaptionMessage => {
  if (answer.tier === "none") {
    return {
      v: 1,
      type: "captions:none",
      id,
      videoId,
      reason: answer.reason,
      tier: "none",
    };
  }

  return {
    v: 1,
    type: "captions:result",
    id,
    videoId,
    tracks: answer.tracks,
    tier: answer.tier,
  };
};
