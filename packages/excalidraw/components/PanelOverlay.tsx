import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  panelEditorText,
  panelScale,
  readCodePanelState,
  readPanelView,
} from "../scene/panelContent";
import { readVideoPanelState } from "../scene/panelContent";
import { readPanelPlayback } from "../scene/panelContent";
import { readYoutubePanelState, youtubeEmbedUrl } from "../scene/panelContent";
import {
  PANEL_SCALE_PROPERTY,
  choiceStripPlacement,
  panelChrome,
} from "../scene/panelChrome";
import { getPanelCapture, subscribePanelCaptures } from "../scene/panelFrames";
import {
  getPendingScreenshot,
  subscribePendingScreenshots,
} from "../scene/panelScreenshot";
import {
  appliedPlaybackState,
  INITIAL_PLAYBACK_SYNC_STATE,
  PLAYBACK_LOCAL_CLOCK_MS,
  playbackCorrection,
} from "../scene/panelPlayback";
import {
  mediaObjectUrl,
  panelSource,
  resolveMediaUrl,
} from "../scene/mediaRegistry";

import { t } from "../i18n";

import { VS_CODE_DARK } from "./vscodeTheme";

import { captionCueAt, DEFAULT_CAPTION_LANGUAGE } from "./panelCaptions";
import {
  registerVideoSurface,
  unregisterVideoSurface,
} from "./videoPanelSurface";

import type {
  BinaryFiles,
  PanelCaptionControls,
  PanelDraftControls,
  PanelRunControls,
  PanelScreenshotControls,
} from "../types";

import type { CodeMirrorEditorProps } from "./TTDDialog/CodeMirrorEditor";

import type { MediaFallback, MediaPanelSource } from "../scene/mediaRegistry";
import type { PanelCamera } from "../scene/panelContent";
import type { PanelChrome } from "../scene/panelChrome";
import type { PanelPlayback } from "../scene/panelContent";
import type { PlaybackSyncState } from "../scene/panelPlayback";
import type { YoutubePanelSource } from "../scene/panelContent";

/**
 * The editor container: the canvas, the panels and the sidebar all live inside
 * it.
 *
 * It is the element that **keeps the keyboard** — the editor listens on it —
 * so it is where the focus goes back to when a foreign document gives it up
 * (D-130).
 */
