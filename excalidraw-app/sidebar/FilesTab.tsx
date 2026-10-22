import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { videoFormatName } from "@excalidraw/excalidraw";
import { t } from "@excalidraw/excalidraw/i18n";

import { findCaptionSidecar } from "../components/videoCaptions";

import { browserState, setBrowserCwd, setBrowserRoot } from "./browserState";
import { hideVideoWireframe, showVideoWireframe } from "./dragWireframe";
import { DocumentViewer } from "./DocumentViewer";
import {
  DRAG_MIME,
  armFileDragOnCanvas,
  armImageDragOnCanvas,
  armInsert,
  cancelImageDrag,
  cancelImagePaste,
  copyImageToClipboard,
  insertImageIntoScene,
  pendingFileDrag,
} from "./insertIntoScene";
import {
  VIDEO_PANEL_FALLBACK_HEIGHT,
  VIDEO_PANEL_FALLBACK_WIDTH,
  browserCanPlayVideo,
  insertVideoPanel,
} from "./videoPanel";
import {
  FILE_ACCEPT,
  directoriesAt,
  groupsAt,
  kindLabel,
  reasonText,
  scanFiles,
} from "./sidebarFiles";

import "./sidebar.scss";

import type { ReactElement } from "react";
import type { GroupEntry, GroupIconId, ScannedFile } from "./sidebarFiles";

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** the icon each group header carries */
const GROUP_ICONS: Record<GroupIconId, ReactElement> = {
  image: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  ),
  document: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  ),
  markdown: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 15v-6l2.5 3L11 9v6" />
      <path d="M15 9v6M18 9l-2 3 2 3" />
    </svg>
  ),
  code: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
    </svg>
  ),
  video: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m10 9 5 3-5 3z" />
    </svg>
  ),
  unsupported: (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
};

/** the icon a folder row carries */
const FOLDER_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const isImageKind = (kind: ScannedFile["kind"]) =>
  kind === "image" || kind === "gif";

/**
 * The one picker.
 *
 * It picks files *and* folders, sorts everything it found by type, and lets
 * the user walk into a folder and back out of it. A file that cannot be used
 * is listed with the reason why — nothing is dropped on the way here.
 */
