/**
 * The **setup from the browser**: the engine that finds or installs the
 * editor, makes the profile and puts the extensions in it, and the link the
 * page opens it with (D-364 to D-369).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 *
 * Nothing here installs an editor or touches the teacher's own editor folders:
 * every run is given throwaway folders, and the registry test uses a key of
 * its own.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const findRepoRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    if (
      existsSync(join(current, "installer", "editor-setup", "EditorSetup.ps1"))
    ) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the editor setup was not found");
};

const root = findRepoRoot();
const folder = join(root, "installer", "editor-setup");
const engine = join(folder, "EditorSetup.ps1");

const run = (file: string, ...args: string[]) =>
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args],
    { encoding: "utf8", windowsHide: true },
  );

const engineJson = (...args: string[]) => {
  const result = run(engine, ...args);

  return {
    code: result.status,
    stdout: result.stdout,
    lines: result.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => JSON.parse(line)),
  };
};

const readLink = (link: string) =>
  JSON.parse(
    run(engine, "-Mode", "ParseLink", "-Link", link).stdout.trim(),
  ) as {
    ok: boolean;
    reason: string;
    options: Record<string, unknown>;
  };

const scratch: string[] = [];

const freshFolders = () => {
  const base = mkdtempSync(join(tmpdir(), "editor-setup-"));

  scratch.push(base);

  return { ud: join(base, "ud"), ex: join(base, "ex") };
};

afterAll(() => {
  for (const base of scratch) {
    rmSync(base, { recursive: true, force: true });
  }
});

const onWindows = process.platform === "win32";

describe.skipIf(!onWindows)("the link the page opens the setup with", () => {
  it("AC-425 a link is read against a closed list, and what is not on it is refused", () => {
    const good = readLink(
      "excalidraw-setup://install?editor=codium&profile=excalidraw&groups=python,java&vsix=http%3A%2F%2F127.0.0.1%3A3061%2Fsetup%2Fexcalidraw-bridge.vsix",
    );

    expect(good.ok).toBe(true);
    expect(good.options).toMatchObject({
      editor: "codium",
      profile: "excalidraw",
      groups: "python,java",
      vsix: "http://127.0.0.1:3061/setup/excalidraw-bridge.vsix",
    });

    // a link that is only the address takes the defaults
    expect(readLink("excalidraw-setup://install?").options).toMatchObject({
      editor: "auto",
      profile: "excalidraw",
      groups: "python,cpp,java,js",
    });

    // the virtual display driver is gone (D-518, D-329): its word is refused
    const driver = readLink("excalidraw-setup://install?vdd=1");

    expect(driver.ok).toBe(false);
    expect(driver.reason).toContain("vdd");
    expect(driver.options).toEqual({});

    // what is not on the list is refused, not ignored
    for (const [link, word] of [
      ["excalidraw-setup://install?run=calc.exe", "run"],
      ["excalidraw-setup://install?editor=notepad", "editor"],
      ["excalidraw-setup://install?profile=a%26b", "profile name"],
      ["excalidraw-setup://install?groups=python,ruby", "language group"],
      [
        "excalidraw-setup://install?vsix=https%3A%2F%2Fevil.example%2Fx.exe",
        "extension address",
      ],
      [
        "excalidraw-setup://install?vsix=http%3A%2F%2Fevil.example%2Fx.vsix",
        "extension address",
      ],
      ["excalidraw-setup://install?folder=..%5C..%5CWindows", "folder"],
      ["https://example.com/install?editor=code", "setup link"],
    ] as const) {
      const answer = readLink(link);

      expect([link, answer.ok]).toEqual([link, false]);
      expect(answer.reason).toContain(word);
    }

    // an extension from the page's own https site, or from this machine, is
    // the only kind of address that is downloaded
    expect(
      readLink(
        "excalidraw-setup://install?vsix=https%3A%2F%2Fexample.org%2Fsetup%2Fb.vsix",
      ).ok,
    ).toBe(true);
  });

  it("AC-425 the helper refuses a bad link without a window and runs nothing", () => {
    const refused = run(
      join(folder, "Open-SetupLink.ps1"),
      "-NoWindow",
      "-Link",
      "excalidraw-setup://install?run=calc.exe",
    );

    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("refused");
  });
});

describe.skipIf(!onWindows)("the plan", () => {
  it("AC-426 the plan says the editor, the profile and each extension, and changes nothing", () => {
    const { ud, ex } = freshFolders();

    const answer = engineJson(
      "-Mode",
      "Plan",
      "-Json",
      "-Editor",
      "codium",
      "-Groups",
      "python,cpp,js",
      "-UserDataDir",
      ud,
      "-ExtensionsDir",
      ex,
      "-VsixPath",
      "C:\\x\\bridge.vsix",
    );

    expect(answer.code).toBe(0);

    const plan = answer.lines.find((line) => line.step === "plan").data;

    expect(plan.editor.key).toBe("codium");
    expect(plan.editor.ladder).toEqual(["winget", "scoop", "direct"]);
    expect(plan.profile).toEqual({ name: "excalidraw", exists: false });
    expect(plan.bridge.source).toBe("C:\\x\\bridge.vsix");

    // the checklist, for the open store: clangd and LLDB stand for C and C++,
    // and JavaScript and TypeScript need nothing (they are built in)
    const ids = plan.extensions.map((e: { id: string }) => e.id);

    expect(ids).toEqual([
      "ms-python.python",
      "ms-python.debugpy",
      "llvm-vs-code-extensions.vscode-clangd",
      "vadimcn.vscode-lldb",
    ]);

    // and nothing was made
    expect(existsSync(ud)).toBe(false);
    expect(existsSync(ex)).toBe(false);
  });

  it("AC-426 for VS Code the C and C++ group is Microsoft's own extension", () => {
    const { ud, ex } = freshFolders();

    const plan = engineJson(
      "-Mode",
      "Plan",
      "-Json",
      "-Editor",
      "code",
      "-Groups",
      "cpp,java",
      "-UserDataDir",
      ud,
      "-ExtensionsDir",
      ex,
    ).lines.find((line) => line.step === "plan").data;

    expect(plan.extensions.map((e: { id: string }) => e.id)).toEqual([
      "ms-vscode.cpptools",
      "redhat.java",
      "vscjava.vscode-java-debug",
      "vscjava.vscode-java-test",
      "vscjava.vscode-maven",
    ]);
  });
});

describe.skipIf(!onWindows)("the profile", () => {
  it("AC-427 the profile is made in the editor's own list, and what else is in it stays", () => {
    const { ud } = freshFolders();
    const storage = join(ud, "User", "globalStorage", "storage.json");

    // the editor's file, as it is on a machine that has been used
    mkdirSync(dirname(storage), { recursive: true });
    writeFileSync(
      storage,
      JSON.stringify({
        telemetry: { machineId: "abc" },
        userDataProfiles: [{ name: "Teaching", location: "teaching" }],
      }),
    );

    const made = run(
      engine,
      "-Mode",
      "Profile",
      "-Editor",
      "codium",
      "-UserDataDir",
      ud,
    );

    expect(made.stdout).toContain("created");

    const after = JSON.parse(readFileSync(storage, "utf8"));

    expect(after.telemetry).toEqual({ machineId: "abc" });
    expect(after.userDataProfiles).toEqual([
      { name: "Teaching", location: "teaching" },
      { name: "excalidraw", location: "excalidraw" },
    ]);

    // the editor's file is copied before it is replaced
    expect(existsSync(`${storage}.before-excalidraw`)).toBe(true);

    // a profile that is there is used, and the file is not written again
    const again = run(
      engine,
      "-Mode",
      "Profile",
      "-Editor",
      "codium",
      "-UserDataDir",
      ud,
    );

    expect(again.stdout).toContain("exists");
    expect(
      JSON.parse(readFileSync(storage, "utf8")).userDataProfiles,
    ).toHaveLength(2);
  });

  it("AC-427 a run that was not accepted stops after the plan and changes nothing", () => {
    const { ud, ex } = freshFolders();

    const stopped = engineJson(
      "-Mode",
      "Run",
      "-Json",
      "-Editor",
      "codium",
      "-UserDataDir",
      ud,
      "-ExtensionsDir",
      ex,
      "-NoOpen",
    );

    expect(stopped.code).toBe(2);
    expect(stopped.lines.some((line) => line.status === "stop")).toBe(true);
    expect(existsSync(ud)).toBe(false);
  });
});

describe.skipIf(!onWindows)("the link in the registry", () => {
  it("AC-428 the link is registered for this user only, and can be taken away", () => {
    const key = `HKCU:\\Software\\Classes\\excalidraw-setup-test-${process.pid}`;
    const register = join(folder, "Register-SetupLink.ps1");

    try {
      const done = run(register, "-KeyPath", key);

      expect(done.status).toBe(0);

      const read = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-ItemProperty -LiteralPath '${key}\\shell\\open\\command').'(default)'`,
        ],
        { encoding: "utf8" },
      ).stdout.trim();

      // the one argument is the link, in quotes, and the helper is this
      // folder's own
      expect(read).toContain("Open-SetupLink.ps1");
      expect(read).toContain('"%1"');
      expect(read).toContain("-ExecutionPolicy Bypass");

      const gone = run(register, "-KeyPath", key, "-Remove");

      expect(gone.status).toBe(0);

      const left = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Test-Path -LiteralPath '${key}'`],
        { encoding: "utf8" },
      ).stdout.trim();

      expect(left).toBe("False");
    } finally {
      spawnSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Remove-Item -LiteralPath '${key}' -Recurse -Force -ErrorAction SilentlyContinue`,
      ]);
    }

    // and it never writes anywhere but the current user's registry
    const source = readFileSync(register, "utf8");

    expect(source).toContain("HKCU:");
    expect(source).not.toContain("HKLM:");
  });
});

describe("the way the editor is installed", () => {
  const source = readFileSync(engine, "utf8");

  it("AC-429 the editor is installed by winget, then scoop, then the publisher's own installer", () => {
    expect(source).toContain("[string]$Ladder = 'winget,scoop,direct'");
    expect(source).toMatch(/'winget' \{ \$ok = Install-ViaWinget/);
    expect(source).toMatch(/'scoop' \{ \$ok = Install-ViaScoop/);
    expect(source).toMatch(/'direct' \{ \$ok = Install-Direct/);

    // the user's own install: no administrator
    expect(source).toContain("--scope user");
    expect(source).toContain("win32-x64-user");
    expect(source).toContain("VSCodiumUserSetup-x64");
    // ... and the administrator is asked for nowhere (D-518)
    const editorPart = source.slice(
      source.indexOf("function Install-ViaWinget"),
      source.indexOf("function Invoke-Cli"),
    );

    expect(editorPart.length).toBeGreaterThan(500);
    expect(editorPart).not.toMatch(/-Verb\s+RunAs/);
  });

  it("AC-429 a downloaded installer is run only when it matches the publisher's checksum", () => {
    // the checksum is compared before the installer is started, and a missing
    // or different one stops it
    const compare = source.indexOf("$actual -ne $expected.ToLowerInvariant()");
    const start = source.indexOf("Start-Process -FilePath $installer");

    expect(compare).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(compare);
    expect(source).toContain(
      "the publisher gave no checksum, so the installer is not run",
    );

    // and nothing from the network is run as a script
    expect(source).not.toMatch(/Invoke-Expression|\biex\b/i);
  });

  it("AC-429 nothing is installed until the plan is accepted", () => {
    // Run says the plan, and stops unless -Yes is given
    expect(source).toMatch(
      /if \(-not \$Yes\) \{[\s\S]*the plan is accepted[\s\S]*return 2/,
    );
  });
});

describe("there is no virtual display driver step", () => {
  const source = readFileSync(engine, "utf8");
  const files = readdirSync(folder).filter((name) => name.endsWith(".ps1"));

  it("AC-430 AC-619 the engine and its helpers carry nothing of the driver, and no step asks for the administrator (D-518, D-329)", () => {
    expect(files.length).toBeGreaterThan(4);

    for (const name of files) {
      const text = readFileSync(join(folder, name), "utf8");

      expect(text, name).not.toMatch(
        /\bVdd\b|Virtual-Display-Driver|VirtualDrivers|Install-Vdd|MttVDD/i,
      );
      expect(text, name).not.toMatch(/-Verb\s+RunAs/i);
    }

    // the engine has no -Vdd switch: a run that names it is refused by PowerShell
    expect(source).not.toMatch(/\[switch\]\$Vdd/);
    expect(existsSync(join(folder, "vdd"))).toBe(false);
  });

  it.skipIf(!onWindows)(
    "AC-430 AC-619 the plan has no driver item and the link word for it is refused",
    () => {
      const { ud, ex } = freshFolders();

      const plan = engineJson(
        "-Mode",
        "Plan",
        "-Json",
        "-Editor",
        "code",
        "-Groups",
        "js",
        "-UserDataDir",
        ud,
        "-ExtensionsDir",
        ex,
      ).lines.find((line) => line.step === "plan").data;

      expect(plan.vdd).toBeUndefined();
      expect(Object.keys(plan)).not.toContain("vdd");

      const refused = run(engine, "-Mode", "Plan", "-Vdd");

      expect(refused.status).not.toBe(0);
    },
  );
});

describe("the old bridge and the window (found on the teacher's own machine)", () => {
  const source = readFileSync(engine, "utf8");
  const window_ = readFileSync(join(folder, "Open-SetupLink.ps1"), "utf8");

  /** a PowerShell function of the engine, run on its own */
  const callFunction = (name: string, call: string) => {
    const match = source.match(
      new RegExp(`function ${name} \\{[\\s\\S]*?\\n\\}\\n`),
    );

    expect(match, name).not.toBeNull();

    return spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `${match![0]}\n${call}`,
      ],
      { encoding: "utf8", windowsHide: true },
    ).stdout.trim();
  };

  it.skipIf(!onWindows)(
    "AC-619 the version of a .vsix is read even when its manifest has two keys that differ only in case",
    () => {
      const base = mkdtempSync(join(tmpdir(), "vsix-version-"));

      scratch.push(base);

      // a manifest Windows PowerShell's ConvertFrom-Json refuses
      const manifest =
        '{"name":"x","Name":"y","version":"7.8.9","engines":{"vscode":"^1.70.0"}}';
      const file = join(base, "bridge.vsix");

      const zip = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { writeZip } from ${JSON.stringify(
            pathToFileURL(
              join(root, "packages", "vscode-bridge", "scripts", "zip.mjs"),
            ).href,
          )}; import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(
            file,
          )}, writeZip([{ name: "extension/package.json", data: Buffer.from(${JSON.stringify(
            manifest,
          )}) }]));`,
        ],
        { encoding: "utf8" },
      );

      expect(zip.status, zip.stderr).toBe(0);
      expect(callFunction("Get-VsixVersion", `Get-VsixVersion '${file}'`)).toBe(
        "7.8.9",
      );
      expect(
        callFunction("Get-VsixVersion", "Get-VsixVersion 'C:\\no\\such.vsix'"),
      ).toBe("");
    },
  );

  it.skipIf(!onWindows)(
    "AC-619 an older version is older, and an unreadable one is treated as older",
    () => {
      const older = (a: string, b: string) =>
        callFunction("Test-OlderVersion", `Test-OlderVersion '${a}' '${b}'`);

      expect(older("0.1.0", "0.2.1")).toBe("True");
      expect(older("0.2.0", "0.2.1")).toBe("True");
      expect(older("0.2.1", "0.2.1")).toBe("False");
      expect(older("0.10.0", "0.9.0")).toBe("False");
      expect(older("not-a-version", "0.2.1")).toBe("True");
    },
  );

  it.skipIf(!onWindows)(
    "AC-619 the plan lists the editors whose usual profile has a bridge, so an old one is updated",
    () => {
      const { ud, ex } = freshFolders();
      const plan = engineJson(
        "-Mode",
        "Plan",
        "-Json",
        "-Editor",
        "code",
        "-Groups",
        "js",
        "-UserDataDir",
        ud,
        "-ExtensionsDir",
        ex,
      ).lines.find((line) => line.step === "plan").data;

      // nothing is installed in the throwaway folders: the list is there and empty
      expect(Array.isArray(plan.staleBridges)).toBe(true);
      expect(plan.staleBridges).toHaveLength(0);
    },
  );

  it("AC-619 the run updates a bridge that is older than the one it brings, in the usual profile, and says what it did", () => {
    expect(source).toMatch(/Test-OlderVersion \$stale\.have \$bridgeVersion/);
    expect(source).toContain("in its usual profile; it is now");
    expect(source).toContain("it could not be updated");
    // and the last line carries what the window reads
    for (const key of [
      "editor",
      "profile",
      "opened",
      "bridge",
      "bridgeVersion",
      "updated",
      "failed",
    ]) {
      expect(source).toMatch(new RegExp(`\\n\\s+${key}\\s+= `));
    }
  });

  it.skipIf(!onWindows)(
    "AC-619 the link is read in the forms a browser hands it over in (Chrome puts a slash after install), and what is refused says what came",
    () => {
      for (const link of [
        "excalidraw-setup://install?editor=code&profile=excalidraw",
        "excalidraw-setup://install/?editor=code&profile=excalidraw",
        "EXCALIDRAW-SETUP://install/?editor=code",
        '"excalidraw-setup://install/?editor=code"',
      ]) {
        const read = readLink(link);

        expect([link, read.ok]).toEqual([link, true]);
        expect(read.options.editor).toBe("code");
      }

      for (const link of [
        "excalidraw-setup://other?editor=code",
        "excalidraw-setup://install/evil?editor=code",
        "excalidraw-setup://installer?editor=code",
        "https://example.com/install/?editor=code",
      ]) {
        expect([link, readLink(link).ok]).toEqual([link, false]);
      }

      expect(readLink("nonsense").reason).toContain("(it begins: nonsense)");
    },
  );

  it.skipIf(!onWindows)(
    "AC-619 the window's controls do not overlap, are inside the window, the editor choice has four answers and the page's choice is ticked",
    () => {
      const open = (editor: string) => {
        const run = spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            join(folder, "Open-SetupLink.ps1"),
            "-Link",
            `excalidraw-setup://install/?editor=${editor}&profile=excalidraw&groups=python,java`,
            "-Layout",
          ],
          { encoding: "utf8", windowsHide: true },
        );

        return JSON.parse(run.stdout.trim()) as {
          client: { w: number; h: number };
          controls: {
            type: string;
            text: string;
            x: number;
            y: number;
            w: number;
            h: number;
            checked: boolean | null;
          }[];
        };
      };

      const layout = open("codium");
      const { controls, client } = layout;

      // every control is inside the window
      for (const control of controls) {
        expect(control.x, control.text).toBeGreaterThanOrEqual(0);
        expect(control.y, control.text).toBeGreaterThanOrEqual(0);
        expect(control.x + control.w, control.text).toBeLessThanOrEqual(
          client.w,
        );
        expect(control.y + control.h, control.text).toBeLessThanOrEqual(
          client.h,
        );
      }

      // and none lies on another: the text of the log was printed over the plan when two did
      for (let a = 0; a < controls.length; a++) {
        for (let b = a + 1; b < controls.length; b++) {
          const p = controls[a];
          const q = controls[b];
          const apart =
            p.x + p.w <= q.x ||
            q.x + q.w <= p.x ||
            p.y + p.h <= q.y ||
            q.y + q.h <= p.y;

          expect(
            apart,
            `${p.type} "${p.text}" lies on ${q.type} "${q.text}"`,
          ).toBe(true);
        }
      }

      // the editor can be chosen, and the page's choice is the one ticked
      const radios = controls.filter((c) => c.type === "RadioButton");

      expect(radios.map((r) => r.text)).toEqual([
        "The one installed",
        "VS Code",
        "VSCodium",
        "Both",
      ]);
      expect(radios.filter((r) => r.checked).map((r) => r.text)).toEqual([
        "VSCodium",
      ]);
      expect(
        open("code")
          .controls.filter((c) => c.type === "RadioButton" && c.checked)
          .map((r) => r.text),
      ).toEqual(["VS Code"]);

      // the languages the link names are ticked, and no others
      expect(
        controls
          .filter((c) => c.type === "CheckBox" && c.checked)
          .map((c) => c.text),
      ).toEqual(["Python", "Java"]);

      // the log and the result sit below the languages
      const lastBox = controls.filter((c) => c.type === "CheckBox").pop()!;
      const text = controls.filter((c) => c.type === "TextBox");

      expect(text).toHaveLength(2);
      expect(text[0].y).toBeGreaterThanOrEqual(lastBox.y + lastBox.h);
    },
  );

  it("AC-619 the window reads the engine without blocking: its own process, a file, a timer", () => {
    expect(window_).toContain("-RedirectStandardOutput");
    expect(window_).toContain("System.Windows.Forms.Timer");
    // the freeze: waiting for a line inside the window's own thread
    expect(window_).not.toMatch(/\.ReadLine\(\)|EndOfStream/);
    // the window is shown first and the plan is read afterwards
    expect(window_.indexOf("$form.Add_Shown")).toBeGreaterThan(0);
    expect(window_).toMatch(/Add_Shown\(\{ Start-PlanFor \}\)/);
    expect(window_).toMatch(/function Start-PlanFor \{[\s\S]*-Mode', 'Plan'/);
    // it ends by saying what to do next
    expect(window_).toContain("leave the token field empty and press Connect");
  });
});

