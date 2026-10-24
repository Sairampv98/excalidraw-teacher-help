/**
 * The **YouTube video id** — the one thing the panel holds (D-128).
 *
 * The teacher pastes a **link**, not an id, so the link is read here and the
 * panel is given the id. The reading is deliberately simple: the link is
 * turned into an id and **nothing else** — no page is fetched, no markup is
 * read, no signature is computed. Nothing of ours talks to YouTube's pages, so
 * nothing of ours can rot when YouTube changes something.
 *
 * It lives in the **shared** module, because both sides need it: the app reads
 * the pasted link, and the extension checks the id it is given.
 */

/**
 * The shape of a YouTube video id.
 *
 * Eleven characters of letters, digits, `_` and `-`. An id that does not look
 * like this is not one, and it is refused rather than sent to YouTube.
 */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The video id in a YouTube link, or `null` when the text is not one.
 *
 * The links that are understood are the ones a teacher pastes: the watch link,
 * the short link, the embed link, the shorts link and the live link — and a
 * bare id.
 */
export const youtubeVideoId = (input: string): string | null => {
  const text = (input ?? "").trim();

  if (!text) {
    return null;
  }

  // a bare id
  if (YOUTUBE_VIDEO_ID.test(text)) {
    return text;
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return idOf(url.pathname);
  }

  if (
    host !== "youtube.com" &&
    host !== "m.youtube.com" &&
    host !== "music.youtube.com" &&
    host !== "youtube-nocookie.com"
  ) {
    return null;
  }

  // the watch link, and the links that carry the id in the query
  const fromQuery = url.searchParams.get("v");

  if (fromQuery) {
    return idOf(fromQuery);
  }

  // the links that carry the id in the path
  const [first, second] = url.pathname.replace(/^\/+/, "").split("/");

  if (
    first === "embed" ||
    first === "shorts" ||
    first === "live" ||
    first === "v"
  ) {
    return idOf(second);
  }

  return null;
};

/** The id, when it is one. */
const idOf = (value: string | undefined): string | null => {
  const id = (value ?? "").trim().replace(/^\/+/, "");

  return YOUTUBE_VIDEO_ID.test(id) ? id : null;
};
