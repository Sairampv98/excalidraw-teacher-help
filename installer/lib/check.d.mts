/**
 * The types of `installer/lib/check.mjs`.
 *
 * The module is plain ESM with no build step and no dependency of its own, so
 * it can be read by any Node. TypeScript needs the shape of it, though, and
 * it takes it from here.
 */

/** An editor as the scripts found it. */
export interface FoundEditor {
  cli: string | null;
  path: string | null;
  installed: boolean;
}

/** Everything the setup knows about a machine. */
export interface Found {
  nodeVersion: string | null;
  yarnVersion: string | null;
  corepackVersion: string | null;
  vscode: FoundEditor;
  vscodium: FoundEditor;
  extensionBuilt: boolean;
  dependenciesInstalled: boolean;
  runtimes: { node: boolean; python: boolean; java: boolean };
  winget: boolean;
  /**
   * The script can download and run the official installer itself, so it does
   * not need a package manager to install anything.
   */
  directInstall: boolean;
}

/** One thing the setup checks. */
export interface Check {
  id: string;
  label: string;
  present: boolean;
  detail: string;
  reason: string | null;
}

/** One thing the setup would install. */
export interface Action {
  id: string;
  label: string;
  detail: string;
  automatic: boolean;
  instruction: string | null;
}

/** The last line of the report. */
export interface Summary {
  total: number;
  present: number;
  missing: number;
  actions: number;
  text: string;
}

/** The report: what is present, what is missing, what would be installed. */
export interface Report {
  checks: Check[];
  present: string[];
  missing: string[];
  actions: Action[];
  summary: Summary;
  lines: string[];
}

/** A question the setup asks before it installs anything. */
export interface Question {
  id: string;
  text: string;
  default: boolean;
}

/** The plan: what to do with the things that are missing. */
export interface Plan {
  mode: "dry-run" | "ask" | "auto";
  planned: Action[];
  willInstall: Action[];
  questions: Question[];
}

export const NODE_MINIMUM: number;

export const CHECKS: { id: string; label: string }[];

export const ACTION_IDS: string[];

export const EXTENSION_FILE: string;

export function majorVersion(version: string | null | undefined): number | null;

export function buildReport(found: Found): Report;

export function formatReport(report: Report): string[];

export function planInstalls(
  report: Report,
  options?: { dryRun?: boolean; assumeYes?: boolean },
): Plan;

export function answerIsYes(
  question: Question,
  answer: string | null | undefined,
): boolean;
