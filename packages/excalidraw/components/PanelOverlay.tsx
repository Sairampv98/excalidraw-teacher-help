import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getContainingFrame,
  getRenderOpacity,
  isPosterPanelElement,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
  PanelCaptionTrack,
} from "@excalidraw/element/types";

import {
  animatedImageClipPath,
  OUTSIDE_FRAME,
} from "../scene/animatedImageOverlay";
import { panelTransform } from "../scene/panelContent";
import {
  codePanelFileName,
  CODE_PANEL_REGION_STYLE,
  isBridgeCodePanel,
  panelScale,
  readCodePanelState,
  readPanelView,
  videoFormatName,
} from "../scene/panelContent";
import { readVideoPanelState } from "../scene/panelContent";
import { readPanelPlayback } from "../scene/panelContent";
import { PANEL_SCALE_PROPERTY, panelChrome } from "../scene/panelChrome";
import { getPanelCapture, subscribePanelCaptures } from "../scene/panelFrames";
import {
  appliedPlaybackState,
  INITIAL_PLAYBACK_SYNC_STATE,
  PLAYBACK_LOCAL_CLOCK_MS,
  playbackCorrection,
} from "../scene/panelPlayback";
import { panelSource, resolveMediaUrl } from "../scene/mediaRegistry";

import { t } from "../i18n";

import { VS_CODE_DARK } from "./vscodeTheme";

import { captionCueAt, DEFAULT_CAPTION_LANGUAGE } from "./panelCaptions";
import {
  registerVideoSurface,
  unregisterVideoSurface,
} from "./videoPanelSurface";

import type { BinaryFiles } from "../types";

import type { CodeMirrorEditorProps } from "./TTDDialog/CodeMirrorEditor";

import type { MediaPanelSource } from "../scene/mediaRegistry";
import type { PanelCamera } from "../scene/panelContent";
import type { PanelChrome } from "../scene/panelChrome";
import type { PanelPlayback } from "../scene/panelContent";
import type { PlaybackSyncState } from "../scene/panelPlayback";

/**
 * The host of the panel overlay.
 *
 * Inline, not from a stylesheet: if the CSS ever fails to load, an overlay
 * that took clicks would break selecting, dragging and the eraser — the same
 * reason the animated-image overlay's host style is inline.
 *
 * The host itself takes **no** pointer events, but each panel's surface takes
 * them: a panel is an interactive surface, unlike a GIF.
 */
const HOST_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  pointerEvents: "none",
};

/**
 * What a video panel tells its host about itself.
 *
 * One event type for the whole surface, so the overlay has a single way into
 * the scene: the host is a second Excalidraw instance (the presenter) or the
 * library itself, and neither of them should have to know about the video's
 * internals.
 */
export type VideoPanelEvent =
  /** the caption that is on screen right now — the text the panel shows */
  | { type: "caption"; text: string }
  /** the teacher switched the caption track */
  | { type: "track"; language: string }
  /** the video told the browser its own size */
  | { type: "metadata"; width: number; height: number }
  /**
   * the position of the video, in seconds, and whether it is playing.
   *
   * The host writes it onto the panel **element**, on a coarse tick — the
   * position is shared state, and it travels with the element to the presenter
   * (D-57).
   */
  | { type: "playback"; time: number; playing: boolean };

type PanelOverlayProps = {
  panels: readonly ExcalidrawPanelElement[];
  files: BinaryFiles;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  viewport: { width: number; height: number };
  /**
   * The host is told what the video panel has to say.
   *
   * The caption is the important one: it is written into the **text element**
   * the panel is bound to, which is an ordinary element of the document — not
   * a second renderer and not a burn-in.
   */
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
  /**
   * The teacher flips the code panel's view (D-83).
   *
   * The host owns the write - the same shape as the lock button's
   * `onToggleLock(panelId)` - so the panel asks and the host decides.
   */
  onToggleView?: (panelId: string) => void;
  /**
   * The host is a **read-only mirror** — the presenter.
   *
   * A mirror applies the playback position the editor published and it never
   * writes one back: two windows writing to each other would fight (D-57).
   */
  mirror?: boolean;
};

/**
 * The caption track of a video panel, as a WebVTT data URL.
 *
 * The track lives in the element's payload as plain data — a `<track>`'s `src`
 * is a URL, and a `data:` URL is the only way to carry the cues without
 * inventing a file id for them. The payload stays plain and
 * structured-cloneable, which is what the transport needs (D-46).
 */
