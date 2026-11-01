/**
 * The files the page makes for the assistant (D-438): the animation of a chart
 * and the handout of the pages, as bytes.
 *
 * The page makes the bytes and the **server** writes them into an allowed
 * folder, so what is tested here is the half that is the page's: that the bytes
 * are a real GIF and a real PDF, that they carry what they say they carry, and
 * that a call which cannot be done is refused with the reason.
 *
 * The animation is made by the Flow tab's own exporter and the handout by the
 * app's own writer, so nothing here is faked: the file is the file.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Excalidraw } from "../index";
import { runMcpTool } from "../mcp/runner";
import { refuseTooLarge } from "../mcp/exportTools";
import { McpToolError } from "../mcp/common";
import { buildFlowPreset } from "../scene/flowPresets";
import {
  FLOW_SETTINGS_STORAGE_KEY,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { MCP_MAX_EXPORT_BYTES, exportTooLargeMessage } from "../mcp/protocol";

import { API } from "./helpers/api";
import { decodeGif } from "./helpers/gifDecode";
import { act, render } from "./test-utils";

import type { McpRunContext } from "../mcp/runner";

const { h } = window;

const CONTEXT: McpRunContext = {
  allowChanges: true,
  app: "test",
  features: [],
};

const run = async (name: string, args: unknown = {}) => {
  let outcome: Awaited<ReturnType<typeof runMcpTool>> | undefined;

  await act(async () => {
    outcome = await runMcpTool(h.app, name, args, CONTEXT);
  });

  return outcome!;
};

const ok = async (name: string, args: unknown = {}) => {
  const outcome = await run(name, args);

  if (!outcome.ok) {
    throw new Error(`${name}: ${outcome.error.code}: ${outcome.error.message}`);
  }

  return outcome.result as any;
};

const refused = async (name: string, args: unknown = {}) => {
  const outcome = await run(name, args);

  if (outcome.ok) {
    throw new Error(`${name}: it was done`);
  }

  return outcome.error;
};

/** the bytes of a file, read back from the text that carried them */
const bytesOf = (data: string): Uint8Array => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

/** a chart on the canvas, made the way the teacher makes one */
const chartOnCanvas = (script = "Plan\nTeach\nReview", chartId = "c1") => {
  const built = buildFlowPreset("process", script, {
    seed: 7,
    chartId,
    direction: "LR",
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  API.setElements(built.elements);

  return built.elements;
};

beforeEach(async () => {
  // the look of the animation is remembered between sessions: every test starts
  // from the look a fresh whiteboard has
  window.localStorage.removeItem(FLOW_SETTINGS_STORAGE_KEY);
  updateFlowAnimationSettings({
    durationMs: 200,
    nodeStyle: "focus",
    arrowStyle: "none",
    camera: false,
  });
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true} />,
  );
});

afterEach(() => {
  window.localStorage.removeItem(FLOW_SETTINGS_STORAGE_KEY);
});

