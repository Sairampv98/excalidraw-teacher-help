import { spawn } from "node:child_process";
import { join } from "node:path";

import { DEFAULT_CAPTURE_FPS } from "./config";

/**
 * The capture of the editor's **own window**.
 *
 * The owner asked for the actual VS Code window on the canvas, not a
 * reconstruction of its text. The extension API cannot do that - there is no
 * screenshot facility in it (D-80) - but the editor process is not the only
 * way out of the editor (D-82).
 *
 * **Why a PowerShell helper and not ffmpeg.** Both were measured on this
 * machine, against a real VS Code and a real VSCodium window:
 *
 *  - `ffmpeg`'s `gdigrab` device, asked for a window by its handle
 *    (`-i hwnd=0x...`), returns a **BLACK RECTANGLE** for VS Code and for
 *    VSCodium (YAVG 16.0, against 173.2 for an ordinary GDI window such as
 *    Notepad). They are Electron apps: they render through DirectComposition,
 *    and gdigrab's window mode BitBlts from the window's own device context,
 *    which does not hold the GPU-composited surface. The earlier "proof" on
 *    this machine used Notepad, so it never exercised the case that matters.
 *  - A **screen** capture shows only what is VISIBLE, so an editor that is
 *    behind the browser shows the browser (YAVG 142.7, against 219.5 for the
 *    same editor in the foreground).
 *  - `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)` asks the window to render
 *    **itself** into a device context. It understands DirectComposition, and
 *    it draws the editor even when something is on top of it: YAVG 219.8 in
 *    the foreground and YAVG 219.8 while a topmost Chrome window covers it -
 *    the editor, not the occluder. The raw capture costs about 12 ms a frame.
 *
 * So the helper is a **PowerShell script that ships inside the extension**:
 * it finds the window, then loops - `PrintWindow` into a bitmap, encode PNG,
 * write the bytes to stdout each prefixed with their length as four
 * little-endian bytes - with ONE header line first (`HEADER <width>
 * <height>`), so the reader learns the frame's size before the frames arrive.
 *
 * Two rules this module exists to keep:
 *
 *  - **one helper** for the whole session. The frames are read off its
 *    running stdout. A helper per frame would spawn a process every frame for
 *    the whole lesson, and each of them would capture a different moment.
 *  - **only the newest frame is kept**. The panel wants the editor as it is
 *    now; a queue of older frames would show the editor as it was.
 *
 * This module imports nothing from `vscode`, so it can be driven by a test
 * without an editor - the same reason `config.ts` and `editorState.ts` keep
 * their rules out of the editor's API.
 */

/** Where the helper lives, relative to the extension's own root. */
export const CAPTURE_SCRIPT_RELATIVE_PATH = join("media", "capture.ps1");

/** The part of `child_process.ChildProcess` the capture uses. */
export interface CaptureProcess {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "exit",
    listener: (code: number | null, signal: string | null) => void,
  ): this;
  kill(signal?: string | number): boolean;
}

/** The options the helper is spawned with. */
export interface CaptureSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** do not let a console window flash on Windows */
  windowsHide?: boolean;
}

export type CaptureSpawn = (
  command: string,
  args: string[],
  options: CaptureSpawnOptions,
) => CaptureProcess;

const defaultSpawn: CaptureSpawn = (command, args, options) =>
  spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: options.windowsHide,
  });

/**
 * The OS process name of the editor.
 *
 * The editor's name and its process's name are not the same: VS Code calls
 * itself "Visual Studio Code" and runs as `Code`, while VSCodium calls itself
 * "VSCodium" and runs as `VSCodium`. The capture asks the OS for a **process**
 * by name, so the name has to be the process's.
 */
export const editorProcessName = (appName?: string | null): string => {
  const trimmed = appName?.trim();

  if (!trimmed) {
    return "Code";
  }

  const withoutPrefix = trimmed.replace(/^Visual Studio\s+/i, "");

  return withoutPrefix || "Code";
};

/**
 * The arguments the helper is run with.
 *
 * `-MaxFrames 0` means "until the extension kills the helper": the capture
 * lasts as long as the session does.
 */
export const captureArgs = (options: {
  /** the helper's path */
  scriptPath: string;
  /** the OS process name of the editor: "Code", "VSCodium" */
  processName: string;
  /** the workspace folder's name, as it appears in the window's title */
  titleLike: string;
  /** how many frames a second */
  fps: number;
}): string[] => [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  options.scriptPath,
  "-ProcessName",
  options.processName,
  "-TitleLike",
  options.titleLike,
  "-Fps",
  String(options.fps),
  "-MaxFrames",
  "0",
];

/** The size of a frame, in its own pixels. */
export interface CaptureSize {
  width: number;
  height: number;
}

export interface CaptureReaderOptions {
  /** a frame arrived */
  onFrame: (png: Buffer) => void;
  /** the helper's header line carried the size */
  onHeader?: (size: CaptureSize) => void;
  /** the helper's first line was not a header: it says what went wrong */
  onLine?: (line: string) => void;
}

/**
 * The reader of the helper's stdout.
 *
 * The stream is: ONE text line (the header, or the reason there is no
 * window), and then the frames - each one prefixed with its length as four
 * little-endian bytes.
 */
