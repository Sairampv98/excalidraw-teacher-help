import React from "react";

/**
 * The icons of a code panel's bars (D-274, D-331): drawn as paths so they are
 * crisp at any size, and named so a bar can be read at a glance.
 *
 * They are shared by the code editor's bars and by the VS Code mirror's header,
 * so the two panels look like one family.
 */
const PANEL_ICON_PATHS: Record<string, React.ReactNode> = {
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  clear: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  dockBottom: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 14h18" />
    </>
  ),
  dockRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M14 4v16" />
    </>
  ),
  // the mirror's tools (D-332)
  camera: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <circle cx="12" cy="13.5" r="3.5" />
      <path d="M8 7l1.5-3h5L16 7" />
    </>
  ),
  readText: (
    <path d="M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M8 9h8M8 12h8M8 15h5" />
  ),
  pointer: <path d="M5 3l6 17 2.5-7.5L21 10z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  hide: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <path d="M4 4l16 16" />
    </>
  ),
  show: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17.2v.01" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0z" />
      <path d="M12 17v4" />
    </>
  ),
};

export const PanelIcon = ({
  name,
  size,
}: {
  name: string;
  size: number | string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {PANEL_ICON_PATHS[name]}
  </svg>
);
