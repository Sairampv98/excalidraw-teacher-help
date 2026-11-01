/**
 * The page's half of the panels (D-415 to D-418): a video from a file, a YouTube
 * video, a code editor, and running the code. The app's insert of a video and the
 * runners of the code are stand-ins that do what the real ones do to the scene
 * and record what they were asked.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import {
  Excalidraw,
  stampCurrentPage,
  useExcalidrawAPI,
  videoPanelContent,
} from "@excalidraw/excalidraw";
import {
  newPanelElement,
  newTextElement,
  syncInvalidIndices,
} from "@excalidraw/element";
import { runMcpTool } from "@excalidraw/excalidraw/mcp/runner";
import {
  codePanelContent,
  emptyCodePanelState,
} from "@excalidraw/excalidraw/scene/panelContent";
import { clearUploads } from "@excalidraw/excalidraw/mcp/uploads";
import { API } from "@excalidraw/excalidraw/tests/helpers/api";
import { Keyboard } from "@excalidraw/excalidraw/tests/helpers/ui";
import { act, render } from "@excalidraw/excalidraw/tests/test-utils";

import type { McpRunContext } from "@excalidraw/excalidraw/mcp/runner";

import { createAppTools } from "../assistant/appTools";

import type { AppToolDeps } from "../assistant/appTools";
import type { PanelDeps } from "../assistant/panelTools";

const { h } = window;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** the bytes of an mp4: a box that says ftyp, and some more */
const MP4 = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0,
]);

/** what the app's insert of a video does to the scene: a panel, and a text beside it */
const insertVideo = vi.fn(async (api: any, { videoFile, sidecarFile }: any) => {
  const track = sidecarFile
    ? {
        language: "en",
        label: "en",
        cues: [{ startMs: 0, endMs: 1000, text: "Hello" }],
      }
    : null;
  const panel = newPanelElement({
    type: "panel",
    x: 700,
    y: 300,
    width: 480,
    height: 270,
    panelKind: "video",
    panel: videoPanelContent({
      source: {
        type: "file",
        fileId: "video-file" as never,
        mimeType: videoFile.type,
      },
      tracks: track ? [track] : [],
    }),
    posterMode: false,
    posterFileId: null,
  });
  const caption = track
    ? newTextElement({ text: "Hello", x: 700, y: 580, fontSize: 20 })
    : null;
  const added = caption ? [panel, caption] : [panel];

  stampCurrentPage(added, api.getAppState().currentPageId);
  api.updateScene({
    elements: syncInvalidIndices([...api.getSceneElements(), ...added]),
    appState: { selectedElementIds: { [panel.id]: true } },
  });

  return { panel, caption, track };
});

const runs: { code: string; stdin: string[] }[] = [];

const fakeRunner = (name: string) => ({
  run: vi.fn(async (code: string, events: any, options: any = {}) => {
    runs.push({ code, stdin: options.stdin ?? [] });
    events.onOutput("stdout", `${name} says hi\n`);
    events.onOutput("stdout", "and again\n");
    events.onOutput("stderr", "a warning\n");

    if (code.includes("ASK")) {
      return { kind: "needs-input" as const };
    }

    if (code.includes("SLOW")) {
      events.onNotice("timed-out", "The program ran too long.");

      return { kind: "timed-out" as const };
    }

    if (code.includes("BOOM")) {
      return { kind: "exit" as const, code: 1 };
    }

    return { kind: "exit" as const, code: 0 };
  }),
});

const runners = {
  python: fakeRunner("python"),
  javascript: fakeRunner("javascript"),
};

const deps: AppToolDeps = {
  stickerFile: vi.fn(),
  getImageSize: vi.fn(),
  buildCodeCard: vi.fn(),
  panels: {
    insertVideo: insertVideo as never,
    runners,
  } as Partial<PanelDeps>,
};

let api: any = null;

const GrabApi = () => {
  api = useExcalidrawAPI();

  return null;
};

const context = (allowChanges = true): McpRunContext => ({
  allowChanges,
  app: "test",
  features: [],
  appTools: createAppTools(() => api, deps),
});

