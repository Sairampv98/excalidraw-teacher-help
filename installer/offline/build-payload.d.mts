/**
 * The types of `installer/offline/build-payload.mjs`.
 *
 * The module is plain ESM with no build step and no dependency of its own, so
 * it can be read by any Node. TypeScript needs the shape of it, though, and
 * it takes it from here.
 */

/** One file of the payload. */
export interface PayloadEntry {
  role: string;
  name: string;
  version: string;
  sha256: string;
  size: number;
  source: string | null;
}

/** The manifest: what the payload carries, with each file's hash and version. */
export interface Manifest {
  schema: number;
  generatedAt: string;
  arch: string;
  bridgeUrl: string;
  files: PayloadEntry[];
}

/** A file on its way into the payload. */
export interface ManifestFile {
  role: string;
  name: string;
  version: string;
  /** where the file is, so the hash and the size are read from it */
  path: string;
  source?: string | null;
}

export const DEFAULT_BRIDGE_URL: string;

export const MANIFEST_NAME: string;

export function sha256File(path: string): string;

export function machineArch(): "x64" | "arm64";

export function buildManifest(options: {
  arch: string;
  bridgeUrl: string;
  files: ManifestFile[];
}): Manifest;

export function readManifest(dir: string): Manifest | null;

export function writeManifest(dir: string, manifest: Manifest): void;

export function refreshManifest(
  dir: string,
  arch: string,
  bridgeUrl: string,
): Manifest;

export function zipFolder(folder: string, zipPath: string): string;
