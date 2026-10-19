export {
  isSomeElementSelected,
  getElementsWithinSelection,
  getSelectedElements,
  getTargetElements,
} from "@excalidraw/element";
export { calculateScrollCenter } from "./scroll";
export {
  hasBackground,
  hasStrokeWidth,
  hasStrokeStyle,
  canHaveArrowheads,
  canChangeRoundness,
} from "@excalidraw/element";
export {
  getNormalizedZoom,
  getNormalizedGridSize,
  getNormalizedGridStep,
} from "./normalize";
export {
  getPageRectByIndex,
  getPageIndex,
  getCurrentPageRect,
  getFitPageZoom,
  clampCameraToPage,
  getCameraForPage,
  getPageRelativeCamera,
  getCameraFromPageRelative,
  getElementsForPage,
  getOrderedElementsForPage,
  getPageViewportWidth,
  MIN_PAGE_VIEWPORT_WIDTH,
  getDefaultPage,
} from "./pages";
export type { PageRect } from "../types";
