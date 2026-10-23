import { spawn } from "node:child_process";
import { join } from "node:path";
import { crc32 } from "node:zlib";

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
 * it finds the window, then loops - `PrintWindow` into a bitmap of the
 * **client area**, downscale it, encode it as a **JPEG**, write the bytes to
 * stdout each prefixed with their length as four little-endian bytes - with
 * ONE header line first (`HEADER <width> <height>`, the scaled size), so the
 * reader learns the frame's size before the frames arrive.
 *
 * Two rules this module exists to keep:
 *
 *  - **one helper** for the whole session. The frames are read off its
 *    running stdout. A helper per frame would spawn a process every frame for
 *    the whole lesson, and each of them would capture a different moment.
 *  - **only the newest frame is kept**, and **only a picture that changed**
 *    is published at all (D-88). The panel wants the editor as it is now, so
 *    a queue of older frames would show the editor as it was - and an
 *    unchanged picture costs no traffic and no app work.
 *
 * And two rules this wave added (D-112, D-113):
 *
 *  - the window is found **by rule** - the editor's process and the title -
 *    and never by a remembered handle: `MainWindowHandle` is 0 for a hidden
 *    window, and the handle changes when the editor recreates its window. The
 *    helper re-resolves it whenever the picture stops coming, and it says
 *    what is wrong instead of exiting.
 *  - a helper that has **died** is started again. One dead helper must not be
 *    dead for the rest of the lesson.
 *
 * This module imports nothing from `vscode`, so it can be driven by a test
 * without an editor - the same reason `config.ts` and `editorState.ts` keep
 * their rules out of the editor's API.
 */

/** Where the helper lives, relative to the extension's own root. */
export const CAPTURE_SCRIPT_RELATIVE_PATH = join("media", "capture.ps1");

/**
 * The JPEG quality the helper encodes with (D-87).
 *
 * Measured on the teacher's live VS Code window on 2026-10-22: PNG 115,884 B
 * (154,512 B base64), JPEG q85 116,166 B, q75 93,736 B, **q60 73,922 B**, q45
 * 63,591 B, q60 at 0.75 scale **45,091 B**. The mean luminance stays ~232 at
 * every setting, so the picture is still real content.
 */
export const CAPTURE_QUALITY = 60;

/**
 * The scale the picture is drawn at (D-87).
 *
 * The panel shows the editor's window at a fraction of its size, so the
 * picture is captured at a fraction too: at 0.75 the JPEG is 45,091 bytes
 * instead of 73,922.
 */
export const CAPTURE_SCALE = 0.75;

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
 *
 * `-Quality` and `-Scale` are the capture's own knobs (D-87): the JPEG
 * quality and the scale the picture is drawn at. They are passed here rather
 * than written into the script, so the script needs no editing to change
 * them.
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
  /** the JPEG quality */
  quality?: number;
  /** the scale the picture is drawn at */
  scale?: number;
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
  "-Quality",
  String(options.quality ?? CAPTURE_QUALITY),
  "-Scale",
  String(options.scale ?? CAPTURE_SCALE),
  "-MaxFrames",
  "0",
];

/** The size of a frame, in its own pixels. */
export interface CaptureSize {
  width: number;
  height: number;
}

/**
 * The text a STATUS carries.
 *
 * The helper's stdout is a LINE until the header has arrived, and FRAMES
 * after it. A status that comes later therefore travels as a frame whose
 * bytes are text - and a JPEG never begins with "STATUS " or with "HEADER ",
 * so the reader can always tell a picture from a message.
 */
const STATUS_PREFIX = "STATUS ";

/** The text a HEADER carries. */
const HEADER_PREFIX = "HEADER ";

/**
 * The reason the panel is told, for each thing the helper can say.
 *
 * Every one of them is a **fact about this moment**, and the panel has to be
 * able to SAY it (D-75). "The window is not visible" and "there is no window"
 * are different facts, and neither of them is "broken" (D-113).
 */
