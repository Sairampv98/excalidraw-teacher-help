/**
 * The capture of the editor's **own window** (D-82).
 *
 * The rows named in the test titles are the rows of SPEC.md — the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { resolveCaptureFps } from "../extension/src/config";
import {
  CAPTURE_SCRIPT_RELATIVE_PATH,
  captureArgs,
  createWindowCapture,
  editorProcessName,
  type CaptureFrame,
  type CaptureProcess,
  type CaptureSpawn,
} from "../extension/src/windowCapture";

/**
 * A PNG of the given size.
 *
 * The bytes are the ones the standard describes: the signature, then an IHDR
 * chunk that carries the width and the height.
 */
const pngBytes = (width: number, height: number, marker = 0): Buffer => {
  const header = Buffer.alloc(13);

  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR", "ascii"),
    header,
    Buffer.from([0x08, 0x06, 0x00, 0x00, 0x00]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    // a marker, so that two frames are never the same bytes
    Buffer.from([marker]),
  ]);
};

/** A frame the way the helper writes it: the length, then the bytes. */
const lengthPrefixed = (png: Buffer): Buffer =>
  Buffer.concat([
    (() => {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(png.length, 0);
      return length;
    })(),
    png,
  ]);

/** The helper, standing in for the real one. */
class FakeHelper implements CaptureProcess {
  /** the frames come out of here */
  readonly stream = new PassThrough();

  stdout: NodeJS.ReadableStream | null = this.stream;
  stderr: NodeJS.ReadableStream | null = null;

  killed = false;

  private listeners = new Map<string, ((...args: any[]) => void)[]>();

