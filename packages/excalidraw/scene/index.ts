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
  getPageRectAtIndex,
  getPageRect,
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
  stampCurrentPage,
  normalizePage,
  getPageSize,
  growPage,
  shrinkPage,
  scalePageContent,
  deletePage,
  deletePageElements,
  translateContentForPageLayout,
  insertPageAfter,
  growPagesToFitContent,
  getPageClampRect,
} from "./pages";
export type { PageRect } from "../types";
