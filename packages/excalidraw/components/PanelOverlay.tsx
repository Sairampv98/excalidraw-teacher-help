import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  readCodePanelState,
} from "../scene/panelContent";
import { readVideoPanelState } from "../scene/panelContent";

import { t } from "../i18n";

import { VS_CODE_DARK } from "./vscodeTheme";

import { captionCueAt, DEFAULT_CAPTION_LANGUAGE } from "./panelCaptions";
import {
  registerVideoSurface,
  unregisterVideoSurface,
} from "./videoPanelSurface";

import type { BinaryFileData, BinaryFiles } from "../types";

import type { CodeMirrorEditorProps } from "./TTDDialog/CodeMirrorEditor";

import type { PanelCamera } from "../scene/panelContent";

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
  | { type: "metadata"; width: number; height: number };

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
 */
const CodePanelEditor = ({ value }: { value: string }) => {
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
 */
const CodePanelSurface = ({ panel }: { panel: ExcalidrawPanelElement }) => {
  const state = readCodePanelState(panel.panel);

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
        {state?.statusMessage || "Not connected to the Excalidraw Bridge."}
      </div>
    );
  }

  const hasFile = Boolean(state.editor.uri);
  const fileName = codePanelFileName(state.editor.uri);

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
                  style={{ color: VS_CODE_DARK.muted }}
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
        </div>

        <div
          className="excalidraw__panel-code-source"
          data-testid="code-panel-source"
        >
          {hasFile ? (
            <CodePanelEditor value={state.editor.text} />
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
const VideoPanelSurface = ({
  panel,
  file,
  onVideoEvent,
}: {
  panel: ExcalidrawPanelElement;
  file: BinaryFileData;
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  const state = readVideoPanelState(panel.panel);
  const tracks: PanelCaptionTrack[] = state?.tracks ?? [];
  const language = state?.language ?? DEFAULT_CAPTION_LANGUAGE;

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
  }, [activeTrack, onVideoEvent, panel.id]);

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

  return (
    <div className="excalidraw__panel-video-box" data-testid="panel-video-box">
      <video
        ref={videoRef}
        className="excalidraw__panel-video"
        data-testid="panel-video"
        src={file.dataURL}
        playsInline={true}
        // the metadata is what tells the browser the video's own size, and the
        // size is what a poster is captured at
        preload="metadata"
        muted={muted}
        onTimeUpdate={reportPosition}
        onSeeked={reportPosition}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
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

      <div className="excalidraw__panel-video-controls">
        <button
          type="button"
          className="excalidraw__panel-video-button"
          data-testid="panel-video-play"
          onClick={togglePlay}
          title={playing ? "Pause" : "Play"}
          aria-label={playing ? "Pause" : "Play"}
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
        />

        <button
          type="button"
          className="excalidraw__panel-video-button"
          data-testid="panel-video-mute"
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇" : "🔊"}
        </button>

        <input
          type="range"
          className="excalidraw__panel-video-volume"
          data-testid="panel-video-volume"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => setVolumeTo(Number(event.currentTarget.value))}
          aria-label="Volume"
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
  onVideoEvent,
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
}) => {
  const { source } = panel.panel;

  if (panel.panelKind === "code" && isBridgeCodePanel(panel)) {
    return <CodePanelSurface panel={panel} />;
  }

  if (source.type === "file") {
    const file = files[source.fileId];

    if (file && source.mimeType.startsWith("image/")) {
      return (
        <img
          className="excalidraw__panel-image"
          src={file.dataURL}
          alt=""
          draggable={false}
        />
      );
    }

    if (file && source.mimeType.startsWith("video/")) {
      return (
        <VideoPanelSurface
          panel={panel}
          file={file}
          onVideoEvent={onVideoEvent}
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
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  viewport: { width: number; height: number };
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
}) => {
  const { zoom, scrollX, scrollY } = camera;

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
        style={{
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
        }}
      >
        <PanelSurface panel={panel} files={files} onVideoEvent={onVideoEvent} />
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
  prev.onVideoEvent === next.onVideoEvent;

export const PanelOverlay = React.memo(PanelOverlayImpl, areEqual);

/**
 * Whether a panel is a poster — the canvas paints it — rather than a live
 * surface the overlay mounts.
 */
export const isPanelPoster = isPosterPanelElement;
