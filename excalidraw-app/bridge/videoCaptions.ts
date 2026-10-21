/**
 * The **YouTube caption path** — the types and the protocol messages.
 *
 * The YouTube path itself is **not** this wave's job: the local path (a
 * sidecar next to the video) is the one this wave builds. What is in scope
 * here is the **shape** of the other path, so that the wave that fills it in
 * — the bridge wave, the OCR wave's neighbour — does not have to change the
 * panel to add it.
 *
 * ## Why the bridge has to do it
 *
 * A browser cannot read YouTube's captions: they are not in the page, and the
 * video cannot be drawn into the canvas either. So the **bridge** — the Node
 * process the teacher's VS Code extension runs — fetches them, and the app
 * receives them as ordinary caption track data.
 *
 * ## What arrives
 *
 * The same shape the local path produces: a list of tracks, each with a
 * language and its cues. The panel does not know where the cues came from —
 * it only knows the cues.
 *
 * ## Where these types live
 *
 * The bridge protocol has **one** definition, in
 * `packages/vscode-bridge/bridge/src/protocol.ts`, and that file is outside
 * this wave's scope. So the messages are stated here, on the app side, and
 * the wave that implements the path moves them into the shared module — the
 * messages change shape **not at all**, and the panel does not change either.
 */

import type { PanelCaptionCue } from "@excalidraw/element/types";

/** A caption track as it travels over the bridge. */
export type BridgeCaptionTrack = {
  /** the track's language, e.g. "en" */
  language: string;
  /** the track's label, e.g. "English (auto-generated)" */
  label: string;
  /** the cues of the track */
  cues: PanelCaptionCue[];
};

/** The messages of the YouTube caption path. */
export type VideoCaptionMessage =
  /** app -> bridge: fetch the captions of a YouTube video */
  | {
      v: 1;
      type: "captions:request";
      /** the id of this request, so the answer can be matched to it */
      id: string;
      /** the YouTube video id */
      videoId: string;
    }
  /** bridge -> app: the captions of the video */
  | {
      v: 1;
      type: "captions:result";
      /** the id of the request this answers */
      id: string;
      /** the YouTube video id */
      videoId: string;
      /** every track the video has — there is often more than one */
      tracks: BridgeCaptionTrack[];
    }
  /** bridge -> app: the video has no captions */
  | {
      v: 1;
      type: "captions:none";
      /** the id of the request this answers */
      id: string;
      /** the YouTube video id */
      videoId: string;
      /** why there are none — the video has none, or they could not be read */
      reason: string;
    };

/** The message type of the YouTube caption path. */
export type VideoCaptionMessageType = VideoCaptionMessage["type"];

/**
 * Whether a message belongs to the YouTube caption path.
 *
 * The bridge's own messages are told apart by their type, and the caption
 * path's types are its own — so a message of this path can never be mistaken
 * for a `run:*` or an `ocr:*` message.
 */
export const isVideoCaptionMessage = (message: {
  type?: unknown;
}): message is VideoCaptionMessage =>
  message.type === "captions:request" ||
  message.type === "captions:result" ||
  message.type === "captions:none";

/**
 * The message that says "this video has no captions".
 *
 * The owner's rule applies here too: no captions, no caption element. The
 * wave that fills the path in sends this instead of a result with no tracks,
 * so the two cases cannot be confused.
 */
export const videoCaptionNoneMessage = ({
  id,
  videoId,
  reason,
}: {
  id: string;
  videoId: string;
  reason: string;
}): VideoCaptionMessage => ({
  v: 1,
  type: "captions:none",
  id,
  videoId,
  reason,
});
