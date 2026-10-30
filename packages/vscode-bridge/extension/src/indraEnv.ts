import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The **private Python environment** of the indra OCR engine (D-353).
 *
 * indra is a Python package and Python packages cannot ride in a `.vsix`: they
 * are tied to the interpreter's version and to the machine's platform, and the
 * set it needs (an inference runtime, an image library, a PDF library) is more
 * than a hundred megabytes. What the extension can do is make the install
 * **one choice**: it makes a virtual environment of its own, in the editor's
 * storage for the extension, and installs the package there. The teacher's own
 * Python is never touched, and the sidecar runs in the environment from then
 * on.
 *
 * When wheels ship with the extension (`wheels/` beside it) they are used and
 * the install needs no internet - the same payload the offline setup carries.
 */

/** the package that is installed */
export const INDRA_PACKAGE = "indra-ocr";

/** the engine's own words when it is not there (the sidecar's report) */
export const isIndraMissing = (message: string): boolean =>
  /indra-ocr is not installed/i.test(message);

/** the environment's folder, in the extension's own storage */
export const indraEnvDir = (storageDir: string): string =>
  join(storageDir, "indra-env");

/** the environment's interpreter */
export const indraEnvPython = (
  storageDir: string,
  platform: string = process.platform,
): string =>
  platform === "win32"
    ? join(indraEnvDir(storageDir), "Scripts", "python.exe")
    : join(indraEnvDir(storageDir), "bin", "python");

/** the folder of wheels that may ship with the extension */
export const wheelhouseOf = (extensionDir: string): string =>
  join(extensionDir, "wheels");

/**
 * The interpreter the sidecar runs in: the private environment once it has
 * been made, and the teacher's configured Python until then.
 */
export const pythonForSidecar = ({
  configured,
  storageDir,
  exists = existsSync,
}: {
  configured: string;
  storageDir: string;
  exists?: (path: string) => boolean;
}): string => {
  const own = indraEnvPython(storageDir);

  return exists(own) ? own : configured;
};

/** one step of the install: a program, its arguments, and what it said */
export type InstallStep = (
  command: string,
  args: string[],
) => Promise<{ code: number | null; output: string }>;

/** runs a program to its end, with its output kept */
export const runInstallStep: InstallStep = (command, args) =>
  new Promise((resolve) => {
    let output = "";

    try {
      const child = spawn(command, args, { windowsHide: true });

      child.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        resolve({ code: null, output: `${output}${error.message}` });
      });
      child.on("exit", (code) => {
        resolve({ code, output });
      });
    } catch (error) {
      resolve({ code: null, output: (error as Error).message });
    }
  });

/** the last line a program said: what the teacher is told when it failed */
const lastLineOf = (output: string): string => {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[lines.length - 1] ?? "it said nothing";
};

/** whether a folder holds wheels */
const hasWheels = (folder: string): boolean => {
  try {
    return readdirSync(folder).some((name) => name.endsWith(".whl"));
  } catch {
    return false;
  }
};

/**
 * Makes the environment and installs indra in it.
 *
 * Every failure is a **sentence**: which step it was, and what the program
 * said last - never a silence (D-91).
 */
export const installIndra = async ({
  basePython,
  storageDir,
  extensionDir,
  run = runInstallStep,
  exists = existsSync,
  wheelsShip = hasWheels,
}: {
  /** the Python the environment is made with */
  basePython: string;
  storageDir: string;
  extensionDir: string;
  run?: InstallStep;
  exists?: (path: string) => boolean;
  wheelsShip?: (folder: string) => boolean;
}): Promise<{ ok: boolean; python?: string; message: string }> => {
  const python = indraEnvPython(storageDir);

  if (!exists(python)) {
    const made = await run(basePython, ["-m", "venv", indraEnvDir(storageDir)]);

    if (made.code !== 0) {
      return {
        ok: false,
        message: `${basePython} could not make the environment: ${lastLineOf(
          made.output,
        )}. Set excalidraw-bridge.pythonPath to a Python 3.10 or newer.`,
      };
    }
  }

  const wheels = wheelhouseOf(extensionDir);
  const offline = wheelsShip(wheels);

  const installed = await run(python, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    ...(offline ? ["--no-index", "--find-links", wheels] : []),
    INDRA_PACKAGE,
  ]);

  if (installed.code !== 0) {
    return {
      ok: false,
      message: `pip could not install ${INDRA_PACKAGE}: ${lastLineOf(
        installed.output,
      )}`,
    };
  }

  return {
    ok: true,
    python,
    message: `${INDRA_PACKAGE} is installed${
      offline ? " from the wheels that ship with the extension" : ""
    }`,
  };
};
