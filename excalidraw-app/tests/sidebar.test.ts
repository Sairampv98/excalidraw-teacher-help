import { vi } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  FILE_ACCEPT,
  classify,
  groupsAt,
  kindLabel,
  languageFor,
  renderMarkdown,
  scanFiles,
} from "../sidebar/sidebarFiles";
import {
  armImagePasteOnCanvas,
  cancelImagePaste,
  copyImageToClipboard,
  insertCodeIntoScene,
  insertImageIntoScene,
  pendingImagePaste,
} from "../sidebar/insertIntoScene";

type SceneUpdate = {
  elements?: readonly unknown[];
  appState?: unknown;
};

const createFakeApi = () => {
  const appState = {
    scrollX: 0,
    scrollY: 0,
    width: 1000,
    height: 800,
    zoom: { value: 1 },
    selectedElementIds: {} as Record<string, boolean>,
  };

  const calls: SceneUpdate[] = [];
  const files: unknown[] = [];

  const api = {
    id: "test-app",
    calls,
    files,
    getSceneElements: () => [] as never[],
    getAppState: () => appState,
    addFiles: (added: unknown[]) => {
      files.push(...added);
    },
    updateScene: (data: SceneUpdate) => {
      calls.push(data);
      Object.assign(appState, (data.appState as object) ?? {});
    },
  };

  return {
    api: api as unknown as ExcalidrawImperativeAPI,
    calls,
    files,
    appState,
  };
};

const makeFile = (name: string, type = "") => new File(["x"], name, { type });

/**
 * A file as the browser hands it over when a *folder* was picked: a flat list
 * whose files carry the path they had inside that folder.
 */
const makeFolderFile = (relativePath: string, type = "") => {
  const name = relativePath.split("/").pop()!;
  const file = new File(["x"], name, { type });

  Object.defineProperty(file, "webkitRelativePath", {
    configurable: true,
    value: relativePath,
  });

  return file;
};

