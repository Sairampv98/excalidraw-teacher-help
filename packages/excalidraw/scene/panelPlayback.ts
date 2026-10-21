/**
 * The **playback sync** of a video panel.
 *
 * The editor publishes the playback position of a video panel on a coarse tick
 * (about 4 Hz) and the **presenter** applies it. The presenter is a second
 * Excalidraw instance, so between two updates it has to keep the video moving
 * on its own — otherwise the video would stutter four times a second (D-57).
 *
 * The rule is the same one a media player uses:
 *
 * - a **small** drift is corrected by the **rate**: the video plays a little
 *   faster or a little slower for a moment, and nobody sees a jump;
 * - a **large** drift is corrected by a **seek**: the video jumps, because a
 *   jump is the honest thing to do when the two windows are far apart;
 * - inside the small band nothing happens at all.
 *
 * The arithmetic is here, apart from the DOM, because it is a rule and not a
 * rendering detail: it can be read, tested and reused without a browser.
 */

import type { PanelPlayback } from "./panelContent";

/**
 * A drift larger than this is corrected by seeking. It is roughly a frame and a
 * half at 30 fps — a jump that small is invisible anyway, so the seek is only
 * worth its cost when the two windows have really drifted apart.
 */
export const PLAYBACK_HARD_SEEK_SECONDS = 0.35;

/**
 * A drift smaller than this is not corrected at all. The rate correction is
 * there to hide the drift, and correcting a drift that small would only make
 * the video breathe.
 */
export const PLAYBACK_SOFT_SEEK_SECONDS = 0.05;

/** The rate the video is never slowed below. */
export const PLAYBACK_MIN_RATE = 0.85;

/** The rate the video is never sped above. */
export const PLAYBACK_MAX_RATE = 1.15;

/**
 * How often the local clock re-checks the drift when the browser has no
 * `requestVideoFrameCallback`.
 *
 * It is the editor's own tick (about 4 Hz): the check is cheap, and a check
 * that runs slower than the updates it corrects would be a check that runs too
 * late.
 */
export const PLAYBACK_LOCAL_CLOCK_MS = 250;

/**
 * How often the editor **writes** the playback position onto the element.
 *
 * About 4 Hz. The scene message is throttled to 40 ms and carries the whole
 * element list, so a write per frame would flood the channel for nothing
 * (D-57).
 */
export const PLAYBACK_PUBLISH_INTERVAL_MS = 250;

/**
 * What this window knows about the video it is mirroring.
 *
 * It is the window's own model of the video: where it believes the video is,
 * since when, and at which rate it has been playing.
 */
export type PlaybackSyncState = {
  /** where the video was, in seconds, when the model was last anchored */
  appliedTime: number;
  /** when the model was last anchored, in milliseconds since the epoch */
  appliedAt: number;
  /** whether the video was playing when the model was anchored */
  appliedPlaying: boolean;
  /** the rate the video plays at now */
  rate: number;
};

/** The state of a window that has not applied anything yet. */
export const INITIAL_PLAYBACK_SYNC_STATE: PlaybackSyncState = {
  appliedTime: 0,
  appliedAt: 0,
  appliedPlaying: false,
  rate: 1,
};

/**
 * What to do with the video, given the position the editor published.
 */
export type PlaybackCorrection = {
  /** where the video is, per this window's model, right now */
  expected: number;
  /** the position to seek to, or null when no seek is needed */
  seekTo: number | null;
  /** the rate the video should play at */
  playbackRate: number;
  /** whether the video should be playing */
  playing: boolean;
};

const clampRate = (rate: number) =>
  Math.min(PLAYBACK_MAX_RATE, Math.max(PLAYBACK_MIN_RATE, rate));

/**
 * The correction for one published position.
 *
 * `state` is what this window knows; `now` is the current clock, in
 * milliseconds. The two are the same clock the window applied its last
 * position on, so the difference between them is how long the video has been
 * moving on its own.
 */
export const playbackCorrection = ({
  received,
  state,
  now,
}: {
  /** the position the editor published, in seconds */
  received: PanelPlayback;
  /** what this window knows about the video */
  state: PlaybackSyncState;
  /** the current clock, in milliseconds since the epoch */
  now: number;
}): PlaybackCorrection => {
  // where the video **should** be, if it had kept playing at the rate it was
  // playing at
  const elapsed = Math.max(0, now - state.appliedAt) / 1000;
  const expected =
    state.appliedTime + (state.appliedPlaying ? elapsed * state.rate : 0);

  const drift = received.time - expected;

  if (Math.abs(drift) >= PLAYBACK_HARD_SEEK_SECONDS) {
    // too far apart to hide: jump
    return {
      expected,
      seekTo: received.time,
      playbackRate: 1,
      playing: received.playing,
    };
  }

  if (Math.abs(drift) <= PLAYBACK_SOFT_SEEK_SECONDS) {
    // in step: nothing to do, and the video plays at its own speed again
    return {
      expected,
      seekTo: null,
      playbackRate: 1,
      playing: received.playing,
    };
  }

  // a small drift: the rate closes it in about a second, without a jump
  return {
    expected,
    seekTo: null,
    playbackRate: clampRate(1 + drift),
    playing: received.playing,
  };
};

/**
 * The state after a correction has been applied.
 *
 * The model is re-anchored on **where the video really is**, not on the
 * position that was published: the video is still a little behind (or ahead)
 * of the published position, and pretending otherwise would lose the drift the
 * rate correction is there to close.
 */
export const appliedPlaybackState = ({
  received,
  correction,
  now,
}: {
  /** the position the editor published, in seconds */
  received: PanelPlayback;
  /** the correction that was applied */
  correction: PlaybackCorrection;
  /** the clock the correction was applied on, in milliseconds */
  now: number;
}): PlaybackSyncState => ({
  appliedTime: correction.seekTo ?? correction.expected,
  appliedAt: now,
  appliedPlaying: received.playing,
  rate: correction.playbackRate,
});
