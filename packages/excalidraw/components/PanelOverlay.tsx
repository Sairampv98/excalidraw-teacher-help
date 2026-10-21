import React, { useEffect, useMemo, useState } from "react";

import {
  getContainingFrame,
  getRenderOpacity,
  isPosterPanelElement,
} from "@excalidraw/element";

import type {
  ElementsMap,
  ExcalidrawPanelElement,
  Theme,
} from "@excalidraw/element/types";

import {
  animatedImageClipPath,
  OUTSIDE_FRAME,
} from "../scene/animatedImageOverlay";
import { panelTransform } from "../scene/panelContent";
import { isBridgeCodePanel, readCodePanelState } from "../scene/panelContent";

import { t } from "../i18n";

import type { BinaryFiles } from "../types";

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

type PanelOverlayProps = {
  panels: readonly ExcalidrawPanelElement[];
  files: BinaryFiles;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  viewport: { width: number; height: number };
  theme: Theme;
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
 */
const CodePanelEditor = ({ value, theme }: { value: string; theme: Theme }) => {
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
      theme={theme}
      placeholder={t("labels.panel.code.noFile")}
    />
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
 * When there is no bridge, the panel says so. It never shows a blank editor:
 * a blank editor looks like a broken panel, and the teacher cannot tell it
 * apart from a program that produced nothing (D-52).
 */
const CodePanelSurface = ({
  panel,
  theme,
}: {
  panel: ExcalidrawPanelElement;
  theme: Theme;
}) => {
  const state = readCodePanelState(panel.panel);

  if (!state || state.connection !== "connected") {
    return (
      <div
        className="excalidraw__panel-code-status"
        data-testid="code-panel-status"
        data-bridge-state={state?.connection ?? "not-connected"}
      >
        {state?.statusMessage || "Not connected to the Excalidraw Bridge."}
      </div>
    );
  }

  return (
    <div className="excalidraw__panel-code-panel" data-testid="code-panel">
      <div
        className="excalidraw__panel-code-editor"
        data-testid="code-panel-editor"
      >
        <CodePanelEditor value={state.editor.text} theme={theme} />
      </div>
      <div
        className="excalidraw__panel-code-output"
        data-testid="code-panel-output"
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
  theme,
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  theme: Theme;
}) => {
  const { source, options } = panel.panel;

  if (panel.panelKind === "code" && isBridgeCodePanel(panel)) {
    return <CodePanelSurface panel={panel} theme={theme} />;
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
        <video
          className="excalidraw__panel-video"
          src={file.dataURL}
          controls={true}
          muted={true}
        >
          {options.captions && (
            <track
              kind="captions"
              src={captionTrackDataUrl(options.captions)}
              srcLang={options.captions.language}
              label={options.captions.label}
              default={true}
            />
          )}
        </video>
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
  theme,
}: {
  panel: ExcalidrawPanelElement;
  files: BinaryFiles;
  elementsMap: ElementsMap;
  camera: PanelCamera;
  viewport: { width: number; height: number };
  theme: Theme;
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
        <PanelSurface panel={panel} files={files} theme={theme} />
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
  theme,
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
          theme={theme}
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
  prev.theme === next.theme;

export const PanelOverlay = React.memo(PanelOverlayImpl, areEqual);

/**
 * Whether a panel is a poster — the canvas paints it — rather than a live
 * surface the overlay mounts.
 */
export const isPanelPoster = isPosterPanelElement;