describe("the proof in a Windows Sandbox", () => {
  const launcher = readFileSync(join(folder, "run-sandbox-proof.ps1"), "utf8");
  const inside = readFileSync(join(folder, "sandbox-run.ps1"), "utf8");

  it("AC-431 the sandbox is fresh, has the network, sees the setup read only, and writes only its result folder", () => {
    // a sandbox that is running is stopped first: a live one keeps its old setup
    expect(launcher).toContain("Get-Process -Name 'WindowsSandbox*'");

    // the network is on: the editor is downloaded
    expect(launcher).toContain("<Networking>Default</Networking>");

    // the setup folder is mapped read only and the result folder is the one
    // place the sandbox writes
    expect(launcher.match(/<MappedFolder>/g)).toHaveLength(2);
    expect(launcher).toMatch(
      /<SandboxFolder>C:\\Setup<\/SandboxFolder>\s*<ReadOnly>true<\/ReadOnly>/,
    );
    expect(launcher).toMatch(
      /<SandboxFolder>C:\\Out<\/SandboxFolder>\s*<ReadOnly>false<\/ReadOnly>/,
    );
    expect(launcher).toContain("C:\\Setup\\sandbox-run.ps1");

    // it installs nothing on the host
    expect(launcher).not.toMatch(
      /Install-Editor|--install-extension|winget install/,
    );
  });

  it("AC-431 inside, the engine runs with the editor missing and what was true before and after is written down", () => {
    expect(inside).toContain("-Mode', 'Run', '-Yes', '-NoOpen', '-Json'");

    for (const fact of [
      "winget",
      "scoop",
      "curl",
      "codeFolder",
      "codiumFolder",
    ]) {
      expect(inside).toContain(fact);
    }

    // a plain string: what Get-Content returns carries the whole drive with it
    expect(inside).toContain(
      "[string](Get-Content -LiteralPath $storage -Raw)",
    );
    expect(inside).toContain("result.json");
    expect(inside).toContain("--list-extensions --show-versions");
  });
});