  on(event: string, listener: (...args: any[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

/** Waits for a condition - the frames arrive on the next tick. */
const until = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the condition was not met in time");
};

/** The package root, found by walking up from the working directory. */
const findPackageRoot = (): string => {
  let current = process.cwd();

  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "packages", "vscode-bridge");

    if (existsSync(join(candidate, "extension", "package.json"))) {
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

describe("the capture of the editor's own window", () => {
  it("AC-101 the extension reads the frames of its own window from one running helper", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const helper = new FakeHelper();
    const frames: CaptureFrame[] = [];

    const spawn: CaptureSpawn = (command, args) => {
      calls.push({ command, args });
      return helper;
    };

    createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "Code",
      titleLike: "excalidraw",
      spawn,
      onFrame: (frame) => {
        frames.push(frame);
      },
    });

    // ONE helper is started, and it is the helper that ships with the
    // extension
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("powershell.exe");
    expect(
      calls[0].args.some((argument) => argument.endsWith("capture.ps1")),
    ).toBe(true);
    expect(calls[0].args).toContain("-ProcessName");
    expect(calls[0].args).toContain("Code");

    // the helper says the size of the window first, and then the frames
    helper.stream.write(Buffer.from("HEADER 1295 687\r\n", "ascii"));

    const picture = pngBytes(1295, 687);

    helper.stream.write(lengthPrefixed(picture));

    await until(() => frames.length === 1);

    // the frame's OWN size, from the helper's header: the picture has to keep
    // the aspect ratio it has in the editor, and the editor's size is not the
    // panel's size on the canvas (D-82)
    expect(frames[0].width).toBe(1295);
    expect(frames[0].height).toBe(687);
    expect(frames[0].data).toBe(picture.toString("base64"));
    expect(frames[0].seq).toBe(1);

    // the next frame is numbered
    helper.stream.write(lengthPrefixed(pngBytes(1295, 687)));

    await until(() => frames.length === 2);

    expect(frames[1].seq).toBe(2);
  });

  it("AC-104 the capture is one helper, not one per frame", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const helper = new FakeHelper();
    const frames: CaptureFrame[] = [];

    const capture = createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "VSCodium",
      titleLike: "NITTE",
      spawn: (command, args) => {
        calls.push({ command, args });
        return helper;
      },
      onFrame: (frame) => {
        frames.push(frame);
      },
    });

    helper.stream.write(Buffer.from("HEADER 800 600\r\n", "ascii"));

    // five frames arrive
    for (let index = 0; index < 5; index++) {
      helper.stream.write(lengthPrefixed(pngBytes(800, 600)));
    }

    await until(() => frames.length >= 1);

    // ONE helper for all of them. A helper per frame would spawn a process
    // every frame for the whole lesson, and each of them would capture a
    // different moment (D-82).
    expect(calls).toHaveLength(1);
    expect(capture.frameCount()).toBeGreaterThanOrEqual(1);

    // the helper is still the one that was started
    expect(helper.killed).toBe(false);

    capture.stop();

    expect(helper.killed).toBe(true);
  });

  it("AC-104 only the newest frame is kept: the frames are dropped, not queued", async () => {
    const helper = new FakeHelper();
    const frames: CaptureFrame[] = [];

    createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "Code",
      titleLike: "excalidraw",
      spawn: () => helper,
      onFrame: (frame) => {
        frames.push(frame);
      },
    });

    helper.stream.write(Buffer.from("HEADER 800 600\r\n", "ascii"));

    // three frames in ONE read: only the newest is handed over. The panel
    // wants the editor as it is NOW, and a queue of older frames would show
    // the editor as it was (D-82).
    const first = pngBytes(800, 600, 1);
    const second = pngBytes(800, 600, 2);
    const third = pngBytes(800, 600, 3);

    helper.stream.write(
      Buffer.concat([
        lengthPrefixed(first),
        lengthPrefixed(second),
        lengthPrefixed(third),
      ]),
    );

    await until(() => frames.length >= 1);

    expect(frames).toHaveLength(1);
    expect(frames[0].data).toBe(third.toString("base64"));
  });

  it("AC-105 the extension finds its own window", () => {
    // The OS process name is not the editor's name: VS Code calls itself
    // "Visual Studio Code" and runs as `Code`, and VSCodium calls itself
    // "VSCodium" and runs as `VSCodium`.
    expect(editorProcessName("Visual Studio Code")).toBe("Code");
    expect(editorProcessName("VSCodium")).toBe("VSCodium");
    expect(editorProcessName("Visual Studio Code - Insiders")).toBe(
      "Code - Insiders",
    );
    expect(editorProcessName(undefined)).toBe("Code");
    expect(editorProcessName("")).toBe("Code");

    // the window is picked by the workspace folder's name in its title, and
    // the helper falls back to that process's first main window
    const args = captureArgs({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "VSCodium",
      titleLike: "NITTE",
      fps: 6,
    });

    expect(args).toContain("-ProcessName");
    expect(args[args.indexOf("-ProcessName") + 1]).toBe("VSCodium");
    expect(args).toContain("-TitleLike");
    expect(args[args.indexOf("-TitleLike") + 1]).toBe("NITTE");

    // and the helper runs for as long as the session does
    expect(args[args.indexOf("-MaxFrames") + 1]).toBe("0");
  });

  it("AC-105 the capture is configurable", () => {
    // the frame rate is a setting, and a number that makes no sense falls
    // back to the default instead of to something that would hammer the
    // machine
    expect(resolveCaptureFps(8)).toBe(8);
    expect(resolveCaptureFps(1)).toBe(1);
    expect(resolveCaptureFps(undefined)).toBe(6);
    expect(resolveCaptureFps(0)).toBe(6);
    expect(resolveCaptureFps(-4)).toBe(6);
    expect(resolveCaptureFps(9999)).toBe(6);

    // the helper SHIPS inside the extension, so there is nothing to install
    // and no dependency to add
    expect(CAPTURE_SCRIPT_RELATIVE_PATH).toContain("capture.ps1");

    const packageRoot = findPackageRoot();

    expect(
      existsSync(join(packageRoot, "extension", "media", "capture.ps1")),
    ).toBe(true);

    // the helper draws the window ITSELF: PrintWindow with
    // PW_RENDERFULLCONTENT understands DirectComposition, and it draws the
    // editor even when something is on top of it. A screen capture would show
    // the thing on top, and ffmpeg's gdigrab draws an Electron window black.
    const script = readFileSync(
      join(packageRoot, "extension", "media", "capture.ps1"),
      "utf8",
    );

    expect(script).toContain("PrintWindow");
    expect(script).toContain("HEADER ");
    expect(script).toContain("GetBytes([int]$bytes.Length)");

    // and the extension's manifest carries the setting ...
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "extension", "package.json"), "utf8"),
    );

    expect(
      manifest.contributes.configuration.properties[
        "excalidraw-bridge.captureFps"
      ],
    ).toBeTruthy();

    // ... and the extension still has no dependency of its own (AC-64)
    expect(manifest.dependencies).toBeUndefined();
  });

  it("AC-103 the capture says why it cannot run", async () => {
    const helper = new FakeHelper();
    const reasons: string[] = [];

    createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "Code",
      titleLike: "excalidraw",
      spawn: () => helper,
      onFrame: () => undefined,
      onUnavailable: (reason) => {
        reasons.push(reason);
      },
    });

    // there is no window of that name
    helper.stream.write(Buffer.from("NO_WINDOW Code\r\n", "ascii"));

    await until(() => reasons.length > 0);

    expect(reasons[0]).toContain("no editor window");

    // and the helper dying is said too, not swallowed
    const dying = new FakeHelper();

    createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "Code",
      titleLike: "excalidraw",
      spawn: () => dying,
      onFrame: () => undefined,
      onUnavailable: (reason) => {
        reasons.push(reason);
      },
    });

    dying.emit("exit", 2, null);

    await until(() => reasons.length > 1);

    expect(reasons[1]).toContain("capture stopped");
  });
});