export const FilesTab = () => {
  const api = useExcalidrawAPI();
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  /**
   * The picked root and the path inside it.
   *
   * Both live in the browser state as well as in this component: the panel is
   * re-created whenever the sidebar is closed and opened again, and the pin has
   * to keep the user where they were.
   */
  const [scan, setScan] = useState(() => scanFiles(browserState().root));
  const [cwd, setCwd] = useState<string[]>(() => browserState().cwd);
  /** the path of the file the user picked out of the list */
  const [selected, setSelected] = useState<string | null>(null);
  /** the path of the document being read, if any */
  const [reading, setReading] = useState<string | null>(null);
  /** the paths of the files that could not be read — they are not usable */
  const [unreadable, setUnreadable] = useState<string[]>([]);
  /**
   * the row that is armed for insertion — by a click (paste on canvas click)
   * or by a drag (drop on the canvas). Same stash, same hint, two gestures.
   */
  const [armed, setArmed] = useState<{
    name: string;
    mode: "paste" | "drag";
  } | null>(null);
  /**
   * Why the last gesture did not put a file on the canvas.
   *
   * A drop released over the sidebar (or off the canvas entirely) is rejected
   * on purpose — the panel floats above the canvas, so inserting there would
   * hide the result. But without this the armed hint just blinks out and the
   * file looks broken, which is exactly how "the GIF doesn't work" was read.
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // a stash armed here must not survive the tab going away, or a later click
  // on the canvas would paste an image nobody asked for
  useEffect(
    () => () => {
      cancelImagePaste();
      cancelImageDrag();
    },
    [],
  );

  const groups = useMemo(
    () => groupsAt(scan, cwd, unreadable),
    [scan, cwd, unreadable],
  );
  const directories = useMemo(() => directoriesAt(scan, cwd), [scan, cwd]);

  /** the documents of this listing — the reader steps through them */
  const documents = useMemo(
    () =>
      groups.flatMap((group) =>
        group.entries.flatMap((entry) =>
          entry.type === "file" &&
          !isImageKind(entry.file.kind) &&
          entry.file.kind !== "video" &&
          entry.file.kind !== "captions"
            ? [entry.file]
            : [],
        ),
      ),
    [groups],
  );

  /** the videos of this listing — they become video panels */
  const videos = useMemo(
    () =>
      groups.flatMap((group) =>
        group.entries.flatMap((entry) =>
          entry.type === "file" && entry.file.kind === "video"
            ? [entry.file]
            : [],
        ),
      ),
    [groups],
  );

  const readingEntry = useMemo(
    () => documents.find((document) => document.path === reading) ?? null,
    [documents, reading],
  );

  // object URLs for the row thumbnails, revoked whenever the listing changes
  const previews = useMemo(() => {
    const urls = new Map<string, string>();

    for (const group of groups) {
      for (const entry of group.entries) {
        if (entry.type === "file" && isImageKind(entry.file.kind)) {
          urls.set(entry.file.path, URL.createObjectURL(entry.file.file));
        }
      }
    }

    return urls;
  }, [groups]);

  useEffect(
    () => () => {
      for (const url of previews.values()) {
        URL.revokeObjectURL(url);
      }
    },
    [previews],
  );

  const onPick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;

    if (!fileList || fileList.length === 0) {
      return;
    }

    const files = Array.from(fileList);
    const scanned = scanFiles(files);

    setBrowserRoot(files, scanned.rootName);
    setScan(scanned);
    setCwd([]);
    setSelected(null);
    setReading(null);
    setUnreadable([]);
    // whatever was armed belongs to the previous pick
    cancelImagePaste();
    cancelImageDrag();
    setArmed(null);
    setNotice(null);
    // allow re-picking the same file
    event.target.value = "";
  }, []);

  const enterDirectory = useCallback(
    (name: string) => {
      const next = [...cwd, name];

      setCwd(next);
      setBrowserCwd(next);
      setSelected(null);
      setNotice(null);
    },
    [cwd],
  );

  const leaveDirectory = useCallback(() => {
    if (cwd.length === 0) {
      return;
    }

    const next = cwd.slice(0, -1);

    setCwd(next);
    setBrowserCwd(next);
    setSelected(null);
  }, [cwd]);

  /**
   * Copy, then paste: clicking a row puts the image on the clipboard *and*
   * stashes it, so the next canvas click drops the image where it was
   * clicked. The clipboard write is best-effort — the stash is what actually
   * makes the flow work when the browser refuses the write.
   */
  const onPickImage = useCallback(
    (entry: ScannedFile) => {
      setSelected(entry.path);
      // a fresh gesture supersedes whatever the last one complained about
      setNotice(null);

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

      armInsert(api, { kind: "image", file: entry.file }, () => setArmed(null));
      setArmed({ name: entry.name, mode: "paste" });
    },
    [api],
  );

  /**
   * Picking a video does not arm a canvas click: a video is a **panel**, and a
   * panel is placed by the insert, not dropped on a click.
   *
   * It does say one thing first: whether this browser can play the container
   * at all. The insert is never refused (D-97) — the teacher is never told
   * "no" — but they are told **before** the insert, so they can convert the
   * file first if they would rather.
   */
  const onPickVideo = useCallback((entry: ScannedFile) => {
    setSelected(entry.path);
    // a fresh gesture supersedes whatever the last one complained about
    setNotice(null);

    const mimeType = entry.file.type;

    if (mimeType && !browserCanPlayVideo(mimeType)) {
      setNotice(
        `${t("labels.panel.video.cannotPlay", {
          format: videoFormatName(mimeType),
        })} ${t("labels.panel.video.convertCommand")}`,
      );
    }
  }, []);

  /**
   * Drag is the same flow with the pointer doing the placement: the row is
   * draggable and the release point becomes the drop point. Nothing is put on
   * the dataTransfer but a private marker — the file travels through our own
   * stash, exactly like the click flow, so both paths share one insert.
   *
   * A **video** takes the same path as an image (D-98) — it is the same stash
   * and the same release point. The difference is the wait: a big video takes a
   * moment to be read and stored, so a loading wireframe stands where the
   * player will land until the insert finishes.
   */
  const startDrag = useCallback(
    (entry: ScannedFile, event: React.DragEvent<HTMLButtonElement>) => {
      if (!api) {
        event.preventDefault();
        return;
      }

      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(DRAG_MIME, "1");

      if (entry.kind === "video") {
        // the captions of a video come from the sidecar next to it
        const sidecar = findCaptionSidecar(entry, scan.files);

        armFileDragOnCanvas(
          api,
          {
            kind: "video",
            file: entry.file,
            sidecarFile: sidecar?.file ?? null,
          },
          () => setArmed(null),
          async (dragged, at, client) => {
            const zoom = api.getAppState().zoom.value;

            // the wireframe stands where the player will land: the panel's own
            // fallback size, at the canvas's zoom (D-98)
            showVideoWireframe({
              clientX: client.clientX,
              clientY: client.clientY,
              width: VIDEO_PANEL_FALLBACK_WIDTH * zoom,
              height: VIDEO_PANEL_FALLBACK_HEIGHT * zoom,
            });

            try {
              await insertVideoPanel(api, {
                videoFile: dragged.file,
                sidecarFile:
                  dragged.kind === "video" ? dragged.sidecarFile ?? null : null,
                at,
              });
            } finally {
              hideVideoWireframe();
            }
          },
        );

        setArmed({ name: entry.name, mode: "drag" });
        return;
      }

      armImageDragOnCanvas(api, entry.file, () => setArmed(null));
      setArmed({ name: entry.name, mode: "drag" });
    },
    [api, scan.files],
  );

  // the drag is over either way: a drop on the canvas already spent the stash,
  // and a release anywhere else has to drop it
  const endDrag = useCallback(() => {
    // A drop that the canvas accepted consumes the stash before `dragend`
    // fires, so a stash that is *still* armed here means the release was
    // rejected — over the sidebar, or off the canvas. Say so, rather than
    // letting the hint disappear and leaving the user to guess.
    const rejected = !!pendingFileDrag();

    cancelImageDrag();
    setArmed((current) => (current?.mode === "drag" ? null : current));

    if (rejected) {
      setNotice(
        "Released outside the canvas, so nothing was added. Let go over the canvas itself, not over this panel.",
      );
    }
  }, []);

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

  /**
   * A video becomes a **video panel** — a live surface on the canvas — and its
   * captions, when it has any, come from the **sidecar** next to it.
   *
   * The sidecar is found by name: the file of the same name and the same
   * directory whose extension is `.srt` or `.vtt`. It is never inserted on its
   * own; it is read by the video.
   */
  const insertVideo = useCallback(
    async (entry: ScannedFile) => {
      if (!api || busy) {
        return;
      }
      setBusy(true);
      try {
        const sidecar = findCaptionSidecar(entry, scan.files);

        await insertVideoPanel(api, {
          videoFile: entry.file,
          sidecarFile: sidecar?.file ?? null,
        });

        if (sidecar) {
          api.setToast({
            message: `Captions from ${sidecar.name}`,
          });
        }
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
    [api, busy, scan.files],
  );

  const step = useCallback(
    (delta: number) => {
      if (!reading || documents.length === 0) {
        return;
      }
      const current = documents.findIndex(
        (document) => document.path === reading,
      );
      const next = (current + delta + documents.length) % documents.length;

      setReading(documents[next].path);
    },
    [documents, reading],
  );

  /**
   * A file that could not be read is not usable any more, so it is listed with
   * the reason rather than looking like a file that works.
   */
  const onUnreadable = useCallback((entry: ScannedFile) => {
    setUnreadable((current) =>
      current.includes(entry.path) ? current : [...current, entry.path],
    );
  }, []);

  /** the images of this listing — the rows the canvas arm works on */
  const images = useMemo(
    () =>
      groups.flatMap((group) =>
        group.entries.flatMap((entry) =>
          entry.type === "file" && isImageKind(entry.file.kind)
            ? [entry.file]
            : [],
        ),
      ),
    [groups],
  );

  /**
   * The image under the cursor: the one the user picked, or else the first of
   * the listing — so "Insert into canvas" works straight after a pick, the way
   * it did when the tab only ever held images.
   */
  const selectedImage = useMemo(
    () => images.find((file) => file.path === selected) ?? images[0] ?? null,
    [images, selected],
  );

  /**
   * The video under the cursor — but only when the user **picked** one: an
   * image is the default of the "Insert into canvas" button, and a video is
   * inserted only when it was asked for.
   */
  const selectedVideo = useMemo(
    () => videos.find((file) => file.path === selected) ?? null,
    [videos, selected],
  );

  const pathLabel = [scan.rootName, ...cwd].filter(Boolean).join(" / ");

  const renderEntry = (entry: GroupEntry) => {
    if (entry.type === "unsupported") {
      const kind = entry.file.kind;

      return (
        <div
          key={entry.file.path}
          className="app-file-list__row app-file-list__row--unsupported"
          title={entry.file.path}
        >
          <span
            className={`app-doc-badge app-doc-badge--${kind ?? "unsupported"}`}
          >
            {kind ? kindLabel(kind) : "?"}
          </span>
          <span className="app-file-list__meta">
            <span className="app-file-list__name">{entry.file.name}</span>
            <span className="app-file-list__size">
              {reasonText(entry.file.reason)}
            </span>
          </span>
        </div>
      );
    }

    const file = entry.file;
    const image = isImageKind(file.kind);
    const video = file.kind === "video";
    const active = selectedImage?.path === file.path;

    if (file.kind === "captions") {
      // a caption sidecar is read **by** the video next to it: it is never
      // inserted on its own, so it is not a button
      return (
        <div
          key={file.path}
          className="app-file-list__row app-file-list__row--caption"
          title={file.path}
        >
          <span className="app-doc-badge app-doc-badge--captions">
            {kindLabel(file.kind)}
          </span>
          <span className="app-file-list__meta">
            <span className="app-file-list__name">{file.name}</span>
            <span className="app-file-list__size">
              the captions of the video next to it
            </span>
          </span>
        </div>
      );
    }

    return (
      <button
        key={file.path}
        type="button"
        role="option"
        aria-selected={active}
        className={
          active
            ? "app-file-list__row app-file-list__row--active"
            : "app-file-list__row"
        }
        // an image is armed for the canvas; a video is picked for the insert;
        // a document is opened
        onClick={() =>
          image
            ? onPickImage(file)
            : video
            ? onPickVideo(file)
            : setReading(file.path)
        }
        // a video drags too — it takes the image's path and lands as a panel
        // (D-98)
        draggable={image || video}
        onDragStart={
          image || video ? (event) => startDrag(file, event) : undefined
        }
        onDragEnd={image || video ? endDrag : undefined}
        title={file.path}
      >
        {image ? (
          <span className="app-file-list__thumb">
            {/* decorative: the file name sits right next to it */}
            <img
              src={previews.get(file.path)}
              alt=""
              draggable={false}
              loading="lazy"
            />
          </span>
        ) : (
          <span className={`app-doc-badge app-doc-badge--${file.kind}`}>
            {kindLabel(file.kind)}
          </span>
        )}
        <span className="app-file-list__meta">
          <span className="app-file-list__name">{file.name}</span>
          <span className="app-file-list__size">
            {formatBytes(file.file.size)}
            {file.language ? ` · ${file.language}` : ""}
          </span>
        </span>
      </button>
    );
  };

  const hasFiles = scan.files.length > 0 || scan.unsupported.length > 0;

  return (
    <div className="app-sidebar-panel">
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        hidden
        onChange={onPick}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        onChange={onPick}
        // non-standard but supported by Chromium/WebKit (and the app is
        // served from Electron/Chromium), which is how you pick a whole folder
        {...({
          webkitdirectory: "",
          directory: "",
        } as React.InputHTMLAttributes<HTMLInputElement>)}
      />

      <div className="app-sidebar-actions">
        <button
          type="button"
          className="app-sidebar-primary"
          onClick={() => filesInputRef.current?.click()}
        >
          Open files
        </button>
        <button
          type="button"
          className="app-sidebar-secondary"
          onClick={() => folderInputRef.current?.click()}
        >
          Open folder
        </button>
      </div>

      {scan.rootName && (
        <div className="app-sidebar-note">
          <strong>{scan.rootName}</strong>
          <span>
            {scan.files.length} file{scan.files.length === 1 ? "" : "s"}
            {scan.directories.length > 0 &&
              ` · ${scan.directories.length} folder${
                scan.directories.length === 1 ? "" : "s"
              }`}
            {scan.unsupported.length > 0 &&
              ` · ${scan.unsupported.length} unsupported`}
          </span>
        </div>
      )}

      {readingEntry ? (
        <DocumentViewer
          entry={readingEntry}
          documents={documents}
          index={documents.findIndex(
            (document) => document.path === readingEntry.path,
          )}
          onStep={step}
          onBack={() => setReading(null)}
          onUnreadable={onUnreadable}
        />
      ) : !hasFiles ? (
        <p className="app-sidebar-empty">
          Open files or a folder. Everything is sorted by type — images, GIFs,
          documents, markdown, code and video — and a folder can be opened and
          walked back out of. Click an image to copy it, then click the canvas
          to paste it where you clicked — or drag a row straight onto the canvas
          to place it where you let go. Click a document to read it. A video
          becomes a video panel on the canvas, with the captions of the .srt or
          .vtt file next to it. A file that cannot be used is listed with the
          reason why.
        </p>
      ) : (
        <div className="app-file-list-panel">
          {cwd.length > 0 && (
            <div className="app-file-browse">
              <button
                type="button"
                className="app-doc-back"
                onClick={leaveDirectory}
                title="Back to the parent folder"
              >
                <span className="app-doc-back__arrow" aria-hidden="true">
                  ←
                </span>
                <span>Back</span>
              </button>
              <span className="app-file-browse__path">{pathLabel}</span>
            </div>
          )}

          <div className="app-file-list" role="listbox" aria-label="Files">
            {directories.map((directory) => (
              <button
                key={directory.join("/")}
                type="button"
                role="option"
                aria-selected={false}
                className="app-file-list__row app-file-list__row--folder"
                onClick={() => enterDirectory(directory[directory.length - 1])}
                title={directory.join("/")}
              >
                <span className="app-file-list__folder">{FOLDER_ICON}</span>
                <span className="app-file-list__meta">
                  <span className="app-file-list__name">
                    {directory[directory.length - 1]}
                  </span>
                </span>
              </button>
            ))}

            {groups.map((group) => (
              <div
                className="app-file-group"
                key={group.id}
                data-group={group.id}
              >
                <div className="app-file-group__head">
                  <span className="app-file-group__icon">
                    {GROUP_ICONS[group.icon]}
                  </span>
                  <span className="app-file-group__label">{group.label}</span>
                  <span className="app-file-group__count">
                    {group.entries.length}
                  </span>
                </div>
                {group.entries.map(renderEntry)}
              </div>
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
            disabled={busy || (!selectedImage && !selectedVideo)}
            onClick={() => {
              // it is on the canvas now, so drop the pending paste
              cancelImagePaste();
              cancelImageDrag();
              setArmed(null);
              setNotice(null);

              if (selectedVideo) {
                insertVideo(selectedVideo);
                return;
              }

              if (selectedImage) {
                insert(selectedImage);
              }
            }}
          >
            {busy
              ? "Inserting…"
              : selectedVideo
              ? "Insert video panel"
              : "Insert into canvas"}
          </button>
        </div>
      )}
    </div>
  );
};
