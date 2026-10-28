/**
 * AC-300 - the view can leave the page, and one button brings it back.
 *
 * Content can sit outside the page (an imported drawing, a long document),
 * and a teacher has to be able to scroll to it, then return to the page they
 * are on.
 */

import {
  Excalidraw,
  getCameraForPage,
  getPageRect,
} from "@excalidraw/excalidraw";
import { MAX_ZOOM } from "@excalidraw/common";
import {
  act,
  fireEvent,
  render,
} from "@excalidraw/excalidraw/tests/test-utils";

import type { ExcalidrawPage } from "@excalidraw/excalidraw/types";

import { Provider, appJotaiStore } from "../app-jotai";
import PageBar from "../components/PageBar";
import { resetDocumentStore } from "../data/LocalData";
import { resetDocumentStats } from "../data/documentStats";

const { h } = window;

const PAGES: ExcalidrawPage[] = [
  { id: "page-1", name: "Page 1" },
  { id: "page-2", name: "Page 2" },
];

describe("AC-300 the view can leave the page", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDocumentStore();
    resetDocumentStats();
  });

  afterEach(() => {
    resetDocumentStore();
  });

  const setup = async () => {
    const result = await render(
      <Provider store={appJotaiStore}>
        <Excalidraw pagesEnabled={true}>
          <PageBar />
        </Excalidraw>
      </Provider>,
    );

    act(() => {
      h.setState({
        pages: PAGES,
        currentPageId: "page-1",
        width: 1200,
        height: 800,
      });
    });

    return result;
  };

  const pageCamera = () =>
    getCameraForPage({
      viewportWidth: h.state.width,
      viewportHeight: h.state.height,
      pageRect: getPageRect(h.state.pages, h.state.currentPageId),
      maxZoom: MAX_ZOOM,
    });

  it("AC-300 the view can leave the page", async () => {
    await setup();

    const far = { scrollX: -50000, scrollY: -40000 };

    act(() => {
      h.setState(far);
    });

    // the view stays where it was put, outside the page
    expect(h.state.scrollX).toBe(far.scrollX);
    expect(h.state.scrollY).toBe(far.scrollY);
  });

  it("AC-300 the back button appears and returns to the page", async () => {
    const { queryByLabelText, getByLabelText } = await setup();

    // on the page: no button
    act(() => {
      const { zoom, ...camera } = pageCamera();

      h.setState({ ...camera, zoom: { value: zoom } });
    });
    expect(queryByLabelText("Back to this page")).toBeNull();

    // far from the page: the button is there, and a click frames the page
    act(() => {
      h.setState({ scrollX: -50000, scrollY: -40000 });
    });
    fireEvent.click(getByLabelText("Back to this page"));

    const camera = pageCamera();

    expect(h.state.scrollX).toBeCloseTo(camera.scrollX);
    expect(h.state.scrollY).toBeCloseTo(camera.scrollY);
    expect(h.state.zoom.value).toBeCloseTo(camera.zoom);
    expect(queryByLabelText("Back to this page")).toBeNull();
  });
});
