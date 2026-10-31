/**
 * AC-443 - the Flow tab's guide has a worked example of an animated chart, and
 * pressing it sets the script and the arrows' animation (D-380).
 *
 * The tab is used the way a teacher uses it: buttons pressed, and the page and
 * the animation's settings read afterwards.
 */

import { Excalidraw } from "@excalidraw/excalidraw";
import {
  flowAnimationStateAtom,
  updateFlowAnimationSettings,
} from "@excalidraw/excalidraw/components/FlowAnimationState";
import { editorJotaiStore } from "@excalidraw/excalidraw/editor-jotai";
import {
  act,
  fireEvent,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { FlowTab } from "../sidebar/FlowTab";
import { FLOW_ANIMATED_EXAMPLE } from "../sidebar/guideText";

const { h } = window;

const ONE_PAGE: ExcalidrawPage[] = [{ id: "page-1", name: "Page 1" }];

const renderStudio = async () => {
  const result = await render(
    <Excalidraw pagesEnabled={true} handleKeyboardGlobally={true}>
      <FlowTab />
    </Excalidraw>,
  );

  act(() => {
    h.setState({ pages: ONE_PAGE, currentPageId: "page-1" });
  });

  return result;
};

const live = () => h.elements.filter((el) => !el.isDeleted);

describe("AC-443 a worked example of an animated chart in the guide", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      updateFlowAnimationSettings({ arrowStyle: "none", nodeStyle: "none" });
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("AC-443 the guide opens with the example: its script, its four steps and a button", async () => {
    const { getByRole, getByTestId } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Guide" }));

    const section = getByTestId("flow-guide-animated");

    expect(section.textContent).toContain(FLOW_ANIMATED_EXAMPLE.title);
    expect(section.querySelector("pre")!.textContent).toBe(
      FLOW_ANIMATED_EXAMPLE.script,
    );
    expect(section.querySelectorAll("ol li")).toHaveLength(4);

    // it says how to get to a file, and which button does it
    expect(section.textContent).toMatch(/Marching dashes/);
    expect(section.textContent).toMatch(/Export/);
    expect(section.textContent).toMatch(/GIF, a WebP or an MP4/);

    // it comes before the kinds of chart, as the first thing the guide shows
    const guide = getByTestId("flow-guide");

    expect(
      section.compareDocumentPosition(
        guide.querySelector("[data-guide-preset]")!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("AC-443 pressing it fills the script, chooses the network and sets the arrows to marching dashes", async () => {
    const { getByRole, getByLabelText } = await renderStudio();

    // the animation is set to nothing, so a change is seen
    expect(editorJotaiStore.get(flowAnimationStateAtom).arrowStyle).toBe(
      "none",
    );

    fireEvent.click(getByRole("button", { name: "Guide" }));
    fireEvent.click(getByRole("button", { name: "Use this animated example" }));

    // back on the chart, with the network and the example's words
    expect(
      getByRole("radio", { name: /Network/ }).getAttribute("aria-checked"),
    ).toBe("true");
    expect((getByLabelText("Script") as HTMLTextAreaElement).value).toBe(
      FLOW_ANIMATED_EXAMPLE.script,
    );

    // and the animation is the one the example is made to show
    const animation = editorJotaiStore.get(flowAnimationStateAtom);

    expect(animation.arrowStyle).toBe("marching");
    expect(animation.nodeStyle).toBe("focus");
  });

  it("AC-443 the example is a chart the studio builds: ten boxes and eight arrows", async () => {
    const { getByRole } = await renderStudio();

    fireEvent.click(getByRole("button", { name: "Guide" }));
    fireEvent.click(getByRole("button", { name: "Use this animated example" }));
    fireEvent.click(getByRole("button", { name: "Insert chart" }));

    const nodes = live().filter(
      (el) =>
        el.type !== "arrow" &&
        el.type !== "text" &&
        el.customData?.flow?.role === "node",
    );
    const arrows = live().filter((el) => el.type === "arrow");

    expect(nodes).toHaveLength(10);
    expect(arrows).toHaveLength(8);
  });
});