describe("sidebar file classification", () => {
  it("treats stills and GIFs as images, videos separately", () => {
    expect(classify("a.png")).toBe("image");
    expect(classify("a.JPEG")).toBe("image");
    // a GIF is an image, but it is a kind of its own: it animates
    expect(classify("a.gif")).toBe("gif");
    expect(classify("a.mp4", "video/mp4")).toBe("video");
    expect(classify("a.pdf")).toBe("pdf");
    expect(classify("a.md")).toBe("markdown");
    expect(classify("a.ts")).toBe("code");
    expect(classify("a.txt")).toBe("text");
    expect(classify("a.unknown")).toBeNull();
  });

  it("maps extensions to shiki language ids", () => {
    expect(languageFor("a.ts")).toBe("typescript");
    expect(languageFor("a.py")).toBe("python");
    expect(languageFor("README.md")).toBe("markdown");
    expect(languageFor("notes.txt")).toBe("text");
  });

  it("gives every kind its own badge, so a .ts is not a TXT", () => {
    expect(kindLabel("image")).toBe("IMG");
    expect(kindLabel("gif")).toBe("GIF");
    expect(kindLabel("pdf")).toBe("PDF");
    expect(kindLabel("markdown")).toBe("MD");
    expect(kindLabel("code")).toBe("CODE");
    expect(kindLabel("text")).toBe("TXT");
    expect(kindLabel("video")).toBe("VID");
  });

  it("AC-44 one scan classifies every supported type", () => {
    const scan = scanFiles([
      makeFile("one.png", "image/png"),
      makeFile("two.gif", "image/gif"),
      makeFile("doc.pdf", "application/pdf"),
      makeFile("notes.md", ""),
      makeFile("script.ts", ""),
      makeFile("plain.txt", ""),
    ]);

    expect(scan.files.map((entry) => [entry.name, entry.kind])).toEqual([
      ["doc.pdf", "pdf"],
      ["notes.md", "markdown"],
      ["one.png", "image"],
      ["plain.txt", "text"],
      ["script.ts", "code"],
      ["two.gif", "gif"],
    ]);
  });

  it("AC-44 one scan returns the unsupported files with a reason", () => {
    const scan = scanFiles([
      makeFile("one.png", "image/png"),
      makeFile("clip.mp4", "video/mp4"),
      makeFile("unknown.docx", ""),
    ]);

    // nothing is dropped on the way to the list: every file we cannot use
    // comes back with the reason why
    expect(scan.unsupported.map((entry) => [entry.name, entry.reason])).toEqual(
      [
        ["clip.mp4", "video-not-embeddable"],
        ["unknown.docx", "unknown-type"],
      ],
    );

    // and the ones we can use are untouched by it
    expect(scan.files.map((entry) => entry.name)).toEqual(["one.png"]);
  });

  it("AC-44 the scan keeps the picked root whole, subfolders included", () => {
    const scan = scanFiles([
      makeFolderFile("root/notes.md", ""),
      makeFolderFile("root/sub/deep.png", "image/png"),
      makeFolderFile("root/sub/deeper/other.ts", ""),
    ]);

    expect(scan.rootName).toBe("root");
    expect(scan.files.map((entry) => entry.path)).toEqual([
      "notes.md",
      "sub/deep.png",
      "sub/deeper/other.ts",
    ]);
    expect(scan.files.map((entry) => entry.dir)).toEqual([
      [],
      ["sub"],
      ["sub", "deeper"],
    ]);
    // every directory of the root, so a folder can be walked into
    expect(scan.directories).toEqual([["sub"], ["sub", "deeper"]]);
  });

  it("AC-44 the accept list admits images, GIFs and video", () => {
    for (const accepted of [
      ".png",
      ".jpg",
      ".gif",
      ".mp4",
      ".webm",
      ".pdf",
      ".md",
      ".txt",
      ".ts",
      "image/*",
      "video/*",
      "application/pdf",
    ]) {
      expect(FILE_ACCEPT).toContain(accepted);
    }
  });

  it("AC-44 the accept list and the classifier cannot drift apart", () => {
    // every extension the classifier knows has to be in the accept list —
    // the two were hand-written before, and they drifted
    for (const name of [
      "a.png",
      "a.gif",
      "a.mp4",
      "a.pdf",
      "a.md",
      "a.txt",
      "a.ts",
      "a.rb",
      "a.kt",
      "a.rs",
      "a.dart",
      "a.ex",
      "a.hs",
      "a.zig",
      "a.ps1",
      "a.ini",
      "a.env",
      "a.gitignore",
    ]) {
      expect(classify(name)).not.toBeNull();
      expect(FILE_ACCEPT).toContain(`.${name.split(".").pop()}`);
    }
  });

  it("AC-45 the groups come out in the fixed order", () => {
    const scan = scanFiles([
      makeFile("two.gif", "image/gif"),
      makeFile("one.png", "image/png"),
      makeFile("doc.pdf", "application/pdf"),
      makeFile("notes.md", ""),
      makeFile("script.ts", ""),
      makeFile("plain.txt", ""),
      makeFile("clip.mp4", "video/mp4"),
      makeFile("unknown.docx", ""),
    ]);

    const groups = groupsAt(scan, []);

    expect(groups.map((group) => group.label)).toEqual([
      "Images",
      "Documents",
      "Markdown",
      "Code",
      "Video",
      "Unsupported",
    ]);

    // one icon per group
    for (const group of groups) {
      expect(group.icon).toBeTruthy();
    }

    // the files land in the group of their kind
    expect(
      groups
        .find((group) => group.label === "Images")!
        .entries.map((entry) => entry.file.name),
    ).toEqual(["one.png", "two.gif"]);
    expect(
      groups.find((group) => group.label === "Markdown")!.entries.length,
    ).toBe(2);
    expect(
      groups
        .find((group) => group.label === "Video")!
        .entries.map((entry) =>
          entry.type === "unsupported" ? entry.file.reason : "",
        ),
    ).toEqual(["video-not-embeddable"]);
    expect(
      groups
        .find((group) => group.label === "Unsupported")!
        .entries.map((entry) =>
          entry.type === "unsupported" ? entry.file.reason : "",
        ),
    ).toEqual(["unknown-type"]);
  });

  it("AC-45 the groups of a subfolder are the groups of that folder", () => {
    const scan = scanFiles([
      makeFolderFile("root/notes.md", ""),
      makeFolderFile("root/sub/deep.png", "image/png"),
    ]);

    expect(groupsAt(scan, []).map((group) => group.label)).toEqual([
      "Markdown",
    ]);
    expect(groupsAt(scan, ["sub"]).map((group) => group.label)).toEqual([
      "Images",
    ]);
  });
});

