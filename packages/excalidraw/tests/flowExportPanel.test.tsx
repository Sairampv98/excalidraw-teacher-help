/**
 * AC-442 - the panel that exports the animation: the bar's Export button, what
 * the panel offers and says before it makes anything, what it does when the
 * browser cannot write a format, and how it shows progress and a stop (D-374,
 * D-375, D-376, D-378, D-379).
 *
 * The panel is used as a teacher uses it - buttons pressed, the page read
 * afterwards. The writing of the file is replaced by a fake, because it is
 * tested on its own; what is checked here is what the panel asks of it.
 */

import React from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLOW_EXPORT_STORAGE_KEY } from "../components/FlowExportPanel";
import {
  flowAnimationStateAtom,
  updateFlowAnimationSettings,
} from "../components/FlowAnimationState";
import { editorJotaiStore } from "../editor-jotai";
import { Excalidraw } from "../index";
import { buildFlowPreset } from "../scene/flowPresets";
import { FlowExportStopped } from "../scene/flowExport/runner";

import { API } from "./helpers/api";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

vi.mock("../scene/flowExport/exportAnimation", () => ({
  exportFlowAnimation: vi.fn(),
}));

vi.mock("../scene/flowExport/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../scene/flowExport/browser")>()),
  webpSupport: vi.fn(),
  createVideoEncoder: vi.fn(),
}));

const { exportFlowAnimation } = await import(
  "../scene/flowExport/exportAnimation"
);
const { webpSupport, createVideoEncoder } = await import(
  "../scene/flowExport/browser"
);

const { h } = window;

const exportMock = vi.mocked(exportFlowAnimation);
let clickSpy: ReturnType<typeof vi.spyOn>;
const webpMock = vi.mocked(webpSupport);
const videoMock = vi.mocked(createVideoEncoder);

/** a video encoder that can do what it is asked, or says why it cannot */
const encoder = (supported: boolean) =>
  ({
    support: async () =>
      supported
        ? { supported: true as const }
        : {
            supported: false as const,
            reason: "No H.264 at 720x340, 30 a second.",
          },
    encode: vi.fn(),
  } as never);

/** a four-step chart on the canvas, selected, and the bar showing */
const chartWithBar = async () => {
  await render(<Excalidraw handleKeyboardGlobally={true} />);

  act(() => {
    h.setState({ width: 1400, height: 900 });
  });

  const built = buildFlowPreset("process", "Plan\nTeach\nReview\nPractise", {
    seed: 7,
  });

  if (!built.ok) {
    throw new Error(built.error);
  }

  API.setElements(built.elements);

  act(() => {
    API.setSelectedElements(built.elements.filter((e) => e.type !== "arrow"));
  });

  await screen.findByTestId("flow-bar");
};

const openPanel = async () => {
  await chartWithBar();
  fireEvent.click(screen.getByTestId("flow-bar-export"));

  return screen.findByTestId("flow-export-panel");
};

beforeEach(() => {
  localStorage.clear();
  webpMock.mockResolvedValue(true);
  videoMock.mockReturnValue(encoder(true));
  exportMock.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  // the download is a link that is clicked: read it, and do not follow it
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  act(() => {
    updateFlowAnimationSettings({ durationMs: 1200, camera: false });
  });
});

afterEach(() => {
  localStorage.clear();
  clickSpy.mockRestore();
});

