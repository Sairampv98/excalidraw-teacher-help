import { useCallback, useEffect, useMemo, useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";

import { STORAGE_KEYS } from "../app_constants";
import { sceneAtClientPoint } from "../sidebar/insertIntoScene";
import { nodeDrop } from "../sidebar/nodeDropHook";

import { stickerUrl } from "./assets";
import { STICKERS } from "./catalog";
import { STICKER_DRAG_TYPE, insertSticker, stickerFile } from "./insertSticker";
import { searchStickers } from "./search";

import "./StickerBar.scss";

import type { Sticker, StickerKind } from "./catalog";

const TABS: readonly { kind: StickerKind; label: string }[] = [
  { kind: "emoji", label: "Emoji" },
  { kind: "gif", label: "GIF" },
];

const readHidden = () => {
  try {
    return (
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_STICKER_BAR_HIDDEN) ===
      "1"
    );
  } catch {
    // private mode / storage disabled - stay expanded
    return false;
  }
};

/** a drag that carries one of our stickers */
const carriesSticker = (event: DragEvent) =>
  !!event.dataTransfer &&
  Array.from(event.dataTransfer.types).includes(STICKER_DRAG_TYPE);

const isInside = (event: Event, selector: string) =>
  event.target instanceof Element && !!event.target.closest(selector);

const SmileIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
    <path d="M9 9.5h.01M15 9.5h.01" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * The emoji and GIF bar (D-159).
 *
 * An island above the page bar, in the same visual language. Two tabs, one
 * search box that searches the open tab, and a scrolling row of stickers. A
 * sticker lands on the canvas by a click (the middle of what is visible) or by
 * a drag (its centre at the pointer) - D-160.
 *
 * Every sticker is a file in the repo (D-157), so the bar works offline.
 */
const StickerBar = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [kind, setKind] = useState<StickerKind>("emoji");
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState(readHidden);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(
    () => searchStickers(STICKERS, query, kind),
    [query, kind],
  );

  const place = useCallback(
    async (sticker: Sticker, at?: { x: number; y: number }) => {
      if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
        return;
      }

      setError(null);
      try {
        await insertSticker(excalidrawAPI, sticker, at);
      } catch (err) {
        console.error("stickers: insert failed", err);
        setError(err instanceof Error ? err.message : "Could not insert it");
      }
    },
    [excalidrawAPI],
  );

  // the canvas accepts a dragged sticker, and the library's own drop handling
  // never sees it: it would not know what to do with it
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }

    const onDragOver = (event: DragEvent) => {
      if (carriesSticker(event) && isInside(event, ".excalidraw")) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!carriesSticker(event) || !isInside(event, ".excalidraw")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      // dropping it back on the bar is not an insert
      if (isInside(event, ".excalidraw-sticker-bar")) {
        return;
      }

      const id = event.dataTransfer?.getData(STICKER_DRAG_TYPE);
      const sticker = STICKERS.find((s) => s.id === id);
      const at = sceneAtClientPoint(
        excalidrawAPI,
        event.clientX,
        event.clientY,
      );

      if (sticker && at) {
        // dropped on a node of a chart: the sticker goes into the node (D-246)
        const onNode = nodeDrop();

        if (onNode?.claims(at)) {
          stickerFile(sticker)
            .then((file) => onNode.add(file, at))
            .catch((err) => {
              console.error("stickers: node insert failed", err);
              setError(
                err instanceof Error ? err.message : "Could not insert it",
              );
            });

          return;
        }

        void place(sticker, at);
      }
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);

    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, [excalidrawAPI, place]);

  const toggleHidden = useCallback(() => {
    setHidden((current) => {
      const next = !current;
      try {
        localStorage.setItem(
          STORAGE_KEYS.LOCAL_STORAGE_STICKER_BAR_HIDDEN,
          next ? "1" : "0",
        );
      } catch {
        // non-fatal: the bar just will not remember its state across reloads
      }
      return next;
    });
  }, []);

  if (!excalidrawAPI) {
    return null;
  }

  if (hidden) {
    return (
      <div className="excalidraw-sticker-bar-hidden">
        <button
          type="button"
          className="excalidraw-sticker-bar-hidden__handle"
          onClick={toggleHidden}
          title="Show the emoji and GIF bar"
          aria-label="Show the emoji and GIF bar"
        >
          <SmileIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="excalidraw-sticker-bar">
      <button
        type="button"
        className="excalidraw-sticker-bar__icon"
        onClick={toggleHidden}
        title="Hide the emoji and GIF bar"
        aria-label="Hide the emoji and GIF bar"
      >
        <ChevronDownIcon />
      </button>

      <div
        className="excalidraw-sticker-bar__tabs"
        role="tablist"
        aria-label="Sticker kind"
      >
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            className="excalidraw-sticker-bar__tab"
            aria-selected={kind === tab.kind}
            onClick={() => setKind(tab.kind)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <input
        type="search"
        className="excalidraw-sticker-bar__search"
        aria-label="Search stickers"
        placeholder={kind === "gif" ? "Search GIFs" : "Search emoji"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // the canvas has single-key shortcuts; typing must not trigger them
        onKeyDown={(event) => event.stopPropagation()}
      />

      <div
        className="excalidraw-sticker-bar__row"
        role="list"
        aria-label={kind === "gif" ? "GIFs" : "Emoji"}
      >
        {shown.length === 0 ? (
          <span className="excalidraw-sticker-bar__empty" role="status">
            Nothing matches “{query.trim()}”
          </span>
        ) : (
          shown.map((sticker) => (
            <button
              key={sticker.id}
              type="button"
              role="listitem"
              className="excalidraw-sticker-bar__item"
              // the hover label is CSS from `data-label`, not a `title`: a title
              // is findable by every `queryByTitle` in the app's tests, and
              // "Thinking" answered the language test's `/thin/i`
              data-label={sticker.label}
              aria-label={`Insert ${sticker.label}`}
              data-sticker-id={sticker.id}
              data-sticker-kind={sticker.kind}
              onClick={() => void place(sticker)}
              onDragStart={(event) => {
                event.dataTransfer.setData(STICKER_DRAG_TYPE, sticker.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <img src={stickerUrl(sticker)} alt="" loading="lazy" />
            </button>
          ))
        )}
      </div>

      {error && (
        <span className="excalidraw-sticker-bar__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
};

export default StickerBar;
