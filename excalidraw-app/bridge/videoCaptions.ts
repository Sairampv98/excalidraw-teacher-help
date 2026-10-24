/**
 * The **YouTube caption path** — the types, now from the shared module.
 *
 * The caption messages were first stated here, on the app side, so that the
 * wave that filled the path in would not have to change the panel to add it.
 * That wave has come: the messages live in the **one** definition of the
 * protocol, `packages/vscode-bridge/bridge/src/protocol.ts` (D-128, D-129).
 *
 * So this file is now the app's **view** of that definition: it re-exports the
 * shared types and keeps the two helpers the app uses — the guard that tells a
 * caption message apart from every other message, and the write that puts the
 * answer into the panel's payload.
 *
 * ## What arrives
 *
 * The same shape the local path produces: a list of tracks, each with a
 * language and its cues. The panel does not know where the cues came from —
 * it only knows the cues.
 */

import { CaptureUpdateAction, isPanelElement } from "@excalidraw/element";
import {
  DEFAULT_CAPTION_LANGUAGE,
  panelSource,
  withVideoPanelState,
  withYoutubePanelState,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PanelCaptionTrack } from "@excalidraw/element/types";

import type { BridgeMessage } from "../../packages/vscode-bridge/bridge/src/protocol";
import type {
  BridgeCaptionTrack,
  CaptionTier,
} from "../../packages/vscode-bridge/bridge/src/protocol";

export type {
  BridgeCaptionTrack,
  CaptionTier,
} from "../../packages/vscode-bridge/bridge/src/protocol";

/** The message type of the YouTube caption path. */
export type VideoCaptionMessageType =
  | "captions:request"
  | "captions:result"
  | "captions:none";

/**
 * Whether a message belongs to the YouTube caption path.
 *
 * The bridge's own messages are told apart by their type, and the caption
 * path's types are its own — so a message of this path can never be mistaken
 * for a `run:*` or an `ocr:*` message.
 */
export const isVideoCaptionMessage = (message: {
  type?: unknown;
}): message is Extract<BridgeMessage, { type: VideoCaptionMessageType }> =>
  message.type === "captions:request" ||
  message.type === "captions:result" ||
  message.type === "captions:none";

/**
 * The caption answer, written into the panel's payload (D-129).
 *
 * The **cues** go into the payload's own homes — `options.captions` for the
 * active track and `video.tracks` for every track — exactly as they do for a
 * local video, because the caption shape does not change: the panel does not
 * know where the cues came from. What is added is the **tier**, so the panel
 * can say which tier answered and why there are none when there are none.
 *
 * It reports whether the answer belonged to this panel: an answer for a video
 * the panel no longer holds is dropped, the way a stale error is (D-127).
 */
export const applyYoutubeCaptions = (
  api: ExcalidrawImperativeAPI,
  {
    panelId,
    videoId,
    tracks,
    tier,
    reason,
  }: {
    /** the panel the answer is for */
    panelId: string;
    /** the video the answer is for */
    videoId: string;
    /** every track the video has */
    tracks: BridgeCaptionTrack[];
    /** which tier answered (D-129) */
    tier: CaptionTier | null;
    /** why there are no captions, when there are none (D-129) */
    reason: string | null;
  },
): boolean => {
  const elements = api.getSceneElements();
  const panel = elements.find((candidate) => candidate.id === panelId);

  if (!panel || !isPanelElement(panel)) {
    return false;
  }

  const source = panelSource(panel);

  // a panel that has been replaced is not this answer's panel
  if (source.type !== "youtube" || source.videoId !== videoId) {
    return false;
  }

  const captionTracks: PanelCaptionTrack[] = tracks.map((track) => ({
    language: track.language,
    label: track.label,
    cues: track.cues,
  }));

  const active = captionTracks[0] ?? null;

  const payload = withYoutubePanelState(
    withVideoPanelState(
      {
        ...panel.panel,
        options: { ...panel.panel.options, captions: active },
      },
      {
        tracks: captionTracks,
        language: active?.language ?? DEFAULT_CAPTION_LANGUAGE,
        timeMs: 0,
        playing: false,
      },
    ),
    { tier, reason },
  );

  api.updateScene({
    elements: elements.map((candidate) =>
      candidate.id === panelId ? { ...candidate, panel: payload } : candidate,
    ),
    // the answer is not something the teacher undoes
    captureUpdate: CaptureUpdateAction.NEVER,
  });

  return true;
};
