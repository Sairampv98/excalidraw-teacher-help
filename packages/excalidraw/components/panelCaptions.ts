/**
 * The **captions** of a video panel.
 *
 * ## Why the captions are not in the player
 *
 * The owner's ask (2026-10-21): the captions should if possible not be inside
 * the video player but outside of it, in a text box — the one Excalidraw
 * natively has — which gets refreshed as the video plays. And: if there is no
 * caption, there is no such option.
 *
 * So the caption is an **ordinary Excalidraw text element** beside the panel.
 * It is not a second renderer and not a burn-in: the teacher can edit it,
 * restyle it, select it, undo it and present it like any other text.
 *
 * Two consequences, and they are the rules this module exists to keep:
 *
 * - a video **without** a caption track gets **no** caption element at all
 *   (`captionTextElement()` returns `null`);
 * - the text is written through the ordinary element machinery, so it goes
 *   through **undo** like every other change on the canvas.
 *
 * ## The two caption paths
 *
 * - a **sidecar** (`.srt` / `.vtt` next to the video) is read by the app, parsed
 *   here, and never touches the bridge;
 * - **YouTube** captions come from the bridge, which fetches them; the wave
 *   that fills that path in reuses everything here — the panel does not change.
 *
 * The **track** itself (the cues) is the panel's own content, so it rides in
 * the payload's `options.captions` — the home the foundation already defines.
 * The **binding** (which text element the captions are written into) points at
 * *another* element, so it does not: see `CaptionBinding` in
 * `scene/panelContent.ts`.
 */

import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from "@excalidraw/common";
import { newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawTextElement,
  FontFamilyValues,
  PanelCaptionCue,
  PanelCaptionTrack,
} from "@excalidraw/element/types";

/**
 * The language a panel's captions fall back to.
 *
 * English, because that is the language the teacher teaches in.
 */
export const DEFAULT_CAPTION_LANGUAGE = "en";

/**
 * A caption time, in milliseconds.
 *
 * Both the SRT (`00:00:01,000`) and the WebVTT (`00:00:01.000`) shape are
 * accepted, and so is the short `01:00.000` form. A time that cannot be read
 * is `null`, and the cue it belongs to is dropped rather than guessed at.
 */
const parseCueTime = (value: string): number | null => {
  const parts = value.trim().replace(",", ".").split(":");

  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  const seconds = Number(parts[parts.length - 1]);
  const minutes = Number(parts[parts.length - 2]);
  const hours = parts.length === 3 ? Number(parts[0]) : 0;

  if (![seconds, minutes, hours].every((part) => Number.isFinite(part))) {
    return null;
  }

  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
};

/**
 * The cues of a caption file, whatever the file's flavour.
 *
 * The two formats differ in their header and in the decimal separator, and
 * nothing else that matters here: a cue is a time line and the text under it.
 * A block that carries no time line is not a cue — a `WEBVTT` header, a `NOTE`
 * comment or a stray line — and it is skipped.
 */
const parseCueBlocks = (text: string): PanelCaptionCue[] => {
  const cues: PanelCaptionCue[] = [];

  for (const block of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const timeIndex = lines.findIndex((line) => line.includes("-->"));

    if (timeIndex === -1) {
      continue;
    }

    const [rawStart, rawEnd] = lines[timeIndex].split("-->");

    if (rawStart === undefined || rawEnd === undefined) {
      continue;
    }

    const startMs = parseCueTime(rawStart);
    // the end time may carry a cue's settings after it ("00:00:03.000 align:start")
    const endMs = parseCueTime(rawEnd.trim().split(/\s+/)[0] ?? "");

    if (startMs === null || endMs === null) {
      continue;
    }

    const cueText = lines
      .slice(timeIndex + 1)
      .join("\n")
      .trim();

    if (!cueText) {
      continue;
    }

    cues.push({ startMs, endMs: Math.max(endMs, startMs), text: cueText });
  }

  return cues.sort((a, b) => a.startMs - b.startMs);
};

/** The cues of a SubRip (`.srt`) file. */
export const parseSrtCues = (text: string): PanelCaptionCue[] =>
  parseCueBlocks(text);

/** The cues of a WebVTT (`.vtt`) file. */
export const parseVttCues = (text: string): PanelCaptionCue[] =>
  parseCueBlocks(text);

/**
 * A caption track from the text of a caption file.
 *
 * `null` when the file carries no cue at all: a caption track with no cue is
 * not a caption track, and a video whose caption file is empty gets **no**
 * caption element (the owner's rule).
 */
export const parseCaptionTrack = ({
  text,
  language = DEFAULT_CAPTION_LANGUAGE,
  label,
}: {
  /** the file's own text */
  text: string;
  /** the track's language, e.g. "en" */
  language?: string;
  /** the track's label, e.g. "English" */
  label?: string;
}): PanelCaptionTrack | null => {
  const cues = parseCueBlocks(text);

  if (!cues.length) {
    return null;
  }

  return {
    language,
    label: label ?? language,
    cues,
  };
};

/**
 * The cue that is on screen at `timeMs`, or `null` when the track is silent at
 * that moment.
 *
 * The last cue that has started wins: a track may have two cues with the same
 * start, and the later one is the one the player shows.
 */
export const captionCueAt = (
  track: PanelCaptionTrack | null | undefined,
  timeMs: number,
): PanelCaptionCue | null => {
  if (!track) {
    return null;
  }

  let active: PanelCaptionCue | null = null;

  for (const cue of track.cues) {
    if (cue.startMs > timeMs) {
      break;
    }
    active = cue;
  }

  if (!active || timeMs >= active.endMs) {
    return null;
  }

  return active;
};

/**
 * The track of a language, or the English one when the language is not there.
 *
 * The teacher switches the track; the panel remembers which one is showing, so
 * the switch survives a reload.
 */
export const selectCaptionTrack = (
  tracks: readonly PanelCaptionTrack[],
  language: string = DEFAULT_CAPTION_LANGUAGE,
): PanelCaptionTrack | null => {
  if (!tracks.length) {
    return null;
  }

  return (
    tracks.find((track) => track.language === language) ??
    tracks.find((track) => track.language === DEFAULT_CAPTION_LANGUAGE) ??
    tracks[0]
  );
};

/**
 * The text element the captions are written into — or `null` when the video has
 * no caption track.
 *
 * This is the rule the owner asked for: *if no caption, no such option*. A
 * video without captions gets **no** text element beside it, so the canvas
 * stays clean and nothing on it claims to be a caption.
 *
 * The element is an ordinary text element: it is created with the ordinary
 * factory, so it is selected, styled, edited and undone like any other text.
 */
export const captionTextElement = ({
  track,
  x,
  y,
  fontFamily = DEFAULT_FONT_FAMILY,
  fontSize = DEFAULT_FONT_SIZE,
  strokeColor,
}: {
  /** the track the element shows — `null` means no caption element at all */
  track: PanelCaptionTrack | null | undefined;
  x: number;
  y: number;
  fontFamily?: FontFamilyValues;
  fontSize?: number;
  strokeColor: string;
}): ExcalidrawTextElement | null => {
  if (!track || !track.cues.length) {
    return null;
  }

  return newTextElement({
    // the element starts on the first cue: an empty text element would have no
    // size at all, and the teacher would see nothing where the caption is
    text: track.cues[0].text,
    x,
    y,
    fontFamily,
    fontSize,
    strokeColor,
    textAlign: "left",
    verticalAlign: "top",
    autoResize: true,
  });
};