const run = async (name: string, args: unknown = {}, ctx = context()) => {
  let outcome: Awaited<ReturnType<typeof runMcpTool>> | undefined;

  await act(async () => {
    outcome = await runMcpTool(h.app, name, args, ctx);
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

const live = () => h.elements.filter((element) => !element.isDeleted);
const panels = () =>
  live().filter((element) => element.type === "panel") as any[];

const undo = () => {
  act(() => {
    Keyboard.undo();
  });
};

const send = async (
  id: string,
  bytes: Uint8Array,
  name: string,
  mimeType = "video/mp4",
) => {
  await ok("upload_chunk", {
    id,
    index: 0,
    total: 1,
    data: b64(bytes),
    name,
    mimeType,
  });
};

const addSecondPage = async () => {
  await act(async () => {
    h.setState({ pages: [...h.state.pages, { id: "p2", name: "Page 2" }] });
  });
};

beforeEach(async () => {
  clearUploads();
  insertVideo.mockClear();
  runs.length = 0;
  runners.python.run.mockClear();
  runners.javascript.run.mockClear();
  await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <GrabApi />
    </Excalidraw>,
  );
});

describe("a video from a file", () => {
  it("AC-503 puts the video panel with its top-left where asked and the caption beside it, on the page asked for, with the person's selection as it was, in one undo step", async () => {
    await addSecondPage();

    const rectangle = API.createElement({
      type: "rectangle",
      x: 5,
      y: 5,
      width: 50,
      height: 50,
    });

    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    await send("vid-0001", MP4, "lesson.mp4");
    await send(
      "cap-0001",
      new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\nHello\n"),
      "lesson.srt",
      "text/plain",
    );

    const result = await ok("place_video", {
      upload: "vid-0001",
      captions: "cap-0001",
      page: 2,
      x: 100,
      y: 80,
    });

    expect(result).toMatchObject({ page: 2, captions: 1, captionText: true });

    const [panel] = panels();
    const caption = live().find((element) => element.type === "text")!;

    expect(panel.pageId).toBe("p2");
    expect(caption.pageId).toBe("p2");
    expect(panel.x).toBeGreaterThan(1920);
    // the caption keeps its place beside the panel: 280 below, as it was made
    expect(caption.x - panel.x).toBe(0);
    expect(caption.y - panel.y).toBe(280);
    expect(result.created[0]).toMatchObject({
      page: 2,
      x: 100,
      y: 80,
      width: 480,
      height: 270,
    });
    // the video was given as a file of its own type, and the captions as a file
    const call = insertVideo.mock.calls[0][1];

    expect(call.videoFile.type).toBe("video/mp4");
    expect(call.videoFile.name).toBe("lesson.mp4");
    expect(call.sidecarFile.name).toBe("lesson.srt");
    // the person's selection is as it was: the rectangle, not the panel
    expect(Object.keys(h.state.selectedElementIds)).toEqual([rectangle.id]);

    undo();
    expect(live().map((element) => element.id)).toEqual([rectangle.id]);
  });

  it("AC-503 puts a video with no place in the middle of the page, no captions without a sidecar, and a width keeps the shape of the video", async () => {
    await send("vid-0002", MP4, "talk.mp4");

    const plain = await ok("place_video", { upload: "vid-0002" });

    expect(plain).toMatchObject({ page: 1, captions: 0, captionText: false });

    const [panel] = panels();

    // the middle of a page 1920 by 1080
    expect(panel.x + panel.width / 2).toBeCloseTo(960, 0);
    expect(panel.y + panel.height / 2).toBeCloseTo(540, 0);
    expect(insertVideo.mock.calls[0][1].sidecarFile).toBeNull();

    await send("vid-0003", MP4, "wide.mp4");
    await ok("place_video", { upload: "vid-0003", width: 960, x: 0, y: 0 });

    const wide = panels().find((each) => each.width === 960)!;

    // 480 by 270 shown 960 wide is 960 by 540
    expect(wide).toMatchObject({ x: 0, y: 0, width: 960, height: 540 });
  });

  it("AC-503 refuses what is not a video, a width that is not one, a page that is not there and Allow changes off, and puts nothing", async () => {
    await send(
      "vid-bad1",
      new TextEncoder().encode("only text, not a video"),
      "liar.mp4",
    );
    expect(await run("place_video", { upload: "vid-bad1" })).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/not a video/),
      },
    });

    await send("vid-bad2", MP4, "x.mp4");
    expect(
      await run("place_video", { upload: "vid-bad2", width: 50 }),
    ).toMatchObject({
      error: { code: "bad-arguments" },
    });
    await send("vid-bad2b", MP4, "x.mp4");
    expect(
      await run("place_video", { upload: "vid-bad2b", width: 2000 }),
    ).toMatchObject({
      error: { code: "bad-arguments" },
    });

    await send("vid-bad3", MP4, "x.mp4");
    expect(
      await run("place_video", { upload: "vid-bad3", page: 9 }),
    ).toMatchObject({
      ok: false,
    });

    await send("vid-bad4", MP4, "x.mp4");
    expect(
      await run("place_video", { upload: "vid-bad4" }, context(false)),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(await run("place_video", { upload: "nothing-here" })).toMatchObject({
      error: { code: "not-found" },
    });
    expect(insertVideo).not.toHaveBeenCalled();
    expect(live()).toHaveLength(0);
  });
});