const captionTrackDataUrl = (
  track: NonNullable<ExcalidrawPanelElement["panel"]["options"]["captions"]>,
): string => {
  const formatTime = (ms: number) => {
    const totalSeconds = Math.max(0, ms) / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = (totalSeconds % 60).toFixed(3);

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0",
    )}:${seconds.padStart(6, "0")}`;
  };

  const cues = track.cues
    .map(
      (cue) =>
        `${formatTime(cue.startMs)} --> ${formatTime(cue.endMs)}\n${cue.text}`,
    )
    .join("\n\n");

  return `data:text/vtt;charset=utf-8,${encodeURIComponent(
    `WEBVTT\n\n${cues}\n`,
  )}`;
};

/**
 * The **mirrored editor** of a code panel.
 *
 * CodeMirror is loaded **lazily**, the same way the TTD dialog loads it: the
 * editor is a heavy module, and a canvas that has no code panel on it must
 * not pay for it. Until it is there, the plain text stands in — the teacher
 * sees the code either way.
 *
 * The editor wears the **VS Code dark theme** whatever the app's theme is
 * (D-80): the teacher is looking at VS Code while they teach, and the panel
 * has to look like the editor they are looking at.
 *
 * **This panel renders the editor ITSELF, and that is deliberate.**
 *
 * It is a RECONSTRUCTION of the teacher's editor, drawn in the app, in the
 * browser — not a picture of it, and not the editor's own DOM. There is no
 * other way to do it: **no extension API can hand the editor over.** Not the
 * stable API, not the proposed ones, not the internal ones:
 *
 * - the extension host is a **DOM-less Node process** — there is no document,
 *   no window and no element to hand over;
 * - the message bridge is **JSON-only** — the extension can send the
 *   document's text and its selection, never rendered pixels;
 * - there is **no registered command that snapshots the editor**: a
 *   repo-wide sweep of the extension API for `copyImage`, `saveImage`,
 *   `exportImage`, `captureScreenshot` and `getEditorDomNode` finds **zero**
 *   matches.
 *
 * So the panel paints the editor's **look** from the palette in
 * `./vscodeTheme` (the colours VS Code actually paints) and the editor's
 * **text** from the bridge. Do not go looking for a screenshot API: there
 * isn't one.
 */
const CodePanelEditor = ({
  value,
  language,
}: {
  value: string;
  language?: string;
}) => {
  const [Editor, setEditor] =
    useState<React.ComponentType<CodeMirrorEditorProps> | null>(null);

  useEffect(() => {
    let cancelled = false;

    import("./TTDDialog/CodeMirrorEditor")
      .then((mod) => {
        if (!cancelled) {
          setEditor(() => mod.default);
        }
      })
      .catch(() => {
        // the plain text stands in
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!Editor) {
    return (
      <pre
        className="excalidraw__panel-code-text"
        data-testid="code-panel-text"
        style={{
          background: VS_CODE_DARK.background,
          color: VS_CODE_DARK.foreground,
        }}
      >
        {value}
      </pre>
    );
  }

  return (
    <Editor
      value={value}
      onChange={() => {}}
      readOnly={true}
      theme="vscode"
      placeholder={t("labels.panel.code.noFile")}
      // the file's own language, so the editor wears the file's grammar and
      // not the mermaid one (D-84)
      language={language}
    />
  );
};

/**
 * The hairline between a code panel's regions - VS Code's own.
 */
const VS_CODE_HAIRLINE: React.CSSProperties = {
  borderTopWidth: 1,
  borderTopStyle: "solid",
  borderTopColor: VS_CODE_DARK.border,
};

/**
 * The surface of a **code panel**: the teacher's editor, the program's output
 * and the bridge's own messages (D-51).
 *
 * Three regions, in the order the teacher reads them. The editor is a
 * **read-only mirror** — it shows the teacher's text, and the teacher types in
 * VS Code, not here.
 *
 * The panel wears the **VS Code dark theme** whatever the app's theme is
 * (D-80), and it says **which file** it is mirroring: code with no name reads
 * as a text box, and the teacher cannot tell the panel from a diagram.
 *
 * When there is no bridge, the panel says so. It never shows a blank editor:
 * a blank editor looks like a broken panel, and the teacher cannot tell it
 * apart from a program that produced nothing (D-52).
 *
 * ## The VIEW decides what is drawn (D-83)
 *
 * The native editor is the DEFAULT and the live picture of the editor's own
 * window is the opt-in alternative. The teacher turns the live view on from
 * the panel's own header, and the choice is the panel's own - it is persisted
 * in the payload, so it survives the bridge's own writes.
 */
const CodePanelSurface = ({
  panel,
  chrome,
  onToggleView,
  mirror,
}: {
  panel: ExcalidrawPanelElement;
  /** the chrome's geometry, in the panel's own units (D-92) */
  chrome: PanelChrome;
  onToggleView?: (panelId: string) => void;
  /** the host is a read-only mirror - the presenter (D-57) */
  mirror?: boolean;
}) => {
  const state = readCodePanelState(panel.panel);

  /**
   * The live view of the editor's **own window** (D-82, D-85).
   *
   * The frames do NOT ride in the element's payload - the payload is saved
   * with the document - and they do not even travel over the websocket: the
   * extension serves them as an MJPEG stream, and the panel plays that
   * stream in a plain `<img>`. So the app does no per-frame work at all.
   *
   * What the registry holds is the live view's **descriptor**: the capture's
   * state and the stream's URL. It changes when the state changes, and only
   * then does this panel re-render.
   */
  const capture = useSyncExternalStore(subscribePanelCaptures, () =>
    getPanelCapture(panel.id),
  );

  /** which view the teacher chose (D-83) */
  const view = readPanelView(panel.panel);

  if (!state || state.connection !== "connected") {
    return (
      <div
        className="excalidraw__panel-code-status"
        data-testid="code-panel-status"
        data-bridge-state={state?.connection ?? "not-connected"}
        style={{
          background: VS_CODE_DARK.background,
          color: VS_CODE_DARK.foreground,
        }}
      >
        {/* the panel says WHY it has nothing to show - a region with nothing
            in it is never an answer (D-93) */}
        {state?.statusMessage || t("labels.panel.code.notConnected")}
      </div>
    );
  }

  const hasFile = Boolean(state.editor.uri);
  const fileName = codePanelFileName(state.editor.uri);

  /**
   * The teacher turns the live view on and off from the panel's own header
   * (D-83).
   *
   * The button is NOT in the panel's chrome: the chrome is only rendered for
   * SELECTED panels, so a button there would be invisible until the panel is
   * selected - and the teacher must be able to flip the view mid-class without
   * selecting anything. This header is always mounted.
   *
   * A MIRROR does not get the button: the presenter shows the host's view, it
   * does not change it (D-57).
   */
  const canToggleView = Boolean(onToggleView) && !mirror;

  return (
    <div
      className="excalidraw__panel-code-panel"
      data-testid="code-panel"
      style={{
        background: VS_CODE_DARK.background,
        color: VS_CODE_DARK.foreground,
      }}
    >
      <div
        className="excalidraw__panel-code-editor"
        data-testid="code-panel-editor"
        style={CODE_PANEL_REGION_STYLE.editor}
      >
        {/* the tab strip: WHICH file this is, the way a VS Code tab says it */}
        <div
          className="excalidraw__panel-code-header"
          data-testid="code-panel-header"
          style={{
            borderBottomWidth: 1,
            borderBottomStyle: "solid",
            borderBottomColor: VS_CODE_DARK.accent,
            // The chrome is sized for the SCREEN and the content for the
            // PANEL (D-92): the header keeps its size on screen at any zoom,
            // and it is tall enough for its own text.
            minHeight: chrome.headerHeight,
            fontSize: chrome.headerFontSize,
          }}
        >
          {hasFile ? (
            <>
              <span
                className="excalidraw__panel-code-file"
                data-testid="code-panel-file"
              >
                {fileName || state.editor.uri}
              </span>
              {state.editor.language ? (
                <span
                  className="excalidraw__panel-code-language"
                  data-testid="code-panel-language"
                  style={{
                    color: VS_CODE_DARK.muted,
                    fontSize: chrome.languageFontSize,
                  }}
                >
                  {state.editor.language}
                </span>
              ) : null}
            </>
          ) : (
            // no file is open: the panel says so, with the same wording it
            // uses everywhere else for that case (D-80)
            <span
              className="excalidraw__panel-code-file"
              data-testid="code-panel-no-file"
            >
              {t("labels.panel.code.noFile")}
            </span>
          )}
          {canToggleView ? (
            <button
              type="button"
              className="excalidraw__panel-code-view"
              data-testid="code-panel-view-toggle"
              data-panel-id={panel.id}
              data-view={view}
              onClick={() => onToggleView?.(panel.id)}
              title={
                view === "live"
                  ? t("labels.panel.code.showEditor")
                  : t("labels.panel.code.showLive")
              }
              aria-label={
                view === "live"
                  ? t("labels.panel.code.showEditor")
                  : t("labels.panel.code.showLive")
              }
              style={{
                background: "transparent",
                border: `1px solid ${VS_CODE_DARK.border}`,
                borderRadius: 2,
                color: VS_CODE_DARK.foreground,
                cursor: "pointer",
                font: "inherit",
              }}
            >
              {view === "live"
                ? t("labels.panel.code.viewLive")
                : t("labels.panel.code.viewEditor")}
            </button>
          ) : null}
        </div>

        <div
          className="excalidraw__panel-code-source"
          data-testid="code-panel-source"
        >
          {view === "live" && capture?.status === "live" ? (
            // The live view of the editor's window: a **plain `<img>`**
            // pointed at the extension's MJPEG stream (D-85). The browser
            // decodes the JPEG natively, so the app does nothing per frame.
            // The picture keeps the aspect ratio it has in the editor:
            // `contain` fits it into the panel without stretching it, and
            // the frame's own size comes from the stream itself - the app is
            // never told it (D-82).
            <img
              className="excalidraw__panel-code-live"
              data-testid="code-panel-live-frame"
              src={capture.streamUrl}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
              }}
            />
          ) : hasFile ? (
            // The editor is the DEFAULT view (D-83), and in the live view it
            // is the fallback when there is no picture.
            state.editor.text ? (
              <CodePanelEditor
                value={state.editor.text}
                language={state.editor.language}
              />
            ) : (
              // The file IS open, but it has no content. An empty editor
              // would look like a broken panel, and the teacher could not
              // tell it apart from a program that produced nothing - so the
              // region says what it knows (D-93).
              <div
                className="excalidraw__panel-code-status"
                data-testid="code-panel-empty-file"
                style={{ color: VS_CODE_DARK.foreground }}
              >
                {t("labels.panel.code.emptyFile")}
              </div>
            )
          ) : (
            // The bridge is connected, but it has not sent an editor yet. That
            // is either because no file is open in the editor, or because the
            // extension has not told us yet. A blank region would look like a
            // broken panel, and the teacher could not tell it apart from a
            // program that produced nothing (D-52) - so the panel says what it
            // knows (D-75).
            <div
              className="excalidraw__panel-code-status"
              data-testid="code-panel-no-editor"
              style={{ color: VS_CODE_DARK.foreground }}
            >
              {t("labels.panel.code.noFile")}
            </div>
          )}

          {view === "live" && capture?.status === "unavailable" ? (
            // There is no live view, and the panel says **why**: the text
            // mirror above is the fallback, and a fallback the teacher cannot
            // explain is a broken panel (D-75). The reason is shown ONLY in
            // the live view - in the default view there is nothing to
            // explain, because the teacher did not ask for the live view
            // (D-83).
            <div
              className="excalidraw__panel-code-status"
              data-testid="code-panel-live-status"
              style={{ color: VS_CODE_DARK.muted }}
            >
              {capture.reason}
            </div>
          ) : null}
        </div>
      </div>
      <div
        className="excalidraw__panel-code-output"
        data-testid="code-panel-output"
        style={{
          ...CODE_PANEL_REGION_STYLE.output,
          ...VS_CODE_HAIRLINE,
          color: VS_CODE_DARK.foreground,
        }}
      >
        {state.output.map((line, index) => (
          <div
            key={`${index}-${line.text}`}
            className="excalidraw__panel-code-line"
            data-stream={line.stream}
          >
            {line.text}
          </div>
        ))}
      </div>
      <div
        className="excalidraw__panel-code-console"
        data-testid="code-panel-console"
        style={{
          ...CODE_PANEL_REGION_STYLE.console,
          ...VS_CODE_HAIRLINE,
          color: VS_CODE_DARK.foreground,
        }}
      >
        {state.console.map((line, index) => (
          <div
            key={`${index}-${line.text}`}
            className="excalidraw__panel-code-line"
            data-level={line.level}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * The browser's own error codes for "I cannot play this" (D-97).
 *
 * `MEDIA_ERR_DECODE` (3) and `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) are the
 * browser saying that it cannot decode this container - a `.mkv`, say. The
 * numbers are the DOM's own, so they are named here rather than read off
 * `MediaError`, which is not everywhere.
 */