const EDITOR_CONTAINER_SELECTOR = ".excalidraw";

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
   * The host's **screenshot** controls (D-102, D-103).
   *
   * The library draws the button and the choice strip; the host takes the
   * picture and puts it on the canvas.
   */
  screenshot?: PanelScreenshotControls;
  /**
   * The host's controls for the code panel's **draft** (D-123).
   *
   * The library draws the editor and reports what the teacher typed; the host
   * writes it into the panel's payload.
   */
  draft?: PanelDraftControls;
  /**
   * The host's controls for the code panel's **Run** control (D-124).
   *
   * The library draws the button and the language picker; the host sends the
   * request and the extension runs the code.
   */
  run?: PanelRunControls;
  /**
   * The host's controls for a panel's **captions** (D-129).
   *
   * The library asks; the host fetches — a browser cannot read YouTube's
   * captions, so the bridge does it. Without this prop the panel still shows
   * the video: the video never needed the bridge.
   */
  captions?: PanelCaptionControls;
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
  onChange,
  readOnly = true,
  focusOnMount = false,
}: {
  value: string;
  language?: string;
  /** the teacher typed. The panel reports it; the host writes it (D-123). */
  onChange?: (value: string) => void;
  /**
   * A **mirror** is read-only: the text belongs to the editor it mirrors
   * (D-123).
   *
   * The teacher's own **draft** is not: a panel that shows text must let the
   * teacher change it (D-123).
   */
  readOnly?: boolean;
  /**
   * A panel does **not** take the focus when it appears: the teacher is
   * drawing on the canvas, and a panel that swallowed the keyboard would make
   * the editor unusable (D-123).
   */
  focusOnMount?: boolean;
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
      onChange={onChange ?? (() => {})}
      readOnly={readOnly}
      theme="vscode"
      placeholder={t("labels.panel.code.noFile")}
      // the file's own language, so the editor wears the file's grammar and
      // not the mermaid one (D-84)
      language={language}
      // the testid is on the editor's own host, so the test can find the
      // editable surface without knowing how CodeMirror builds its DOM
      testId="code-panel-draft-editor"
      focusOnMount={focusOnMount}
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
 * The **screenshot** button of a panel (D-102) lives in the panel's
 * **properties**, not on the panel's picture (D-135) - see
 * `components/PanelActions.tsx`.
 *
 * The **choice strip** of a screenshot (D-103).
 *
 * Exactly three entries, and they exist **only** after the capture: before it
 * there is no screenshot, and a choice about a picture that was never taken is
 * a choice about nothing. The strip is chrome - it keeps its size on screen at
 * any zoom (D-92) - and it is drawn by the library, like the header.
 *
 * The strip asks the **host** to act: the host owns the bridge, the pages and
 * the files, and the host is the side that can read a picture (D-105).
 */
const PanelScreenshotChoices = ({
  panel,
  chrome,
  screenshot,
  top,
}: {
  panel: ExcalidrawPanelElement;
  chrome: PanelChrome;
  screenshot: PanelScreenshotControls;
  /** where the strip hangs, in the panel's own units */
  top: string;
}) => {
  const pending = useSyncExternalStore(
    subscribePendingScreenshots,
    () => getPendingScreenshot(panel.id),
    () => getPendingScreenshot(panel.id),
  );

  if (!pending) {
    return null;
  }

  const choice = (
    name: string,
    value: "ocr" | "page" | "new-page",
    label: string,
  ) => (
    <button
      type="button"
      className="excalidraw__panel-screenshot-choice"
      data-testid={`panel-screenshot-choice-${name}`}
      data-panel-id={panel.id}
      onClick={() => screenshot.onChoice?.(panel.id, value)}
      style={{
        // Every size of the chrome comes from `panelChrome.ts` (D-114): the
        // buttons had a height and no width, so their width was decided by
        // their label - and a button the flexbox may shrink is a choice the
        // teacher cannot read.
        width: chrome.choiceStripButtonWidth,
        height: chrome.choiceStripHeight,
        fontSize: chrome.choiceStripFontSize,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="excalidraw__panel-screenshot-choices"
      data-testid="panel-screenshot-choices"
      data-panel-id={panel.id}
      style={{
        position: "absolute",
        top,
        right: 0,
        display: "flex",
        alignItems: "center",
        // the strip never leaves the panel: it wraps rather than hang over
        // the panel's own edge
        flexWrap: "wrap",
        maxWidth: "100%",
        gap: chrome.choiceStripGap,
        padding: chrome.choiceStripPadding,
        minHeight: chrome.choiceStripBoxHeight,
      }}
    >
      {choice("ocr", "ocr", t("labels.panel.screenshot.ocr"))}
      {choice("page", "page", t("labels.panel.screenshot.page"))}
      {choice("newPage", "new-page", t("labels.panel.screenshot.newPage"))}
    </div>
  );
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
  screenshot,
  mirror,
  draft,
  run,
}: {
  panel: ExcalidrawPanelElement;
  /** the chrome's geometry, in the panel's own units (D-92) */
  chrome: PanelChrome;
  onToggleView?: (panelId: string) => void;
  /** the host's screenshot controls (D-102) */
  screenshot?: PanelScreenshotControls;
  /** the host is a read-only mirror - the presenter (D-57) */
  mirror?: boolean;
  /** the host's controls for the teacher's own text (D-123) */
  draft?: PanelDraftControls;
  /** the host's controls for the Run control (D-124) */
  run?: PanelRunControls;
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

  /** which view the panel shows: the default, or the teacher's own choice (D-99) */
  const view = readPanelView(panel.panel);

  /** where the bridge connection stands */
  const connected = state?.connection === "connected";

  /**
   * What the editor shows, and where the text came from (D-123).
   *
   * The oracle is the library's own `panelEditorText`: the mirror is what a
   * draft STARTS from, and a draft the teacher has edited is theirs alone.
   */
  const editor = panelEditorText(
    panel.panel,
    state ? { text: state.editor.text, language: state.editor.language } : null,
  );

  /**
   * Whether the panel draws the editor at all.
   *
   * The editor is drawn when the panel has **text** to show or to edit, when
   * the teacher asked for the editor view (D-83), or when there is **no
   * bridge at all** - that last one is the owner's bypass: the editor has to
   * work with nothing connected to it (D-123).
   */
  const showEditor =
    view === "editor" ||
    !connected ||
    Boolean(editor.text) ||
    editor.source === "draft";

  /**
   * The languages the teacher may run.
   *
   * They are the ones the **extension** found on this machine (D-124): the
   * picker never offers a language whose runtime is not there.
   */
  const languageOptions = useMemo(() => {
    const options: string[] = [];
    if (editor.language) {
      options.push(editor.language);
    }

    for (const language of run?.languages ?? []) {
      if (language && !options.includes(language)) {
        options.push(language);
      }
    }

    return options;
  }, [editor.language, run?.languages]);

  const hasFile = Boolean(state?.editor.uri);
  const fileName = codePanelFileName(state?.editor.uri ?? "");

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
  const canToggleView = Boolean(onToggleView) && !mirror && connected;

  /**
   * The **run bar**: the language to run, the Run control, and which text the
   * editor is showing (D-123, D-124).
   *
   * The library draws the controls and says which it is showing; the **host**
   * sends the request and the **extension** runs the code. The library never
   * runs anything itself.
   */
  const runBar = (
    <div
      className="excalidraw__panel-code-runbar"
      data-testid="code-panel-runbar"
    >
      {languageOptions.length ? (
        <select
          className="excalidraw__panel-code-language-picker"
          data-testid="code-panel-language-picker"
          aria-label={t("labels.panel.code.runLanguage")}
          value={editor.language}
          onChange={(event) =>
            draft?.onLanguageChange?.(panel.id, event.target.value)
          }
          style={{
            background: "transparent",
            color: VS_CODE_DARK.foreground,
            border: `1px solid ${VS_CODE_DARK.border}`,
            borderRadius: 2,
            font: "inherit",
          }}
        >
          {/* The draft has no language yet: the picker says so instead of
              pretending one is chosen (D-122's rule - say what is missing). */}
          {editor.language ? null : (
            <option value="">{t("labels.panel.code.runLanguageNone")}</option>
          )}
          {languageOptions.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className="excalidraw__panel-code-run"
        data-testid="code-panel-run"
        data-panel-id={panel.id}
        disabled={!connected}
        onClick={() => run?.onRun?.(panel.id)}
        title={t("labels.panel.code.runTitle")}
        aria-label={t("labels.panel.code.runTitle")}
        style={{
          background: "transparent",
          border: `1px solid ${VS_CODE_DARK.border}`,
          borderRadius: 2,
          color: VS_CODE_DARK.foreground,
          cursor: connected ? "pointer" : "not-allowed",
          font: "inherit",
          opacity: connected ? 1 : 0.6,
        }}
      >
        {t("labels.panel.code.run")}
      </button>
      {/* Which text the editor is showing: the teacher's own draft, or the
          mirror it started from (D-123). */}
      <span
        className="excalidraw__panel-code-editor-source"
        data-testid="code-panel-editor-source"
        data-source={editor.source}
        style={{ color: VS_CODE_DARK.muted }}
      >
        {editor.source === "draft"
          ? t("labels.panel.code.yourDraft")
          : t("labels.panel.code.theMirror")}
      </span>
      {!connected ? (
        // Running needs the extension, and the extension is not there: the
        // panel says so instead of pretending (D-124).
        <span
          className="excalidraw__panel-code-run-note"
          data-testid="code-panel-run-needs-bridge"
          style={{ color: VS_CODE_DARK.muted }}
        >
          {t("labels.panel.code.runNeedsBridge")}
        </span>
      ) : null}
    </div>
  );

  /**
   * The panel's **source**: the live picture, the editor, or the reason there
   * is neither.
   */
  const source = (
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
      ) : showEditor ? (
        // The editor is the FALLBACK of the live view (D-99), and it is what
        // the teacher sees when the panel is in the editor view. It is
        // **editable**: the panel shows the teacher's own text, and the
        // mirror is only what that text started from (D-123).
        <>
          <CodePanelEditor
            value={editor.text}
            language={editor.language}
            // the presenter's copy is a mirror: it is read-only (D-57)
            readOnly={Boolean(mirror)}
            onChange={(text) => draft?.onChange?.(panel.id, text)}
          />
          {/* The run bar is at the **bottom** of the source region: the
              panel's own chrome - the bridge field - hangs over the panel's
              top-left corner, and a control under it is a control the
              teacher cannot press. */}
          {runBar}
        </>
      ) : hasFile ? (
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

      {view === "live" && capture?.status !== "live" ? (
        // There is no live view, and the panel says **why**: the text
        // mirror above is the fallback, and a fallback the teacher cannot
        // explain is a broken panel (D-75). The reason is shown ONLY in
        // the live view - in the editor view there is nothing to explain,
        // because the teacher did not ask for the live view (D-83).
        //
        // Two reasons, and both of them are the panel's own knowledge: the
        // capture said it cannot run (and it says why), or there is no
        // descriptor AT ALL - the editor has not published the live view
        // yet, or the presenter has not heard it. A presenter that has
        // heard nothing says so, and never shows a black rectangle
        // (D-101).
        <div
          className="excalidraw__panel-code-status excalidraw__panel-code-notice"
          data-testid="code-panel-live-status"
          style={{ color: VS_CODE_DARK.muted }}
        >
          {capture?.status === "unavailable"
            ? capture.reason
            : t("labels.panel.code.liveNotArrived")}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className="excalidraw__panel-code-panel"
      data-testid="code-panel"
      style={{
        background: VS_CODE_DARK.background,
        color: VS_CODE_DARK.foreground,
      }}
    >
      {connected ? (
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
              // The camera hangs on the panel's own corner (D-115), so the
              // header keeps the room it needs and the view toggle is never
              // hidden under the camera.
              ...(screenshot ? { paddingRight: chrome.cameraReserve } : {}),
            }}
          >
            {hasFile ? (
              <>
                <span
                  className="excalidraw__panel-code-file"
                  data-testid="code-panel-file"
                >
                  {fileName || state?.editor.uri}
                </span>
                {state?.editor.language ? (
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

          {source}
        </div>
      ) : (
        <>
          {/* The panel says WHY it has nothing to show - a region with nothing
              in it is never an answer (D-93). And the editor is STILL there:
              the teacher's own text does not need a bridge (D-123). */}
          <div
            className="excalidraw__panel-code-status excalidraw__panel-code-notice"
            data-testid="code-panel-status"
            data-bridge-state={state?.connection ?? "not-connected"}
            style={{
              background: VS_CODE_DARK.background,
              color: VS_CODE_DARK.foreground,
            }}
          >
            {state?.statusMessage || t("labels.panel.code.notConnected")}
          </div>
          {source}
        </>
      )}
      <div
        className="excalidraw__panel-code-output"
        data-testid="code-panel-output"
        style={{
          ...CODE_PANEL_REGION_STYLE.output,
          ...VS_CODE_HAIRLINE,
          color: VS_CODE_DARK.foreground,
        }}
      >
        {(state?.output ?? []).map((line, index) => (
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
        {(state?.console ?? []).map((line, index) => (
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
 * browser saying that it cannot decode **this file**. The numbers are the
 * DOM's own, so they are named here rather than read off `MediaError`, which
 * is not everywhere.
 */
const CANNOT_PLAY_CODES = [3, 4];

/**
 * The volume a **muted** video gets back when the teacher unmutes it (D-119).
 *
 * A slider at 0 is muted, and unmuting a silent video has to give it a volume
 * again - otherwise the button says "unmuted" and the video stays silent, which
 * is the same lie in the other direction.
 */
const UNMUTED_VOLUME = 1;

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
  src,
  chrome,
  onVideoEvent,
  mirror,
  fallback,
}: {
  panel: ExcalidrawPanelElement;
  /**
   * Where the video's bytes are.
   *
   * A data URL for a file in the document's own store, and a URL the **host**
   * lent us for a media-backed panel (D-95).
   */
  src: string;
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
  /**
   * The **fallback** for the bytes (D-126).
   *
   * The **other way of reaching the same bytes**: a fresh object URL from the
   * host, or the file store's data URL. It is tried **once**, when the first
   * source fails, and it never rebuilds a base64 string of a big file.
   */
  fallback?: MediaFallback;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  /**
   * The video's **effective** state (D-119).
   *
   * The control used to show `video.muted` alone, so a slider at 0 left it
   * saying "unmuted" while the video was silent - the owner's exact report
   * ("sliding the volume slider completely down does not show the mute icon").
   * The state the teacher **experiences** is "muted" when the video is muted
   * **or** its volume is 0, and that is what the button shows and what clicking
   * it acts on. The rule: the control shows the state the user experiences, not
   * the field it happens to be bound to.
   */
  const effectiveMuted = muted || volume === 0;
  /**
   * The browser's own verdict on the video (D-97, D-125).
   *
   * The `<video>` element's `error` event is the **oracle**: it is the browser
   * saying "I cannot play this", and nothing else knows better. A panel that
   * shows nothing and says nothing is indistinguishable from a panel that has
   * nothing to show (D-75, D-93), so the error becomes a sentence - a
   * sentence about **this file**, never about the container (D-125).
   */
  const [playError, setPlayError] = useState<number | null>(null);
  /**
   * The **fallback** (D-126).
   *
   * `fallbackUrl` is the other way of reaching the same bytes, once the first
   * source has failed. `fallbackTried` says that the fallback was tried -
   * whether it worked or not - because a panel that says "this file could not
   * be played" without saying whether the fallback was tried hides half of
   * what it knows (D-75, D-93).
   */
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [fallbackTried, setFallbackTried] = useState(false);
  /**
   * How many sources have been tried (D-127).
   *
   * Each attempt is its own `<video>` element, so an error that arrives for a
   * source the panel has already replaced is delivered to the handler of THAT
   * attempt - and that handler knows the source is gone.
   */
  const [attempt, setAttempt] = useState(0);
  /** the element of the **current** attempt - the two are told apart by it */
  const currentVideoRef = useRef<HTMLVideoElement | null>(null);
  /** the listeners of every attempt, so the panel can let go of them at the end */
  const listenersRef = useRef<
    { video: HTMLVideoElement; onError: (event: Event) => void }[]
  >([]);
  /** the fallback is tried once, and this says so even between renders */
  const fallbackTriedRef = useRef(false);
  /** the URL the fallback produced - the library's to give back */
  const fallbackUrlRef = useRef<string | null>(null);
  /** the panel is gone: nothing may be written to it any more */
  const aliveRef = useRef(true);

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
   * The browser's verdict about **this file** (D-125, D-126, D-127).
   *
   * The error belongs to the source that raised it. A source the panel has
   * already **replaced** is gone, and an error about it is not a fact about
   * the file (D-127) - so it is ignored. Otherwise the verdict is kept, and
   * the **fallback** is tried once: the other way of reaching the same bytes
   * (D-126). Only when the fallback has failed too does the panel say that
   * the file could not be played.
   */
  const handleError = useCallback(
    async (video: HTMLVideoElement) => {
      // The source that failed is not the current one: the panel has replaced
      // it, and this error is not about the file (D-127).
      if (currentVideoRef.current !== video) {
        return;
      }

      const code = video.error?.code ?? 0;

      // The fallback is tried **once** (D-126).
      if (fallbackTriedRef.current) {
        setPlayError(code);
        return;
      }

      fallbackTriedRef.current = true;
      setFallbackTried(true);

      const next = fallback ? await fallback() : null;

      if (!aliveRef.current) {
        return;
      }

      if (!next) {
        // the fallback could not even be reached: the first source's verdict
        // is the failure, and the panel says the fallback was tried
        setPlayError(code);
        return;
      }

      // the URL is lent: the library gives it back when the panel goes away
      fallbackUrlRef.current = next;
      setFallbackUrl(next);
      setAttempt((count) => count + 1);
    },
    [fallback],
  );

  /**
   * The latest handler, for the listeners that were attached earlier.
   *
   * The listener of an attempt must stay attached to its own element - that
   * is how an error for a replaced source is told apart from an error for the
   * current one (D-127) - so it cannot be re-created when the handler changes.
   */
  const handleErrorRef = useRef(handleError);
  handleErrorRef.current = handleError;

  /**
   * The browser's own verdict, listened for **per attempt** (D-127).
   *
   * Each attempt is its own `<video>` element, so each attempt's error has
   * its own handler: the handler of a replaced attempt knows the source is
   * gone and says nothing about the file.
   *
   * The listener is **not** taken off when the element is replaced: the error
   * that arrives for a replaced source is exactly the one that has to be
   * judged, and it arrives after the element is detached. It is taken off when
   * the panel itself goes away.
   *
   * It is a **layout** effect on purpose: the listener must be attached
   * before the browser can dispatch the error, and a media error can arrive
   * as soon as the source is set.
   */
  useLayoutEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    currentVideoRef.current = video;

    const onError = (event: Event) => {
      void handleErrorRef.current(event.target as HTMLVideoElement);
    };

    video.addEventListener("error", onError);
    listenersRef.current.push({ video, onError });
  }, [attempt]);

  /**
   * The panel goes away: every listener is taken off and the fallback's URL
   * is given back (D-95's rule: a lent URL is returned).
   */
  useEffect(() => {
    aliveRef.current = true;

    return () => {
      aliveRef.current = false;

      for (const { video, onError } of listenersRef.current) {
        video.removeEventListener("error", onError);
      }

      listenersRef.current = [];

      if (fallbackUrlRef.current) {
        URL.revokeObjectURL(fallbackUrlRef.current);
        fallbackUrlRef.current = null;
      }
    };
  }, []);

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
  }, [panel.id, attempt]);

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

    if (effectiveMuted) {
      // a slider at 0 is muted too (D-119): unmuting has to bring a volume
      // back, or the video stays silent and the button has just lied again
      if (volume === 0) {
        setVolumeTo(UNMUTED_VOLUME);
      }

      video.muted = false;
    } else {
      // the element's own value is the truth; the state only mirrors it
      video.muted = true;
    }

    setMuted(video.muted);
  };

  if (playError !== null) {
    return (
      <div
        className="excalidraw__panel-video-error"
        data-testid="panel-video-error"
        data-error-code={playError}
        data-panel-kind={panel.panelKind}
        // whether the fallback was tried - the panel says so in words too
        // (D-126)
        data-fallback-tried={fallbackTried ? "true" : "false"}
      >
        <p
          className="excalidraw__panel-video-error-text"
          data-testid="panel-video-error-text"
        >
          {CANNOT_PLAY_CODES.includes(playError)
            ? t("labels.panel.video.cannotPlay")
            : t("labels.panel.video.playbackFailed")}
        </p>
        {fallbackTried ? (
          // The fallback was tried and it failed too: the panel says which it
          // tried, because a panel that hides half of what it knows is a
          // panel the teacher cannot act on (D-126, D-75, D-93).
          <p
            className="excalidraw__panel-video-error-fallback"
            data-testid="panel-video-error-fallback"
          >
            {t("labels.panel.video.fallbackFailed")}
          </p>
        ) : null}
        {CANNOT_PLAY_CODES.includes(playError) && (
          // The `ffmpeg` command is a **remedy**, not a verdict on the
          // container (D-125): it is the one command that always produces a
          // file every browser plays.
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
        // Each attempt is its own element, so an error for a source the panel
        // has already replaced is delivered to the handler of THAT attempt
        // (D-127).
        key={attempt}
        ref={videoRef}
        className="excalidraw__panel-video"
        data-testid="panel-video"
        // the primary source, or the fallback once it has been tried (D-126)
        src={fallbackUrl ?? src}
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
        // The browser's own verdict is listened for in a layout effect, per
        // attempt - it is the only thing that knows whether THIS file can be
        // played here (D-97, D-127).
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
            // the same rule as the screenshot button (D-108): this glyph is
            // the control's content, so without the rule the flexbox could
            // take the chrome's size away from it too
            flexShrink: 0,
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
          // slider is dimmed while the panel is muted (AC-129). The state it
          // shows is the **effective** one - a slider at 0 is muted (D-119).
          data-muted={effectiveMuted ? "true" : "false"}
          aria-pressed={effectiveMuted}
          onClick={toggleMute}
          title={effectiveMuted ? "Unmute" : "Mute"}
          aria-label={effectiveMuted ? "Unmute" : "Mute"}
          style={{
            width: chrome.buttonSize,
            height: chrome.buttonSize,
            fontSize: chrome.buttonFontSize,
            // the same rule as the play button (D-108)
            flexShrink: 0,
          }}
        >
          {effectiveMuted ? "🔇" : "🔊"}
        </button>

        <input
          type="range"
          className="excalidraw__panel-video-volume"
          data-testid="panel-video-volume"
          data-muted={effectiveMuted ? "true" : "false"}
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
      // the media id IS the source: a new one is a new panel's worth of
      // attempts (D-127)
      key={source.mediaId}
      panel={panel}
      src={url}
      chrome={chrome}
      onVideoEvent={onVideoEvent}
      mirror={mirror}
      /**
       * The **fallback** for the bytes (D-126): the host's own store, asked
       * for a **fresh** object URL. The URL the host lent may be stale or
       * revoked - the library lends it and gives it back when the panel goes
       * away - and asking again is cheap: the host reads its own Blob and
       * makes another URL. It never rebuilds a base64 string of a big file
       * (D-94).
       */
      fallback={() => resolveMediaUrl(source.mediaId)}
    />
  );
};

/**
 * The **YouTube** panel: an iframe of YouTube's own player (D-128).
 *
 * The panel holds a **video id**, and the embed URL is built from it in one
 * place (`youtubeEmbedUrl`). Nothing here talks to YouTube's pages: an iframe
 * is the **supported** way to play a YouTube video in a web page, so there is
 * no endpoint to call, no markup to parse and no signature to compute — and
 * nothing of ours can rot when YouTube changes something.
 *
 * ## The focus (D-130)
 *
 * An iframe is different from every other panel's content: clicking it moves
 * the focus into **YouTube's document**, and the whiteboard's keyboard (Ctrl+V,
 * the arrow keys, Delete) stops reaching the canvas while it does. So the
 * iframe **borrows** the focus and gives it back — the same rule the sidebar
 * already follows (D-73): the canvas takes the focus back when the pointer
 * leaves the panel, and the iframe's focus is blurred.
 *
 * A foreign document may borrow the focus, never keep it.
 *
 * ## The layout (D-131, D-132)
 *
 * The panel is the **video**: it is 480x270, which is 16:9, and that is the
 * aspect YouTube's own player renders at. So the iframe **fills** the panel,
 * and the caption note — an **annotation** about the video, not a second thing
 * beside it — **floats over** the video's top edge as one line, with the whole
 * reason in its tooltip.
 *
 * An annotation never takes the picture's space.
 */
const YoutubePanelSurface = ({
  panel,
  source,
  captions,
}: {
  panel: ExcalidrawPanelElement;
  source: YoutubePanelSource;
  /** the host's caption controls (D-129) */
  captions?: PanelCaptionControls;
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const state = readYoutubePanelState(panel.panel);

  /**
   * The captions are asked for **once**, when the panel appears (D-129).
   *
   * The library does not fetch them: the **host** asks the bridge, and the
   * bridge answers with one of the three tiers. Without the host the panel
   * still shows the video — the video never needed the bridge.
   *
   * The effect may run **twice** — React's development mode runs it twice on
   * purpose — and the captions of a video are read once: the second ask would
   * be a second call to YouTube for the same thing.
   */
  const askedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (askedForRef.current === source.videoId) {
      return;
    }

    askedForRef.current = source.videoId;

    captions?.onRequest?.(panel.id, source.videoId);
  }, [captions, panel.id, source.videoId]);

  /**
   * The focus goes back to the canvas when the pointer leaves (D-130).
   *
   * The pointer's position is compared with the iframe's **rect**, the way the
   * sidebar does it (D-73): an element with `pointer-events: none` is never
   * returned by `elementFromPoint`, so the rect is the honest test.
   *
   * The focus is only taken back when the iframe **holds** it — the teacher's
   * own typing is never interrupted.
   */
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const frame = iframeRef.current;

      if (!frame || document.activeElement !== frame) {
        return;
      }

      const rect = frame.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (inside) {
        return;
      }

      // the pointer has left the panel: the canvas takes the focus back, and
      // the iframe's own focus is blurred (D-130)
      frame.blur();
      frame.contentWindow?.blur();
      frame
        .closest<HTMLElement>(EDITOR_CONTAINER_SELECTOR)
        ?.focus({ preventScroll: true });
    };

    document.addEventListener("pointermove", onPointerMove, true);

    return () => {
      document.removeEventListener("pointermove", onPointerMove, true);
    };
  }, []);

  /**
   * Which tier answered (D-129).
   *
   * The panel says it, so the teacher is never left guessing why a video has
   * no text — and the reason travels with the answer.
   */
  const tier = state?.tier ?? null;
  const note =
    tier === "api"
      ? t("labels.panel.youtube.captionsFromApi")
      : tier === "public"
      ? t("labels.panel.youtube.captionsFromPublic")
      : tier === "none"
      ? // the reason says it all — "no captions: the API key is not set" — and
        // it is only shown on its own when it is missing
        state?.reason || t("labels.panel.youtube.noCaptions")
      : null;

  return (
    <div
      className="excalidraw__panel-youtube"
      data-testid="panel-youtube"
      data-panel-kind={panel.panelKind}
    >
      <iframe
        ref={iframeRef}
        className="excalidraw__panel-youtube-frame"
        data-testid="panel-youtube-embed"
        data-video-id={source.videoId}
        src={youtubeEmbedUrl(source.videoId)}
        title={t("labels.panel.youtube.title")}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        // the iframe is focusable so that the focus can be **given back**: a
        // foreign document may borrow the focus, never keep it (D-130)
        tabIndex={-1}
      />
      {note ? (
        <div
          className="excalidraw__panel-youtube-note"
          data-testid="panel-youtube-captions"
          data-caption-tier={tier}
          // the WHOLE reason is the tooltip (D-132): the line says what fits
          // and the tooltip says it all
          title={note}
        >
          {note}
        </div>
      ) : null}
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
  chrome,
  onVideoEvent,
  onToggleView,
  screenshot,
  mirror,
  draft,
  run,
  captions,
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  /** the chrome's geometry, in the panel's own units (D-92) */
  chrome: PanelChrome;
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
  /** the teacher flips the code panel's view (D-83) */
  onToggleView?: (panelId: string) => void;
  /** the host's screenshot controls (D-102) */
  screenshot?: PanelScreenshotControls;
  /** the host is a read-only mirror - the presenter (D-57) */
  mirror?: boolean;
  /** the host's controls for the teacher's own text (D-123) */
  draft?: PanelDraftControls;
  /** the host's controls for the Run control (D-124) */
  run?: PanelRunControls;
  /** the host's controls for the panel's captions (D-129) */
  captions?: PanelCaptionControls;
}) => {
  // the source, widened: a panel may name media in the host's store (D-95)
  const source = panelSource(panel);

  if (panel.panelKind === "code" && isBridgeCodePanel(panel)) {
    return (
      <CodePanelSurface
        panel={panel}
        chrome={chrome}
        onToggleView={onToggleView}
        screenshot={screenshot}
        mirror={mirror}
        draft={draft}
        run={run}
      />
    );
  }

  if (source.type === "youtube") {
    return (
      <YoutubePanelSurface panel={panel} source={source} captions={captions} />
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
          // the file id IS the source: a new one is a new panel's worth of
          // attempts (D-127)
          key={source.fileId}
          panel={panel}
          src={file.dataURL}
          chrome={chrome}
          onVideoEvent={onVideoEvent}
          mirror={mirror}
          /**
           * The **fallback** for the bytes (D-126): the file store's `dataURL`,
           * re-read, and the same bytes reached through an **object URL**. The
           * browser decodes the base64 itself, so no base64 string is ever
           * built (D-94) - and an object URL plays where a data URL without a
           * type does not (measured, 2026-10-23).
           */
          fallback={async () => {
            const stored = files[source.fileId];

            return stored ? await mediaObjectUrl(stored.dataURL) : null;
          }}
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
  screenshot,
  mirror,
  draft,
  run,
  captions,
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  viewport: { width: number; height: number };
  onVideoEvent?: (panelId: string, event: VideoPanelEvent) => void;
  /** the teacher flips the code panel's view (D-83) */
  onToggleView?: (panelId: string) => void;
  /** the host's screenshot controls (D-102) */
  screenshot?: PanelScreenshotControls;
  /** the host is a read-only mirror — the presenter (D-57) */
  mirror?: boolean;
  /** the host's controls for the teacher's own text (D-123) */
  draft?: PanelDraftControls;
  /** the host's controls for the Run control (D-124) */
  run?: PanelRunControls;
  /** the host's controls for the panel's captions (D-129) */
  captions?: PanelCaptionControls;
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

  /**
   * Whether this panel's picture is waiting to be placed (D-116).
   *
   * The focus state dims the panel's **content** while the picture is in
   * front: the editor steps back, and the panel's own chrome - the camera and
   * the three choices - does not, so the teacher can still act on the picture
   * the focus state shows.
   */
  const pending = useSyncExternalStore(
    subscribePendingScreenshots,
    () => getPendingScreenshot(panel.id),
    () => getPendingScreenshot(panel.id),
  );

  /**
   * Where the screenshot's choice strip hangs, in the panel's own units
   * (D-114).
   *
   * It is computed from the panel's **own rect** - how tall the panel is and
   * whether it wears a header - and from the chrome's own sizes. Nothing here
   * is a number typed in at the call site.
   */
  const placement = useMemo(
    () =>
      choiceStripPlacement({
        scale,
        panelHeight: panel.height,
        hasHeader: panel.panelKind === "code",
      }),
    [scale, panel.height, panel.panelKind],
  );

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
          screenshot={screenshot}
          mirror={mirror}
          draft={draft}
          run={run}
          captions={captions}
        />
        {pending ? (
          // the editor steps back while its picture is in focus (D-116)
          <div
            className="excalidraw__panel-focus-scrim"
            data-testid="panel-focus-scrim"
          />
        ) : null}
        {screenshot ? (
          // The choice strip hangs off the panel's own chrome, and it exists
          // only after the capture (D-103). Its position is computed from
          // the panel's own rect (D-114), never guessed.
          //
          // The CAMERA is not here: it is a choice about the panel, so it
          // lives in the panel's properties (D-135). A button drawn on top
          // of the picture is a button under a YouTube panel's iframe - and
          // the iframe takes the click.
          <PanelScreenshotChoices
            panel={panel}
            chrome={chrome}
            screenshot={screenshot}
            top={placement.top}
          />
        ) : null}
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
  screenshot,
  mirror,
  draft,
  run,
  captions,
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
          screenshot={screenshot}
          mirror={mirror}
          draft={draft}
          run={run}
          captions={captions}
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
  prev.onToggleView === next.onToggleView &&
  prev.screenshot === next.screenshot &&
  prev.draft === next.draft &&
  prev.run === next.run &&
  prev.captions === next.captions;

export const PanelOverlay = React.memo(PanelOverlayImpl, areEqual);

/**
 * Whether a panel is a poster — the canvas paints it — rather than a live
 * surface the overlay mounts.
 */
export const isPanelPoster = isPosterPanelElement;
