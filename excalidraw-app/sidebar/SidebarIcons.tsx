/**
 * The icons of the sidebar's buttons (D-310): drawn as paths, so they are crisp
 * at any size and take the colour of the button's text.
 */

const SIDEBAR_ICON_PATHS = {
  openFiles: (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M12 11v6M9 14h6" />
    </>
  ),
  openFolder: (
    <>
      <path d="M5 19l2.757-7.351A1 1 0 0 1 8.693 11H21a1 1 0 0 1 .986 1.164l-.996 5.211A2 2 0 0 1 19.026 19H5z" />
      <path d="M5 19a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l3 3h5a2 2 0 0 1 2 2v2" />
    </>
  ),
  youtube: (
    <>
      <path d="M2 8a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" />
      <path d="M10 9l5 3-5 3z" />
    </>
  ),
  fitWidth: (
    <>
      <path d="M4 5v14M20 5v14" />
      <path d="M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3" />
    </>
  ),
  fitPage: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <rect x="8" y="7" width="8" height="10" rx="1" />
    </>
  ),
  readPage: (
    <>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M8 9h8M8 12h8M8 15h5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  codeCard: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12" />,
  textBox: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 9h8M12 9v7" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
    </>
  ),
  where: (
    <>
      <path d="M5 6h8M5 11h14M5 16h10" />
      <path d="M19 15v6M16 18h6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-8 9" />
    </>
  ),
} as const;

export type SidebarIconName = keyof typeof SIDEBAR_ICON_PATHS;

export const SidebarIcon = ({
  name,
  size = 18,
}: {
  name: SidebarIconName;
  size?: number;
}) => (
  <svg
    className="app-sidebar-icon__svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {SIDEBAR_ICON_PATHS[name]}
  </svg>
);
