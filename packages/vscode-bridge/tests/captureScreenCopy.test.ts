/**
 * The **screen copy** on Windows 7 (D-493, AC-591).
 *
 * On a Windows 7 machine the window helper finds the editor's window, but
 * `PrintWindow` gives an empty picture of it (found on the two test machines:
 * `NO_PICTURE`). Only THEN, and only on Windows 7, the helper copies the
 * window's client area from the screen, says `SCREEN_COPY`, and the panel tells
 * the person the window must be visible and not covered.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing. The real proof is the
 * run of `installer/win7/vm/ps2-editor.ps1` on the two Windows 7 machines.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { parseBridgeMessage } from "../bridge/src/protocol";
import { createCaptureStatePublisher } from "../extension/src/captureState";
import {
  captureReason,
  createWindowCapture,
  parseScreenCopyStatus,
  type CaptureFrame,
  type CaptureProcess,
} from "../extension/src/windowCapture";

import type { CaptureStateMessage } from "../extension/src/captureState";

const findRepoRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    if (
      existsSync(join(current, "installer", "win7", "vm", "ps2-editor.ps1"))
    ) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  throw new Error("the repository root was not found");
};

const root = findRepoRoot();
const capturePath = join(
  root,
  "packages",
  "vscode-bridge",
  "extension",
  "media",
  "capture.ps1",
);
const source = readFileSync(capturePath, "utf8");

const jpegBytes = (marker: number): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 10, marker]);

const lengthPrefixed = (payload: Buffer): Buffer => {
  const length = Buffer.alloc(4);

  length.writeUInt32LE(payload.length, 0);

  return Buffer.concat([length, payload]);
};

const statusChunk = (code: string): Buffer =>
  lengthPrefixed(Buffer.from(`STATUS ${code}`, "utf8"));

class FakeHelper implements CaptureProcess {
  readonly stream = new PassThrough();

  stdout: NodeJS.ReadableStream | null = this.stream;
  stderr: NodeJS.ReadableStream | null = null;

  private listeners = new Map<string, ((...args: any[]) => void)[]>();

  on(event: string, listener: (...args: any[]) => void): this {
    const list = this.listeners.get(event) ?? [];

    list.push(listener);
    this.listeners.set(event, list);

    return this;
  }

  kill(): boolean {
    return true;
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

const until = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("the condition was not met in time");
};

describe("the helper's screen copy", () => {
  // the part of the loop that decides what to do with an EMPTY picture
  const emptyPart = source.slice(
    source.indexOf("$empty = Test-Empty $bmp"),
    source.indexOf("$bytes = $mem.ToArray()"),
  );

  it("AC-591 the copy is taken from the screen at the client area's origin (CopyFromScreen at ClientToScreen)", () => {
    expect(source).toContain("CopyFromScreen");
    expect(source).toContain("ClientToScreen");

    // the copy is the client area: the same rectangle PrintWindow draws
    const copy = source.slice(source.indexOf("public static bool ScreenCopy"));

    expect(copy.slice(0, 600)).toMatch(
      /ClientRect\(hwnd\)[\s\S]*CopyFromScreen\(r\[0\], r\[1\], 0, 0/,
    );
  });

  it("AC-591 the copy is for Windows 7 only", () => {
    // version 6.1 is Windows 7 and nothing else (8 is 6.2, 8.1 is 6.3)
    expect(source).toMatch(
      /IsWindows7\(\)[\s\S]{0,200}Major == 6 && [a-z.]*Minor == 1/,
    );

    // and the loop asks it before it copies anything
    expect(emptyPart).toMatch(/\$empty -and \$isWin7/);
    expect(emptyPart.indexOf("$isWin7")).toBeLessThan(
      emptyPart.indexOf("ScreenCopy"),
    );

    // a test can say which Windows it is, so no other Windows is ever copied
    expect(source).toContain("[string]$AssumeWindowsVersion");
    expect(source).toMatch(
      /\$isWin7 = if \(\$AssumeWindowsVersion\) \{ \$AssumeWindowsVersion -eq '6\.1' \}/,
    );
  });

  it("AC-591 the copy comes only AFTER PrintWindow gave an empty picture", () => {
    const shot = source.indexOf("[PwCap]::Shot($hwnd, $bmp)");
    const empty = source.indexOf("$empty = Test-Empty $bmp");
    const copy = source.indexOf("[PwCap]::ScreenCopy($hwnd, $bmp)");

    expect(shot).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(shot);
    expect(copy).toBeGreaterThan(empty);

    // the screen is never copied from anywhere but that one place
    expect(source.match(/\[PwCap\]::ScreenCopy\(/g)).toHaveLength(1);

    // a copy that is empty too is NO_PICTURE, as it was before
    expect(emptyPart).toContain("-not (Test-Empty $bmp)");
    expect(emptyPart).toContain("'NO_PICTURE'");
  });

  it("AC-591 the state says SCREEN_COPY when the copy is used, and says when it stops", () => {
    expect(emptyPart + source.slice(source.indexOf("$usedCopy"))).toContain(
      "Write-Status 'SCREEN_COPY'",
    );
    expect(source).toContain("Write-Status 'SCREEN_COPY_OFF'");

    // it is said BEFORE the first copied frame is written, so the panel never
    // shows a copy without saying so
    const said = source.indexOf("Write-Status 'SCREEN_COPY'");
    const written = source.indexOf(
      "$stream.Write([BitConverter]::GetBytes([int]$bytes.Length)",
    );

    expect(said).toBeGreaterThan(0);
    expect(said).toBeLessThan(written);
  });

  it("AC-591 a window with something on top of it is NOT copied: the copy would show that other window to the class", () => {
    expect(source).toContain("WindowFromPoint");
    expect(source).toContain("public static bool Covered");
    expect(emptyPart).toMatch(/\[PwCap\]::Covered\(\$hwnd\)/);
    expect(emptyPart).toContain("'SCREEN_COPY_COVERED'");

    // the cover is looked at BEFORE the screen is copied
    expect(emptyPart.indexOf("Covered")).toBeLessThan(
      emptyPart.indexOf("ScreenCopy"),
    );
  });

  it("AC-591 the helper keeps PowerShell 2.0 syntax (Windows 7)", () => {
    // no PowerShell 3+ only constructs in the code (comments say what is avoided)
    const code = source
      .split(/\r?\n/)
      .filter((line) => !/^\s*(#|\/\/)/.test(line))
      .join("\n");

    expect(code).not.toMatch(/\[ordered\]|\.Where\(|\.ForEach\(|::new\(/);
    expect(code).not.toMatch(/\bRestart\(\)/);
  });
});

describe("what the extension does with it", () => {
  it("AC-591 SCREEN_COPY is not a failure: the panel is told it is a copy, and the frames still arrive", async () => {
    const helper = new FakeHelper();
    const reasons: string[] = [];
    const copies: boolean[] = [];
    const frames: CaptureFrame[] = [];

    createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "VSCodium",
      titleLike: "excalidraw",
      spawn: () => helper,
      onFrame: (frame) => {
        frames.push(frame);
      },
      onUnavailable: (reason) => {
        reasons.push(reason);
      },
      onScreenCopy: (on) => {
        copies.push(on);
      },
    });

    helper.stream.write(Buffer.from("HEADER 962 506\r\n", "ascii"));
    helper.stream.write(statusChunk("SCREEN_COPY"));
    helper.stream.write(lengthPrefixed(jpegBytes(1)));

    await until(() => frames.length === 1);

    expect(copies).toEqual([true]);
    expect(reasons).toEqual([]);

    // PrintWindow works again: the copy stops, and the panel is told
    helper.stream.write(statusChunk("SCREEN_COPY_OFF"));
    helper.stream.write(lengthPrefixed(jpegBytes(2)));

    await until(() => frames.length === 2);

    expect(copies).toEqual([true, false]);
    expect(reasons).toEqual([]);
  });

  it("AC-591 a helper that exits ends the copy: the next helper says it again", async () => {
    const helper = new FakeHelper();
    const copies: boolean[] = [];

    createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "VSCodium",
      titleLike: "excalidraw",
      spawn: () => helper,
      onFrame: () => undefined,
      onScreenCopy: (on) => {
        copies.push(on);
      },
    });

    helper.stream.write(Buffer.from("HEADER 100 100\r\n", "ascii"));
    helper.stream.write(statusChunk("SCREEN_COPY"));

    await until(() => copies.length === 1);

    helper.emit("exit", 1, null);

    expect(copies).toEqual([true, false]);
  });

  it("AC-591 a covered window says it must be uncovered, and no picture is published for it", async () => {
    expect(captureReason("STATUS SCREEN_COPY_COVERED")).toMatch(
      /covered.*front|front.*covered/i,
    );

    const helper = new FakeHelper();
    const reasons: string[] = [];
    const frames: CaptureFrame[] = [];

    createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "VSCodium",
      titleLike: "excalidraw",
      spawn: () => helper,
      onFrame: (frame) => {
        frames.push(frame);
      },
      onUnavailable: (reason) => {
        reasons.push(reason);
      },
    });

    helper.stream.write(Buffer.from("HEADER 100 100\r\n", "ascii"));
    helper.stream.write(statusChunk("SCREEN_COPY_COVERED"));

    await until(() => reasons.length === 1);

    expect(reasons[0]).toContain("covered");
    expect(frames).toHaveLength(0);
  });

  it("AC-591 the words of the status are read exactly", () => {
    expect(parseScreenCopyStatus("STATUS SCREEN_COPY")).toBe(true);
    expect(parseScreenCopyStatus("SCREEN_COPY")).toBe(true);
    expect(parseScreenCopyStatus("STATUS SCREEN_COPY_OFF")).toBe(false);
    expect(parseScreenCopyStatus("STATUS SCREEN_COPY_COVERED")).toBeNull();
    expect(parseScreenCopyStatus("STATUS NO_PICTURE")).toBeNull();
    expect(parseScreenCopyStatus("STATUS")).toBeNull();
  });

  it("AC-591 the state carries the copy to the panel, and an older extension's message still parses", () => {
    const sent: CaptureStateMessage[] = [];
    const publisher = createCaptureStatePublisher((message) => {
      sent.push(message);
    });

    publisher.live(1, { width: 10, height: 10 });
    expect("screenCopy" in sent[0]).toBe(false);

    publisher.setScreenCopy(true);

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ state: "live", screenCopy: true });

    // the same thing again is not a change
    publisher.setScreenCopy(true);
    expect(sent).toHaveLength(2);

    publisher.setScreenCopy(false);
    expect("screenCopy" in sent[2]).toBe(false);

    // the message round-trips through the protocol ...
    const round = parseBridgeMessage(JSON.stringify(sent[1]));

    expect(round).toMatchObject({ screenCopy: true });

    // ... a wrong type is refused ...
    expect(
      parseBridgeMessage(
        JSON.stringify({
          v: 1,
          type: "editor:capture",
          state: "live",
          seq: 1,
          screenCopy: "yes",
        }),
      ),
    ).toBeNull();

    // ... and a message that does not have it parses as before
    expect(
      parseBridgeMessage(
        JSON.stringify({ v: 1, type: "editor:capture", state: "live", seq: 1 }),
      ),
    ).not.toBeNull();
  });
});

describe.skipIf(process.platform !== "win32")("the real helper", () => {
  it("AC-591 on a Windows that is not 7, with a window that is not there, the helper says NO_WINDOW and never copies", () => {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        capturePath,
        "-ProcessName",
        "NoSuchEditorProcessForThisTest",
        "-AssumeWindowsVersion",
        "10.0",
        "-Fps",
        "1",
        "-MaxFrames",
        "1",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 60000 },
    );

    expect(result.stdout).toContain("STATUS NO_WINDOW");
    expect(result.stdout).not.toContain("SCREEN_COPY");
  });
});