/**
 * Re-joins the per-run text elements back into the rows they were laid out as.
 *
 * This is the check that matters for the card. The runs are positioned by
 * cumulative character count, so if that arithmetic is off, every run is still
 * individually correct while the *line* comes back scrambled — which is exactly
 * the kind of bug a per-element assertion would sail straight past.
 *
 * Runs in a row always have distinct x, so ties only happen when the arithmetic
 * is broken. Ties therefore break on *descending* insertion order: a stable sort
 * would fall back to creation order and quietly reconstruct the right answer
 * from a completely wrong layout.
 */
const reassembleLines = (
  elements: Array<{ type: string; text?: string; x: number; y: number }>,
) => {
  const byRow = new Map<
    number,
    Array<{ x: number; seq: number; text: string }>
  >();

  elements.forEach((el, seq) => {
    if (el.type !== "text" || !el.text) {
      return;
    }

    const row = byRow.get(el.y) ?? [];
    row.push({ x: el.x, seq, text: el.text });
    byRow.set(el.y, row);
  });

  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x || b.seq - a.seq)
        .map((part) => part.text)
        .join(""),
    );
};

describe("insertCodeIntoScene", () => {
  it("builds one highlighted card out of many real text elements", async () => {
    const { api, calls } = createFakeApi();
    const code = "const a = 1;\nconst b = 2;\nconst c = 3;";

    const highlighted = await insertCodeIntoScene(api, code, {
      fileName: "snippet.ts",
      language: "typescript",
    });

    expect(highlighted).toBe(true);
    expect(calls).toHaveLength(1);

    const elements = calls[0].elements as Array<{
      type: string;
      text?: string;
      strokeColor: string;
      groupIds: string[];
      x: number;
      y: number;
    }>;

    const texts = elements.filter((el) => el.type === "text");

    // a card is a frame plus runs — never one flat block of uncoloured text
    expect(elements.filter((el) => el.type === "rectangle")).toHaveLength(1);
    expect(texts.length).toBeGreaterThan(1);
    expect(new Set(texts.map((el) => el.strokeColor)).size).toBeGreaterThan(1);

    // the filename header is gone
    expect(texts.some((el) => el.text?.includes("snippet.ts"))).toBe(false);

    // ...and the runs still spell the original source, in order
    expect(reassembleLines(elements)).toEqual(code.split("\n"));

    // everything is grouped so it moves as one card
    const groups = elements.map((el) => el.groupIds[0]);
    expect(new Set(groups).size).toBe(1);
  });

  it("wraps long lines instead of overflowing", async () => {
    const { api, calls } = createFakeApi();
    const long = `const value = "${"x".repeat(200)}";`;

    await insertCodeIntoScene(api, long, { language: "typescript" });

    const elements = calls[0].elements as Array<{
      type: string;
      text?: string;
      x: number;
      y: number;
    }>;

    // one card row is one y, so the distinct y values are the wrapped rows
    const rows = new Set(
      elements.filter((el) => el.type === "text").map((el) => el.y),
    );

    expect(rows.size).toBeGreaterThan(1);

    const lines = reassembleLines(elements);

    // the break landed on whitespace rather than mid-token where it could
    expect(lines[0]).toBe("const value =");

    // wrapping may consume the whitespace at a break point, but it must not eat
    // or duplicate a single non-space character
    expect(lines.join("").replace(/\s+/g, "")).toBe(long.replace(/\s+/g, ""));
  });

  it("gives each pasted card its own group, so they resize separately", async () => {
    const { api, calls } = createFakeApi();

    await insertCodeIntoScene(api, "const a = 1;", { language: "typescript" });
    await insertCodeIntoScene(api, "const b = 2;", { language: "typescript" });

    const groupsOf = (call: number) =>
      new Set(
        (calls[call].elements as Array<{ groupIds: string[] }>).map(
          (el) => el.groupIds[0],
        ),
      );

    // each card is internally one group...
    expect(groupsOf(0).size).toBe(1);
    expect(groupsOf(1).size).toBe(1);

    // ...and the second card does not join the first one's
    const [first] = [...groupsOf(0)];
    const [second] = [...groupsOf(1)];
    expect(second).not.toBe(first);
  });

  it("centres the card in the current viewport", async () => {
    const { api, calls, appState } = createFakeApi();
    appState.scrollX = -100;
    appState.scrollY = -50;

    await insertCodeIntoScene(api, "hello");

    const card = (
      calls[0].elements as Array<{
        type: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>
    ).find((el) => el.type === "rectangle")!;

    expect(card.x).toBeCloseTo((1000 / 2 - -100) * 1 - card.width / 2);
    expect(card.y).toBeCloseTo((800 / 2 - -50) * 1 - card.height / 2);
  });
});

describe("insertImageIntoScene", () => {
  it("adds one image element and registers its binary file", async () => {
    // jsdom cannot decode images, so give it a predictable size
    const originalImage = globalThis.Image;
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 800;
      naturalHeight = 400;
      set src(_value: string) {
        this.onload?.();
      }
    } as unknown as typeof Image;

    try {
      const { api, calls, files } = createFakeApi();

      await insertImageIntoScene(api, makeFile("pic.svg", "image/svg+xml"));

      const image = (calls[0].elements as Array<{ type: string }>).find(
        (el) => el.type === "image",
      );
      expect(image).toBeTruthy();
      expect(files).toHaveLength(1);
    } finally {
      globalThis.Image = originalImage;
    }
  });
});

