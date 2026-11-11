import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { FlowPanelTabs } from "./FlowPanelTabs";

import "./flowPanel.scss";

export type FlowWindowTab<T> = {
  id: string;
  label: string;
  render: (
    draft: T,
    update: React.Dispatch<React.SetStateAction<T>>,
  ) => React.ReactNode;
};

/** D-537: shared draft lifetime, focus and preview placement. */
export const FlowExpandedWindow = <T,>({
  title,
  initial,
  tabs,
  preview,
  onApply,
  onClose,
}: {
  title: string;
  initial: T;
  tabs: readonly FlowWindowTab<T>[];
  preview: (draft: T) => React.ReactNode;
  onApply: (draft: T) => void;
  onClose: () => void;
}) => {
  const [draft, setDraft] = useState<T>(() => structuredClone(initial));
  const [selected, setSelected] = useState(tabs[0]?.label);
  const root = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[role="tab"]')?.focus();
    return () => {
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, [opener]);
  const tab = tabs.find((item) => item.label === selected) ?? tabs[0];
  return createPortal(
    <div
      className="flow-expanded-backdrop"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        ref={root}
        className="flow-expanded-window"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const focusable = [
              ...(root.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
              ) ?? []),
            ].filter((node) => node.tabIndex >= 0);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            }
            if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2>{title}</h2>
        <div className="flow-expanded-header">
          <FlowPanelTabs
            tabs={tabs.map((item) => item.label)}
            value={tab?.label ?? ""}
            onChange={setSelected}
            label="Expanded options"
          />
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flow-expanded-body">
          <section role="tabpanel" aria-label={tab?.label}>
            {tab?.render(draft, setDraft)}
          </section>
          <aside aria-label="Preview">{preview(draft)}</aside>
        </div>
        <footer>
          <p>Preview only until you apply. Close discards these changes.</p>
          <button type="button" onClick={() => onApply(draft)}>
            Apply
          </button>
        </footer>
      </div>
    </div>,
    opener?.closest(".excalidraw") ?? document.body,
  );
};