describe("the animation of a chart", () => {
  it("AC-529 makes a real GIF of the chart and says what the file is", async () => {
    chartOnCanvas();

    const answer = await ok("export_animation_bytes", {
      format: "gif",
      size: 480,
      fps: 5,
    });

    expect(answer.mimeType).toBe("image/gif");
    expect(answer.filename).toMatch(/\.gif$/);
    // the chart has three steps, and the file walks them
    expect(answer.steps).toBe(3);
    expect(answer.format).toBe("gif");
    // the picture is the size that was asked for
    expect(Math.max(answer.width, answer.height)).toBe(480);
    expect(answer.width).toBeGreaterThan(0);
    expect(answer.height).toBeGreaterThan(0);

    // the bytes are a GIF, read back from the text that carried them
    const bytes = bytesOf(answer.data);

    expect(bytes.length).toBe(answer.bytes);
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
    // and the picture in it is the picture that was said
    expect(bytes[6] | (bytes[7] << 8)).toBe(answer.width);
    expect(bytes[8] | (bytes[9] << 8)).toBe(answer.height);

    // the file is read back by the decoder of this repository: the picture is
    // of the size that was said, there is a picture for each step of the
    // chart, and the file loops for ever
    const decoded = decodeGif(bytes);

    expect(decoded.width).toBe(answer.width);
    expect(decoded.height).toBe(answer.height);
    expect(decoded.frames).toHaveLength(answer.steps);
    expect(decoded.loops).toBe(0);
  });

  it("AC-529 the GIF is the chart's own exporter, and the bar's own look", async () => {
    chartOnCanvas();

    const answer = await ok("export_animation_bytes", {
      format: "gif",
      size: 480,
      fps: 5,
    });

    // the file is a GIF the exporter wrote: it has the loop and the end of it
    const bytes = bytesOf(answer.data);
    const text = String.fromCharCode(...bytes.subarray(0, 64));

    expect(text).toContain("NETSCAPE2.0");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it("AC-529 refuses a chart that is not there, a format that is not one, and a rate the format does not offer", async () => {
    chartOnCanvas();

    const missing = await refused("export_animation_bytes", {
      chartId: "nope",
    });

    expect(missing.code).toBe("not-found");
    expect(missing.message).toMatch(/list_flow_charts/);

    const format = await refused("export_animation_bytes", { format: "avi" });

    expect(format.code).toBe("bad-arguments");
    expect(format.message).toMatch(/gif, webp, mp4/);

    const fps = await refused("export_animation_bytes", { fps: 7 });

    expect(fps.code).toBe("bad-arguments");
    expect(fps.message).toMatch(/fps must be one of/);

    const size = await refused("export_animation_bytes", { size: 640 });

    expect(size.code).toBe("bad-arguments");
    expect(size.message).toMatch(/480, 720, 1080, 1920/);
  });

  it("AC-529 refuses a chart that has nothing to walk", async () => {
    chartOnCanvas("Only one step", "c2");

    const error = await refused("export_animation_bytes", { chartId: "c2" });

    expect(error.code).toBe("failed");
    expect(error.message).toMatch(/no steps to walk/);
  });

  it("AC-529 refuses an animation that is longer than the most that may be made", async () => {
    chartOnCanvas();

    // three steps of half a minute each are longer than a minute
    act(() => {
      updateFlowAnimationSettings({ durationMs: 30_000 });
    });

    const error = await refused("export_animation_bytes", { format: "gif" });

    expect(error.code).toBe("too-large");
    expect(error.message).toMatch(/90 seconds/);
    expect(error.message).toMatch(/the most that can be made is 60 seconds/);
  });

  it("AC-529 the chart that is selected is the chart that is exported", async () => {
    const elements = chartOnCanvas();

    API.setSelectedElements(
      elements.filter((element) => element.type !== "arrow"),
    );

    const answer = await ok("export_animation_bytes", {
      format: "gif",
      size: 480,
      fps: 5,
    });

    expect(answer.chartId).toBe("c1");
    expect(answer.steps).toBe(3);
  });

  it("AC-529 a file too big to travel in one message is refused with the reason", () => {
    // a file that fits is not refused
    expect(() => refuseTooLarge(MCP_MAX_EXPORT_BYTES)).not.toThrow();

    try {
      refuseTooLarge(MCP_MAX_EXPORT_BYTES + 1);
      throw new Error("it was done");
    } catch (error) {
      expect(error).toBeInstanceOf(McpToolError);
      expect((error as McpToolError).code).toBe("too-large");
      // the words are the server's, so the two halves answer the same way
      expect((error as McpToolError).message).toBe(
        exportTooLargeMessage(MCP_MAX_EXPORT_BYTES + 1),
      );
      expect((error as McpToolError).message).toMatch(/20 MB/);
    }
  });
});

describe("the handout of the pages", () => {
  it("AC-530 makes one PDF with a page each, at the pages' own sizes", async () => {
    // a second page, of its own size
    await ok("add_page", {});
    await ok("set_page", { page: 2, width: 2400, height: 1200 });

    const answer = await ok("export_handout_bytes", { pages: [2, 1] });

    expect(answer.mimeType).toBe("application/pdf");
    expect(answer.filename).toMatch(/\.pdf$/);
    expect(answer.pages).toBe(2);
    expect(answer.pageNumbers).toEqual([2, 1]);

    const bytes = bytesOf(answer.data);
    const text = new TextDecoder("latin1").decode(bytes);

    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Count 2");
    // a page object and an image for each page, and not the page tree
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(2);
    expect((text.match(/\/Subtype \/Image/g) ?? []).length).toBe(2);

    // the pages are the ones that were asked for, in that order: the second
    // page is the bigger one, so its box is the bigger one
    const boxes = text.match(/\/MediaBox \[0 0 \d+ \d+\]/g) ?? [];

    expect(boxes).toEqual([
      "/MediaBox [0 0 1800 900]",
      "/MediaBox [0 0 1440 810]",
    ]);
  });

  it("AC-530 every page of the document is in the file when none is asked for", async () => {
    await ok("add_page", {});
    await ok("add_page", {});

    const answer = await ok("export_handout_bytes", {});
    const text = new TextDecoder("latin1").decode(bytesOf(answer.data));

    expect(answer.pages).toBe(3);
    expect(text).toContain("/Count 3");
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(3);
  });

  it("AC-530 refuses a page that is not there", async () => {
    const error = await refused("export_handout_bytes", { pages: [2] });

    expect(error.code).toBe("not-found");
    expect(error.message).toMatch(/no page 2/);
  });
});
