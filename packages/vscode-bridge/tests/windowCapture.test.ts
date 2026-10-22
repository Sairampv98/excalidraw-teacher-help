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
  CAPTURE_QUALITY,
  CAPTURE_SCALE,
  CAPTURE_SCRIPT_RELATIVE_PATH,
  captureArgs,
  createWindowCapture,
  editorProcessName,
  type CaptureFrame,
  type CaptureProcess,
  type CaptureSpawn,
} from "../extension/src/windowCapture";

/**
 * A JPEG of the given size.
 *
 * The bytes are the ones a JPEG starts with: the SOI marker, then a frame
 * header that carries the width and the height.
 *
 * The extension never looks inside them - the browser decodes the picture,
 * not the app (D-85) - so a stand-in is enough.
 */
const jpegBytes = (width: number, height: number, marker = 0): Buffer => {
  const size = Buffer.alloc(4);

  size.writeUInt16BE(width, 0);
  size.writeUInt16BE(height, 2);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    size,
    // a marker, so that two frames are never the same bytes
    Buffer.from([marker]),
  ]);
};

/** A frame the way the helper writes it: the length, then the bytes. */
const lengthPrefixed = (jpeg: Buffer): Buffer =>
  Buffer.concat([
    (() => {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(jpeg.length, 0);
      return length;
    })(),
    jpeg,
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

    // the helper says the size of the picture first, and then the frames
    helper.stream.write(Buffer.from("HEADER 962 506\r\n", "ascii"));

    const picture = jpegBytes(962, 506);

    helper.stream.write(lengthPrefixed(picture));

    await until(() => frames.length === 1);

    // the frame's OWN size, from the helper's header: the picture has to keep
    // the aspect ratio it has in the editor, and the editor's size is not the
    // panel's size on the canvas (D-82)
    expect(frames[0].width).toBe(962);
    expect(frames[0].height).toBe(506);

    // the bytes are the JPEG's bytes: the picture never becomes text, and
    // never becomes a base64 blob (D-85)
    expect(frames[0].bytes).toEqual(picture);
    expect(frames[0].seq).toBe(1);

    // the next frame is numbered - and it is a DIFFERENT picture, because an
    // unchanged one is not published again (D-88)
    helper.stream.write(lengthPrefixed(jpegBytes(962, 506, 1)));

    await until(() => frames.length === 2);

    expect(frames[1].seq).toBe(2);
  });

  it("AC-120 the helper is spawned once, and its frames are read from its running stdout", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const helper = new FakeHelper();
    const frames: CaptureFrame[] = [];

    const capture = createWindowCapture({
      scriptPath: "C:/ext/media/capture.ps1",
      processName: "Code",
      titleLike: "excalidraw",
      spawn: (command, args) => {
        calls.push({ command, args });
        return helper;
      },
      onFrame: (frame) => {
        frames.push(frame);
      },
    });

    // the helper is spawned ONCE ...
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("powershell.exe");

    // ... and the frames are read off its RUNNING stdout, not from a new
    // process per frame: a helper per frame would spawn a process every
    // frame for the whole lesson, and each of them would capture a different
    // moment (D-82, D-120).
    helper.stream.write(Buffer.from("HEADER 962 506\r\n", "ascii"));

    const first = jpegBytes(962, 506, 1);
    const second = jpegBytes(962, 506, 2);

    helper.stream.write(lengthPrefixed(first));

    await until(() => frames.length === 1);

    helper.stream.write(lengthPrefixed(second));

    await until(() => frames.length === 2);

    // still ONE helper
    expect(calls).toHaveLength(1);
    expect(helper.killed).toBe(false);

    // and the bytes the extension read are the JPEG's bytes the helper wrote
    // - not a base64 copy of them
    expect(frames[0].bytes).toEqual(first);
    expect(frames[1].bytes).toEqual(second);
    expect(frames[0].bytes.toString("base64")).not.toBe(
      frames[0].bytes.toString("utf8"),
    );

    capture.stop();
  });

  it("AC-117 an unchanged picture is not published again", async () => {
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

    helper.stream.write(Buffer.from("HEADER 962 506\r\n", "ascii"));

    const picture = jpegBytes(962, 506);

    // the SAME picture, twice: the editor did not change, so the helper's
    // JPEG encoding is byte-identical, and an unchanged picture is NOT
    // published again (D-88)
    helper.stream.write(lengthPrefixed(picture));
    helper.stream.write(lengthPrefixed(picture));

    await until(() => frames.length >= 1);

    // give the second copy a chance to arrive and be skipped
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(frames).toHaveLength(1);

    // and a picture that DID change is published again
    helper.stream.write(lengthPrefixed(jpegBytes(962, 506, 9)));

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
      helper.stream.write(lengthPrefixed(jpegBytes(800, 600)));
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
    const first = jpegBytes(800, 600, 1);
    const second = jpegBytes(800, 600, 2);
    const third = jpegBytes(800, 600, 3);

    helper.stream.write(
      Buffer.concat([
        lengthPrefixed(first),
        lengthPrefixed(second),
        lengthPrefixed(third),
      ]),
    );

    await until(() => frames.length >= 1);

    expect(frames).toHaveLength(1);
    expect(frames[0].bytes).toEqual(third);
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

    // the picture's QUALITY and SCALE are the capture's own knobs (D-87)
    expect(args).toContain("-Quality");
    expect(args[args.indexOf("-Quality") + 1]).toBe("60");
    expect(args).toContain("-Scale");
    expect(args[args.indexOf("-Scale") + 1]).toBe("0.75");
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

  it("AC-116 the capture is the client area, a JPEG, and scaled", () => {
    const packageRoot = findPackageRoot();
    const script = readFileSync(
      join(packageRoot, "extension", "media", "capture.ps1"),
      "utf8",
    );

    // The FORMAT: a JPEG, not a PNG. The picture goes over the wire to the
    // MJPEG stream, so the bytes matter (D-87).
    expect(script).toContain("image/jpeg");
    expect(script).toContain("Encoder]::Quality");
    expect(script).not.toContain("ImageFormat]::Png");

    // The QUALITY: 60, and it is a parameter of the helper, so it can be
    // changed without editing the script.
    expect(script).toContain("[int]$Quality = 60");
    expect(CAPTURE_QUALITY).toBe(60);

    // The SIZE: the CLIENT area, not the window. The OS title bar and the
    // borders are not the editor, and they are not in the picture either.
    expect(script).toContain("GetClientRect");
    expect(script).toContain("ClientToScreen");
    expect(script).not.toContain("GetWindowRect");

    // and the flags are 3: PW_CLIENTONLY and PW_RENDERFULLCONTENT together.
    // RENDERFULLCONTENT is what understands DirectComposition, so the editor
    // is drawn even when something is on top of it.
    expect(script).toContain("PrintWindow(hwnd, hdc, 3)");

    // The SCALE: 0.75, and the header line reports the SCALED size - the
    // size of the picture that is written.
    expect(script).toContain("[double]$Scale = 0.75");
    expect(CAPTURE_SCALE).toBe(0.75);
    expect(script).toContain("HEADER ' + $outW + ' ' + $outH");

    // and the length prefix in front of each frame is still four
    // little-endian bytes
    expect(script).toContain("GetBytes([int]$bytes.Length)");
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