describe("a YouTube video", () => {
  it("AC-504 puts the panel of the video named by a link or an id, where asked, on the page asked for, with the person's selection as it was", async () => {
    await addSecondPage();

    const rectangle = API.createElement({
      type: "rectangle",
      x: 5,
      y: 5,
      width: 50,
      height: 50,
    });

    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);

    const result = await ok("insert_youtube", {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5",
      page: 2,
      x: 40,
      y: 60,
    });

    expect(result).toMatchObject({ page: 2, videoId: "dQw4w9WgXcQ" });
    expect(result.note).toMatch(/internet/);

    const [panel] = panels();

    expect(panel.pageId).toBe("p2");
    expect(panel.panel.source).toEqual({
      type: "youtube",
      videoId: "dQw4w9WgXcQ",
    });
    expect(result.created[0]).toMatchObject({
      page: 2,
      x: 40,
      y: 60,
      width: 480,
      height: 270,
    });
    expect(Object.keys(h.state.selectedElementIds)).toEqual([rectangle.id]);

    undo();
    expect(live().map((element) => element.id)).toEqual([rectangle.id]);
  });

  it("AC-504 reads a short link, a bare id, and puts a video with no place in the middle of the page", async () => {
    expect(
      await ok("insert_youtube", { url: "https://youtu.be/dQw4w9WgXcQ" }),
    ).toMatchObject({
      videoId: "dQw4w9WgXcQ",
    });
    expect(await ok("insert_youtube", { url: "aqz-KE-bpKQ" })).toMatchObject({
      videoId: "aqz-KE-bpKQ",
    });

    const [first] = panels();

    expect(first.x + first.width / 2).toBeCloseTo(960, 0);
    expect(first.y + first.height / 2).toBeCloseTo(540, 0);
  });

  it("AC-504 refuses what is not a YouTube link, and Allow changes off, and puts nothing", async () => {
    for (const url of [
      "https://example.com/watch?v=dQw4w9WgXcQ",
      "not a link",
      "short",
    ]) {
      expect(await run("insert_youtube", { url })).toMatchObject({
        error: {
          code: "bad-arguments",
          message: expect.stringMatching(/not a YouTube/),
        },
      });
    }

    expect(await run("insert_youtube", {})).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("insert_youtube", { url: "dQw4w9WgXcQ" }, context(false)),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });
    expect(live()).toHaveLength(0);
  });
});

