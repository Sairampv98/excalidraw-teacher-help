/**
 * AC-277 - the paper is in the picture of the page: the canvas, a PNG export
 * and an SVG export (D-243).
 */

import { describe, expect, it } from "vitest";

import { getDefaultAppState } from "../appState";
import { exportToCanvas, exportToSvg } from "../scene/export";
import { getPageDecoration, getPageRect } from "../scene/pages";

import { API } from "./helpers/api";

import type { PagePaper } from "../scene/paper";
import type { AppState, ExcalidrawPage } from "../types";

const pagesWith = (paper?: PagePaper): ExcalidrawPage[] => [
  { id: "page-1", name: "Page 1", ...(paper ? { paper } : {}) },
];

const appState = (pages: ExcalidrawPage[]): AppState => ({
  ...getDefaultAppState(),
  pages,
  currentPageId: "page-1",
  exportBackground: true,
  viewBackgroundColor: "#ffffff",
  width: 1920,
  height: 1080,
  offsetTop: 0,
  offsetLeft: 0,
});

const rect = () => API.createElement({ type: "rectangle", x: 100, y: 100 });

const svgOf = async (pages: ExcalidrawPage[]) => {
  const decoration = getPageDecoration({ pages, pageId: "page-1" });

  return exportToSvg(
    [rect()],
    appState(pages),
    {},
    { pagePaper: decoration.paper },
  );
};

describe("AC-277 the paper is in the picture of the page", () => {
  it("AC-277 a PNG export draws the paper under the content", async () => {
    const paper: PagePaper = {
      type: "grid",
      color: "legal",
      grain: 30,
      age: 40,
    };
    const pages = pagesWith(paper);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")! as CanvasRenderingContext2D & {
      __getDrawCalls: () => { type: string; props: Record<string, unknown> }[];
    };

    // no elements: whatever is stroked is the paper
    await exportToCanvas(
      [],
      appState(pages),
      {},
      {
        exportBackground: true,
        exportPadding: 0,
        viewBackgroundColor: "#ffffff",
        pageRect: getPageRect(pages, "page-1"),
        pageDecoration: getPageDecoration({ pages, pageId: "page-1" }),
      },
      (width, height) => {
        canvas.width = width;
        canvas.height = height;

        return { canvas, scale: 1 };
      },
    );

    const calls = context.__getDrawCalls();
    const types = calls.map((call) => call.type);

    // the sheet is filled with the paper's own colour, then the rules are
    // stroked, then the grain is laid over, and the rectangle comes after
    const sheet = calls.findIndex(
      (call) => call.type === "fill" || call.type === "fillRect",
    );

    expect(types).toContain("stroke");
    expect(sheet).toBeGreaterThan(-1);
    expect(context.canvas.width).toBe(1920);
    expect(context.canvas.height).toBe(1080);

    // a plain page draws none of it: no rules are stroked before the content
    const plain = document.createElement("canvas");
    const plainContext = plain.getContext("2d")! as typeof context;

    await exportToCanvas(
      [],
      appState(pagesWith()),
      {},
      {
        exportBackground: true,
        exportPadding: 0,
        viewBackgroundColor: "#ffffff",
        pageRect: getPageRect(pagesWith(), "page-1"),
        pageDecoration: getPageDecoration({
          pages: pagesWith(),
          pageId: "page-1",
        }),
      },
      (width, height) => {
        plain.width = width;
        plain.height = height;

        return { canvas: plain, scale: 1 };
      },
    );

    expect(plainContext.__getDrawCalls().some((c) => c.type === "stroke")).toBe(
      false,
    );
  });

  it("AC-277 an SVG export is the page on its paper", async () => {
    const svg = await svgOf(
      pagesWith({
        type: "single-line",
        color: "blackboard",
        grain: 30,
        age: 40,
      }),
    );
    const group = svg.querySelector("g[data-paper]")!;

    expect(group.getAttribute("data-paper")).toBe("single-line");

    // the picture is the page
    expect(svg.getAttribute("viewBox")).toBe("0 0 1920 1080");

    // the sheet, the rules, the fibres and the edges, and a filter for the grain
    expect(group.querySelector('rect[fill="#1f2326"]')).not.toBeNull();
    expect(group.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
    expect(svg.querySelector("radialGradient")).not.toBeNull();
    expect(svg.querySelector("filter feTurbulence")).not.toBeNull();

    // and the paper is under the elements
    const all = [...svg.children];

    expect(all.indexOf(group)).toBeLessThan(
      all.findIndex((node) => node.tagName === "g" && node !== group),
    );
  });

  it("AC-277 a plain page and a page without grain or age have none of it", async () => {
    const plain = await svgOf(pagesWith());

    expect(plain.querySelector("g[data-paper]")).toBeNull();

    const clean = await svgOf(
      pagesWith({ type: "grid", color: "white", grain: 0, age: 0 }),
    );

    expect(clean.querySelector("g[data-paper]")).not.toBeNull();
    expect(clean.querySelector("filter feTurbulence")).toBeNull();
    expect(clean.querySelector("radialGradient")).toBeNull();
  });

  it("AC-277 two exports of one page are the same, and another page differs in its grain", async () => {
    const paper: PagePaper = {
      type: "dot-grid",
      color: "midnight",
      grain: 50,
      age: 50,
    };
    const first = (await svgOf(pagesWith(paper))).querySelector(
      "g[data-paper]",
    )!.outerHTML;
    const again = (await svgOf(pagesWith(paper))).querySelector(
      "g[data-paper]",
    )!.outerHTML;

    expect(again).toBe(first);

    const other = await exportToSvg(
      [rect()],
      appState([{ id: "page-2", name: "Page 2", paper }]),
      {},
      {
        pagePaper: getPageDecoration({
          pages: [{ id: "page-2", name: "Page 2", paper }],
          pageId: "page-2",
        }).paper,
      },
    );

    expect(other.querySelector("g[data-paper]")!.outerHTML).not.toBe(first);
  });
});
