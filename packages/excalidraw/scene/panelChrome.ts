/**
 * The chrome of a panel: the header, the control strip, the buttons, the
 * sliders and the selects.
 *
 * ## The chrome is sized for the SCREEN, the content for the PANEL (D-92)
 *
 * A panel is a DOM overlay, and the overlay draws it with a `transform:
 * translate(...) scale(<zoom>) ...`, so everything inside the panel is
 * multiplied by the canvas zoom before it reaches the screen. The CONTENT
 * wants that: the code and the picture are the panel's own, and they grow and
 * shrink with it. The CHROME does not: the header, the control strip, the
 * buttons and the sliders are the teacher's instrument panel, and they have to
 * be readable and hittable at **every** zoom.
 *
 * What was measured on the owner's machine on 2026-10-22, at 51% zoom: the
 * code panel's header box was 11 screen pixels tall — its text overlapped —
 * and the video's control buttons were about 5. The chrome was sized in fixed
 * CSS pixels, so the zoom ate it.
 *
 * So every chrome size is a **SCREEN** size, and it is put into the panel's own
 * units by dividing it by the scale. The transform then brings it back to the
 * size it was meant to have.
 *
 * ## The scale has ONE source
 *
 * The scale is the panel element's own: `panelScale(camera)` is the very
 * number `panelTransform` folds into the panel's transform, and it is
 * published on the panel element as the CSS custom property `--panel-scale`.
 * The transform and the chrome therefore cannot disagree about the zoom:
 * nothing reads the zoom a second time, and no number is hard-coded here.
 *
 * ## Why the sizes are applied inline
 *
 * The sizes are applied inline, from this one module, and not from the
 * stylesheet: a size that cannot be measured cannot be defended, and the
 * acceptance criteria measure the chrome on screen (AC-128). The stylesheet
 * keeps the chrome's **arrangement**, and divides its spacing by the same
 * `--panel-scale`.
 */

/** The CSS custom property the panel's scale is published under. */
export const PANEL_SCALE_PROPERTY = "--panel-scale";

/**
 * The chrome's sizes, in SCREEN pixels.
 *
 * These are the sizes the teacher sees, whatever the zoom is. They are not
 * the sizes inside the panel: those are the screen sizes divided by the
 * scale, and `panelChrome` does that division.
 */
export const PANEL_CHROME = {
  /** the code panel's tab strip: tall enough for its own text */
  headerHeight: 22,
  headerFontSize: 12,
  /** the language shown beside the file's name */
  languageFontSize: 11,
  /** the video's control strip: not squeezed to nothing */
  controlHeight: 26,
  controlFontSize: 11,
  /** the buttons */
  buttonSize: 24,
  buttonFontSize: 12,
  /** the sliders */
  sliderHeight: 20,
  volumeWidth: 72,
  seekMinWidth: 56,
  /** the caption track select */
  trackHeight: 20,
  trackFontSize: 11,
  trackMaxWidth: 90,
  /** the screenshot's choice strip: three entries, sized like the chrome */
  choiceStripHeight: 24,
  choiceStripFontSize: 11,
  choiceStripPadding: 6,
  choiceStripGap: 4,
  /**
   * The width of **one** of the strip's three buttons (D-114).
   *
   * The buttons had a height and no width, so their width was decided by their
   * content - and their content is a word. A button whose width comes from its
   * label is a button the flexbox may shrink, and a button that is shrunk to
   * nothing is a choice the teacher cannot read and cannot hit. So the width is
   * **decided here**, like every other size of the chrome, and it is wide
   * enough for the longest of the three labels.
   */
  choiceStripButtonWidth: 104,
  /**
   * How far the camera sits from the panel's own corner (D-115).
   *
   * The camera is a chrome control of the panel (D-115), so it lives on the
   * panel - and it is kept clear of the panel's corner, because the corner is
   * where the canvas draws the resize handle.
   */
  panelCornerInset: 8,
  /** the wireframe that stands where a screenshot will land */
  wireframeBorderWidth: 1,
  wireframeFontSize: 11,
} as const;

/**
 * A SCREEN size, in the panel's own units.
 *
 * The panel is drawn with a `transform: scale(...)`, so a size inside it is
 * multiplied by the scale on its way to the screen. A chrome size is a screen
 * size, so it is divided by the scale on the way in (D-92).
 */
const panelUnit = (scale: number, screenPx: number): string =>
  `${Number((screenPx / scale).toFixed(4))}px`;

/**
 * The chrome's geometry, in the PANEL's own units.
 *
 * One place for every chrome size (D-92): a size that is written twice is a
 * size that can drift, and a size that is written once is a size a test can
 * measure.
 */
