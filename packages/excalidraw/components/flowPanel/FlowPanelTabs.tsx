import React, { useId } from "react";

export const FLOW_PANEL_TABS = [
  "Look",
  "Animation",
  "Script",
  "Present in class",
  "Save as preset",
  "Camera",
  "Export",
] as const;
export type FlowPanelTab = typeof FLOW_PANEL_TABS[number];
export const FLOW_PANEL_TAB_KEY = "excalidraw-flow-panel-tab";

export const readFlowPanelTab = (): FlowPanelTab => {
  try {
    const saved = localStorage.getItem(FLOW_PANEL_TAB_KEY);
    return FLOW_PANEL_TABS.find((tab) => tab === saved) ?? "Animation";
  } catch {
    return "Animation";
  }
};

export const writeFlowPanelTab = (tab: FlowPanelTab) => {
  try {
    localStorage.setItem(FLOW_PANEL_TAB_KEY, tab);
  } catch {
    /* Storage is optional; the session still keeps the choice. */
  }
};

export const FlowPanelTabs = ({
  value,
  onChange,
  tabs = FLOW_PANEL_TABS,
  label = "Chart options",
}: {
  value: string;
  onChange: (value: FlowPanelTab) => void;
  tabs?: readonly string[];
  label?: string;
}) => {
  const id = useId();
  return (
    <div className="flow-panel-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          type="button"
          role="tab"
          key={tab}
          id={`${id}-${index}`}
          aria-selected={value === tab}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab as FlowPanelTab)}
          onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight") {
              next = (index + 1) % tabs.length;
            } else if (event.key === "ArrowLeft") {
              next = (index + tabs.length - 1) % tabs.length;
            } else if (event.key === "Home") {
              next = 0;
            } else if (event.key === "End") {
              next = tabs.length - 1;
            } else {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onChange(tabs[next] as FlowPanelTab);
            document.getElementById(`${id}-${next}`)?.focus();
          }}
        >
          {tab}
        </button>
      ))}
    </div>
  );
};
