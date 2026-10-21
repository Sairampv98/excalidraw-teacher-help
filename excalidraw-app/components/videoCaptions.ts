/**
 * The captions of a video panel, on the **app** side.
 *
 * ## The local caption path is a sidecar
 *
 * A `.srt` or a `.vtt` file that sits **next to** the video. The app reads it —
 * the browser reads files, not the library — the library parses it, and the
 * cues ride in the panel's payload as plain data. The bridge never sees a
 * sidecar: it is the local path's own business, and the YouTube path (the
 * bridge's) is a different one.
 *
 * ## The caption element
 *
 * The caption the teacher reads is an **ordinary Excalidraw text element**
 * beside the panel (the owner's ask, 2026-10-21): not inside the player, not
 * burnt into the picture, but a text element that can be edited, restyled,
 * selected and undone like any other text.
 *
 * And the rule that goes with it: a video **without** a caption track gets
 * **no** caption element at all. There is nothing to show, so nothing is
 * created — not an empty text box, not a placeholder.
 */

import {
  captionTextElement,
  DEFAULT_CAPTION_LANGUAGE,
  parseCaptionTrack,
} from "@excalidraw/excalidraw";

import type {
  ExcalidrawPanelElement,
  PanelCaptionTrack,
} from "@excalidraw/element/types";
import type { CaptionBinding } from "@excalidraw/excalidraw";

/** The file extensions a caption sidecar may have. */
export const CAPTION_SIDECAR_EXTENSIONS = ["srt", "vtt"] as const;

/** The gap between the panel and the caption element beside it. */
export const CAPTION_GAP = 24;

/**
 * Whether a file name is a caption sidecar.
 *
 * A sidecar is not a document of its own: it is read **by** the video next to
 * it, so it is never inserted on its own.
 */
export const isCaptionSidecarName = (name: string): boolean => {
  const extension = name.includes(".")
    ? (name.split(".").pop() ?? "").toLowerCase()
    : "";

  return (CAPTION_SIDECAR_EXTENSIONS as readonly string[]).includes(extension);
};

/**
 * The language of a caption file, from its name.
 *
 * `lesson.en.srt` is English; `lesson.srt` is English too, because that is the
 * language the teacher teaches in and the default of the panel.
 */
export const captionLanguageFromName = (name: string): string => {
  const parts = name.split(".");

  // the last part is the extension
  const language = parts.length > 2 ? parts[parts.length - 2] : "";

  return /^[a-z]{2,3}$/i.test(language)
    ? language.toLowerCase()
    : DEFAULT_CAPTION_LANGUAGE;
};

/**
 * The text of a file.
 *
 * `FileReader` and not `Blob.text()`: the reader is what the rest of the app
 * uses for files, and it works everywhere the app runs.
 */
const readFileText = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("The file could not be read"));
    reader.readAsText(file);
  });

/**
 * The caption track of a sidecar file — or `null` when the file carries no
 * cue, which is the same as having no caption at all.
 */
export const readCaptionTrack = async (
  file: File,
): Promise<PanelCaptionTrack | null> => {
  const text = await readFileText(file);
  const language = captionLanguageFromName(file.name);

  return parseCaptionTrack({ text, language, label: language });
};

/**
 * The sidecar that belongs to a video: the file of the same name and the same
 * directory whose extension is `.srt` or `.vtt`.
 *
 * The name may carry a **language tag**: `lesson.en.srt` is the sidecar of
 * `lesson.mp4` too, and the language in the name is the language of the track.
 * A sidecar that is not found is a video with **no captions at all** — the
 * teacher would see no caption box for a video that has one on disk — so the
 * tagged name is matched as well as the plain one.
 *
 * The plain name wins when both are there: `lesson.srt` is the track the
 * teacher expects, and the tagged one is the extra.
 */
export const findCaptionSidecar = <T extends { name: string; path: string }>(
  video: { name: string; path: string },
  candidates: readonly T[],
): T | null => {
  const videoDirectory = video.path.includes("/")
    ? video.path.slice(0, video.path.lastIndexOf("/"))
    : "";
  const stem = video.name.replace(/\.[^.]+$/, "");
  const stemOf = (name: string) => name.replace(/\.[^.]+$/, "");

  const matches = candidates.filter((candidate) => {
    if (!isCaptionSidecarName(candidate.name)) {
      return false;
    }

    const directory = candidate.path.includes("/")
      ? candidate.path.slice(0, candidate.path.lastIndexOf("/"))
      : "";
    const candidateStem = stemOf(candidate.name);

    return (
      directory === videoDirectory &&
      (candidateStem === stem || candidateStem.startsWith(`${stem}.`))
    );
  });

  return (
    matches.find((candidate) => stemOf(candidate.name) === stem) ??
    matches[0] ??
    null
  );
};

/**
 * The caption element **beside** the panel — or `null` when the video has no
 * caption track.
 *
 * The element is an ordinary text element: the teacher's own element, on the
 * teacher's own canvas, and it is placed beside the panel rather than on top
 * of it, so the picture is never covered by its own caption.
 */
export const captionElementBeside = ({
  panel,
  track,
  fontSize,
  strokeColor,
}: {
  panel: ExcalidrawPanelElement;
  track: PanelCaptionTrack | null | undefined;
  fontSize: number;
  strokeColor: string;
}) => {
  const element = captionTextElement({
    track,
    x: panel.x + panel.width + CAPTION_GAP,
    y: panel.y,
    fontSize,
    strokeColor,
  });

  if (!element) {
    return null;
  }

  return {
    ...element,
    // the caption sits at the panel's bottom edge, the way a subtitle does
    y: panel.y + panel.height - element.height,
  };
};

/**
 * The binding between a panel and its caption element.
 *
 * `null` when there is no caption element: a video without captions has
 * nothing to bind.
 */
export const captionBindingFor = ({
  panel,
  elementId,
  language,
}: {
  panel: ExcalidrawPanelElement;
  elementId: string | null;
  language: string;
}): CaptionBinding | null =>
  elementId ? { elementId, panelId: panel.id, language } : null;

/**
 * The size of a video file, in the video's **own** pixels.
 *
 * The browser knows the size of a video once it has read its metadata, and the
 * size is the video's **intrinsic** size — the size a poster is captured at.
 * The panel's size on the canvas is a different thing and never changes it.
 *
 * `null` when the browser cannot read the video (a codec it does not know, a
 * file that is not a video, or a browser that takes too long): the caller then
 * falls back to a default size. The read never waits for ever — a video the
 * browser cannot open must not hold the insert up.
 */
export const readVideoSize = async (
  file: File,
  timeoutMs = 2000,
): Promise<{ width: number; height: number } | null> => {
  let url: string | null = null;

  try {
    url = URL.createObjectURL(file);

    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("The video did not answer in time"));
      }, timeoutMs);

      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("The video could not be read"));
      };
      video.src = url as string;
    });

    const width = video.videoWidth;
    const height = video.videoHeight;

    return width && height ? { width, height } : null;
  } catch {
    return null;
  } finally {
    if (url) {
      URL.revokeObjectURL(url);
    }
  }
};
