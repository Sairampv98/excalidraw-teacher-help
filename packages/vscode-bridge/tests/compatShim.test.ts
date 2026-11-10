/**
 * The shim that lets the editor-window helpers run on PowerShell 2.0, the one
 * Windows 7 has (D-477, D-481).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

/** The package root, found by walking up from the working directory. */
const findPackageRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");

    if (existsSync(join(candidate, "scripts", "build-vsix.mjs"))) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the vscode-bridge package was not found");
};

const media = join(findPackageRoot(), "extension", "media");
const HELPERS = ["capture.ps1", "window.ps1", "input.ps1"];

/** the script without its comment lines: what runs */
const code = (name: string): string =>
  readFileSync(join(media, name), "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

describe("the PowerShell 2.0 shim (D-481)", () => {
  it("AC-576 every helper loads compat.ps1 the way PowerShell 2.0 can", () => {
    for (const name of HELPERS) {
      const text = code(name);

      // `$PSScriptRoot` is empty in a script on PowerShell 2.0, so the helper
      // finds its folder through `$MyInvocation`
      expect(text, name).toContain(
        ". (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'compat.ps1')",
      );
      expect(text, name).not.toContain("$PSScriptRoot");
    }
  });

  it("AC-576 no helper uses a form that PowerShell 2.0 does not know", () => {
    for (const name of HELPERS) {
      const text = code(name);

      expect(text, name).not.toMatch(/\[ordered\]/i);
      expect(text, name).not.toMatch(/\[IntPtr\]::new\(/i);
      expect(text, name).not.toMatch(/\[pscustomobject\]/i);
      // the hashtable form of Get-Process's filters is PowerShell 3 as well
      expect(text, name).not.toMatch(/Get-CimInstance/i);
      // PowerShell 2.0 runs on the .NET 2.0 / 3.5 runtime: no type that is .NET 4
      expect(text, name).not.toMatch(/.Restart()/);
      expect(text, name).not.toMatch(
        /BlockingCollection|System.Collections.Concurrent/,
      );
    }
  });

  it("AC-576 the shim defines what the helpers lean on", () => {
    const shim = readFileSync(join(media, "compat.ps1"), "utf8");

    expect(shim).toContain("function Ordered");
    expect(shim).toContain("function New-IntPtr");
    // the stand-in is written ONLY when the command does not exist
    expect(shim).toMatch(
      /if \(-not \(Get-Command ConvertTo-Json[^)]*\)\) \{\s*function ConvertTo-Json/,
    );
  });

  it.skipIf(process.platform !== "win32")(
    "AC-576 the shim's JSON is the text PowerShell's own gives for the helpers' objects",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "compat-"));
      const script = join(dir, "same.ps1");
      writeFileSync(
        script,
        [
          `. '${join(media, "compat.ps1").replace(/'/g, "''")}'`,
          "$title = 'He said \"hi\"  C:a\b' + [char]10 + 'next'",
          "$window = Ordered 'found' $true 'visible' $false 'handle' ([long]123456789012) 'title' $title 'pid' ([uint32]42) 'x' -8 'ratio' 1.5 'none' $null",
          "$list = @()",
          "$list += Ordered 'device' 'one' 'primary' $true",
          "$list += Ordered 'device' 'two' 'primary' $false",
          "$displays = Ordered 'displays' $list",
          "foreach ($value in @($window, $displays)) {",
          "  $mine = ConvertTo-JsonText $value 4",
          "  $theirs = ConvertTo-Json -InputObject $value -Compress -Depth 4",
          "  Write-Output ($mine -ceq $theirs)",
          "  Write-Output $mine",
          "}",
        ].join("\r\n"),
      );

      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        { encoding: "utf8" },
      )
        .split(/\r?\n/)
        .filter(Boolean);

      // [true, text, true, text]
      expect(out[0]).toBe("True");
      expect(out[2]).toBe("True");

      const parsed = JSON.parse(out[1]);

      expect(parsed.title).toBe('He said "hi"  C:a\b\nnext');
      expect(parsed.handle).toBe(123456789012);
      expect(Object.keys(parsed)).toEqual([
        "found",
        "visible",
        "handle",
        "title",
        "pid",
        "x",
        "ratio",
        "none",
      ]);
      expect(JSON.parse(out[3]).displays).toHaveLength(2);
    },
    30_000,
  );
});