export const panelChrome = (scale: number) => {
  const px = (screenPx: number) => panelUnit(scale, screenPx);

  return {
    /** the code panel's tab strip */
    headerHeight: px(PANEL_CHROME.headerHeight),
    headerFontSize: px(PANEL_CHROME.headerFontSize),
    languageFontSize: px(PANEL_CHROME.languageFontSize),

    /** the video's control strip */
    controlHeight: px(PANEL_CHROME.controlHeight),
    controlFontSize: px(PANEL_CHROME.controlFontSize),

    /** the buttons */
    buttonSize: px(PANEL_CHROME.buttonSize),
    buttonFontSize: px(PANEL_CHROME.buttonFontSize),

    /** the sliders */
    sliderHeight: px(PANEL_CHROME.sliderHeight),
    volumeWidth: px(PANEL_CHROME.volumeWidth),
    seekMinWidth: px(PANEL_CHROME.seekMinWidth),

    /** the caption track select */
    trackHeight: px(PANEL_CHROME.trackHeight),
    trackFontSize: px(PANEL_CHROME.trackFontSize),
    trackMaxWidth: px(PANEL_CHROME.trackMaxWidth),

    /** the screenshot's choice strip */
    choiceStripHeight: px(PANEL_CHROME.choiceStripHeight),
    choiceStripFontSize: px(PANEL_CHROME.choiceStripFontSize),
    choiceStripPadding: px(PANEL_CHROME.choiceStripPadding),
    choiceStripGap: px(PANEL_CHROME.choiceStripGap),
    choiceStripButtonWidth: px(PANEL_CHROME.choiceStripButtonWidth),
    /**
     * The strip's own box: one row of buttons and the padding around them.
     *
     * The strip is drawn with `box-sizing: border-box`, so a strip that is as
     * tall as its buttons has no room for its own padding - and the buttons
     * hang out of it. The box is therefore decided here as well.
     */
    choiceStripBoxHeight: px(
      PANEL_CHROME.choiceStripHeight + 2 * PANEL_CHROME.choiceStripPadding,
    ),
    /** the camera's distance from the panel's own corner */
    panelCornerInset: px(PANEL_CHROME.panelCornerInset),
    /**
     * The room the panel's own chrome leaves for the camera (D-115).
     *
     * The camera hangs on the panel's corner, so whatever sits along that edge
     * - the code panel's header - has to keep clear of it.
     */
    cameraReserve: px(PANEL_CHROME.panelCornerInset + PANEL_CHROME.buttonSize),

    /** the wireframe that stands where a screenshot will land */
    wireframeBorderWidth: px(PANEL_CHROME.wireframeBorderWidth),
    wireframeFontSize: px(PANEL_CHROME.wireframeFontSize),
  };
};

/**
 * The chrome's geometry, as the type the surfaces take.
 */
export type PanelChrome = ReturnType<typeof panelChrome>;

/**
 * Where the screenshot's **choice strip** hangs, in the panel's own units
 * (D-114).
 *
 * The strip hangs **on the panel**: its right edge is the panel's own right
 * edge, and its top is the panel's own header - the chrome's header height -
 * when the panel wears one. A panel too short to hold the strip there takes it
 * lower, so the strip is never drawn below the panel's own bottom edge.
 *
 * The position is **computed from the panel's own rect**: the caller says how
 * tall the panel is and whether it wears a header, and the numbers come from
 * the chrome. Nothing here is guessed, and nothing is written twice.
 */
export const choiceStripPlacement = ({
  scale,
  panelHeight,
  hasHeader,
}: {
  /** the scale the panel is drawn at (`panelScale`) */
  scale: number;
  /** the panel's own height, in scene units */
  panelHeight: number;
  /** whether the panel wears a header the strip has to sit below */
  hasHeader: boolean;
}): { top: string; right: string } => {
  // the strip's box, in the panel's own units
  const box =
    (PANEL_CHROME.choiceStripHeight + 2 * PANEL_CHROME.choiceStripPadding) /
    scale;

  // the header the strip sits below, in the panel's own units
  const header = hasHeader ? PANEL_CHROME.headerHeight / scale : 0;

  // the camera hangs on the panel's own top-right corner (D-115), and the strip
  // hangs on that same edge - so the strip sits below the camera and the two
  // never cover each other
  const cameraBottom =
    (PANEL_CHROME.panelCornerInset + PANEL_CHROME.buttonSize) / scale;

  // the strip never hangs below the panel's own bottom edge
  const top = Math.min(
    Math.max(header, cameraBottom),
    Math.max(0, panelHeight - box),
  );

  return {
    top: `${Number(top.toFixed(4))}px`,
    right: "0px",
  };
};