const CANNOT_PLAY_CODES = [3, 4];

/**
 * The live surface of a **video panel**.
 *
 * The video is a real `<video>` element — a panel is interactive, so it cannot
 * be painted onto the canvas — with its own controls: play, pause, seek,
 * volume and mute.
 *
 * ## The captions are NOT drawn inside the player
 *
 * The owner asked for the captions to live **outside** the player, in an
 * ordinary text element beside the panel (2026-10-21). So the `<track>`
 * elements carry the cues — the browser reads them, and the teacher can turn
 * the browser's own captions on if they want them — but **none of them is
 * `default`**: the player does not draw the caption, and the caption the
 * teacher reads is the one in the text element next to the panel.
 *
 * The cue the panel reports is computed from the panel's **own** copy of the
 * cues (the payload's `options.captions`), not from the browser's text track:
 * the panel's copy is the same data the document was saved with, so the
 * caption the text element shows is the caption the document knows about.
 */
/**
 * The browser's own error codes for "I cannot play this" (D-97).
 *
 * `MEDIA_ERR_DECODE` (3) and `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) are the
 * browser saying that it cannot decode this container - a `.mkv`, say. The
 * numbers are the DOM's own, so they are named here rather than read off
 * `MediaError`, which is not everywhere.
 */
const VideoPanelSurface = ({
  panel,
  src,
  mimeType,
  chrome,
  onVideoEvent,
  mirror,
}: {
  panel: ExcalidrawPanelElement;
  /**
   * Where the video's bytes are.
   *
   * A data URL for a file in the document's own store, and a URL the **host**
   * lent us for a media-backed panel (D-95).
   */
  src: string;
  /** the video's own type, so the panel can say what it cannot play (D-97) */
  mimeType: string;
  /** the chrome's geometry, in the panel's own units (D-92) */
  chrome: PanelChrome;
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
  /**
   * The host is a **read-only mirror** — the presenter (D-57).
   *
   * A mirror applies the position the editor published and it keeps the video
   * moving on its own between the updates. It never writes a position back:
   * the editor is the source of truth, and two windows writing to each other
   * would fight.
   */
  mirror?: boolean;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  /**
   * The browser's own verdict on the video (D-97).
   *
   * The `<video>` element's `error` event is the **oracle**: it is the browser
   * saying "I cannot play this", and nothing else knows better. A panel that
   * shows nothing and says nothing is indistinguishable from a panel that has
   * nothing to show (D-75, D-93), so the error becomes a sentence.
   */
  const [playError, setPlayError] = useState<number | null>(null);

  const state = readVideoPanelState(panel.panel);
  const tracks: PanelCaptionTrack[] = state?.tracks ?? [];
  const language = state?.language ?? DEFAULT_CAPTION_LANGUAGE;

  // this window's model of the video, and the position the editor published
  const syncStateRef = useRef<PlaybackSyncState>(INITIAL_PLAYBACK_SYNC_STATE);
  const receivedRef = useRef<PanelPlayback | null>(null);

  // the **active** track is the payload's own home for it; the state's list is
  // the fallback for a panel whose payload was written before the track was
  // chosen
  const activeTrack: PanelCaptionTrack | null =
    panel.panel.options.captions ??
    tracks.find((track) => track.language === language) ??
    null;

  /**
   * The panel is registered so the lock transition can freeze the frame the
   * teacher is looking at — at the video's own size, not the panel's.
   */
  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    registerVideoSurface(panel.id, video);

    return () => {
      unregisterVideoSurface(panel.id);
    };
  }, [panel.id]);

  /**
   * Reports the position of the video, and with it the caption that is on
   * screen. The host writes the caption into the bound text element.
   *
   * The report is a **fact about the video**, not a request to write: whether
   * this host may write the position is the host's own decision, and the
   * library makes it (D-57).
   */
  const reportPosition = useCallback(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const now = Math.round((video.currentTime || 0) * 1000);

    setTimeMs(now);

    const cue = captionCueAt(activeTrack, now);

    onVideoEvent?.(panel.id, { type: "caption", text: cue?.text ?? "" });
    onVideoEvent?.(panel.id, {
      type: "playback",
      time: video.currentTime || 0,
      playing: !video.paused,
    });
  }, [activeTrack, onVideoEvent, panel.id]);

  /**
   * Applies the position the editor published, and keeps the video moving
   * between the updates (D-57).
   *
   * The correction is the library's own rule (`scene/panelPlayback.ts`): a small
   * drift is closed by the **rate**, a large one by a **seek**.
   */
  const applyPublishedPlayback = useCallback((now: number) => {
    const video = videoRef.current;
    const received = receivedRef.current;

    if (!video || !received) {
      return;
    }

    const correction = playbackCorrection({
      received,
      state: syncStateRef.current,
      now,
    });

    if (correction.seekTo !== null) {
      try {
        video.currentTime = correction.seekTo;
      } catch {
        // the browser refused the seek — the video keeps its own position
      }
    }

    try {
      video.playbackRate = correction.playbackRate;
    } catch {
      // the browser refused the rate — the video plays at its own speed
    }

    if (correction.playing) {
      if (video.paused) {
        try {
          const played = video.play() as Promise<void> | undefined;

          played?.catch(() => {
            // the browser refused to play — the panel stays as it is
          });
        } catch {
          // the browser refused to play — the panel stays as it is
        }
      }
    } else if (!video.paused) {
      video.pause();
    }

    syncStateRef.current = appliedPlaybackState({
      received,
      correction,
      now,
    });

    setPlaying(correction.playing);
    setTimeMs(Math.round((video.currentTime || 0) * 1000));
  }, []);

  /**
   * The published position arrives with the element, so it is applied as soon
   * as the element carries one.
   */
  useEffect(() => {
    if (!mirror) {
      return;
    }

    const playback = readPanelPlayback(panel);

    if (!playback) {
      return;
    }

    receivedRef.current = playback;

    applyPublishedPlayback(Date.now());
  }, [applyPublishedPlayback, mirror, panel]);

  /**
   * The local clock: the video keeps playing between the updates, and the
   * clock re-checks the drift while it does.
   *
   * `requestVideoFrameCallback` is the browser's own "a frame was presented"
   * hook, so the check rides the video's own frames. Without it the check runs
   * on a timer — slower, but the same rule.
   */
  useEffect(() => {
    if (!mirror) {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frameHandle: number | null = null;

    const withFrameCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (
        callback: (now: number, metadata: unknown) => void,
      ) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    const tick = () => {
      if (cancelled) {
        return;
      }

      applyPublishedPlayback(Date.now());

      if (typeof withFrameCallback.requestVideoFrameCallback === "function") {
        frameHandle = withFrameCallback.requestVideoFrameCallback(() => tick());
        return;
      }

      timer = setTimeout(tick, PLAYBACK_LOCAL_CLOCK_MS);
    };

    tick();

    return () => {
      cancelled = true;

      if (timer !== null) {
        clearTimeout(timer);
      }

      if (frameHandle !== null) {
        withFrameCallback.cancelVideoFrameCallback?.(frameHandle);
      }
    };
  }, [applyPublishedPlayback, mirror]);

  const togglePlay = () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (video.paused) {
      try {
        const played = video.play() as Promise<void> | undefined;

        played?.catch(() => {
          // the browser refused to play — the panel stays as it is
        });
      } catch {
        // the browser refused to play — the panel stays as it is
      }
    } else {
      video.pause();
    }
  };

  const seekTo = (value: number) => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.currentTime = value / 1000;
    setTimeMs(value);
    reportPosition();
  };

  const setVolumeTo = (value: number) => {
    const video = videoRef.current;

    setVolume(value);

    if (video) {
      video.volume = value;
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;

    if (!video) {
      setMuted((current) => !current);
      return;
    }

    // the element's own value is the truth; the state only mirrors it
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  if (playError !== null) {
    return (
      <div
        className="excalidraw__panel-video-error"
        data-testid="panel-video-error"
        data-error-code={playError}
        data-panel-kind={panel.panelKind}
      >
        <p className="excalidraw__panel-video-error-text">
          {CANNOT_PLAY_CODES.includes(playError)
            ? t("labels.panel.video.cannotPlay", {
                format: videoFormatName(mimeType),
              })
            : t("labels.panel.video.playbackFailed")}
        </p>
        {CANNOT_PLAY_CODES.includes(playError) && (
          <p className="excalidraw__panel-video-error-command">
            <code>{t("labels.panel.video.convertCommand")}</code>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="excalidraw__panel-video-box" data-testid="panel-video-box">
      <video
        ref={videoRef}
        className="excalidraw__panel-video"
        data-testid="panel-video"
        src={src}
        playsInline={true}
        // the metadata is what tells the browser the video's own size, and the
        // size is what a poster is captured at
        preload="metadata"
        muted={muted}
        onTimeUpdate={reportPosition}
        onSeeked={reportPosition}
        // the ELEMENT is the truth and the state only mirrors it: whatever
        // changed the element's own volume, the slider follows it
        onVolumeChange={(event) => setVolume(event.currentTarget.volume)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        // The browser's own verdict: it is the only thing that knows whether
        // this container can be played here (D-97)
        onError={(event) => setPlayError(event.currentTarget.error?.code ?? 0)}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;

          setDurationMs(
            Number.isFinite(video.duration)
              ? Math.round(video.duration * 1000)
              : 0,
          );

          onVideoEvent?.(panel.id, {
            type: "metadata",
            width: video.videoWidth,
            height: video.videoHeight,
          });
        }}
      >
        {tracks.map((track) => (
          <track
            key={track.language}
            kind="captions"
            src={captionTrackDataUrl(track)}
            srcLang={track.language}
            label={track.label}
            // deliberately NOT `default`: the captions live in the text element
            // beside the panel, not inside the player
          />
        ))}
      </video>

      <div
        className="excalidraw__panel-video-controls"
        data-testid="panel-video-controls"
        // The chrome is sized for the SCREEN and the content for the PANEL
        // (D-92): the control strip keeps its size on screen at any zoom, so
        // it is never squeezed to nothing and the controls can be hit.
        style={{
          minHeight: chrome.controlHeight,
          fontSize: chrome.controlFontSize,
        }}
      >
        <button
          type="button"
          className="excalidraw__panel-video-button"
          data-testid="panel-video-play"
          onClick={togglePlay}
          title={playing ? "Pause" : "Play"}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: chrome.buttonSize,
            height: chrome.buttonSize,
            fontSize: chrome.buttonFontSize,
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <input
          type="range"
          className="excalidraw__panel-video-seek"
          data-testid="panel-video-seek"
          min={0}
          max={Math.max(durationMs, 1)}
          step={100}
          value={Math.min(timeMs, Math.max(durationMs, 1))}
          onChange={(event) => seekTo(Number(event.currentTarget.value))}
          aria-label="Seek"
          style={{
            minWidth: chrome.seekMinWidth,
            height: chrome.sliderHeight,
          }}
        />

        <button
          type="button"
          className="excalidraw__panel-video-button"
          data-testid="panel-video-mute"
          // the muted state is VISIBLE: the button says it, and the volume
          // slider is dimmed while the panel is muted (AC-129)
          data-muted={muted ? "true" : "false"}
          aria-pressed={muted}
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
          style={{
            width: chrome.buttonSize,
            height: chrome.buttonSize,
            fontSize: chrome.buttonFontSize,
          }}
        >
          {muted ? "🔇" : "🔊"}
        </button>

        <input
          type="range"
          className="excalidraw__panel-video-volume"
          data-testid="panel-video-volume"
          data-muted={muted ? "true" : "false"}
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => setVolumeTo(Number(event.currentTarget.value))}
          aria-label="Volume"
          style={{
            width: chrome.volumeWidth,
            height: chrome.sliderHeight,
          }}
        />

        {tracks.length > 1 && (
          <select
            className="excalidraw__panel-video-track"
            data-testid="panel-video-track"
            value={language}
            onChange={(event) =>
              onVideoEvent?.(panel.id, {
                type: "track",
                language: event.currentTarget.value,
              })
            }
            aria-label="Caption language"
            style={{
              height: chrome.trackHeight,
              fontSize: chrome.trackFontSize,
              maxWidth: chrome.trackMaxWidth,
            }}
          >
            {tracks.map((track) => (
              <option key={track.language} value={track.language}>
                {track.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
};

/**
 * The live surface of a **media-backed** video panel (D-95).
 *
 * The bytes are not in the document: they are in the **host's** media store,
 * and the library asks the host's resolver for a URL. The library never sees
 * the bytes and never touches IndexedDB - it only knows how to ask.
 *
 * Until the URL arrives the panel says it is loading, and when the host does
 * not have the media it says that too: a region with nothing in it says
 * **why** (D-93).
 */
const MediaPanelSurface = ({
  panel,
  source,
  chrome,
  onVideoEvent,
  mirror,
}: {
  panel: ExcalidrawPanelElement;
  source: MediaPanelSource;
  /** the chrome's geometry, in the panel's own units (D-92) */
  chrome: PanelChrome;
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
  /** the host is a read-only mirror - the presenter (D-57) */
  mirror?: boolean;
}) => {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    setUrl(null);
    setMissing(false);

    void resolveMediaUrl(source.mediaId).then((resolved) => {
      if (cancelled) {
        return;
      }

      if (!resolved) {
        setMissing(true);
        return;
      }

      setUrl(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [source.mediaId]);

  // The URL is **lent** by the host: the library gives it back when the panel
  // goes away, so a long session does not leak one object URL per panel.
  useEffect(
    () => () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );

  if (missing) {
    return (
      <div
        className="excalidraw__panel-file-gone"
        data-testid="panel-media-gone"
        data-panel-kind={panel.panelKind}
      >
        {t("labels.panel.mediaGone")}
      </div>
    );
  }

  if (!url) {
    return (
      <div
        className="excalidraw__panel-media-loading"
        data-testid="panel-media-loading"
        data-panel-kind={panel.panelKind}
      >
        {t("labels.panel.mediaLoading")}
      </div>
    );
  }

  return (
    <VideoPanelSurface
      panel={panel}
      src={url}
      mimeType={source.mimeType}
      chrome={chrome}
      onVideoEvent={onVideoEvent}
      mirror={mirror}
    />
  );
};

/**
 * The live surface of a panel.
 *
 * The foundation wave ships a **minimal but real** surface for every kind, so
 * that the shared machinery — the placement, the lock transition, the crop,
 * the OCR hook — can be exercised end to end. The per-kind waves replace the
 * surface with the real one (a mirrored editor, a video with its captions, an
 * animated flowchart) without touching any of the machinery.
 */
const PanelSurface = ({
  panel,
  files,
  chrome,
  onVideoEvent,
  onToggleView,
  mirror,
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  /** the chrome's geometry, in the panel's own units (D-92) */
  chrome: PanelChrome;
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
  /** the teacher flips the code panel's view (D-83) */
  onToggleView?: (panelId: string) => void;
  /** the host is a read-only mirror - the presenter (D-57) */
  mirror?: boolean;
}) => {
  // the source, widened: a panel may name media in the host's store (D-95)
  const source = panelSource(panel);

  if (panel.panelKind === "code" && isBridgeCodePanel(panel)) {
    return (
      <CodePanelSurface
        panel={panel}
        chrome={chrome}
        onToggleView={onToggleView}
        mirror={mirror}
      />
    );
  }

  if (source.type === "media") {
    return (
      <MediaPanelSurface
        panel={panel}
        source={source}
        chrome={chrome}
        onVideoEvent={onVideoEvent}
        mirror={mirror}
      />
    );
  }

  if (source.type === "file") {
    const file = files[source.fileId];

    if (!file) {
      // The file is not in the document's store any more - the teacher deleted
      // it, or the document was saved without it. The panel says so, because
      // an empty frame looks like a panel that is broken (D-93).
      return (
        <div
          className="excalidraw__panel-file-gone"
          data-testid="panel-file-gone"
          data-panel-kind={panel.panelKind}
        >
          {t("labels.panel.fileGone")}
        </div>
      );
    }

    if (source.mimeType.startsWith("image/")) {
      return (
        <img
          className="excalidraw__panel-image"
          src={file.dataURL}
          alt=""
          draggable={false}
        />
      );
    }

    if (source.mimeType.startsWith("video/")) {
      return (
        <VideoPanelSurface
          panel={panel}
          src={file.dataURL}
          mimeType={source.mimeType}
          chrome={chrome}
          onVideoEvent={onVideoEvent}
          mirror={mirror}
        />
      );
    }
  }

  if (source.type === "inline" && typeof source.payload === "string") {
    return (
      <pre className="excalidraw__panel-code" data-testid="panel-code">
        {source.payload}
      </pre>
    );
  }

  return (
    <div
      className="excalidraw__panel-surface"
      data-testid="panel-surface"
      data-panel-kind={panel.panelKind}
    />
  );
};

/**
 * One live panel, as a real DOM surface sitting on top of the canvas.
 *
 * The transform reproduces what `renderElement` would have drawn, so the
 * surface lands on exactly the pixels the canvas would have used — the canvas
 * paints nothing for a live panel, so this *is* the panel.
 */
const Panel = ({
  panel,
  files,
  elementsMap,
  camera,
  viewport,
  onVideoEvent,
  onToggleView,
  mirror,
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  viewport: { width: number; height: number };
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
  /** the teacher flips the code panel's view (D-83) */
  onToggleView?: (panelId: string) => void;
  /** the host is a read-only mirror — the presenter (D-57) */
  mirror?: boolean;
}) => {
  const { zoom, scrollX, scrollY } = camera;

  /**
   * The scale the panel is rendered at.
   *
   * It is the very number the transform carries - `panelTransform` folds the
   * same value in - so the chrome and the transform cannot disagree about the
   * zoom (D-92). It is published on the panel element as `--panel-scale`, and
   * the chrome's sizes are the screen sizes divided by it.
   */
  const scale = panelScale(camera);

  const chrome = useMemo(() => panelChrome(scale), [scale]);

  const transform = useMemo(
    () => panelTransform(panel, elementsMap, camera),
    // `camera` is rebuilt on every app state change; only its fields can change
    // what the transform comes out as
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      panel,
      elementsMap,
      zoom.value,
      scrollX,
      scrollY,
      camera.offsetLeft,
      camera.offsetTop,
    ],
  );

  const clipPath = useMemo(
    () => animatedImageClipPath(panel, elementsMap, camera, viewport),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panel, elementsMap, zoom.value, scrollX, scrollY, viewport],
  );

  if (clipPath === OUTSIDE_FRAME) {
    return null;
  }

  return (
    // the clip is in the host's own (viewport) space, so it lives on a wrapper
    // that is not transformed — the same structure the animated-image overlay
    // uses, and for the same reason
    <div
      className="excalidraw__panel-clip"
      style={clipPath ? { clipPath } : undefined}
    >
      <div
        className="excalidraw__panel"
        data-testid="panel"
        data-panel-id={panel.id}
        data-panel-kind={panel.panelKind}
        style={
          {
            position: "absolute",
            width: panel.width,
            height: panel.height,
            transform,
            transformOrigin: "0 0",
            // the panel is an interactive surface: it takes the pointer, unlike
            // the host and unlike a GIF
            pointerEvents: "auto",
            opacity: getRenderOpacity(
              panel,
              getContainingFrame(panel, elementsMap),
              new Set<string>(),
              null,
            ),
            // the scale the panel is rendered at, published for the stylesheet
            // (D-92): the chrome's spacing is divided by it
            [PANEL_SCALE_PROPERTY]: scale,
          } as React.CSSProperties
        }
      >
        <PanelSurface
          panel={panel}
          files={files}
          chrome={chrome}
          onVideoEvent={onVideoEvent}
          onToggleView={onToggleView}
          mirror={mirror}
        />
      </div>
    </div>
  );
};

/**
 * The DOM layer of the canvas panels.
 *
 * A live panel cannot be painted onto the canvas: the canvas is a single
 * raster, and a live surface has to be a real element in the page — for the
 * same reason a GIF has to be (see `AnimatedImageOverlay.tsx`), and more so,
 * because a panel is **interactive**.
 *
 * The overlay is mounted by the **library**, so the presenter — a second
 * Excalidraw instance — gets it for free (D-64).
 */
const PanelOverlayImpl = ({
  panels,
  files,
  elementsMap,
  camera,
  viewport,
  onVideoEvent,
  onToggleView,
  mirror,
}: PanelOverlayProps) => {
  if (panels.length === 0) {
    return null;
  }

  return (
    // inline, not just in the stylesheet: if the CSS ever fails to load, an
    // overlay that took clicks would break selecting, dragging and the eraser
    <div
      className="excalidraw__panels"
      style={HOST_STYLE}
      data-testid="panel-overlay"
    >
      {panels.map((panel) => (
        <Panel
          key={panel.id}
          panel={panel}
          files={files}
          elementsMap={elementsMap}
          camera={camera}
          viewport={viewport}
          onVideoEvent={onVideoEvent}
          onToggleView={onToggleView}
          mirror={mirror}
        />
      ))}
    </div>
  );
};

/**
 * The overlay re-renders its whole surface tree whenever it is rendered, so
 * it must not be rendered when nothing it shows has changed. The camera and
 * the viewport are rebuilt on every app state change, so they are compared by
 * value rather than by reference.
 */
const areEqual = (prev: PanelOverlayProps, next: PanelOverlayProps) =>
  prev.panels === next.panels &&
  prev.files === next.files &&
  prev.elementsMap === next.elementsMap &&
  prev.camera.zoom.value === next.camera.zoom.value &&
  prev.camera.scrollX === next.camera.scrollX &&
  prev.camera.scrollY === next.camera.scrollY &&
  prev.camera.offsetLeft === next.camera.offsetLeft &&
  prev.camera.offsetTop === next.camera.offsetTop &&
  prev.viewport.width === next.viewport.width &&
  prev.viewport.height === next.viewport.height &&
  prev.mirror === next.mirror &&
  prev.onVideoEvent === next.onVideoEvent &&
  prev.onToggleView === next.onToggleView;

export const PanelOverlay = React.memo(PanelOverlayImpl, areEqual);

/**
 * Whether a panel is a poster — the canvas paints it — rather than a live
 * surface the overlay mounts.
 */
export const isPanelPoster = isPosterPanelElement;
