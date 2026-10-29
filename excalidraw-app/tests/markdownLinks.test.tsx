/**
 * AC-347, AC-348 - a link of a markdown document goes where it points, and its
 * text can be selected.
 *
 * A link to another file of the opened folder is read in the viewer; a link to
 * a heading scrolls to it; a link to another website is left to the browser,
 * which opens it in a new tab; and a link to a file that was not opened says so.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { ExcalidrawAPIContext } from "@excalidraw/excalidraw/components/App";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { resetBrowserState } from "../sidebar/browserState";
import { FilesTab } from "../sidebar/FilesTab";
import {
  findHeading,
  headingSlug,
  renderMarkdown,
  resolveDocumentLink,
} from "../sidebar/sidebarFiles";

import type { ScannedFile } from "../sidebar/sidebarFiles";

/** a scanned markdown file at `path`, as the scan makes it */
const doc = (path: string): ScannedFile => {
  const segments = path.split("/");
  const name = segments[segments.length - 1];

  return {
    file: new File([""], name),
    name,
    path,
    dir: segments.slice(0, -1),
    kind: "markdown",
    language: "markdown",
  };
};

const FILES = [
  "lesson.md",
  "notes/a.md",
  "notes/b.md",
  "notes/my file.md",
  "notes/sub/c.md",
  "top.md",
  "basics/index.md",
  "readme-dir/README.md",
  "same/same.md",
  "plain.md",
].map(doc);

const linkFrom = (from: string, href: string, origin?: string) =>
  resolveDocumentLink({ href, from, files: FILES, origin });

/** the path of the document a link opens, or what else it came to */
const opens = (from: string, href: string, origin?: string) => {
  const link = linkFrom(from, href, origin);

  return link.type === "document" ? link.file.path : link.type;
};

describe("AC-347 a link of a document goes where it points", () => {
  it("AC-347 a link is resolved against the folder of the document", () => {
    // as written, with ./, with the extension left out
    expect(opens("notes/a.md", "b.md")).toBe("notes/b.md");
    expect(opens("notes/a.md", "./b.md")).toBe("notes/b.md");
    expect(opens("notes/a.md", "b")).toBe("notes/b.md");
    expect(opens("notes/a.md", "sub/c")).toBe("notes/sub/c.md");

    // up out of the folder, and from the root
    expect(opens("notes/sub/c.md", "../a.md")).toBe("notes/a.md");
    expect(opens("notes/a.md", "../top.md")).toBe("top.md");
    expect(opens("notes/a.md", "/top.md")).toBe("top.md");
    // not found where it stands: the top of the opened folder is tried
    expect(opens("notes/a.md", "top.md")).toBe("top.md");

    // a space written as %20, and a name in other letters
    expect(opens("notes/a.md", "my%20file.md")).toBe("notes/my file.md");
    expect(opens("notes/a.md", "MY FILE")).toBe("notes/my file.md");

    // a query is not part of the file
    expect(opens("notes/a.md", "b.md?x=1")).toBe("notes/b.md");
  });

  it("AC-347 a folder, a heading and the app's own address", () => {
    // a folder is its index, its README, or the file named like it
    expect(opens("lesson.md", "basics/")).toBe("basics/index.md");
    expect(opens("lesson.md", "basics")).toBe("basics/index.md");
    expect(opens("lesson.md", "readme-dir/")).toBe("readme-dir/README.md");
    expect(opens("lesson.md", "same/")).toBe("same/same.md");
    // a file named like the link, with the extension left out, comes first
    expect(opens("lesson.md", "plain/")).toBe("plain.md");

    // a heading of the document, and of another one
    expect(linkFrom("lesson.md", "#Second Part")).toEqual({
      type: "anchor",
      anchor: "Second Part",
    });

    const other = linkFrom("lesson.md", "top.md#a-heading");

    expect(other).toMatchObject({ type: "document", anchor: "a-heading" });

    // the app's own address is where the browser would have looked for it
    expect(
      opens(
        "lesson.md",
        "http://localhost:3059/basics/",
        "http://localhost:3059",
      ),
    ).toBe("basics/index.md");
    expect(
      opens(
        "lesson.md",
        "http://localhost:3059/top.md#x",
        "http://localhost:3059",
      ),
    ).toBe("top.md");
    // another port is another website
    expect(
      opens(
        "lesson.md",
        "http://localhost:3059/basics/",
        "http://localhost:3000",
      ),
    ).toBe("external");
  });

  it("AC-347 an address elsewhere is external, and a file that is not there is missing", () => {
    for (const href of [
      "https://example.com/page",
      "http://example.com",
      "mailto:teacher@example.com",
      "//cdn.example.com/x.js",
      "ftp://example.com/file",
    ]) {
      expect(opens("lesson.md", href, "http://localhost:3059")).toBe(
        "external",
      );
    }

    expect(linkFrom("lesson.md", "nothing.md")).toEqual({
      type: "missing",
      target: "nothing.md",
    });
    // up past the top of the opened folder is not a file of it
    expect(linkFrom("lesson.md", "../../outside.md").type).toBe("missing");
  });

  it("AC-347 a heading is found by what it says", () => {
    expect(headingSlug("Second Part!")).toBe("second-part");

    const body = document.createElement("div");

    body.innerHTML = "<h1>First</h1><h2>Second Part</h2>";

    expect(findHeading(body, "second-part")?.textContent).toBe("Second Part");
    expect(findHeading(body, "Second Part")?.textContent).toBe("Second Part");
    expect(findHeading(body, "nothing")).toBeNull();
  });
});

