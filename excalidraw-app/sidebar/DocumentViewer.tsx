import { useCallback, useEffect, useRef, useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { codeToHtml } from "shiki";

import { appJotaiStore, pdfPageReadRequestAtom } from "../app-jotai";

import {
  armInsert,
  cancelCodePaste,
  insertCodeIntoScene,
} from "./insertIntoScene";

import {
  PdfViewer,
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  clampPdfZoom,
} from "./PdfViewer";
import { SelectionBar } from "./SelectionBar";
import {
  escapeHtml,
  findHeading,
  kindLabel,
  renderMarkdown,
  resolveDocumentLink,
} from "./sidebarFiles";

import "./sidebar.scss";

import type { PdfRegion } from "./PdfViewer";

import type { ScannedFile } from "./sidebarFiles";

/** the width of the choices under a selected text, to keep them in the document */
const SELECTION_BAR_WIDTH = 140;

/** highlighting a megabyte of source in the main thread is not worth it */
const MAX_HIGHLIGHT_BYTES = 400 * 1024;

/** the markdown viewer's zoom, in steps of 10% */
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

/** how long the copy button keeps saying "Copied" */
const COPY_FEEDBACK_MS = 1200;

const clampZoom = (value: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));

type LoadedDoc = {
  entry: ScannedFile;
  /** only set for text-ish documents */
  text?: string;
  /** true when the file was larger than we were willing to highlight */
  truncated?: boolean;
};

type DocumentViewerProps = {
  /** the document being read */
  entry: ScannedFile;
  /** the readable documents of the listing we came from, for the stepper */
  documents: ScannedFile[];
  /** where `entry` sits in `documents` */
  index: number;
  /** move to the next or previous document of the listing */
  onStep: (delta: number) => void;
  /** back to the listing, without re-scanning it */
  onBack: () => void;
  /** the file could not be read — the picker names it with the reason */
  onUnreadable?: (entry: ScannedFile) => void;
  /** the files a link of a markdown document may open (D-308) */
  linkTargets?: readonly ScannedFile[];
  /** a link opened this file: the viewer reads it, and goes to its heading */
  onOpenDocument?: (file: ScannedFile, anchor: string | null) => void;
  /** the heading to go to once the document is shown */
  anchor?: string | null;
};

/**
 * The reader.
 *
 * It reads one document — a PDF, a markdown file, a source file — out of the
 * sidebar's one list. It never picks anything itself: the list belongs to the
 * picker, and the picker is what knows about folders.
 */
