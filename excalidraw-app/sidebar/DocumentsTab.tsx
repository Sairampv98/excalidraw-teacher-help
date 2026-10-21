import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { codeToHtml } from "shiki";

import {
  armCodePasteOnCanvas,
  cancelCodePaste,
  insertCodeIntoScene,
} from "./insertIntoScene";
import {
  DOCUMENT_ACCEPT,
  escapeHtml,
  renderMarkdown,
  scanDocuments,
} from "./sidebarFiles";

import "./sidebar.scss";

import type { ScannedFile } from "./sidebarFiles";

/** highlighting a megabyte of source in the main thread is not worth it */
const MAX_HIGHLIGHT_BYTES = 400 * 1024;

/** the markdown viewer's zoom, in steps of 10% */
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

const clampZoom = (value: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

type LoadedDoc = {
  entry: ScannedFile;
  /** only set for text-ish documents */
  text?: string;
  /** true when the file was larger than we were willing to highlight */
  truncated?: boolean;
};

const badgeLabel = (kind: ScannedFile["kind"]) =>
  kind === "pdf" ? "PDF" : kind === "markdown" ? "MD" : "TXT";

export const DocumentsTab = () => {
  const api = useExcalidrawAPI();
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  /** the rendered document body — a selection has to lie inside it */
  const bodyRef = useRef<HTMLDivElement>(null);

  const [docs, setDocs] = useState<ScannedFile[]>([]);
  const [index, setIndex] = useState(0);
  /** the tab is either browsing the list or reading one document */
  const [reading, setReading] = useState(false);
  const [loaded, setLoaded] = useState<LoadedDoc | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** scales the rendered document; the PDF viewer zooms with its own toolbar */
  const [zoom, setZoom] = useState(1);

  const selected = docs[index];
  const viewed = reading ? selected : null;
  const isMarkdown = viewed?.kind === "markdown";

  // a new document starts at fit-to-panel, like the PDF viewer does
  useEffect(() => {
    setZoom(1);
  }, [viewed]);

  const changeZoom = useCallback((delta: number) => {
    setZoom((prev) => clampZoom(Math.round((prev + delta) * 10) / 10));
  }, []);

  // The object URL is created together with the preview and revoked once the
  // <object> for it has been swapped out (next document) or unmounted (read
  // back to the list), so the URL on screen is never revoked underneath it.
  const pdfUrl = useMemo(() => {
    if (!viewed || viewed.kind !== "pdf") {
      return null;
    }
    return URL.createObjectURL(viewed.file);
  }, [viewed]);

  useEffect(
    () => () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    },
    [pdfUrl],
  );

  // an armed code paste must not outlive the tab, or a later paste anywhere in
  // the app would insert a code card nobody asked for. It is also dropped when
  // the reader moves to another document, since it belongs to the old one.
  useEffect(() => {
    cancelCodePaste();

    return () => cancelCodePaste();
  }, [viewed]);

  /**
   * Selecting text in the document copies it.
   *
   * The copy happens on the mouse-up / key-up that *ends* the selection, not
   * on `selectionchange`: a clipboard write needs a transient user activation
   * and `selectionchange` carries none, so the browser would reject it with
   * NotAllowedError. A mouse-up or a key-up is an activation.
   *
   * Only a selection that lies wholly inside the body is ours — one that
   * reaches out of the viewer is left to the browser. A link's text is
   * ordinary text inside the body, so it is covered by the same code.
   */
  useEffect(() => {
    const body = bodyRef.current;

    if (!body) {
      return;
    }

    const copySelection = async () => {
      const selection = window.getSelection();

      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);

      if (
        !body.contains(range.startContainer) ||
        !body.contains(range.endContainer)
      ) {
        return;
      }

      const text = selection.toString();

      if (!text) {
        return;
      }

      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        console.error(error);
        api?.setToast({ message: "Clipboard was blocked", closable: true });
      }
    };

    const onSelectionEnd = () => {
      void copySelection();
    };

    // on the document, not on the body: a selection extended with the
    // keyboard ends on whatever holds the focus, which is not the body
    document.addEventListener("mouseup", onSelectionEnd);
    document.addEventListener("keyup", onSelectionEnd);

    return () => {
      document.removeEventListener("mouseup", onSelectionEnd);
      document.removeEventListener("keyup", onSelectionEnd);
    };
  }, [api, html]);

  const onPick = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }

    const found = scanDocuments(fileList);
    setDocs(found);
    setIndex(0);
    setReading(false);
    // allow re-picking the same file
    event.target.value = "";
  }, []);

  // read + highlight the document being read
  useEffect(() => {
    let cancelled = false;

    setLoaded(null);
    setHtml(null);

    if (!viewed) {
      return;
    }

    if (viewed.kind === "pdf") {
      setLoaded({ entry: viewed });
      return;
    }

    setBusy(true);

    (async () => {
      try {
        const truncated = viewed.file.size > MAX_HIGHLIGHT_BYTES;
        const raw = truncated
          ? await viewed.file.slice(0, MAX_HIGHLIGHT_BYTES).text()
          : await viewed.file.text();

        if (cancelled) {
          return;
        }
        // the raw source is what gets copied and inserted; `html` is only ever
        // the preview
        setLoaded({ entry: viewed, text: raw, truncated });

        try {
          const rendered =
            viewed.kind === "markdown"
              ? await renderMarkdown(raw)
              : await codeToHtml(raw, {
                  lang: viewed.language || "text",
                  theme: "github-dark",
                });
          if (!cancelled) {
            setHtml(rendered);
          }
        } catch {
          // unknown language id for this shiki build — fall back to plain text
          if (!cancelled) {
            setHtml(`<pre class="shiki"><code>${escapeHtml(raw)}</code></pre>`);
          }
        }
      } catch (error) {
        if (!cancelled) {
          api?.setToast({
            message: `Could not read ${viewed.name}`,
            closable: true,
          });
          console.error(error);
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, viewed]);

  // moving to another document while reading swaps the preview in place
  const step = useCallback(
    (delta: number) => {
      setIndex((prev) => {
        if (docs.length === 0) {
          return 0;
        }
        return (prev + delta + docs.length) % docs.length;
      });
    },
    [docs.length],
  );

  /**
   * Copy puts the source on the clipboard for every other app, and *also* arms
   * one paste on the canvas so the code arrives as a highlighted card. The
   * clipboard is the only channel other programs can see, so it stays plain text
   * — this is a second, opt-in-by-intent path, not a replacement.
   *
   * `language` rides along so the card can be highlighted. Without it the
   * snippet arrives as plain monospace text, which is the one thing that would
   * have made this look like no progress at all.
   */
  const copyAndArm = useCallback(
    (code: string, fileName: string, language?: string) => {
      if (api) {
        armCodePasteOnCanvas(api, code, { fileName, language });
      }
    },
    [api],
  );

  const onCopy = useCallback(async () => {
    if (!loaded?.text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(loaded.text);
      copyAndArm(loaded.text, loaded.entry.name, loaded.entry.language);
      api?.setToast({
        message: loaded.entry.language
          ? "Copied — paste on the canvas for a highlighted code card"
          : "Copied — paste on the canvas for a code card",
      });
    } catch (error) {
      console.error(error);
      api?.setToast({ message: "Clipboard was blocked", closable: true });
    }
  }, [api, copyAndArm, loaded]);

  /** how long the button keeps saying "Copied" */
  const COPY_FEEDBACK_MS = 1200;

  /**
   * One delegated listener for every fenced block's copy button. The buttons are
   * part of the injected markdown HTML, so there is no React node to hang a
   * handler on — and the code is read back from the block's own `<pre>`, which is
   * verbatim.
   */
  const onMarkdownClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      const button = (event.target as HTMLElement | null)?.closest?.(
        ".app-doc-copy-code",
      ) as HTMLElement | null;

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const code =
        button.parentElement?.querySelector("pre")?.textContent ?? "";
      const language =
        button.closest<HTMLElement>(".app-doc-codeblock")?.dataset.language ||
        undefined;

      try {
        await navigator.clipboard.writeText(code);
        copyAndArm(code, loaded?.entry.name ?? "Code", language);
        api?.setToast({
          message: language
            ? "Code copied — paste for a highlighted code card"
            : "Code copied — paste for a code card",
        });
      } catch (error) {
        console.error(error);
        api?.setToast({ message: "Clipboard was blocked", closable: true });
        return;
      }

      const label = button.querySelector(".app-doc-copy-code__label");

      button.classList.add("app-doc-copy-code--copied");

      if (label) {
        label.textContent = "Copied";
      }

      setTimeout(() => {
        button.classList.remove("app-doc-copy-code--copied");

        if (label) {
          label.textContent = "Copy code";
        }
      }, COPY_FEEDBACK_MS);
    },
    [api, copyAndArm, loaded],
  );

  const onInsert = useCallback(async () => {
    if (!loaded?.text || !api || busy) {
      return;
    }
    // it is on the canvas now, so a pending paste of the same code is stale
    cancelCodePaste();
    setBusy(true);
    try {
      await insertCodeIntoScene(api, loaded.text, {
        fileName: loaded.entry.name,
        language: loaded.entry.language,
      });
    } catch (error) {
      api?.setToast({ message: "Could not insert", closable: true });
      console.error(error);
    } finally {
      setBusy(false);
    }
  }, [api, busy, loaded]);

  return (
    <div className="app-sidebar-panel">
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept={DOCUMENT_ACCEPT}
        hidden
        onChange={onPick}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        onChange={onPick}
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
          Open documents
        </button>
        <button
          type="button"
          className="app-sidebar-secondary"
          onClick={() => folderInputRef.current?.click()}
        >
          Open folder
        </button>
      </div>

      {docs.length === 0 ? (
        <p className="app-sidebar-empty">
          Load PDFs, markdown or source files. PDFs and markdown fill the panel
          and scroll inside it — markdown is rendered as a document, with a zoom
          control, rather than highlighted as source. Copying and inserting
          always use the raw file text.
        </p>
      ) : viewed ? (
        <div className="app-doc-viewer">
          {/* read-back: goes to the list we came from, without re-scanning */}
          <div className="app-doc-nav">
            <button
              type="button"
              className="app-doc-back"
              onClick={() => setReading(false)}
              title="Back to the file list"
            >
              <span className="app-doc-back__arrow" aria-hidden="true">
                ←
              </span>
              <span>Files</span>
              <span className="app-doc-back__count">{docs.length}</span>
            </button>

            <div className="app-doc-step">
              <button
                type="button"
                className="app-doc-step__btn"
                onClick={() => step(-1)}
                disabled={docs.length < 2}
                aria-label="Previous document"
              >
                ‹
              </button>
              <span className="app-doc-step__pos">
                {index + 1} / {docs.length}
              </span>
              <button
                type="button"
                className="app-doc-step__btn"
                onClick={() => step(1)}
                disabled={docs.length < 2}
                aria-label="Next document"
              >
                ›
              </button>
            </div>
          </div>

          <div className="app-doc-title" title={viewed.path}>
            <span className={`app-doc-badge app-doc-badge--${viewed.kind}`}>
              {badgeLabel(viewed.kind)}
            </span>
            <span className="app-doc-title__name">{viewed.name}</span>
          </div>

          {viewed.kind === "pdf" ? (
            pdfUrl ? (
              <object
                className="app-doc-pdf"
                data={pdfUrl}
                type="application/pdf"
                aria-label={`${viewed.name} preview`}
              >
                <div className="app-doc-fallback">
                  <p>Inline PDF preview is unavailable in this browser.</p>
                  <a href={pdfUrl} target="_blank" rel="noreferrer">
                    Open {viewed.name}
                  </a>
                </div>
              </object>
            ) : (
              <div className="app-doc-fallback">Loading…</div>
            )
          ) : loaded?.text != null ? (
            <>
              {isMarkdown && (
                <div className="app-doc-zoom">
                  <button
                    type="button"
                    className="app-doc-step__btn"
                    onClick={() => changeZoom(-ZOOM_STEP)}
                    disabled={zoom <= ZOOM_MIN}
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="app-doc-zoom__level"
                    onClick={() => setZoom(1)}
                    title="Reset zoom"
                    aria-label="Reset zoom"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="app-doc-step__btn"
                    onClick={() => changeZoom(ZOOM_STEP)}
                    disabled={zoom >= ZOOM_MAX}
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                </div>
              )}

              {html ? (
                <div
                  ref={bodyRef}
                  className={isMarkdown ? "app-doc-markdown" : "app-doc-code"}
                  // the markdown viewer is scaled, not reflowed, so long lines
                  // stay one line and the panel keeps its own scrollbars
                  style={
                    isMarkdown
                      ? { fontSize: `${Math.round(zoom * 100)}%` }
                      : undefined
                  }
                  // the renderer escapes raw HTML and untrusted URLs first
                  onClick={onMarkdownClick}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <pre className="app-doc-code app-doc-code--loading">
                  {loaded.text}
                </pre>
              )}
              {loaded.truncated && (
                <div className="app-doc-note">
                  Large file — only the first 400&nbsp;KB are shown.
                </div>
              )}
              <div className="app-sidebar-actions">
                <button
                  type="button"
                  className="app-sidebar-primary"
                  disabled={busy}
                  onClick={onInsert}
                >
                  {busy ? "Inserting…" : "Insert as a code card"}
                </button>
                <button
                  type="button"
                  className="app-sidebar-secondary"
                  onClick={onCopy}
                >
                  Copy code
                </button>
              </div>
            </>
          ) : (
            <div className="app-doc-fallback">Loading…</div>
          )}
        </div>
      ) : (
        <div className="app-doc-list" role="listbox" aria-label="Documents">
          {docs.map((doc, docIndex) => (
            <button
              key={`${doc.path}-${docIndex}`}
              type="button"
              role="option"
              aria-selected={docIndex === index}
              className={
                docIndex === index
                  ? "app-doc-list__item app-doc-list__item--active"
                  : "app-doc-list__item"
              }
              // clicking a row opens that document; it does not just arm it
              onClick={() => {
                setIndex(docIndex);
                setReading(true);
              }}
              title={doc.path}
            >
              <span className={`app-doc-badge app-doc-badge--${doc.kind}`}>
                {badgeLabel(doc.kind)}
              </span>
              <span className="app-doc-list__name">{doc.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
