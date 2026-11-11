/**
 * The page's side of the editor setup (D-518, D-364): what the teacher ticks in
 * the dialog, and the three ways the setup is started from it - the link
 * `excalidraw-setup://install?...`, a downloadable `.cmd`, and a PowerShell
 * command to copy.
 *
 * The scripts that read these are `installer/editor-setup/*.ps1`, and they read
 * a link against a CLOSED list (editor, profile, language groups, extension
 * address, folder). Everything made here is made from that list and from the
 * page's own address, and is checked against the same rules - so a name or an
 * address that the engine would refuse is refused here first, with the reason.
 */

/** the editor the setup uses */
export type SetupEditor = "auto" | "code" | "codium";

/** a group of language extensions the engine knows */
export type SetupGroup = "python" | "cpp" | "java" | "js";

export interface EditorSetupChoice {
  editor: SetupEditor;
  profile: string;
  groups: SetupGroup[];
}

export const EDITOR_CHOICES: readonly {
  id: SetupEditor;
  label: string;
  hint: string;
}[] = [
  {
    id: "auto",
    label: "The one that is installed",
    hint: "VS Code first, then VSCodium.",
  },
  {
    id: "code",
    label: "Visual Studio Code",
    hint: "From Microsoft.",
  },
  {
    id: "codium",
    label: "VSCodium",
    hint: "The open build of VS Code.",
  },
];

export const LANGUAGE_GROUPS: readonly { id: SetupGroup; label: string }[] = [
  { id: "python", label: "Python" },
  { id: "cpp", label: "C and C++" },
  { id: "java", label: "Java" },
  { id: "js", label: "JavaScript and TypeScript (built into the editor)" },
];

export const DEFAULT_SETUP_CHOICE: EditorSetupChoice = {
  editor: "auto",
  profile: "excalidraw",
  groups: ["python", "cpp", "java", "js"],
};

/** the profile name the engine accepts: letters, digits, a space, - and _ */
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

export const isValidProfileName = (name: string): boolean =>
  PROFILE_NAME.test(name);

/** the address the scripts are fetched from: https anywhere, or http on this computer */
const SITE_BASE =
  /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/;

/** where the scripts are served from the page's own site, and the extension's name */
export const SETUP_PATH = "/setup";
export const SETUP_VSIX_NAME = "excalidraw-bridge.vsix";

export type SetupBase =
  | { ok: true; origin: string; base: string; vsix: string }
  | { ok: false; reason: string };

/**
 * The page's own address as the setup wants it, or why it cannot be used.
 *
 * The engine downloads the extension over https, or over http from this
 * computer, and from nowhere else. A page on another computer over plain http
 * (a school network address) is refused with what to do about it.
 */
export const setupBase = (origin: string): SetupBase => {
  if (!SITE_BASE.test(origin)) {
    return {
      ok: false,
      reason: origin.startsWith("http://")
        ? "This page is open over plain http from another computer, so the setup will not download anything from it. Open the board from this computer (http://localhost) or over https, then try again."
        : "This page's address is not one the setup can download from. Open the board from its https address or from this computer (http://localhost), then try again.",
    };
  }

  return {
    ok: true,
    origin,
    base: `${origin}${SETUP_PATH}`,
    vsix: `${origin}${SETUP_PATH}/${SETUP_VSIX_NAME}`,
  };
};

export type SetupChoiceProblem = string | null;

/** why the choice cannot be turned into a setup, or null when it can */
export const choiceProblem = (
  choice: EditorSetupChoice,
): SetupChoiceProblem => {
  if (!isValidProfileName(choice.profile)) {
    return "The profile name may have letters, digits, spaces, - and _ only, and must start with a letter or a digit (40 characters at most).";
  }

  if (choice.groups.length === 0) {
    return "Tick at least one language. JavaScript and TypeScript are built into the editor and cost nothing.";
  }

  return null;
};

/** the groups in the order the engine lists them, each once */
const orderedGroups = (groups: readonly SetupGroup[]): SetupGroup[] =>
  LANGUAGE_GROUPS.map((group) => group.id).filter((id) => groups.includes(id));

/**
 * The link the browser opens: `excalidraw-setup://install?...`.
 *
 * It carries only what the engine's closed list allows and no secret. The
 * extension's address is the page's own, so the extension comes from where the
 * page came from.
 */
export const buildSetupLink = (
  choice: EditorSetupChoice,
  base: Extract<SetupBase, { ok: true }>,
): string => {
  const query = [
    `editor=${choice.editor}`,
    `profile=${encodeURIComponent(choice.profile)}`,
    `groups=${orderedGroups(choice.groups).join(",")}`,
    `vsix=${encodeURIComponent(base.vsix)}`,
  ];

  return `excalidraw-setup://install?${query.join("&")}`;
};

/**
 * The PowerShell command to copy.
 *
 * It fetches `Bootstrap.ps1` from the page's own site, which puts the other
 * scripts in `%LOCALAPPDATA%\ExcalidrawSetup`, registers the link for this user
 * and opens the plan. Nothing is installed until the teacher presses Set up in
 * that window. `WebClient` and not `Invoke-RestMethod`, so that it runs on the
 * oldest PowerShell the setup supports.
 */
export const buildPowerShellCommand = (
  choice: EditorSetupChoice,
  base: Extract<SetupBase, { ok: true }>,
): string => {
  const link = buildSetupLink(choice, base);

  return (
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "' +
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " +
    `& ([scriptblock]::Create((New-Object Net.WebClient).DownloadString('${base.base}/Bootstrap.ps1'))) ` +
    `-Base '${base.base}' -Link '${link}'` +
    '"'
  );
};

/** the file name of the downloadable installer */
export const SETUP_CMD_NAME = "ExcalidrawSetup.cmd";

/**
 * The downloadable `.cmd`: the same command, in a file that opens with a
 * double click. A `%` in a batch file is the start of a variable, so each one
 * is doubled; the lines end in CRLF.
 */
export const buildCmdFile = (
  choice: EditorSetupChoice,
  base: Extract<SetupBase, { ok: true }>,
): string => {
  const command = buildPowerShellCommand(choice, base).replace(/%/g, "%%");

  return [
    "@echo off",
    "rem Sets up the editor for the whiteboard (Excalidraw classroom).",
    `rem It fetches the setup from ${base.origin} and opens its plan.`,
    "rem Nothing is installed until you press Set up in the window that opens.",
    command,
    "if errorlevel 1 (",
    "  echo.",
    "  echo The setup could not be started. Check the connection and double-click this file again.",
    ")",
    "pause",
    "",
  ].join("\r\n");
};

/** the three things the dialog hands over, or why it cannot */
export type SetupOffer =
  | { ok: false; reason: string }
  | {
      ok: true;
      link: string;
      command: string;
      cmd: string;
    };

export const buildSetupOffer = (
  choice: EditorSetupChoice,
  origin: string,
): SetupOffer => {
  const base = setupBase(origin);

  if (!base.ok) {
    return base;
  }

  const problem = choiceProblem(choice);

  if (problem) {
    return { ok: false, reason: problem };
  }

  return {
    ok: true,
    link: buildSetupLink(choice, base),
    command: buildPowerShellCommand(choice, base),
    cmd: buildCmdFile(choice, base),
  };
};
