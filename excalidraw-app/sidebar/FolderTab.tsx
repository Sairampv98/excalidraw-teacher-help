import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";

import {
  DRAG_MIME,
  armImageDragOnCanvas,
  armImagePasteOnCanvas,
  cancelImageDrag,
  cancelImagePaste,
  copyImageToClipboard,
  insertImageIntoScene,
  pendingImageDrag,
} from "./insertIntoScene";
import { scanFolder } from "./sidebarFiles";

import "./sidebar.scss";

import type { ScannedFile } from "./sidebarFiles";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const FolderTab = () => {
  const api = useExcalidrawAPI();
  const inputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<ScannedFile[]>([]);
  const [videoCount, setVideoCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  /**
   * the row that is armed for insertion — by a click (paste on canvas click)
   * or by a drag (drop on the canvas). Same stash, same hint, two gestures.
   */
  const [armed, setArmed] = useState<{
    name: string;
    mode: "paste" | "drag";
  } | null>(null);
  /**
   * Why the last gesture did not put an image on the canvas.
   *
   * A drop released over the sidebar (or off the canvas entirely) is rejected
   * on purpose — the panel floats above the canvas, so inserting there would
   * hide the result. But without this the armed hint just blinks out and the
   * file looks broken, which is exactly how "the GIF doesn't work" was read.
   */
  const [notice, setNotice] = useState<string | null>(null);

  // a stash armed here must not survive the tab going away, or a later click
  // on the canvas would paste an image nobody asked for
  useEffect(
    () => () => {
      cancelImagePaste();
      cancelImageDrag();
    },
    [],
  );

  // object URLs for the row thumbnails, revoked whenever the folder changes
  const previews = useMemo(() => {
    const urls = new Map<ScannedFile, string>();

    for (const entry of images) {
      urls.set(entry, URL.createObjectURL(entry.file));
    }

    return urls;
  }, [images]);

  useEffect(
    () => () => {
      for (const url of previews.values()) {
        URL.revokeObjectURL(url);
      }
    },
    [previews],
  );

  const onPickFolder = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) {
        return;
      }

      const { images: found, videos, skipped } = scanFolder(fileList);

      setImages(found);
      setVideoCount(videos.length);
      setSkippedCount(skipped);
      setIndex(0);
      setFolderName(fileList[0].name);
      // whatever was armed belongs to the previous folder
      cancelImagePaste();
      cancelImageDrag();
      setArmed(null);
      setNotice(null);
    },
    [],
  );

  /**
   * Copy, then paste: clicking a row puts the image on the clipboard *and*
   * stashes it, so the next canvas click drops the image where it was
   * clicked. The clipboard write is best-effort — the stash is what actually
   * makes the flow work when the browser refuses the write.
   */
  const copy = useCallback(
    (entry: ScannedFile) => {
      // the clipboard is the primary path and needs nothing from the canvas
      void copyImageToClipboard(entry.file).then((copied) => {
        if (copied) {
          api?.setToast?.({ message: `Copied ${entry.name}` });
        }
      });

      // the stash + one-shot canvas click is what makes the flow work when
      // the browser refuses the clipboard write
      if (!api) {
        return;
      }

      armImagePasteOnCanvas(api, entry.file, () => setArmed(null));
      setArmed({ name: entry.name, mode: "paste" });
    },
    [api],
  );

  /**
   * Drag is the same flow with the pointer doing the placement: the row is
   * draggable and the release point becomes the drop point. Nothing is put on
   * the dataTransfer but a private marker — the file travels through our own
   * stash, exactly like the click flow, so both paths share one insert.
   */
  const startDrag = useCallback(
    (entry: ScannedFile, event: React.DragEvent<HTMLButtonElement>) => {
      if (!api) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(DRAG_MIME, "1");

      armImageDragOnCanvas(api, entry.file, () => setArmed(null));
      setArmed({ name: entry.name, mode: "drag" });
    },
    [api],
  );

  // the drag is over either way: a drop on the canvas already spent the stash,
  // and a release anywhere else has to drop it
  const endDrag = useCallback(() => {
    // A drop that the canvas accepted consumes the stash before `dragend`
    // fires, so a stash that is *still* armed here means the release was
    // rejected — over the sidebar, or off the canvas. Say so, rather than
    // letting the hint disappear and leaving the user to guess.
    const rejected = !!pendingImageDrag();

    cancelImageDrag();
    setArmed((current) => (current?.mode === "drag" ? null : current));

    if (rejected) {
      setNotice(
        "Released outside the canvas, so nothing was added. Let go over the canvas itself, not over this panel.",
      );
    }
  }, []);

  const onSelect = useCallback(
    (entryIndex: number) => {
      const entry = images[entryIndex];

      setIndex(entryIndex);
      // a fresh gesture supersedes whatever the last one complained about
      setNotice(null);

      if (entry) {
        copy(entry);
      }
    },
    [copy, images],
  );

  const insert = useCallback(
    async (entry: ScannedFile) => {
      if (!api || busy) {
        return;
      }
      setBusy(true);
      try {
        await insertImageIntoScene(api, entry.file);
      } catch (error) {
        api.setToast({
          message: `Could not insert ${entry.name}`,
          closable: true,
        });
        console.error(error);
      } finally {
        setBusy(false);
      }
    },
    [api, busy],
  );

  const selected = images[index];

  return (
    <div className="app-sidebar-panel">
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={onPickFolder}
        // non-standard but supported by Chromium/WebKit (and the app is
        // served from Electron/Chromium), which is how you pick a whole folder
        {...({
          webkitdirectory: "",
          directory: "",
        } as React.InputHTMLAttributes<HTMLInputElement>)}
      />

      <button
        type="button"
        className="app-sidebar-primary"
        onClick={() => inputRef.current?.click()}
      >
        Open folder
      </button>

      {folderName && (
        <div className="app-sidebar-note">
          <strong>{folderName}</strong>
          <span>
            {images.length} image{images.length === 1 ? "" : "s"}
            {videoCount > 0 &&
              ` · ${videoCount} video${
                videoCount === 1 ? "" : "s"
              } skipped (not supported)`}
            {skippedCount > 0 && ` · ${skippedCount} other skipped`}
          </span>
        </div>
      )}

      {images.length === 0 ? (
        <p className="app-sidebar-empty">
          Pick a folder to scan it for images. Click a row to copy the image,
          then click the canvas to paste it where you clicked — or drag a row
          straight onto the canvas to place it where you let go. GIFs work too —
          they stay animated on the canvas. Video files cannot be embedded:
          Excalidraw's image element only understands stills and GIFs.
        </p>
      ) : (
        <div className="app-file-list-panel">
          <div
            className="app-file-list"
            role="listbox"
            aria-label="Folder images"
          >
            {images.map((entry, entryIndex) => (
              <button
                key={`${entry.path}-${entryIndex}`}
                type="button"
                role="option"
                aria-selected={entryIndex === index}
                className={
                  entryIndex === index
                    ? "app-file-list__row app-file-list__row--active"
                    : "app-file-list__row"
                }
                // one click is the whole flow: copy now, paste on canvas click
                onClick={() => onSelect(entryIndex)}
                draggable
                onDragStart={(event) => startDrag(entry, event)}
                onDragEnd={endDrag}
                title={entry.path}
              >
                <span className="app-file-list__thumb">
                  {/* decorative: the file name sits right next to it */}
                  <img
                    src={previews.get(entry)}
                    alt=""
                    draggable={false}
                    loading="lazy"
                  />
                </span>
                <span className="app-file-list__meta">
                  <span className="app-file-list__name">{entry.name}</span>
                  <span className="app-file-list__size">
                    {formatBytes(entry.file.size)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {armed && (
            <div className="app-sidebar-note app-sidebar-note--armed">
              <strong>{armed.name}</strong>
              <span>
                {armed.mode === "drag"
                  ? "Dragging. Release over the canvas — not over this panel — to place it where you let go."
                  : "Copied. Click the canvas to paste it where you clicked."}
              </span>
            </div>
          )}

          {notice && (
            <div
              className="app-sidebar-note app-sidebar-note--warn"
              role="status"
            >
              <span>{notice}</span>
            </div>
          )}

          <button
            type="button"
            className="app-sidebar-primary"
            disabled={busy || !selected}
            onClick={() => {
              // it is on the canvas now, so drop the pending paste
              cancelImagePaste();
              cancelImageDrag();
              setArmed(null);
              setNotice(null);

              if (selected) {
                insert(selected);
              }
            }}
          >
            {busy ? "Inserting…" : "Insert into canvas"}
          </button>
        </div>
      )}
    </div>
  );
};
