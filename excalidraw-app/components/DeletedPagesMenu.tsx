import { useCallback, useEffect, useState } from "react";

import { useExcalidrawAPI } from "@excalidraw/excalidraw";

import {
  PAGE_TRASH_LIMIT,
  forgetDeletedPage,
  listDeletedPages,
  restoreDeletedPage,
  storageUsage,
} from "../pages/pageTrash";

import type { DeletedPage } from "../pages/pageTrash";

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

const ago = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/**
 * The list of deleted pages (D-280): each can be brought back, or forgotten, and
 * the list says how much of the browser's storage the whole site uses.
 *
 * `refreshKey` changes when a page was just kept, so the list is read again.
 */
export const DeletedPagesMenu = ({ refreshKey }: { refreshKey: number }) => {
  const api = useExcalidrawAPI();
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<DeletedPage[]>([]);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    setPages(await listDeletedPages());
    setUsage(await storageUsage());
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const restore = async (entry: DeletedPage) => {
    if (!api) {
      return;
    }

    await restoreDeletedPage(api, entry);
    setOpen(false);
    await load();
  };

  if (!pages.length && !open) {
    return null;
  }

  return (
    <span className="excalidraw-page-bar__deleted" data-testid="deleted-pages">
      <button
        type="button"
        className="excalidraw-page-bar__icon"
        data-testid="deleted-pages-button"
        onClick={() => setOpen((value) => !value)}
        title="Deleted pages"
        aria-label="Deleted pages"
        aria-expanded={open}
      >
        ↺{pages.length ? ` ${pages.length}` : ""}
      </button>
      {open ? (
        <div
          className="excalidraw-page-bar__deleted-list"
          data-testid="deleted-pages-list"
          style={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            minWidth: 280,
            maxHeight: 320,
            overflow: "auto",
            padding: 8,
            borderRadius: 8,
            background: "var(--island-bg-color, #fff)",
            boxShadow: "0 2px 12px rgba(0,0,0,0.25)",
            zIndex: 10,
          }}
        >
          {pages.length ? (
            pages.map((entry) => (
              <div
                key={entry.id}
                data-testid="deleted-page"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "4px 0",
                }}
              >
                <span style={{ flex: 1 }}>
                  {entry.page.name}
                  <small style={{ display: "block", opacity: 0.65 }}>
                    {entry.elements.length} elements · {ago(entry.deletedAt)}
                  </small>
                </span>
                <button
                  type="button"
                  data-testid="deleted-page-restore"
                  onClick={() => void restore(entry)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  data-testid="deleted-page-forget"
                  aria-label="Forget this page"
                  onClick={async () => {
                    await forgetDeletedPage(entry.id);
                    await load();
                  }}
                >
                  ✕
                </button>
              </div>
            ))
          ) : (
            <div>No deleted pages.</div>
          )}
          <small
            data-testid="deleted-pages-storage"
            style={{ display: "block", marginTop: 6, opacity: 0.7 }}
          >
            The last {PAGE_TRASH_LIMIT} are kept.
            {usage
              ? ` Browser storage: ${megabytes(usage.used)} of ${megabytes(
                  usage.quota,
                )} used.`
              : ""}
          </small>
        </div>
      ) : null}
    </span>
  );
};
