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

    /** the wireframe that stands where a screenshot will land */
    wireframeBorderWidth: px(PANEL_CHROME.wireframeBorderWidth),
    wireframeFontSize: px(PANEL_CHROME.wireframeFontSize),
  };
};

/**
 * The chrome's geometry, as the type the surfaces take.
 */
export type PanelChrome = ReturnType<typeof panelChrome>;