export const createCaptureReader = (options: CaptureReaderOptions) => {
  let buffer: Buffer = Buffer.alloc(0);
  let headerRead = false;
  let size: CaptureSize | null = null;

  const readFrames = () => {
    // Only the NEWEST frame is handed over. The panel wants the editor as it
    // is NOW, and a queue of older frames would show the editor as it was -
    // so the frames that arrive together are dropped rather than queued.
    let newest: Buffer | null = null;

    for (;;) {
      if (buffer.length < 4) {
        break;
      }

      const length = buffer.readUInt32LE(0);

      if (buffer.length < 4 + length) {
        break;
      }

      newest = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
    }

    if (newest) {
      options.onFrame(newest);
    }
  };

  return {
    push: (chunk: Buffer) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;

      if (!headerRead) {
        const newline = buffer.indexOf(0x0a);

        if (newline === -1) {
          return;
        }

        const line = buffer.subarray(0, newline).toString("utf8").trim();
        buffer = buffer.subarray(newline + 1);
        headerRead = true;

        const match = line.match(/^HEADER\s+(\d+)\s+(\d+)$/);

        if (match) {
          size = { width: Number(match[1]), height: Number(match[2]) };
          options.onHeader?.(size);
        } else {
          options.onLine?.(line);
        }
      }

      readFrames();
    },
    /** the size the helper's header line carried, once it has arrived */
    get size(): CaptureSize | null {
      return size;
    },
    /** has the header line been read? */
    get headerRead(): boolean {
      return headerRead;
    },
  };
};

/** One frame of the editor's window, ready for the wire. */
export interface CaptureFrame {
  /** the PNG, base64-encoded */
  data: string;
  /** the frame's own width, in pixels */
  width: number;
  /** the frame's own height, in pixels */
  height: number;
  /** the frame's number: 1, 2, 3 ... */
  seq: number;
}

export interface WindowCaptureOptions {
  /** the helper's path */
  scriptPath: string;
  /** the OS process name of the editor: "Code", "VSCodium" */
  processName: string;
  /** the workspace folder's name, as it appears in the window's title */
  titleLike: string;
  /** how many frames a second */
  fps?: number;
  /** overridable for the tests */
  spawn?: CaptureSpawn;
  /** a frame arrived */
  onFrame: (frame: CaptureFrame) => void;
  /** the capture cannot run, and this is why */
  onUnavailable?: (reason: string) => void;
}

export interface WindowCapture {
  /** stop the capture */
  stop: () => void;
  /** how many frames the capture has read */
  frameCount: () => number;
}

/**
 * The capture: one helper, and the frames that come out of it.
 *
 * The helper is a **Windows** program (PowerShell, and `PrintWindow`), so the
 * capture is a Windows feature. Anywhere else the extension says so, and the
 * panel falls back to the text.
 */
export const createWindowCapture = (
  options: WindowCaptureOptions,
): WindowCapture => {
  const spawnImpl = options.spawn ?? defaultSpawn;
  const fps = options.fps ?? DEFAULT_CAPTURE_FPS;

  let seq = 0;
  let stopped = false;
  let reported = false;

  const reportUnavailable = (reason: string) => {
    if (stopped || reported) {
      return;
    }
    reported = true;
    options.onUnavailable?.(reason);
  };

  let child: CaptureProcess;

  try {
    child = spawnImpl(
      "powershell.exe",
      captureArgs({
        scriptPath: options.scriptPath,
        processName: options.processName,
        titleLike: options.titleLike,
        fps,
      }),
      { windowsHide: true },
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    reportUnavailable(`the capture helper could not be started: ${text}`);
    return { stop: () => undefined, frameCount: () => 0 };
  }

  let width = 0;
  let height = 0;

  const reader = createCaptureReader({
    onHeader: (size) => {
      width = size.width;
      height = size.height;
    },
    onLine: (line) => {
      if (line.startsWith("NO_WINDOW")) {
        reportUnavailable("no editor window was found to capture");
        return;
      }
      if (line === "BAD_RECT") {
        reportUnavailable("the editor window has no size to capture");
        return;
      }
      if (line.startsWith("SHOT_FAILED")) {
        reportUnavailable("the editor window could not be drawn");
        return;
      }
      if (line) {
        reportUnavailable(line);
      }
    },
    onFrame: (png) => {
      // a frame means the capture IS working: a later failure may be reported
      reported = false;
      seq += 1;

      options.onFrame({
        data: png.toString("base64"),
        width,
        height,
        seq,
      });
    },
  });

  child.stdout?.on("data", (chunk: Buffer | string) => {
    reader.push(
      typeof chunk === "string" ? Buffer.from(chunk, "binary") : chunk,
    );
  });

  child.on("error", (error: Error) => {
    reportUnavailable(`the capture helper could not be run: ${error.message}`);
  });

  child.on("exit", (code: number | null) => {
    if (stopped) {
      return;
    }
    reportUnavailable(
      `the capture stopped: the helper exited with code ${code ?? "unknown"}`,
    );
  });

  return {
    stop: () => {
      stopped = true;
      try {
        child.kill();
      } catch {
        // already gone
      }
    },
    frameCount: () => seq,
  };
};
