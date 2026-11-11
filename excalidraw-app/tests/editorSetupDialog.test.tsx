/**
 * AC-619 - "Set up my editor" (D-518, D-364): the checklist, the link
 * `excalidraw-setup://install?...`, the downloadable `.cmd` and the PowerShell
 * command to copy.
 *
 * The scripts that read the link are `installer/editor-setup/*.ps1`; the
 * engine's own reading of what is made here is tried for real (Windows).
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  render,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import ExcalidrawApp from "../App";
import { appJotaiStore } from "../app-jotai";
import { EditorSetupDialog } from "../setup/EditorSetupDialog";
import {
  DEFAULT_SETUP_CHOICE,
  buildCmdFile,
  buildPowerShellCommand,
  buildSetupLink,
  buildSetupOffer,
  isValidProfileName,
  setupBase,
} from "../setup/editorSetup";
import {
  closeEditorSetup,
  editorSetupOpenAtom,
  openEditorSetup,
} from "../setup/editorSetupState";

const LOCAL = "http://127.0.0.1:3061";

const base = () => {
  const made = setupBase(LOCAL);

  if (!made.ok) {
    throw new Error("the local address must be usable");
  }

  return made;
};

const findRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    if (
      existsSync(join(current, "installer", "editor-setup", "EditorSetup.ps1"))
    ) {
      return current;
    }

    current = dirname(current);
  }

  throw new Error("the repository root was not found");
};

const query = (selector: string) => document.querySelector(selector);

describe("AC-619 what the page hands over", () => {
  it("AC-619 the link carries the editor, the profile, the languages and the page's own extension address, and nothing else", () => {
    const link = buildSetupLink(
      { editor: "codium", profile: "my class", groups: ["java", "python"] },
      base(),
    );

    expect(link).toBe(
      "excalidraw-setup://install?editor=codium&profile=my%20class&groups=python,java&vsix=http%3A%2F%2F127.0.0.1%3A3061%2Fsetup%2Fexcalidraw-bridge.vsix",
    );

    // the keys are the engine's closed list, and no secret rides along
    const keys = [...link.split("?")[1].matchAll(/(?:^|&)([a-z]+)=/g)].map(
      (match) => match[1],
    );

    expect(keys).toEqual(["editor", "profile", "groups", "vsix"]);
    expect(link).not.toMatch(/token|secret|password|key=/i);
  });

  it("AC-619 the PowerShell command fetches the bootstrap from the page's own site and opens the link", () => {
    const command = buildPowerShellCommand(DEFAULT_SETUP_CHOICE, base());

    expect(
      command.startsWith("powershell -NoProfile -ExecutionPolicy Bypass"),
    ).toBe(true);
    expect(command).toContain(`'${LOCAL}/setup/Bootstrap.ps1'`);
    expect(command).toContain(`-Base '${LOCAL}/setup'`);
    expect(command).toContain(
      `-Link '${buildSetupLink(DEFAULT_SETUP_CHOICE, base())}'`,
    );

    // nothing from the network is run in another way than the bootstrap, and
    // it runs for this user: no administrator
    expect(command).not.toMatch(/RunAs|Start-Process|iex\b/i);
    // one command line: it can be pasted as it is
    expect(command).not.toContain("\n");
  });

  it("AC-619 the .cmd is the same command in a file: lines end in CRLF and each % is doubled", () => {
    const choice = { ...DEFAULT_SETUP_CHOICE, profile: "my class" };
    const cmd = buildCmdFile(choice, base());

    expect(cmd.startsWith("@echo off\r\n")).toBe(true);
    expect(cmd).not.toMatch(/[^\r]\n/);
    expect(cmd).toContain("pause");

    // a lone % would start a variable in a batch file
    expect(cmd).not.toMatch(/(^|[^%])%(?!%)/);
    expect(cmd).toContain("my%%20class");
    expect(cmd).toContain("Bootstrap.ps1");
    expect(cmd).toContain("Nothing is installed until you press Set up");
  });

  it("AC-619 what the engine would refuse is refused here first, with what to do", () => {
    // another computer over plain http: the engine downloads from https or from this computer only
    const lan = buildSetupOffer(
      DEFAULT_SETUP_CHOICE,
      "http://192.168.1.20:3061",
    );

    expect(lan.ok).toBe(false);
    expect(lan.ok ? "" : lan.reason).toMatch(/https|localhost/);

    expect(
      buildSetupOffer(DEFAULT_SETUP_CHOICE, "https://board.example").ok,
    ).toBe(true);

    // a name with characters the engine does not allow, and an empty checklist
    expect(isValidProfileName("excalidraw")).toBe(true);
    expect(isValidProfileName("a b_c-1")).toBe(true);
    expect(isValidProfileName("a&b")).toBe(false);
    expect(isValidProfileName("x'y")).toBe(false);
    expect(isValidProfileName("")).toBe(false);
    expect(isValidProfileName(" lead")).toBe(false);
    expect(isValidProfileName("a".repeat(41))).toBe(false);

    const bad = buildSetupOffer(
      { ...DEFAULT_SETUP_CHOICE, profile: "a&b" },
      LOCAL,
    );

    expect(bad.ok).toBe(false);
    expect(bad.ok ? "" : bad.reason).toMatch(/profile name/);

    const none = buildSetupOffer(
      { ...DEFAULT_SETUP_CHOICE, groups: [] },
      LOCAL,
    );

    expect(none.ok).toBe(false);
    expect(none.ok ? "" : none.reason).toMatch(/at least one language/);
  });

  it.skipIf(process.platform !== "win32")(
    "AC-619 the real engine reads the link the page makes, option for option",
    () => {
      const engine = join(
        findRoot(),
        "installer",
        "editor-setup",
        "EditorSetup.ps1",
      );

      for (const choice of [
        DEFAULT_SETUP_CHOICE,
        {
          editor: "codium" as const,
          profile: "my class",
          groups: ["java" as const],
        },
        {
          editor: "code" as const,
          profile: "a_b-9",
          groups: ["js" as const, "cpp" as const],
        },
      ]) {
        const link = buildSetupLink(choice, base());
        const run = spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            engine,
            "-Mode",
            "ParseLink",
            "-Link",
            link,
          ],
          { encoding: "utf8", windowsHide: true },
        );
        const read = JSON.parse(run.stdout.trim());

        expect(read.ok, read.reason).toBe(true);
        expect(read.options.editor).toBe(choice.editor);
        expect(read.options.profile).toBe(choice.profile);
        expect(read.options.vsix).toBe(`${LOCAL}/setup/excalidraw-bridge.vsix`);
        expect(read.options.groups.split(",").sort()).toEqual(
          [...choice.groups].sort(),
        );
      }
    },
  );
});

describe("AC-619 the dialog", () => {
  const open = async () => {
    const onClose = vi.fn();

    await render(
      <Excalidraw>
        <EditorSetupDialog onClose={onClose} />
      </Excalidraw>,
    );

    return { onClose };
  };

  const link = () =>
    query('[data-testid="editor-setup-link"]') as HTMLAnchorElement | null;
  const command = () =>
    query('[data-testid="editor-setup-command"]') as HTMLTextAreaElement;
  const message = () =>
    query('[data-testid="editor-setup-message"]')!.textContent;
  const button = (name: RegExp) =>
    [...document.querySelectorAll("button")].find((entry) =>
      name.test(entry.textContent ?? ""),
    ) as HTMLButtonElement;

  it("AC-619 shows the checklist, ticked as the setup does by default, and a link that follows it", async () => {
    window.localStorage.clear();
    await open();

    const radios = [
      ...document.querySelectorAll<HTMLInputElement>(
        '[data-testid="editor-setup-editor"] input[type="radio"]',
      ),
    ];

    expect(radios.map((radio) => radio.value)).toEqual([
      "auto",
      "code",
      "codium",
    ]);
    expect(radios.find((radio) => radio.checked)?.value).toBe("auto");

    const boxes = [
      ...document.querySelectorAll<HTMLInputElement>(
        '[data-testid="editor-setup-languages"] input[type="checkbox"]',
      ),
    ];

    expect(boxes).toHaveLength(4);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(link()!.getAttribute("href")).toContain("editor=auto");
    expect(link()!.getAttribute("href")).toContain("groups=python,cpp,java,js");

    // a different choice changes the link and the command at once
    fireEvent.click(radios.find((radio) => radio.value === "codium")!);
    fireEvent.click(boxes[1]);

    await waitFor(() =>
      expect(link()!.getAttribute("href")).toContain("editor=codium"),
    );
    expect(link()!.getAttribute("href")).toContain("groups=python,java,js");
    expect(command().value).toContain("editor=codium");

    // every control has a name a screen reader can say
    for (const control of document.querySelectorAll(
      '[data-testid="editor-setup"] input, [data-testid="editor-setup"] textarea',
    )) {
      const labelled =
        control.getAttribute("aria-label") ||
        (control as HTMLInputElement).labels?.length ||
        control.closest("label");

      expect(labelled, control.outerHTML).toBeTruthy();
    }
  });

  it("AC-619 downloads the .cmd with the command in it", async () => {
    window.localStorage.clear();
    await open();

    const created: Blob[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    (URL as any).createObjectURL = (blob: Blob) => {
      created.push(blob);
      return "blob:setup";
    };
    (URL as any).revokeObjectURL = () => undefined;

    fireEvent.click(button(/Download ExcalidrawSetup\.cmd/));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(click).toHaveBeenCalled();

    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(created[0]);
    });

    expect(text).toContain("@echo off");
    expect(text).toContain("Bootstrap.ps1");
    expect(message()).toMatch(/ExcalidrawSetup\.cmd was saved/);

    click.mockRestore();
  });

  it("AC-619 copies the PowerShell command, and when the browser refuses it selects the command and says to press Ctrl+C", async () => {
    window.localStorage.clear();
    await open();

    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    fireEvent.click(button(/Copy the PowerShell command/));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe(command().value);
    await waitFor(() => expect(message()).toMatch(/^Copied/));

    // the browser refuses: the command is selected, and the person is told what to do
    writeText.mockRejectedValue(new Error("denied"));
    (document as any).execCommand = vi.fn().mockReturnValue(false);

    fireEvent.click(button(/Copy the PowerShell command/));

    await waitFor(() => expect(message()).toMatch(/Ctrl\+C/));
    expect(document.activeElement).toBe(command());
  });

  it("AC-619 a name the engine would refuse shows the problem and gives no link, file or command", async () => {
    window.localStorage.clear();
    await open();

    const profile = query(
      '[data-testid="editor-setup-profile"]',
    ) as HTMLInputElement;

    fireEvent.change(profile, { target: { value: "bad&name" } });

    await waitFor(() =>
      expect(
        query('[data-testid="editor-setup-problem"]')?.textContent,
      ).toMatch(/profile name/),
    );
    expect(link()).toBeNull();
    expect(query('[data-testid="editor-setup-link-off"]')).not.toBeNull();
    expect(command().value).toBe("");
    expect(button(/Download ExcalidrawSetup\.cmd/).disabled).toBe(true);
    expect(button(/Copy the PowerShell command/).disabled).toBe(true);

    // and no language at all is said as plainly
    fireEvent.change(profile, { target: { value: "excalidraw" } });

    for (const box of document.querySelectorAll<HTMLInputElement>(
      '[data-testid="editor-setup-languages"] input',
    )) {
      fireEvent.click(box);
    }

    await waitFor(() =>
      expect(
        query('[data-testid="editor-setup-problem"]')?.textContent,
      ).toMatch(/at least one language/),
    );
  });

  it("AC-619 remembers the choice, and a damaged memory is only the default", async () => {
    window.localStorage.setItem(
      "excalidraw-classroom-editor-setup-choice",
      JSON.stringify({ editor: "codium", profile: "class", groups: ["java"] }),
    );
    await open();

    expect(link()!.getAttribute("href")).toContain("editor=codium");
    expect(link()!.getAttribute("href")).toContain("profile=class");
    expect(link()!.getAttribute("href")).toContain("groups=java&");
  });

  it("AC-619 a damaged memory is the default", async () => {
    window.localStorage.setItem(
      "excalidraw-classroom-editor-setup-choice",
      '{"editor": 7, "profile": ["x"], "groups": "nope"',
    );
    await open();

    expect(link()!.getAttribute("href")).toContain("editor=auto");
    expect(link()!.getAttribute("href")).toContain("profile=excalidraw");
    window.localStorage.clear();
  });

  it("AC-619 each of the three ways says what it does and when to use it, and the message and Close stay in view", async () => {
    window.localStorage.clear();
    await open();

    const rows = [
      ...(query('[data-testid="editor-setup-ways"]')?.children ?? []),
    ] as HTMLElement[];

    expect(rows).toHaveLength(3);

    // a button (or the link) and a sentence beside it, in each
    for (const row of rows) {
      const control = row.querySelector("button, a, span[aria-disabled]");

      expect(control, row.textContent ?? "").not.toBeNull();
      expect((row.textContent ?? "").length).toBeGreaterThan(80);
    }

    expect(rows[0].textContent).toMatch(/Easiest/);
    expect(rows[0].textContent).toMatch(/Double-click/);
    expect(rows[1].textContent).toMatch(/Windows key.*powershell/i);
    expect(rows[2].textContent).toMatch(/Only after/);
    expect(rows[2].textContent).toMatch(/Open Windows PowerShell/);
    expect(rows[2].textContent).toMatch(/Open the setup window/);

    // the line with what just happened and Close is stuck to the bottom of the scrolling part
    const message = query('[data-testid="editor-setup-message"]')!;
    const footer = message.parentElement as HTMLElement;

    expect(footer.style.position).toBe("sticky");
    expect(footer.style.bottom).toBe("0px");
    expect(footer.textContent).toContain("Close");
  });

  it("AC-619 Close and Escape close it", async () => {
    window.localStorage.clear();

    const { onClose } = await open();

    fireEvent.click(button(/^Close$/));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(query('[data-testid="editor-setup"]')!, {
      key: "Escape",
    });
    await waitFor(() => expect(onClose.mock.calls.length).toBeGreaterThan(1));
  });
});

describe("AC-619 where it is opened from", () => {
  it("AC-619 the app shows it when asked for, and closes it again", async () => {
    window.localStorage.clear();
    await render(<ExcalidrawApp />);

    expect(query('[data-testid="editor-setup"]')).toBeNull();

    act(() => {
      openEditorSetup();
    });

    await waitFor(() =>
      expect(query('[data-testid="editor-setup"]')).not.toBeNull(),
    );

    act(() => {
      closeEditorSetup();
    });

    await waitFor(() =>
      expect(query('[data-testid="editor-setup"]')).toBeNull(),
    );
    expect(appJotaiStore.get(editorSetupOpenAtom)).toBe(false);
  });
});