export const DocumentViewer = ({
  entry,
  documents,
  index,
  onStep,
  onBack,
  onUnreadable,
  linkTargets,
  onOpenDocument,
  anchor,
}: DocumentViewerProps) => {
  const api = useExcalidrawAPI();
  /** the rendered document body — a selection has to lie inside it */
  const bodyRef = useRef<HTMLDivElement>(null);

  const [loaded, setLoaded] = useState<LoadedDoc | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** the file could not be read */
  const [failed, setFailed] = useState(false);
  /** scales the rendered document; the PDF viewer zooms with its own toolbar */
  const [zoom, setZoom] = useState(1);
  /** the text the teacher has just selected in the document, if any */
  const [picked, setPicked] = useState<string | null>(null);
  /** where the choices for it float, from the corner of the document (D-317) */
  const [pickedAt, setPickedAt] = useState<{
    left: number;
    top: number;
  } | null>(null);
  /** the place in the zoom row where the PDF's toolbar is drawn (D-313) */
  const [toolbarHost, setToolbarHost] = useState<HTMLElement | null>(null);

  const isMarkdown = entry.kind === "markdown";

  // a new document starts at fit-to-panel, like the PDF viewer does
  useEffect(() => {
    setZoom(1);
    setPicked(null);
  }, [entry]);

  const isPdf = entry.kind === "pdf";
  const zoomMin = isPdf ? PDF_ZOOM_MIN : ZOOM_MIN;
  const zoomMax = isPdf ? PDF_ZOOM_MAX : ZOOM_MAX;

  const changeZoom = useCallback(
    (delta: number) => {
      setZoom((prev) =>
        isPdf
          ? clampPdfZoom(Math.round((prev + delta) * 100) / 100)
          : clampZoom(Math.round((prev + delta) * 10) / 10),
      );
    },
    [isPdf],
  );

  // An armed code paste must not outlive the document, or a later paste
  // anywhere in the app would insert a code card nobody asked for. It is also
  // dropped when the reader moves to another document, since it belongs to the
  // old one.
  //
  // The cancel is deliberately NOT run on unmount. Clicking the canvas closes
  // the sidebar, which unmounts this viewer — and the owner's own sequence is
  // "Copy code", click the canvas, paste. A stale arm is harmless anyway: the
  // clipboard guard refuses one whose text is no longer the stashed code.
  useEffect(() => {
    cancelCodePaste();
  }, [entry]);

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

    // a PDF is selected with a box, not with the browser's selection (D-314)
    if (!body || entry.kind === "pdf") {
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

      // the choices float under the end of the selection, inside the document:
      // they scroll with the text and move nothing (D-317)
      const end = range.getBoundingClientRect?.();
      const area = body.getBoundingClientRect();

      setPickedAt({
        left: Math.min(
          Math.max(0, (end?.left ?? area.left) - area.left + body.scrollLeft),
          Math.max(0, body.clientWidth - SELECTION_BAR_WIDTH) + body.scrollLeft,
        ),
        top: (end?.bottom ?? area.top) - area.top + body.scrollTop + 6,
      });

      // the bar is offered whether or not the copy went through
      setPicked(text);
    };

    const onSelectionEnd = (event: Event) => {
      // pressing one of the bar's own buttons is not a new selection: the bar
      // would come back after it was closed (D-306)
      if ((event.target as Element | null)?.closest?.(".app-doc-selection")) {
        return;
      }

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
  }, [api, html, entry.kind]);

  // read + highlight the document being read
  useEffect(() => {
    let cancelled = false;

    setLoaded(null);
    setHtml(null);
    setFailed(false);

    if (entry.kind === "pdf") {
      setLoaded({ entry });
      return;
    }

    setBusy(true);

    (async () => {
      try {
        const truncated = entry.file.size > MAX_HIGHLIGHT_BYTES;
        const raw = truncated
          ? await entry.file.slice(0, MAX_HIGHLIGHT_BYTES).text()
          : await entry.file.text();

        if (cancelled) {
          return;
        }
        // the raw source is what gets copied and inserted; `html` is only ever
        // the preview
        setLoaded({ entry, text: raw, truncated });

        try {
          const rendered =
            entry.kind === "markdown"
              ? await renderMarkdown(raw)
              : await codeToHtml(raw, {
                  lang: entry.language || "text",
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
          setFailed(true);
          // the picker lists the file with the reason, rather than leaving it
          // looking like a file that works
          onUnreadable?.(entry);
          api?.setToast({
            message: `Could not read ${entry.name}`,
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
  }, [api, entry, onUnreadable]);

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
        armInsert(api, { kind: "code", code, fileName, language });
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

  /** goes to the heading a link means; with none, to the top (D-308) */
  const scrollToAnchor = useCallback((target: string) => {
    const body = bodyRef.current;

    if (!body) {
      return;
    }

    const heading = target ? findHeading(body, target) : null;

    if (heading) {
      heading.scrollIntoView?.({ block: "start" });
    } else if (!target) {
      body.scrollTo?.({ top: 0 });
    }
  }, []);

  // a document opened by a link to one of its headings goes there once it shows
  useEffect(() => {
    if (anchor && html) {
      scrollToAnchor(anchor);
    }
  }, [anchor, html, scrollToAnchor]);

  /**
   * A link of the document goes where it points (D-308): a file of the opened
   * folder opens here, a heading is scrolled to, and an address elsewhere is
   * left to the browser, which opens it in a new tab.
   */
  const onLinkClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, link: HTMLElement) => {
      const resolved = resolveDocumentLink({
        href: link.getAttribute("href") ?? "",
        from: entry.path,
        files: linkTargets ?? [],
        origin: window.location.origin,
      });

      if (resolved.type === "external") {
        return;
      }

      // none of these may load this app in a tab of its own
      event.preventDefault();

      if (resolved.type === "anchor") {
        scrollToAnchor(resolved.anchor);
      } else if (resolved.type === "document") {
        if (resolved.file.path === entry.path) {
          scrollToAnchor(resolved.anchor ?? "");
        } else {
          onOpenDocument?.(resolved.file, resolved.anchor);
        }
      } else {
        api?.setToast({
          message: `"${resolved.target}" is not among the opened files`,
          closable: true,
        });
      }
    },
    [api, entry.path, linkTargets, onOpenDocument, scrollToAnchor],
  );

  /**
   * One delegated listener for every fenced block's copy button. The buttons are
   * part of the injected markdown HTML, so there is no React node to hang a
   * handler on — and the code is read back from the block's own `<pre>`, which is
   * verbatim. The links of the document are read the same way.
   */
  const onMarkdownClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest?.("a[href]") as HTMLElement | null;

      if (link && isMarkdown) {
        onLinkClick(event, link);
        return;
      }

      const button = target?.closest?.(
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
    [api, copyAndArm, isMarkdown, loaded, onLinkClick],
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

  /**
   * The box of a PDF covers text: it is copied, as a selection is (D-314). A
   * box with no text - a figure - leaves the clipboard as it was.
   */
  const copyRegion = useCallback(
    async (region: PdfRegion) => {
      if (!region.text.trim()) {
        return;
      }

      try {
        await navigator.clipboard.writeText(region.text);
      } catch (error) {
        console.error(error);
        api?.setToast({ message: "Clipboard was blocked", closable: true });
      }
    },
    [api],
  );

  const zoomBar = (
    <div className="app-doc-zoom">
      <button
        type="button"
        className="app-doc-step__btn"
        onClick={() => changeZoom(-ZOOM_STEP)}
        disabled={zoom <= zoomMin}
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
        disabled={zoom >= zoomMax}
        aria-label="Zoom in"
      >
        +
      </button>
      {/* the PDF's tools are drawn here by its viewer, where they never scroll
      away (D-313) */}
      {isPdf ? (
        <span
          ref={setToolbarHost}
          className="app-doc-pdf-toolhost"
          data-testid="pdf-toolhost"
        />
      ) : null}
    </div>
  );

  return (
    <div className="app-doc-viewer">
      {/* read-back: goes to the list we came from, without re-scanning */}
      <div className="app-doc-nav">
        <button
          type="button"
          className="app-doc-back"
          onClick={() => {
            // leaving the document for the list is a change of mind: the
            // armed paste for it is dropped. The unmount does not do it —
            // closing the sidebar unmounts this viewer too, and the paste
            // has to survive that.
            cancelCodePaste();
            onBack();
          }}
          title="Back to the file list"
        >
          <span className="app-doc-back__arrow" aria-hidden="true">
            ←
          </span>
          <span>Files</span>
          <span className="app-doc-back__count">{documents.length}</span>
        </button>

        <div className="app-doc-step">
          <button
            type="button"
            className="app-doc-step__btn"
            onClick={() => onStep(-1)}
            disabled={documents.length < 2}
            aria-label="Previous document"
          >
            ‹
          </button>
          <span className="app-doc-step__pos">
            {index + 1} / {documents.length}
          </span>
          <button
            type="button"
            className="app-doc-step__btn"
            onClick={() => onStep(1)}
            disabled={documents.length < 2}
            aria-label="Next document"
          >
            ›
          </button>
        </div>
      </div>

      <div className="app-doc-title" title={entry.path}>
        <span className={`app-doc-badge app-doc-badge--${entry.kind}`}>
          {kindLabel(entry.kind)}
        </span>
        <span className="app-doc-title__name">{entry.name}</span>
      </div>

      {entry.kind === "pdf" ? (
        <>
          {zoomBar}
          <PdfViewer
            file={entry.file}
            zoom={zoom}
            onZoomChange={setZoom}
            containerRef={bodyRef}
            toolbarHost={toolbarHost}
            onReadPage={(picture) =>
              appJotaiStore.set(pdfPageReadRequestAtom, picture)
            }
            onRegion={copyRegion}
            // the choices are under the box that was drawn (D-314)
            renderRegionBar={(region, close) => (
              <SelectionBar
                api={api}
                text={region.text}
                lines={region.lines}
                picture={region.picture}
                onDone={close}
              />
            )}
          />
        </>
      ) : loaded?.text != null ? (
        <>
          {isMarkdown && zoomBar}

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
              onClick={onMarkdownClick}
            >
              {/* the renderer escapes raw HTML and untrusted URLs first */}
              <div dangerouslySetInnerHTML={{ __html: html }} />
              {picked && pickedAt && (
                <div
                  className="app-doc-selection-float"
                  data-testid="selection-float"
                  style={{ left: pickedAt.left, top: pickedAt.top }}
                >
                  <SelectionBar
                    api={api}
                    text={picked}
                    onDone={() => setPicked(null)}
                  />
                </div>
              )}
            </div>
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
      ) : failed ? (
        <div className="app-doc-fallback">Could not read {entry.name}.</div>
      ) : (
        <div className="app-doc-fallback">Loading…</div>
      )}
    </div>
  );
};