describe("the code panel", () => {
  it("AC-505 puts a code editor with the code and the language at the place asked for, on the page asked for, in one undo step", async () => {
    await addSecondPage();

    const result = await ok("insert_code_panel", {
      code: "print('hi')",
      language: "Python",
      page: 2,
      x: 50,
      y: 70,
      width: 500,
      height: 300,
    });

    expect(result).toMatchObject({ page: 2, language: "python" });

    const [panel] = panels();

    expect(panel).toMatchObject({
      pageId: "p2",
      panelKind: "code",
      width: 500,
      height: 300,
    });
    expect(result.created[0]).toMatchObject({ page: 2, x: 50, y: 70 });
    // it is the editor of its own: no bridge, and the text is the panel's own
    expect(panel.panel.standalone).toBe(true);
    expect(panel.panel.draft).toEqual({
      text: "print('hi')",
      language: "python",
      edited: true,
    });

    undo();
    expect(live()).toHaveLength(0);
  });

  it("AC-505 puts an empty python editor of the usual size at 100, 100 when told nothing", async () => {
    await ok("insert_code_panel");

    const [panel] = panels();

    expect(panel).toMatchObject({ x: 100, y: 100, width: 640, height: 400 });
    expect(panel.panel.draft).toEqual({
      text: "",
      language: "python",
      edited: true,
    });
  });

  it("AC-505 refuses a size outside what a code panel is, a language that is not a name, code that is too long, and Allow changes off", async () => {
    for (const size of [
      { width: 100 },
      { width: 1300 },
      { height: 100 },
      { height: 1300 },
    ]) {
      expect(await run("insert_code_panel", size)).toMatchObject({
        error: { code: "bad-arguments" },
      });
    }

    for (const language of ["", "py thon", "../x", "1python"]) {
      expect(await run("insert_code_panel", { language })).toMatchObject({
        error: {
          code: "bad-arguments",
          message: expect.stringMatching(/name of a language/),
        },
      });
    }

    expect(
      await run("insert_code_panel", { code: "x".repeat(200_001) }),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(await run("insert_code_panel", {}, context(false))).toMatchObject({
      error: { code: "changes-not-allowed" },
    });
    expect(live()).toHaveLength(0);
  });

  it("AC-505 changes the code, the language or both of a code panel, in one undo step, and reads them back", async () => {
    const made = await ok("insert_code_panel", {
      code: "one",
      language: "python",
    });
    const id = made.created[0].id;

    expect(await ok("read_code_panel", { id })).toMatchObject({
      id,
      language: "python",
      source: "draft",
      standalone: true,
      edited: true,
      characters: 3,
      text: "one",
      truncated: false,
    });

    expect(await ok("set_code_panel", { id, code: "two" })).toMatchObject({
      language: "python",
      characters: 3,
    });
    expect(await ok("read_code_panel", { id })).toMatchObject({
      text: "two",
      language: "python",
    });

    await ok("set_code_panel", { id, language: "javascript" });
    expect(await ok("read_code_panel", { id })).toMatchObject({
      text: "two",
      language: "javascript",
    });

    await ok("set_code_panel", { id, code: "three", language: "java" });
    expect(await ok("read_code_panel", { id })).toMatchObject({
      text: "three",
      language: "java",
    });

    undo();
    expect(await ok("read_code_panel", { id })).toMatchObject({
      text: "two",
      language: "javascript",
    });
  });

  it("AC-505 refuses a change with nothing in it, a panel that is not a code panel, an element that is not there, code that is too long, and Allow changes off; and reads at most a hundred thousand characters", async () => {
    const made = await ok("insert_code_panel", { code: "x".repeat(150_000) });
    const id = made.created[0].id;
    const read = await ok("read_code_panel", { id });

    expect(read.characters).toBe(150_000);
    expect(read.text).toHaveLength(100_000);
    expect(read.truncated).toBe(true);

    expect(await run("set_code_panel", { id })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(
      await run("set_code_panel", { id, code: "x".repeat(200_001) }),
    ).toMatchObject({ error: { code: "too-large" } });
    expect(
      await run("set_code_panel", { id: "nothing", code: "x" }),
    ).toMatchObject({
      error: { code: "not-found" },
    });
    expect(
      await run("set_code_panel", { id, code: "x" }, context(false)),
    ).toMatchObject({ error: { code: "changes-not-allowed" } });

    await ok("create_elements", {
      elements: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    });

    const rectangle = live().find((element) => element.type === "rectangle")!;

    expect(
      await run("set_code_panel", { id: rectangle.id, code: "x" }),
    ).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/not a code panel/),
      },
    });
    expect(await run("read_code_panel", { id: rectangle.id })).toMatchObject({
      error: { code: "bad-arguments" },
    });
  });

  it("AC-501 lists the panels on the pages with their place and what they hold", async () => {
    await addSecondPage();
    await ok("insert_code_panel", {
      code: "abc",
      language: "javascript",
      page: 2,
      x: 10,
      y: 20,
    });
    await ok("insert_youtube", { url: "dQw4w9WgXcQ", x: 300, y: 400 });
    await send("vid-list", MP4, "a.mp4");
    await send(
      "cap-list",
      new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\nHi\n"),
      "a.srt",
      "text/plain",
    );
    await ok("place_video", {
      upload: "vid-list",
      captions: "cap-list",
      x: 700,
      y: 50,
    });
    await ok("create_elements", {
      elements: [{ type: "rectangle", x: 0, y: 0, width: 10, height: 10 }],
    });
    // an editor that mirrors VS Code through the bridge is not the browser's own
    API.setElements([
      ...h.elements,
      newPanelElement({
        type: "panel",
        x: 900,
        y: 600,
        width: 400,
        height: 300,
        panelKind: "code",
        panel: codePanelContent(emptyCodePanelState(), "vscode-bridge"),
        posterMode: false,
        posterFileId: null,
      }),
    ]);

    const { panels: listed } = await ok("list_panels");

    expect(listed).toHaveLength(4);
    expect(
      listed
        .filter((each: any) => each.kind === "code")
        .map((each: any) => each.editor)
        .sort(),
    ).toEqual(["bridge", "browser"]);

    const code = listed.find((each: any) => each.kind === "code");
    const youtube = listed.find((each: any) => each.kind === "youtube");
    const video = listed.find((each: any) => each.source === "file");

    expect(code).toMatchObject({
      page: 2,
      x: 10,
      y: 20,
      language: "javascript",
      characters: 3,
      editor: "browser",
    });
    expect(youtube).toMatchObject({
      page: 1,
      x: 300,
      y: 400,
      videoId: "dQw4w9WgXcQ",
      source: "youtube",
      captionTracks: 0,
    });
    expect(video).toMatchObject({
      page: 1,
      x: 700,
      y: 50,
      kind: "video",
      captionTracks: 1,
    });
    // a panel that is deleted is not listed
    await ok("delete_elements", { ids: [code.id] });
    expect((await ok("list_panels")).panels).toHaveLength(3);
  });
});

