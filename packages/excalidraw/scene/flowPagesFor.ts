/**
 * The pages a spread chart goes on (D-226).
 *
 * A chart that is spread over pages goes on the current page and on the pages
 * that follow it. When there are not enough pages after the current one, pages
 * are **made**, after the last page the chart uses, the same size as the others.
 *
 * Everything here is pure: it says which pages there are to be, and the caller
 * puts them in the document.
 */

import { randomId } from "@excalidraw/common";

import { getPageIndex, getPageRect, insertPageAfter } from "./pages";

import type { ExcalidrawPage } from "../types";
import type { FlowPageRect } from "./flowPresets";

export type FlowChartPages = {
  /** every page of the document after the pages were made */
  pages: readonly ExcalidrawPage[];
  /** the page of each part of the chart: the current page first */
  pageIds: string[];
  /** how many pages had to be made */
  created: number;
};

/**
 * The `count` pages a chart goes on, starting at the current one. The ids of
 * pages that are made come from `newId`.
 */
export const planChartPages = ({
  pages,
  currentPageId,
  count,
  newId = () => `page-${randomId()}`,
}: {
  pages: readonly ExcalidrawPage[];
  currentPageId: string;
  count: number;
  newId?: () => string;
}): FlowChartPages => {
  const start = Math.max(getPageIndex(pages, currentPageId), 0);
  const pageIds = pages
    .slice(start, start + Math.max(count, 1))
    .map((page) => page.id);

  let next = pages;
  let created = 0;

  while (pageIds.length < Math.max(count, 1)) {
    const id = newId();

    next = insertPageAfter({
      pages: next,
      afterPageId: pageIds[pageIds.length - 1] ?? currentPageId,
      pageId: id,
    });
    pageIds.push(id);
    created++;
  }

  return { pages: next, pageIds, created };
};

/** the pages of a plan as the builder wants them: a rect and an id for each (D-226) */
export const flowPagesOf = (
  plan: FlowChartPages,
): { rect: FlowPageRect; pageId: string }[] =>
  plan.pageIds.map((pageId) => ({
    rect: getPageRect(plan.pages, pageId),
    pageId,
  }));