describe("AC-347 a link in the viewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** a file at `path` inside the picked folder, as the browser hands it over */
  const makeFile = (path: string, body: string) => {
    const file = new File([body], path.split("/").pop()!);

    Object.defineProperty(file, "webkitRelativePath", {
      configurable: true,
      value: `course/${path}`,
    });
    Object.defineProperty(file, "text", {
      configurable: true,
      value: () => Promise.resolve(body),
    });

    return file;
  };

  const pickFiles = (input: HTMLInputElement, files: File[]) => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files,
    });
    fireEvent.change(input);
  };

  /** the sidebar with a folder picked and `lesson.md` open */
  const openLesson = async (lesson: string) => {
    const setToast = vi.fn();
    const api = {
      id: "test-app",
      getSceneElements: () => [] as never[],
      getAppState: () => ({}),
      updateScene: () => {},
      setToast,
    } as unknown as ExcalidrawImperativeAPI;

    resetBrowserState();

    const { container } = render(
      <ExcalidrawAPIContext.Provider value={api}>
        <FilesTab />
      </ExcalidrawAPIContext.Provider>,
    );

    pickFiles(
      container.querySelector<HTMLInputElement>(
        'input[type="file"][webkitdirectory]',
      )!,
      [
        makeFile("lesson.md", lesson),
        makeFile("python-basics-v2/index.md", "# Basics\n\n## Loops\n\ntext"),
        makeFile("other.md", "# Other\n\n## Second Part\n\nmore"),
      ],
    );

    fireEvent.click(
      Array.from(container.querySelectorAll(".app-file-list__row")).find(
        (row) => row.textContent?.includes("lesson.md"),
      )!,
    );

    await waitFor(() =>
      expect(container.querySelector(".app-doc-markdown a")).not.toBeNull(),
    );

    // the viewer listens for the end of a selection from an effect: let it run
    await act(async () => {});

    return { container, setToast };
  };

  it("AC-347 clicking a link to another file opens it in the viewer", async () => {
    // written as the folder is written, and with this app's own address
    for (const href of [
      "python-basics-v2/",
      `${window.location.origin}/python-basics-v2/`,
    ]) {
      const { container } = await openLesson(`[the basics](${href})`);

      const link = container.querySelector<HTMLAnchorElement>(
        ".app-doc-markdown a",
      )!;

      // the browser does not follow it: no tab with this app in it
      expect(fireEvent.click(link)).toBe(false);

      await waitFor(() =>
        expect(
          container.querySelector(".app-doc-title__name")?.textContent,
        ).toBe("index.md"),
      );
      await waitFor(() =>
        expect(
          container.querySelector(".app-doc-markdown h1")?.textContent,
        ).toBe("Basics"),
      );
    }
  });

  it("AC-347 clicking a link to a heading scrolls to it", async () => {
    const scrolled: string[] = [];

    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this.textContent ?? "");
    });

    const { container } = await openLesson(
      [
        "[down](#the-end)",
        "",
        "[over there](other.md#second-part)",
        "",
        "## The end",
      ].join("\n"),
    );

    const [down, over] = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".app-doc-markdown a"),
    );

    // a heading of the document itself: it is scrolled to, nothing else opens
    expect(fireEvent.click(down)).toBe(false);
    expect(scrolled).toEqual(["The end"]);
    expect(container.querySelector(".app-doc-title__name")?.textContent).toBe(
      "lesson.md",
    );

    // a heading of another document: it opens, and goes to the heading
    expect(fireEvent.click(over)).toBe(false);

    await waitFor(() =>
      expect(container.querySelector(".app-doc-title__name")?.textContent).toBe(
        "other.md",
      ),
    );
    await waitFor(() => expect(scrolled).toEqual(["The end", "Second Part"]));

    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("AC-347 an external link is left to the browser, and a missing file is said", async () => {
    const { container, setToast } = await openLesson(
      ["[web](https://example.com/page)", "", "[gone](missing-lesson)"].join(
        "\n",
      ),
    );

    const [web, gone] = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".app-doc-markdown a"),
    );

    // not stopped: the browser opens it in a new tab, because of its target
    expect(web.getAttribute("target")).toBe("_blank");
    expect(fireEvent.click(web)).toBe(true);
    expect(setToast).not.toHaveBeenCalled();

    // stopped, and said: it must not load this app in a tab of its own
    expect(fireEvent.click(gone)).toBe(false);
    expect(setToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("missing-lesson"),
      }),
    );
    expect(container.querySelector(".app-doc-title__name")?.textContent).toBe(
      "lesson.md",
    );
  });

  it("AC-348 the text of a link is part of the selected text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const { container } = await openLesson(
      "Previous: [03-core.md](03-core.md) · Index: [README.md](README.md)",
    );

    const paragraph = container.querySelector(".app-doc-markdown p")!;
    const range = document.createRange();

    range.selectNodeContents(paragraph);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    fireEvent.mouseUp(paragraph);

    // the names of the links are in what was copied, not left out of it
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "Previous: 03-core.md · Index: README.md",
      ),
    );
    expect(container.querySelector(".app-doc-selection")).not.toBeNull();
  });
});

