import type { DocumentStoreBackend } from "./documentStore";

/**
 * Document instrumentation (D-10).
 *
 * The point of this module is to make the *lazy hydration* decision on
 * measured numbers instead of on a guess. It records, in a rolling window:
 *
 * - the total element count and the current page's element count
 * - the save latency (per save)
 * - the page-switch latency
 * - the page count
 * - the active storage backend
 * - the number of bytes the last save wrote
 *
 * The decision thresholds from the design are:
 *
 * | signal                  | threshold |
 * | ----------------------- | --------- |
 * | save p95 latency        | > 250 ms  |
 * | page-switch p95 latency | > 120 ms  |
 * | total elements          | > 50,000  |
 * | page count              | > 2,000   |
 *
 * The numbers are readable through {@link getDocumentStats} and, in the
 * browser console, through `window.__excalidrawDocumentStats()`.
 */

/** how many samples the rolling window keeps */
const WINDOW_SIZE = 50;

export type DocumentStats = {
  /** number of elements in the whole document */
  totalElementCount: number;
  /** number of elements on the page the user is on */
  currentPageElementCount: number;
  /** number of pages in the document */
  pageCount: number;
  /** the backend the document is persisted through */
  activeBackend: DocumentStoreBackend | null;
  /** latency of the last save, in ms */
  saveLatencyMs: number;
  /** latency of the last page switch, in ms */
  pageSwitchLatencyMs: number;
  /** p95 of the recorded save latencies, in ms */
  saveLatencyP95Ms: number;
  /** p95 of the recorded page-switch latencies, in ms */
  pageSwitchLatencyP95Ms: number;
  /** number of bytes the last save wrote */
  lastSaveBytes: number;
  /** the rolling window of save latencies, in ms */
  saveLatencies: readonly number[];
  /** the rolling window of page-switch latencies, in ms */
  pageSwitchLatencies: readonly number[];
};

const stats: DocumentStats = {
  totalElementCount: 0,
  currentPageElementCount: 0,
  pageCount: 0,
  activeBackend: null,
  saveLatencyMs: 0,
  pageSwitchLatencyMs: 0,
  saveLatencyP95Ms: 0,
  pageSwitchLatencyP95Ms: 0,
  lastSaveBytes: 0,
  saveLatencies: [],
  pageSwitchLatencies: [],
};

/** p95 of a sample window (0 for an empty window) */
const percentile95 = (samples: readonly number[]) => {
  if (!samples.length) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[index];
};

/** a snapshot of the current numbers */
export const getDocumentStats = (): DocumentStats => ({
  ...stats,
  saveLatencies: [...stats.saveLatencies],
  pageSwitchLatencies: [...stats.pageSwitchLatencies],
});

/** records how long a save took, and how much it wrote */
export const recordSave = ({
  latencyMs,
  bytes = 0,
}: {
  latencyMs: number;
  bytes?: number;
}) => {
  stats.saveLatencyMs = latencyMs;
  stats.lastSaveBytes = bytes;
  stats.saveLatencies = [...stats.saveLatencies, latencyMs].slice(-WINDOW_SIZE);
  stats.saveLatencyP95Ms = percentile95(stats.saveLatencies);
};

/** records how long a page switch took */
export const recordPageSwitch = (latencyMs: number) => {
  stats.pageSwitchLatencyMs = latencyMs;
  stats.pageSwitchLatencies = [...stats.pageSwitchLatencies, latencyMs].slice(
    -WINDOW_SIZE,
  );
  stats.pageSwitchLatencyP95Ms = percentile95(stats.pageSwitchLatencies);
};

/** records the element and page counts of the document */
export const recordDocumentCounts = ({
  totalElementCount,
  currentPageElementCount,
  pageCount,
}: {
  totalElementCount: number;
  currentPageElementCount: number;
  pageCount: number;
}) => {
  stats.totalElementCount = totalElementCount;
  stats.currentPageElementCount = currentPageElementCount;
  stats.pageCount = pageCount;
};

/** records which backend the document is persisted through */
export const recordActiveBackend = (backend: DocumentStoreBackend | null) => {
  stats.activeBackend = backend;
};

/** the number of bytes the last save wrote */
export const getDocumentBytes = () => stats.lastSaveBytes;

/** clears every recorded number (used by the tests) */
export const resetDocumentStats = () => {
  stats.totalElementCount = 0;
  stats.currentPageElementCount = 0;
  stats.pageCount = 0;
  stats.saveLatencyMs = 0;
  stats.pageSwitchLatencyMs = 0;
  stats.saveLatencyP95Ms = 0;
  stats.pageSwitchLatencyP95Ms = 0;
  stats.lastSaveBytes = 0;
  stats.saveLatencies = [];
  stats.pageSwitchLatencies = [];
};

/**
 * A console handle, so the numbers can be read without opening a panel:
 *
 *     __excalidrawDocumentStats()
 */
export const installDocumentStatsConsoleApi = () => {
  if (typeof window === "undefined") {
    return;
  }
  (window as unknown as Record<string, unknown>).__excalidrawDocumentStats =
    getDocumentStats;
};