export const captureReason = (line: string): string | null => {
  const text = line.replace(/^STATUS\s+/i, "").trim();

  if (!text) {
    return null;
  }

  if (text.startsWith("NO_WINDOW")) {
    return "no editor window was found to capture";
  }

  if (text.startsWith("WINDOW_NOT_VISIBLE")) {
    // the window is THERE, but it is not on screen: the teacher can bring it
    // back, and the panel says so (D-113)
    return "VS Code's window is not visible - click on it";
  }

  if (text.startsWith("BAD_RECT")) {
    return "the editor window has no size to capture";
  }

  if (text.startsWith("NO_PICTURE")) {
    // the window is on screen, but it draws nothing: a black rectangle is
    // not a live view, so the helper says this instead of publishing it
    return "VS Code's window is not showing a picture - click on it";
  }

  if (text.startsWith("SHOT_FAILED")) {
    return "the editor window could not be drawn";
  }

  // anything else is said as it is
  return text;
};

export interface CaptureReaderOptions {
  /** a frame arrived */
  onFrame: (bytes: Buffer) => void;
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
 * little-endian bytes. The bytes are a **JPEG** (D-87); the prefix is
 * exactly as it was.
 *
 * And after the header, a **status** may travel as a frame whose bytes are
 * text (D-112, D-113): the helper has to be able to say "the window is not
 * visible" in the middle of the session, and a picture is the only thing the
 * stream carries otherwise.
 */
export const createCaptureReader = (options: CaptureReaderOptions) => {
  let buffer: Buffer = Buffer.alloc(0);
  let headerRead = false;
  let size: CaptureSize | null = null;

  /**
   * The lines, before the header has arrived.
   *
   * The helper says what is wrong as a line while it waits for the window,
   * and the header ends the line phase: after it, the stream is frames.
   */
  const readLines = () => {
    for (;;) {
      const newline = buffer.indexOf(0x0a);

      if (newline === -1) {
        return;
      }

      const line = buffer.subarray(0, newline).toString("utf8").trim();
      buffer = buffer.subarray(newline + 1);

      const match = line.match(/^HEADER\s+(\d+)\s+(\d+)$/);

      if (!match) {
        if (line) {
          options.onLine?.(line);
        }
        continue;
      }

      headerRead = true;
      size = { width: Number(match[1]), height: Number(match[2]) };
      options.onHeader?.(size);

      // the rest of the buffer is frames
      return;
    }
  };

  const readFrames = () => {
    // Only the NEWEST frame is handed over. The panel wants the editor as it
    // is NOW, and a queue of older frames would show the editor as it was -
    // so the frames that arrive together are dropped rather than queued.
    let newest: Buffer | null = null;
    const lines: string[] = [];

    for (;;) {
      if (buffer.length < 4) {
        break;
      }

      const length = buffer.readUInt32LE(0);

      if (buffer.length < 4 + length) {
        break;
      }

      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);

      // a picture starts with 0xFF, and text starts with a byte below 0x80
      const text =
        payload.length > 0 && payload[0] < 0x80
          ? payload.toString("utf8")
          : null;

      if (text !== null && text.startsWith(STATUS_PREFIX)) {
        // the helper is saying what is wrong, in the middle of the session
        lines.push(text);
        continue;
      }

      if (text !== null && text.startsWith(HEADER_PREFIX)) {
        // the window was recreated and it is another size: the reader is told
        // again, in the shape it already knows
        const match = text.match(/^HEADER\s+(\d+)\s+(\d+)$/);

        if (match) {
          size = { width: Number(match[1]), height: Number(match[2]) };
          options.onHeader?.(size);
        }
        continue;
      }

      newest = payload;
    }

    for (const line of lines) {
      options.onLine?.(line);
    }

    if (newest) {
      options.onFrame(newest);
    }
  };