describe("AC-348 the text of a link can be selected", () => {
  it("AC-348 a link in a document cannot be dragged", async () => {
    const html = await renderMarkdown(
      [
        "A [link](https://example.com/docs) in a sentence.",
        "",
        "| name | page |",
        "| --- | --- |",
        "| docs | [the docs](https://example.com/docs) |",
      ].join("\n"),
    );

    const body = document.createElement("div");

    body.innerHTML = html;

    const links = Array.from(body.querySelectorAll("a"));

    expect(links).toHaveLength(2);

    for (const link of links) {
      // a link that is dragged is not selected: the browser starts a drag of
      // the address instead of selecting its text
      expect(link.getAttribute("draggable")).toBe("false");
      // and it still opens elsewhere, safely
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    }

    // the one in the table is a cell's text like any other
    expect(body.querySelector("td a")?.textContent).toBe("the docs");
  });

  it("AC-348 the style lifts the library's rule against selecting on a link", () => {
    // the library puts `user-select: none` on every link inside `.excalidraw`:
    // the text of such a link is not highlighted and is not in the selected
    // text, which is how "Previous: · Index:" came out without its links
    const library = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "packages",
        "excalidraw",
        "css",
        "styles.scss",
      ),
      "utf8",
    );
    const rule = library.slice(library.indexOf(".excalidraw-link,\n  a {"));

    expect(rule.slice(0, rule.indexOf("&:hover"))).toMatch(
      /user-select:\s*none/,
    );

    const styles = readFileSync(
      join(__dirname, "..", "sidebar", "sidebar.scss"),
      "utf8",
    );
    const override = styles.slice(styles.indexOf(".excalidraw & a {"));

    expect(override.startsWith(".excalidraw & a {")).toBe(true);
    expect(override.slice(0, override.indexOf("}"))).toMatch(
      /user-select:\s*text/,
    );
  });
});