const SCRIPT_URL_MARKER = ["java", "script:"].join("");

describe("renderMarkdown", () => {
  it("renders markdown as markdown instead of highlighted source", async () => {
    const html = await renderMarkdown(
      [
        "# Title",
        "",
        "Some **bold**, *italic* and `code`.",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
        "",
        "| a | b |",
        "| --- | --- |",
        "| 1 | 2 |",
      ].join("\n"),
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");

    // no raw markers survive
    expect(html).not.toContain("**bold**");
    expect(html).not.toContain("| --- |");
  });

  it("keeps a fenced block as a code block", async () => {
    const html = await renderMarkdown(
      ["```ts", "const a = 1 < 2;", "```"].join("\n"),
    );

    expect(html).toContain("<pre");
    // shiki keeps highlighting fenced blocks; its tokens are spans
    expect(html).toContain('class="shiki');
    expect(html.replace(/<[^>]*>/g, "")).toContain("const a = 1");
  });

  it("escapes raw HTML so a document cannot inject markup", async () => {
    const html = await renderMarkdown(
      [
        "<script>alert(1)</script>",
        "",
        "<img src=x onerror=alert(2)>",
        "",
        '<b onclick="steal()">hi</b>',
      ].join("\n"),
    );

    expect(html).not.toMatch(/<(script|img|b|iframe)\b/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x");
  });

  it("drops dangerous link and image URLs", async () => {
    const html = await renderMarkdown(
      [
        // assembled at runtime so the linter doesn't read it as a real URL
        `[click](${SCRIPT_URL_MARKER}alert(1))`,
        "",
        "![img](data:text/html;base64,PHNjcmlwdD4=)",
        "",
        "[ok](https://example.com/a)",
      ].join("\n"),
    );

    expect(html).not.toContain(SCRIPT_URL_MARKER);
    expect(html).not.toContain("data:text/html");
    expect(html).toContain('href="https://example.com/a"');
  });
});

describe("copy an image, then paste it on the canvas", () => {
  const originalImage = globalThis.Image;
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  const originalClipboardItem = globalThis.ClipboardItem;

  const mockImage = () => {
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 800;
      naturalHeight = 400;
      set src(_value: string) {
        this.onload?.();
      }
    } as unknown as typeof Image;
  };

  const mockClipboard = (write: unknown) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    globalThis.ClipboardItem = class {
      constructor(readonly items: unknown) {}
    } as unknown as typeof ClipboardItem;
  };

  const addCanvas = () => {
    const canvas = document.createElement("canvas");
    canvas.className = "excalidraw__canvas";
    document.body.appendChild(canvas);

    return canvas;
  };

  const clickCanvas = (canvas: HTMLCanvasElement, x: number, y: number) =>
    canvas.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }),
    );

  beforeEach(() => {
    mockImage();
  });

  afterEach(() => {
    cancelImagePaste();
    document.body.innerHTML = "";

    globalThis.Image = originalImage;

    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
    globalThis.ClipboardItem = originalClipboardItem;
  });

  it("reports success when the clipboard accepts the image", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    mockClipboard(write);

    await expect(
      copyImageToClipboard(makeFile("a.png", "image/png")),
    ).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("reports failure instead of throwing when the clipboard is blocked", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    await expect(
      copyImageToClipboard(makeFile("a.png", "image/png")),
    ).resolves.toBe(false);
  });

  it("stashes the image and inserts it at the clicked point, exactly once", async () => {
    const canvas = addCanvas();
    const { api, calls } = createFakeApi();

    armImagePasteOnCanvas(api, makeFile("pic.svg", "image/svg+xml"));
    expect(pendingImagePaste()?.name).toBe("pic.svg");

    clickCanvas(canvas, 120, 40);

    await vi.waitFor(() => expect(calls).toHaveLength(1));

    const image = (
      calls[0].elements as Array<{
        type: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>
    ).find((el) => el.type === "image")!;

    // scaled down to the 460px cap, and centred on the click
    expect(image.width).toBeCloseTo(460);
    expect(image.height).toBeCloseTo(230);
    expect(image.x).toBeCloseTo(120 - 230);
    expect(image.y).toBeCloseTo(40 - 115);

    // the listener is spent: a second click pastes nothing
    expect(pendingImagePaste()).toBeNull();
    clickCanvas(canvas, 10, 10);
    expect(calls).toHaveLength(1);
  });

  it("listens on the interactive canvas, not the inert static one", async () => {
    // Excalidraw renders both, and the static one comes first in the DOM but
    // is `pointer-events: none` — attaching the listener to it meant the
    // click-to-paste flow could never fire
    const staticCanvas = document.createElement("canvas");
    staticCanvas.className = "excalidraw__canvas static";
    document.body.appendChild(staticCanvas);

    const interactive = document.createElement("canvas");
    interactive.className = "excalidraw__canvas interactive";
    document.body.appendChild(interactive);

    const { api, calls } = createFakeApi();

    armImagePasteOnCanvas(api, makeFile("pic.svg", "image/svg+xml"));
    clickCanvas(interactive, 120, 40);

    await vi.waitFor(() => expect(calls).toHaveLength(1));
  });

  it("does not paste after the tab goes away", async () => {
    const canvas = addCanvas();
    const { api, calls } = createFakeApi();

    armImagePasteOnCanvas(api, makeFile("pic.svg", "image/svg+xml"));

    // what the tab's unmount cleanup runs
    cancelImagePaste();
    clickCanvas(canvas, 120, 40);

    await Promise.resolve();

    expect(calls).toHaveLength(0);
    expect(pendingImagePaste()).toBeNull();
  });
});