describe("the export panel", () => {
  it("AC-442 the bar has an Export button that opens the panel and the panel closes", async () => {
    await chartWithBar();

    expect(screen.queryByTestId("flow-export-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("flow-bar-export"));
    expect(await screen.findByTestId("flow-export-panel")).toBeTruthy();
    expect(
      screen.getByTestId("flow-bar-export").getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("flow-export-panel")).toBeNull();
  });

  it("AC-442 it offers the three formats, GIF first, with the rates the format offers", async () => {
    await openPanel();

    const press = (format: string) =>
      screen
        .getByTestId(`flow-export-format-${format}`)
        .getAttribute("aria-pressed");
    const rates = () =>
      [
        ...(screen.getByTestId("flow-export-fps") as HTMLSelectElement).options,
      ].map((option) => option.value);

    expect(press("gif")).toBe("true");
    expect(press("webp")).toBe("false");
    expect(press("mp4")).toBe("false");

    // a GIF has no 60, and starts at 15
    expect(rates()).toEqual(["5", "10", "15", "24", "30"]);
    expect(
      (screen.getByTestId("flow-export-fps") as HTMLSelectElement).value,
    ).toBe("15");

    // an MP4 has the whole list and starts at 30
    fireEvent.click(screen.getByTestId("flow-export-format-mp4"));
    expect(rates()).toEqual(["5", "10", "15", "24", "30", "60"]);
    expect(
      (screen.getByTestId("flow-export-fps") as HTMLSelectElement).value,
    ).toBe("30");

    // the sizes and the shapes
    expect(
      [
        ...(screen.getByTestId("flow-export-size") as HTMLSelectElement)
          .options,
      ].map((option) => option.value),
    ).toEqual(["480", "720", "1080", "1920"]);
    expect(
      [
        ...(screen.getByTestId("flow-export-shape") as HTMLSelectElement)
          .options,
      ].map((option) => option.textContent),
    ).toEqual(["As the chart", "16:9", "Square", "Portrait 9:16"]);
  });

  it("AC-442 it says how long the file will be, how many pictures and how large before it is made", async () => {
    await openPanel();

    // four steps of 1.2 s, fifteen a second
    expect(screen.getByTestId("flow-export-note").textContent).toMatch(
      /^4\.8 s, 72 pictures, 720x\d+$/,
    );

    fireEvent.change(screen.getByTestId("flow-export-fps"), {
      target: { value: "30" },
    });
    expect(screen.getByTestId("flow-export-note").textContent).toMatch(
      /^4\.8 s, 144 pictures, 720x\d+$/,
    );

    fireEvent.change(screen.getByTestId("flow-export-shape"), {
      target: { value: "portrait" },
    });
    fireEvent.change(screen.getByTestId("flow-export-size"), {
      target: { value: "1080" },
    });
    expect(screen.getByTestId("flow-export-note").textContent).toMatch(
      /144 pictures, 608x1080$/,
    );
  });

  it("AC-442 an MP4 the browser cannot write is not offered, and says why; GIF and WebP still are", async () => {
    videoMock.mockReturnValue(encoder(false));
    await openPanel();

    fireEvent.click(screen.getByTestId("flow-export-format-mp4"));

    expect(await screen.findByTestId("flow-export-problem")).toBeTruthy();
    expect(screen.getByTestId("flow-export-problem").textContent).toBe(
      "No H.264 at 720x340, 30 a second.",
    );
    expect(
      (screen.getByTestId("flow-export-go") as HTMLButtonElement).disabled,
    ).toBe(true);

    // the other two are as they were
    fireEvent.click(screen.getByTestId("flow-export-format-gif"));
    expect(screen.queryByTestId("flow-export-problem")).toBeNull();
    expect(
      (screen.getByTestId("flow-export-go") as HTMLButtonElement).disabled,
    ).toBe(false);

    // no encoder in the browser at all
    videoMock.mockReturnValue(null);
    fireEvent.click(screen.getByTestId("flow-export-format-mp4"));
    fireEvent.change(screen.getByTestId("flow-export-fps"), {
      target: { value: "24" },
    });
    expect(
      await screen.findByText("This browser cannot write MP4 video."),
    ).toBeTruthy();
  });

  it("AC-442 a WebP the browser cannot write is not offered either", async () => {
    webpMock.mockResolvedValue(false);
    await openPanel();

    fireEvent.click(screen.getByTestId("flow-export-format-webp"));

    expect(
      await screen.findByText("This browser cannot write WebP pictures."),
    ).toBeTruthy();
    expect(
      (screen.getByTestId("flow-export-go") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("AC-442 the background can be left out of a GIF or a WebP, and an MP4 always has it and says so", async () => {
    await openPanel();

    const box = () =>
      screen.getByTestId("flow-export-background") as HTMLInputElement;

    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(false);

    fireEvent.click(box());
    expect(box().checked).toBe(false);

    // an MP4: on, and not to be changed
    fireEvent.click(screen.getByTestId("flow-export-format-mp4"));
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(true);
    expect(screen.getByTestId("flow-export-background-note").textContent).toBe(
      "MP4 cannot be transparent",
    );
  });

  it("AC-447 the panel can fly the camera to each step, starting from the bar's own setting, and the choice is the export's alone", async () => {
    // the bar's camera is off: so is the panel's
    await openPanel();

    const box = () =>
      screen.getByTestId("flow-export-camera") as HTMLInputElement;

    expect(box().checked).toBe(false);
    expect(box().disabled).toBe(false);

    // the bar's camera is on: a panel opened now starts with it on
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => {
      updateFlowAnimationSettings({ camera: true });
    });
    fireEvent.click(screen.getByTestId("flow-bar-export"));
    await screen.findByTestId("flow-export-panel");

    expect(box().checked).toBe(true);

    // turned off here, it is off in the export and still on in the bar
    fireEvent.click(box());
    expect(box().checked).toBe(false);

    exportMock.mockResolvedValue({
      blob: new Blob([new Uint8Array(10)], { type: "image/gif" }),
      filename: "chart.gif",
      width: 720,
      height: 340,
    });
    fireEvent.click(screen.getByTestId("flow-export-go"));
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1));

    expect(exportMock.mock.calls[0][0].options.camera).toBe(false);
    expect(editorJotaiStore.get(flowAnimationStateAtom).camera).toBe(true);

    // turned on, it is on in the export
    await screen.findByTestId("flow-export-saved");
    fireEvent.click(box());
    fireEvent.click(screen.getByTestId("flow-export-go"));
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(2));

    expect(exportMock.mock.calls[1][0].options.camera).toBe(true);

    // it cannot be changed while the export works
    exportMock.mockImplementationOnce(() => new Promise(() => undefined));
    fireEvent.click(screen.getByTestId("flow-export-go"));
    await screen.findByTestId("flow-export-stop");
    expect(box().disabled).toBe(true);
  });

  it("AC-442 it exports what was chosen, shows how far it is, saves the file and says where", async () => {
    await openPanel();

    let report: (done: number, total: number) => void = () => undefined;
    let finish: () => void = () => undefined;

    exportMock.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          report = input.onProgress;
          finish = () =>
            resolve({
              blob: new Blob([new Uint8Array(2048)], { type: "image/gif" }),
              filename: "chart.gif",
              width: 720,
              height: 340,
            });
        }),
    );

    fireEvent.change(screen.getByTestId("flow-export-size"), {
      target: { value: "480" },
    });
    fireEvent.click(screen.getByTestId("flow-export-background"));
    fireEvent.click(screen.getByTestId("flow-export-go"));

    // the options go as they were set, with the animation's own settings
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1));
    expect(exportMock.mock.calls[0][0]).toMatchObject({
      options: {
        format: "gif",
        fps: 15,
        longest: 480,
        shape: "chart",
        withBackground: false,
        camera: false,
      },
      animation: { durationMs: 1200 },
    });
    expect(exportMock.mock.calls[0][0].steps).toHaveLength(4);

    // while it works there is a progress bar and a stop, and nothing else to press
    const progress = (await screen.findByTestId(
      "flow-export-progress",
    )) as HTMLProgressElement;

    act(() => report(30, 72));
    expect(progress.value).toBe(30);
    expect(progress.max).toBe(72);
    expect(screen.queryByTestId("flow-export-go")).toBeNull();
    expect(screen.getByTestId("flow-export-stop")).toBeTruthy();
    expect(
      (screen.getByTestId("flow-export-format-webp") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await act(async () => finish());

    expect((await screen.findByTestId("flow-export-saved")).textContent).toBe(
      "Saved chart.gif - 720x340, 2 KB",
    );
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    // the file is downloaded under its own name, from the link that was made
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).download).toBe(
      "chart.gif",
    );
    expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).href).toBe(
      "blob:test",
    );
    expect(screen.queryByTestId("flow-export-progress")).toBeNull();
    expect(screen.getByTestId("flow-export-go")).toBeTruthy();
  });

  it("AC-442 a stop is passed to the export, and a stopped export is not an error", async () => {
    await openPanel();

    let stopped: () => boolean = () => false;
    let fail: (error: Error) => void = () => undefined;

    exportMock.mockImplementation(
      (input) =>
        new Promise((_resolve, reject) => {
          stopped = input.isStopped;
          fail = reject;
        }),
    );

    fireEvent.click(screen.getByTestId("flow-export-go"));
    await screen.findByTestId("flow-export-stop");

    expect(stopped()).toBe(false);
    fireEvent.click(screen.getByTestId("flow-export-stop"));
    expect(stopped()).toBe(true);

    await act(async () => fail(new FlowExportStopped()));

    expect(screen.queryByTestId("flow-export-error")).toBeNull();
    expect(screen.queryByTestId("flow-export-saved")).toBeNull();
    expect(await screen.findByTestId("flow-export-go")).toBeTruthy();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("AC-442 a failure is said in words and the panel can try again", async () => {
    await openPanel();

    exportMock.mockRejectedValueOnce(new Error("The canvas is too large."));
    fireEvent.click(screen.getByTestId("flow-export-go"));

    expect((await screen.findByTestId("flow-export-error")).textContent).toBe(
      "The canvas is too large.",
    );
    expect(
      (screen.getByTestId("flow-export-go") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("AC-442 the choices are remembered, and what storage holds that is not a choice is ignored", async () => {
    await openPanel();

    fireEvent.click(screen.getByTestId("flow-export-format-webp"));
    fireEvent.change(screen.getByTestId("flow-export-fps"), {
      target: { value: "24" },
    });
    fireEvent.change(screen.getByTestId("flow-export-size"), {
      target: { value: "1080" },
    });

    expect(
      JSON.parse(localStorage.getItem(FLOW_EXPORT_STORAGE_KEY)!),
    ).toMatchObject({
      format: "webp",
      fps: 24,
      longest: 1080,
    });

    // a panel opened later starts there
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByTestId("flow-bar-export"));
    await screen.findByTestId("flow-export-panel");

    expect(
      screen
        .getByTestId("flow-export-format-webp")
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByTestId("flow-export-fps") as HTMLSelectElement).value,
    ).toBe("24");

    // a stored value that is not valid is the default, and a GIF's 60 is the nearest it has
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    localStorage.setItem(
      FLOW_EXPORT_STORAGE_KEY,
      JSON.stringify({ format: "gif", fps: 60, longest: 999, shape: "wide" }),
    );
    fireEvent.click(screen.getByTestId("flow-bar-export"));
    await screen.findByTestId("flow-export-panel");

    // the panel keeps the state of its first reading, so a new one is read from storage
    expect(
      [
        ...(screen.getByTestId("flow-export-size") as HTMLSelectElement)
          .options,
      ].map((option) => option.value),
    ).toContain(
      (screen.getByTestId("flow-export-size") as HTMLSelectElement).value,
    );
    expect(
      screen.getByTestId("flow-export-format-gif").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByTestId("flow-export-fps") as HTMLSelectElement).value,
    ).toBe("30");
    expect(
      (screen.getByTestId("flow-export-size") as HTMLSelectElement).value,
    ).toBe("720");
    expect(
      (screen.getByTestId("flow-export-shape") as HTMLSelectElement).value,
    ).toBe("chart");
  });
});