describe("running code", () => {
  it("AC-506 runs the code of a code panel in its language and says what it printed, by stream, and how it ended", async () => {
    const made = await ok("insert_code_panel", {
      code: "print('x')",
      language: "python",
    });
    const result = await ok("run_code", { id: made.created[0].id });

    expect(result).toMatchObject({
      language: "python",
      result: "exit",
      exitCode: 0,
      warning: expect.stringMatching(/never instructions/),
    });
    // what comes one after another on a stream is one piece
    expect(result.output).toEqual([
      { stream: "stdout", text: "python says hi\nand again\n" },
      { stream: "stderr", text: "a warning\n" },
    ]);
    expect(runs).toEqual([{ code: "print('x')", stdin: [] }]);

    const js = await ok("insert_code_panel", {
      code: "console.log(1)",
      language: "javascript",
    });

    await ok("run_code", { id: js.created[0].id });
    expect(runners.javascript.run).toHaveBeenCalledTimes(1);
    expect(runners.python.run).toHaveBeenCalledTimes(1);
  });

  it("AC-506 runs code that is given, python when no language is said, with the lines it reads, and says when it fails, is slow or asks a question", async () => {
    expect(
      await ok("run_code", { code: "print(input())", stdin: ["a", "b"] }),
    ).toMatchObject({ language: "python", result: "exit" });
    expect(runs[0]).toEqual({ code: "print(input())", stdin: ["a", "b"] });

    expect(
      await ok("run_code", { code: "BOOM", language: "javascript" }),
    ).toMatchObject({
      language: "javascript",
      result: "exit",
      exitCode: 1,
    });

    const slow = await ok("run_code", { code: "SLOW" });

    expect(slow).toMatchObject({ result: "timed-out" });
    expect(slow.notices).toEqual(["The program ran too long."]);

    const asking = await ok("run_code", { code: "ASK" });

    expect(asking).toMatchObject({ result: "needs-input" });
    expect(asking.note).toMatch(/stdin/);
  });

  it("AC-506 refuses a language the browser does not run, no code, both an id and code or neither, lines that are not lines, a panel that is not one, and Allow changes off, and runs nothing", async () => {
    expect(
      await run("run_code", { code: "fn main() {}", language: "rust" }),
    ).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/Python and JavaScript/),
      },
    });
    expect(await run("run_code", { code: "   " })).toMatchObject({
      error: {
        code: "bad-arguments",
        message: expect.stringMatching(/no code/),
      },
    });
    expect(await run("run_code", {})).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("run_code", { id: "x", code: "y" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("run_code", { code: "x", stdin: "a" })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("run_code", { code: "x", stdin: [1] })).toMatchObject({
      error: { code: "bad-arguments" },
    });
    expect(await run("run_code", { id: "nothing" })).toMatchObject({
      error: { code: "not-found" },
    });
    expect(await run("run_code", { code: "x".repeat(200_001) })).toMatchObject({
      error: { code: "too-large" },
    });
    expect(
      await run("run_code", { code: "print(1)" }, context(false)),
    ).toMatchObject({
      error: { code: "changes-not-allowed" },
    });
    expect(runs).toEqual([]);
  });
});