  return {
    push: (chunk: Buffer) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;

      if (!headerRead) {
        readLines();
      }

      if (headerRead) {
        readFrames();
      }
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

/** One frame of the editor's window, ready for the stream. */
export interface CaptureFrame {
  /**
   * The JPEG bytes, exactly as the helper wrote them.
   *
   * They stay **bytes**: the picture goes to the MJPEG stream and to nothing
   * else (D-85), so it never becomes base64 and never becomes text.
   */
  bytes: Buffer;
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
  /**
   * The helper has EXITED.
   *
   * The exit is an **event**, not the end of the capture: a helper that died
   * is started again, because one dead helper must not be dead for the rest
   * of the session (D-112).
   */
  onExit?: (code: number | null) => void;
}

export interface WindowCapture {
  /** stop the capture */
  stop: () => void;
  /** how many frames the capture has read */
  frameCount: () => number;
  /** is the helper still running? */
  isRunning: () => boolean;
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
  let exited = false;
  /** the CRC of the last PUBLISHED frame: an unchanged picture is skipped */
  let lastChecksum: number | null = null;
  /** the reason that was last reported: a NEW reason is always reported */
  let reported: string | null = null;

  const reportUnavailable = (reason: string) => {
    if (stopped || reported === reason) {
      return;
    }
    reported = reason;
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
    return {
      stop: () => undefined,
      frameCount: () => 0,
      isRunning: () => false,
    };
  }

  let width = 0;
  let height = 0;

  const reader = createCaptureReader({
    onHeader: (size) => {
      width = size.width;
      height = size.height;
    },
    onLine: (line) => {
      // every line the helper says is a FACT, and the panel has to be able
      // to say it (D-75): "the window is not visible" is not "there is no
      // window", and neither of them is "broken" (D-113)
      const reason = captureReason(line);

      if (reason) {
        reportUnavailable(reason);
      }
    },
    onFrame: (bytes) => {
      // a frame means the capture IS working: a later failure may be reported
      reported = null;

      // The change detection is HERE, in the extension, and not in the helper
      // (D-88). The helper's JPEG encoding is deterministic, so an unchanged
      // editor produces byte-identical JPEG - and `zlib.crc32` (a Node
      // builtin, Node 20.15 and later: the extension's manifest asks for
      // VS Code 1.91, which ships it) catches that without the helper
      // reading its own pixels back. An unchanged picture is NOT published
      // again, so a static editor costs no traffic and no app work at all.
      const checksum = crc32(bytes);

      if (checksum === lastChecksum) {
        return;
      }

      lastChecksum = checksum;
      seq += 1;
      options.onFrame({
        bytes,
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

    exited = true;

    // The exit is an EVENT the extension acts on: a helper that died is
    // started again (D-112). It is not the end of the capture.
    options.onExit?.(code);

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
    isRunning: () => !stopped && !exited,
  };
};

/**
 * How long the extension waits before it starts a helper that died again.
 *
 * Long enough that a helper which dies at once (a script that cannot run, a
 * machine that is busy) does not become a loop, and short enough that the
 * teacher does not notice the gap.
 */
export const CAPTURE_RESTART_DELAY_MS = 1000;

export interface WindowCaptureSupervisorOptions extends WindowCaptureOptions {
  /** how long to wait before a helper that died is started again */
  restartDelayMs?: number;
}

export interface WindowCaptureSupervisor {
  /** make sure a helper is running */
  ensureRunning: () => void;
  /** stop the capture, for good */
  stop: () => void;
  /** is a helper running right now? */
  isRunning: () => boolean;
  /** how many helpers have been started */
  startCount: () => number;
}

/**
 * The capture, and the rule that keeps it alive (D-112).
 *
 * The capture is still **ONE helper** for the session (D-73): a helper per
 * frame would spawn a process every frame for the whole lesson. But a helper
 * that has **died** is not the session - it is one process that stopped - so
 * it is started again, and the gap is a moment rather than the rest of the
 * lesson. That is what the owner's "it works exactly twice and then stops"
 * was: one dead helper, dead for the rest of the session.
 *
 * `ensureRunning` is what the extension calls when a client connects: a
 * client that arrives into a session whose helper had died gets a capture
 * again, without anybody having to refocus anything.
 *
 * This module imports nothing from `vscode`, so the rule can be driven by a
 * test without an editor.
 */
export const createWindowCaptureSupervisor = (
  options: WindowCaptureSupervisorOptions,
): WindowCaptureSupervisor => {
  const restartDelayMs = options.restartDelayMs ?? CAPTURE_RESTART_DELAY_MS;

  let capture: WindowCapture | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let starts = 0;

  const start = () => {
    if (stopped) {
      return;
    }

    if (capture && capture.isRunning()) {
      return;
    }

    capture = createWindowCapture({
      ...options,
      onExit: (code) => {
        // the helper is gone: the capture is not over
        capture = null;
        options.onExit?.(code);

        if (stopped || timer) {
          return;
        }

        // a helper that died is started again - ONE dead helper must not be
        // dead for the rest of the session (D-112)
        timer = setTimeout(() => {
          timer = null;
          start();
        }, restartDelayMs);

        timer.unref?.();
      },
    });

    starts += 1;
  };

  return {
    ensureRunning: () => {
      start();
    },
    stop: () => {
      stopped = true;

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      capture?.stop();
      capture = null;
    },
    isRunning: () => Boolean(capture?.isRunning()),
    startCount: () => starts,
  };
};
