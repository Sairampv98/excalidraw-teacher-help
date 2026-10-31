import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ExcalidrawPanelElement } from "@excalidraw/element/types";

import { t } from "../i18n";

import { CONTROL_RELEASE_CHORD } from "../scene/panelControl";
import { readCodePanelState, readPanelMirror } from "../scene/panelContent";
import { getPanelCapture, subscribePanelCaptures } from "../scene/panelFrames";
import {
  FOLLOW_SIZE_MAX,
  FOLLOW_SIZE_MIN,
  FOLLOW_SIZE_STEP,
  openPanelMirrorPicker,
  panelMirrorCrop,
  panelMirrorMode,
  panelMirrorRegionNudge,
  resizePanelMirrorRegion,
  withPanelMirrorMode,
} from "../scene/panelMirror";
import { mirrorPanelView } from "../scene/mirrorPanelView";
import { snapshotUrl } from "../scene/panelScreenshot";

import { KEYBOARD_TAKEN_ATTRIBUTE } from "./keyboardTaken";

import Spinner from "./Spinner";
import { toggleFullscreen } from "./panelFullscreen";
import { PanelIcon } from "./panelIcons";
import { usePanelControlSurface } from "./usePanelControlSurface";
import { PANEL_PALETTES } from "./vscodeTheme";

import type { PanelControlControls } from "../scene/panelControl";
import type { PanelMirror, PanelMirrorMode } from "../scene/panelMirror";
import type { PanelChrome } from "../scene/panelChrome";
import type {
  PanelBridgeControls,
  PanelOcrControls,
  PanelScreenshotControls,
} from "../types";

/**
 * The **VS Code mirror**: the editor's own window, and nothing else (D-331).
 *
 * It was the code panel with a toggle between the editor's text and the live
 * window, and the toggle became a second panel the day the menu offered the two
 * separately: the code editor (in the browser) and the VS Code mirror (bridge).
 * So the mirror is built for what it is - **one thing, in a few states**:
 *
 *  - a spinner and a sentence while it connects and while it waits;
 *  - an error and a sentence when it cannot (the token is refused, the editor's
 *    window is not there ...), with the field to paste a new token where the
 *    token is the problem;
 *  - the live window, with its tools in the header (D-332): the three ways to
 *    look at it, the control, the parking, the picture and the read.
 *
 * The state is a pure rule (`scene/mirrorPanelView.ts`), and a change of state
 * fades in, so the panel is never a flicker between two screens.
 *
 * There is no text mirror, no run bar and no console here: the code editor has
 * them, and what the bridge runs is shown by the editor it runs in.
 */

/** A body that fades in when it appears: a change of state is a transition. */
const Fade = ({ children }: { children: React.ReactNode }) => {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 0);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: shown ? 1 : 0,
        transition: "opacity 180ms ease",
      }}
    >
      {children}
    </div>
  );
};

/** how often the following area takes a step towards the pointer (D-337) */
const FOLLOW_INTERVAL_MS = 120;

/** the colour of the dot that says how the connection stands */
const DOT_COLOURS = {
  good: "#3fb950",
  wait: "#d29922",
  bad: "#f85149",
} as const;

/** the name of the file in a uri: the last part of its path */
const fileNameOf = (uri: string | undefined): string => {
  if (!uri) {
    return "";
  }

  try {
    return decodeURIComponent(uri.split("/").pop() ?? "");
  } catch {
    return uri.split("/").pop() ?? "";
  }
};

/**
 * The **sharpening** of the live picture (D-354).
 *
 * The window is captured at its own size and drawn in a panel that is a third
 * of that or less, so the browser has to shrink it - and a picture that is
 * shrunk comes out soft, text first. The picture is drawn through a 3x3
 * sharpening kernel (the weights add up to one, so brightness is kept): it
 * works on the pixels that are drawn, and not on the ones that are streamed,
 * so it adds nothing to the capture, the stream or the bytes. What it costs is
 * the browser's filter pass over the panel's area for every frame, which was
 * measured (D-354).
 */
/**
 * Whether the header has run out of room (D-361).
 *
 * The header is one row of buttons with words on them, and a panel that is
 * narrow wrapped it onto a second row, which took a third of the picture. A
 * header that wraps is a header with no room for its words: the buttons that
 * have an icon keep the icon, and the words are in their tooltips. It is
 * measured, not guessed: the row has wrapped when the middles of its children
 * are not all on one line. The width at which it wrapped is kept, and the words come
 * back when the header is clearly wider than that.
 */
const useCompactWhenWrapped = (
  ref: React.RefObject<HTMLElement | null>,
): boolean => {
  const [compact, setCompact] = useState(false);
  const wrappedAt = useRef(0);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const measure = () => {
      const width = element.clientWidth;

      if (!compact) {
        // the middles of the children: a row has one, whatever the heights are
        const middles = Array.from(element.children).map((child) => {
          const box = child as HTMLElement;

          return box.offsetTop + box.offsetHeight / 2;
        });

        if (Math.max(...middles) - Math.min(...middles) > 6) {
          wrappedAt.current = width;
          setCompact(true);
        }
      } else if (width > wrappedAt.current + Math.max(120, width * 0.2)) {
        setCompact(false);
      }
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(element);

    return () => observer.disconnect();
  }, [compact, ref]);

  return compact;
};

const MirrorSharpenFilter = ({ id }: { id: string }) => (
  <svg
    aria-hidden="true"
    width="0"
    height="0"
    style={{ position: "absolute", pointerEvents: "none" }}
  >
    <filter id={id} colorInterpolationFilters="sRGB">
      <feConvolveMatrix
        order="3"
        kernelMatrix="0 -0.4 0 -0.4 2.6 -0.4 0 -0.4 0"
        divisor="1"
        edgeMode="duplicate"
        preserveAlpha="true"
      />
    </filter>
  </svg>
);

export const MirrorPanelSurface = ({
  panel,
  chrome,
  readOnly,
  bridge,
  screenshot,
  ocr,
  onMirrorChange,
  control,
}: {
  panel: ExcalidrawPanelElement;
  /** the chrome's geometry, in the panel's own units (D-92) */
  chrome: PanelChrome;
  /** the host is a read-only mirror - the presenter (D-57) */
  readOnly?: boolean;
  /** the host's bridge: the connection, and the field for the token (D-333) */
  bridge?: PanelBridgeControls;
  /** the host's screenshot controls (D-102) */
  screenshot?: PanelScreenshotControls;
  /** the host's read of the picture (D-59, D-118) */
  ocr?: PanelOcrControls;
  /** the teacher chose what is mirrored (D-143) */
  onMirrorChange?: (panelId: string, mirror: PanelMirror) => void;
  /** the host's controls for the control of the mirrored window (D-323) */
  control?: PanelControlControls;
}) => {
  const state = readCodePanelState(panel.panel);
  const palette = PANEL_PALETTES.dark;
  const mirror = readPanelMirror(panel.panel);
  const mode = panelMirrorMode(mirror);
  const isReadOnly = Boolean(readOnly);

  /** the live view's descriptor, as the registry holds it (D-85) */
  const capture = useSyncExternalStore(subscribePanelCaptures, () =>
    getPanelCapture(panel.id),
  );

  const view = mirrorPanelView({
    readOnly: isReadOnly,
    bridge: bridge ? { status: bridge.status, phase: bridge.phase } : undefined,
    capture,
  });

  const live = view === "live" && capture?.status === "live" ? capture : null;
  const picture =
    live && live.width && live.height
      ? { width: live.width, height: live.height }
      : null;

  // ------------------------------------------------------------------ sizes

  /**
   * The area the picture is shown in, in pixels (D-143): the region's window is
   * fitted into it, so the region keeps its shape and the picture is never
   * stretched.
   */
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = sourceRef.current;

    if (!element) {
      return;
    }

    const measure = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;

      if (!width || !height) {
        // a panel that is not on the screen measures nothing: the last good
        // measurement stands
        return;
      }

      setArea((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);

      observer.observe(element);

      return () => observer.disconnect();
    }

    window.addEventListener("resize", measure);

    return () => window.removeEventListener("resize", measure);
  }, []);

  const crop = panelMirrorCrop(mirror.region, picture, area);

  // -------------------------------------------------------- mode and picker

  /** the window the region is shown through, for the pointer (D-143, D-324) */
  const windowRef = useRef<HTMLDivElement | null>(null);
  const lastFollowRef = useRef(0);
  /** where the pointer is over the window, while it is over it (D-337) */
  const followPointerRef = useRef<{ x: number; y: number } | null>(null);
  /** the latest mirror, for the steps that are taken while the pointer rests */
  const mirrorRef = useRef(mirror);

  mirrorRef.current = mirror;

  /**
   * The teacher chose a mode (D-322).
   *
   * **Part** with no region to keep - or when the part is already the mode -
   * opens the picker: it is how a part is drawn, and how it is drawn again. The
   * picker is drawn over the page, and into the full screen element when the
   * panel is full screen (D-334).
   */
  const chooseMode = (next: PanelMirrorMode) => {
    if (next === "part" && (mode === "part" || !mirror.region)) {
      if (capture?.status === "live") {
        openPanelMirrorPicker(
          panel.id,
          {
            src: snapshotUrl(capture.streamUrl),
            width: capture.width ?? 0,
            height: capture.height ?? 0,
          },
          mirror.region,
        );
      }

      return;
    }

    if (next !== mode) {
      onMirrorChange?.(panel.id, withPanelMirrorMode(mirror, next));
    }
  };

  // ---------------------------------------------------------------- control

  // the header keeps to one row (D-361)
  const headerRef = useRef<HTMLDivElement>(null);
  const compact = useCompactWhenWrapped(headerRef);

  // the id of the sharpening filter the live picture is drawn through (D-354)
  const sharpenId = `mirror-sharpen-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const controlState = capture?.status === "live" ? capture.control : undefined;
  const controlOn =
    !isReadOnly && Boolean(control?.onToggle) && controlState?.enabled === true;
  const parked = capture?.status === "live" && capture.parked === true;
  const virtualOn = capture?.status === "live" && capture.virtual === true;
  const virtualAvailable =
    capture?.status === "live" && capture.virtualAvailable === true;
  const canControl =
    !isReadOnly &&
    Boolean(control?.onToggle) &&
    live !== null &&
    live.control !== undefined;

  const surface = usePanelControlSurface({
    panelId: panel.id,
    enabled: controlOn,
    region: mirror.region,
    boxRef: windowRef,
    picture,
    onInput: control?.onInput,
    onRelease: () => {
      // the keyboard goes back to the canvas
      windowRef.current
        ?.closest<HTMLElement>(".excalidraw")
        ?.focus({ preventScroll: true });
    },
  });

  // Control has been turned on: the window takes the keyboard at once, so the
  // teacher does not have to click it first (D-337)
  const wasControlOn = useRef(false);

  useEffect(() => {
    if (controlOn && !wasControlOn.current) {
      windowRef.current?.focus({ preventScroll: true });
    }

    wasControlOn.current = controlOn;
  }, [controlOn]);

  /**
   * A step of the following area towards the pointer (D-143, D-337).
   *
   * The area keeps its size and stands still while the pointer is in the rest
   * zone; outside it, it moves towards the pointer, faster the further out the
   * pointer is. It stands still while a button is down, so a drag does not run
   * away from the pointer.
   */
  const followStep = () => {
    const current = mirrorRef.current;
    const pointer = followPointerRef.current;

    if (
      isReadOnly ||
      !current.follow ||
      !current.region ||
      !pointer ||
      !windowRef.current ||
      surface.isPressed()
    ) {
      return;
    }

    const rect = windowRef.current.getBoundingClientRect();
    const next = panelMirrorRegionNudge(current.region, pointer, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });

    if (next.x === current.region.x && next.y === current.region.y) {
      return;
    }

    lastFollowRef.current = Date.now();
    onMirrorChange?.(panel.id, { ...current, region: next });
  };

  const onFollowMove = (event: React.PointerEvent<HTMLDivElement>) => {
    followPointerRef.current = { x: event.clientX, y: event.clientY };

    if (Date.now() - lastFollowRef.current >= FOLLOW_INTERVAL_MS) {
      followStep();
    }
  };

  // The pointer rests outside the rest zone and the area goes on moving: a step
  // is taken every interval while the pointer is over the window (D-337)
  const followOn = !isReadOnly && mirror.follow && mirror.region !== null;

  useEffect(() => {
    if (!followOn) {
      followPointerRef.current = null;
      return undefined;
    }

    const timer = window.setInterval(followStep, FOLLOW_INTERVAL_MS);

    return () => window.clearInterval(timer);
    // the step reads the latest mirror from its ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followOn]);

  // ----------------------------------------------------------------- styles

  const barSize = `calc(${chrome.buttonSize} * 1.5)`;
  const iconSize = "62%";

  const tool = (
    options: { active?: boolean; disabled?: boolean; wide?: boolean } = {},
  ): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: chrome.chromeGap,
    flex: "0 0 auto",
    height: barSize,
    minWidth: barSize,
    padding: options.wide ? `0 ${chrome.chromeGap}` : 0,
    background: options.active ? palette.accent : "transparent",
    border: `1px solid ${palette.border}`,
    borderRadius: 4,
    color: palette.foreground,
    font: "inherit",
    cursor: options.disabled ? "not-allowed" : "pointer",
    opacity: options.disabled ? 0.5 : 1,
  });

  const dotColour =
    view === "live"
      ? DOT_COLOURS.good
      : view === "refused" || view === "unavailable" || view === "token"
      ? DOT_COLOURS.bad
      : DOT_COLOURS.wait;

  const title = fileNameOf(state?.editor.uri) || t("labels.mirror.title");

  // ----------------------------------------------------------------- header

  const modes = (
    [
      {
        option: "whole",
        testId: "code-panel-mirror-whole",
        label: t("labels.mirror.modeWhole"),
        hint: t("labels.mirror.wholeWindow"),
      },
      {
        option: "part",
        testId: "code-panel-mirror-region",
        label: t("labels.mirror.modePart"),
        hint: t("labels.mirror.change"),
      },
      {
        option: "follow",
        testId: "code-panel-mirror-follow",
        label: t("labels.mirror.modeFollow"),
        hint:
          mode === "follow"
            ? t("labels.mirror.following")
            : t("labels.mirror.follow"),
      },
    ] as const
  ).map(({ option, testId, label, hint }) => (
    <button
      key={option}
      type="button"
      className="excalidraw__panel-code-mirror"
      data-testid={testId}
      data-panel-id={panel.id}
      data-mode-option={option}
      data-follow={
        option === "follow" ? (mirror.follow ? "on" : "off") : undefined
      }
      aria-pressed={mode === option}
      onClick={() => chooseMode(option)}
      title={hint}
      aria-label={hint}
      style={tool({ active: mode === option, wide: true })}
    >
      {label}
    </button>
  ));

  const header = (
    <div
      ref={headerRef}
      className="excalidraw__panel-mirror-header"
      data-testid="mirror-panel-header"
      data-compact={compact ? "yes" : "no"}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: chrome.chromeGap,
        flex: "0 0 auto",
        minHeight: chrome.headerHeight,
        padding: chrome.chromeGap,
        fontSize: chrome.headerFontSize,
        borderBottom: `1px solid ${palette.accent}`,
      }}
    >
      <span
        data-testid="mirror-panel-dot"
        data-view={view}
        aria-hidden="true"
        style={{
          width: "0.7em",
          height: "0.7em",
          borderRadius: "50%",
          background: dotColour,
          flex: "0 0 auto",
        }}
      />
      <span
        className="excalidraw__panel-code-file"
        data-testid="mirror-panel-title"
        style={{
          fontFamily: "monospace",
          flex: "0 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>

      {live && !isReadOnly && onMirrorChange ? (
        <div
          className="excalidraw__panel-code-mirror-modes"
          data-testid="code-panel-mirror-modes"
          data-mode={mode}
          role="group"
          aria-label={t("labels.mirror.picker")}
          style={{ display: "inline-flex", gap: 2 }}
        >
          {modes}
        </div>
      ) : null}

      {live &&
      !isReadOnly &&
      onMirrorChange &&
      mode === "follow" &&
      mirror.region ? (
        <label
          className="excalidraw__panel-code-mirror-size"
          title={t("labels.mirror.size")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: palette.muted,
            fontSize: chrome.languageFontSize,
          }}
        >
          <input
            type="range"
            data-testid="code-panel-mirror-size"
            aria-label={t("labels.mirror.size")}
            min={Math.round(FOLLOW_SIZE_MIN * 100)}
            max={Math.round(FOLLOW_SIZE_MAX * 100)}
            step={Math.round(FOLLOW_SIZE_STEP * 100)}
            value={Math.round(mirror.region.width * 100)}
            onChange={(event) => {
              if (!mirror.region) {
                return;
              }

              onMirrorChange?.(panel.id, {
                ...mirror,
                region: resizePanelMirrorRegion(
                  mirror.region,
                  Number(event.currentTarget.value) / 100,
                ),
              });
            }}
            style={{ width: 72 }}
          />
          <span data-testid="code-panel-mirror-size-value">
            {Math.round(mirror.region.width * 100)}%
          </span>
        </label>
      ) : null}

      {canControl ? (
        <>
          <button
            type="button"
            className="excalidraw__panel-code-control"
            data-testid="code-panel-control"
            data-panel-id={panel.id}
            data-control={controlOn ? "on" : "off"}
            aria-pressed={controlOn}
            onClick={() => control?.onToggle?.(panel.id, !controlOn)}
            title={
              controlOn
                ? t("labels.control.onTitle", { chord: CONTROL_RELEASE_CHORD })
                : t("labels.control.offTitle")
            }
            aria-label={t("labels.control.label")}
            style={tool({ active: controlOn, wide: true })}
          >
            <PanelIcon name="pointer" size={iconSize} />
            {compact ? null : t("labels.control.label")}
          </button>
          <button
            type="button"
            className="excalidraw__panel-code-park"
            data-testid="code-panel-park"
            data-panel-id={panel.id}
            data-parked={parked ? "yes" : "no"}
            onClick={() =>
              control?.onWindow?.(panel.id, parked ? "bring-back" : "park")
            }
            title={
              parked
                ? t("labels.control.bringBackTitle")
                : t("labels.control.parkTitle")
            }
            aria-label={
              parked
                ? t("labels.control.bringBackTitle")
                : t("labels.control.parkTitle")
            }
            style={tool({ active: parked, wide: true })}
          >
            <PanelIcon name={parked ? "show" : "hide"} size={iconSize} />
            {compact
              ? null
              : parked
              ? t("labels.control.bringBack")
              : t("labels.control.park")}
          </button>
          {(virtualOn || virtualAvailable) && control?.onWindow ? (
            <button
              type="button"
              className="excalidraw__panel-code-virtual"
              data-testid="code-panel-virtual"
              data-panel-id={panel.id}
              data-virtual={virtualOn ? "yes" : "no"}
              onClick={() =>
                control.onWindow?.(
                  panel.id,
                  virtualOn ? "bring-back" : "virtual",
                )
              }
              title={
                virtualOn
                  ? t("labels.control.mainScreenTitle")
                  : t("labels.control.virtualTitle")
              }
              aria-label={
                virtualOn
                  ? t("labels.control.mainScreenTitle")
                  : t("labels.control.virtualTitle")
              }
              style={tool({ active: virtualOn, wide: true })}
            >
              <PanelIcon name="monitor" size={iconSize} />
              {compact
                ? null
                : virtualOn
                ? t("labels.control.mainScreen")
                : t("labels.control.virtual")}
            </button>
          ) : null}
          {controlOn && controlState && !compact ? (
            <span
              className="excalidraw__panel-code-control-route"
              data-testid="code-panel-control-route"
              data-route={controlState.route}
              title={controlState.reason}
              style={{
                color: palette.muted,
                fontSize: chrome.languageFontSize,
              }}
            >
              {controlState.route === "background"
                ? t("labels.control.routeBackground")
                : controlState.route === "focus"
                ? t("labels.control.routeFocus")
                : controlState.reason}
            </span>
          ) : null}
        </>
      ) : null}

      {/* the tools that take the picture away: the camera and the read (D-332) */}
      <span style={{ flex: "1 1 0" }} />

      {live && !isReadOnly && screenshot?.onCapture ? (
        <button
          type="button"
          className="excalidraw__panel-mirror-screenshot"
          data-testid="mirror-panel-screenshot"
          data-panel-id={panel.id}
          onClick={() => screenshot.onCapture?.(panel.id)}
          title={t("labels.panel.screenshot.button")}
          aria-label={t("labels.panel.screenshot.button")}
          style={tool()}
        >
          <PanelIcon name="camera" size={iconSize} />
        </button>
      ) : null}

      {live && !isReadOnly && ocr ? (
        <>
          <button
            type="button"
            className="excalidraw__panel-mirror-read"
            data-testid="mirror-panel-read"
            data-panel-id={panel.id}
            data-busy={ocr.busy ? "true" : undefined}
            onClick={() => ocr.onOcr?.(panel.id)}
            disabled={ocr.busy || !ocr.onOcr}
            title={ocr.busy ? t("labels.ocrLadder.reading") : ocr.message}
            aria-label={t("labels.panel.ocr")}
            style={tool({ wide: true, disabled: ocr.busy || !ocr.onOcr })}
          >
            {ocr.busy ? (
              <Spinner size="1em" />
            ) : (
              <PanelIcon name="readText" size={iconSize} />
            )}
            {compact
              ? null
              : ocr.busy
              ? t("labels.ocrLadder.reading")
              : t("labels.panel.ocr")}
          </button>
          {ocr.engines && ocr.engines.length > 0 ? (
            <select
              data-testid="mirror-panel-ocr-engine"
              aria-label={t("labels.panel.ocr")}
              value={ocr.engineFor?.(panel.id) ?? ocr.engines[0].id}
              onChange={(event) =>
                ocr.onSelectEngine?.(panel.id, event.currentTarget.value)
              }
              style={{
                height: barSize,
                fontSize: chrome.headerFontSize,
                background: palette.background,
                color: palette.foreground,
                border: `1px solid ${palette.border}`,
                borderRadius: 4,
                colorScheme: "dark",
              }}
            >
              {ocr.engines.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.label}
                </option>
              ))}
            </select>
          ) : null}
          {ocr.busy && ocr.onCancel ? (
            <button
              type="button"
              data-testid="mirror-panel-ocr-cancel"
              onClick={() => ocr.onCancel?.()}
              title={t("labels.ocrLadder.cancel")}
              aria-label={t("labels.ocrLadder.cancel")}
              style={tool({ wide: true })}
            >
              {t("labels.ocrLadder.cancel")}
            </button>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className="excalidraw__panel-code-fullscreen"
        data-testid="code-panel-fullscreen"
        data-panel-id={panel.id}
        onClick={(event) => toggleFullscreen(event.currentTarget)}
        title={t("labels.editor.fullScreen")}
        aria-label={t("labels.editor.fullScreen")}
        style={tool()}
      >
        <PanelIcon name="fullscreen" size={iconSize} />
      </button>
    </div>
  );

  // ------------------------------------------------------------------- body

  /** a centred state: an icon or a spinner, a sentence, and what to do */
  const statusBody = (
    kind: "spinner" | "error",
    message: string,
    hint?: string,
    extra?: React.ReactNode,
  ) => (
    <div
      className="excalidraw__panel-mirror-status"
      data-testid="mirror-panel-status"
      data-view={view}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: chrome.chromeGap,
        padding: chrome.chromeGap,
        textAlign: "center",
        color: palette.foreground,
        fontSize: chrome.headerFontSize,
        overflow: "auto",
      }}
    >
      <span
        data-testid={
          kind === "spinner"
            ? "mirror-panel-spinner"
            : "mirror-panel-error-icon"
        }
        style={{
          display: "inline-flex",
          width: "2.4em",
          height: "2.4em",
          alignItems: "center",
          justifyContent: "center",
          color: kind === "error" ? DOT_COLOURS.bad : palette.muted,
        }}
      >
        {kind === "spinner" ? (
          <Spinner size="2.4em" />
        ) : (
          <PanelIcon name="alert" size="100%" />
        )}
      </span>
      <span data-testid="mirror-panel-message" style={{ maxWidth: "36em" }}>
        {message}
      </span>
      {hint ? (
        <span
          data-testid="mirror-panel-hint"
          style={{ color: palette.muted, maxWidth: "36em" }}
        >
          {hint}
        </span>
      ) : null}
      {extra}
    </div>
  );

  /** the token, and the way to give it (D-333): in the panel, where it is needed */
  const tokenField = bridge ? (
    <div
      className="excalidraw__panel-bridge"
      data-testid="panel-bridge"
      data-panel-id={panel.id}
      data-bridge-state={bridge.status}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: chrome.chromeGap,
        marginTop: chrome.chromeGap,
      }}
    >
      <input
        className="excalidraw__panel-bridge-token"
        data-testid="panel-bridge-token"
        type="password"
        value={bridge.token}
        placeholder={t("labels.panel.bridge.placeholder")}
        aria-label={t("labels.panel.bridge.label")}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => bridge.onTokenChange?.(event.target.value)}
        style={{
          height: chrome.bridgeFieldHeight,
          width: chrome.bridgeFieldWidth,
          boxSizing: "border-box",
          padding: `0 ${chrome.chromeGap}`,
          borderRadius: 4,
          border: `1px solid ${palette.border}`,
          background: palette.background,
          color: palette.foreground,
          font: "inherit",
        }}
      />
      <button
        type="button"
        className="excalidraw__panel-bridge-paste"
        data-testid="panel-bridge-paste"
        onClick={() => bridge.onPasteToken?.()}
        style={{
          ...tool({ wide: true }),
          height: chrome.bridgeButtonHeight,
          width: chrome.bridgeButtonWidth,
        }}
      >
        {t("labels.panel.bridge.paste")}
      </button>
      <button
        type="button"
        className="excalidraw__panel-bridge-connect"
        data-testid="panel-bridge-connect"
        onClick={() => bridge.onConnect?.()}
        style={{
          ...tool({ wide: true }),
          height: chrome.bridgeButtonHeight,
          width: chrome.bridgeButtonWidth,
          background: palette.accent,
        }}
      >
        {t("labels.panel.bridge.connect")}
      </button>
    </div>
  ) : null;

  const message = bridge?.message ?? "";

  const body = (() => {
    switch (view) {
      case "live":
        return null;
      case "connecting":
        return statusBody(
          "spinner",
          t("labels.mirror.state.connecting"),
          message || undefined,
        );
      case "looking":
        return statusBody(
          "spinner",
          t("labels.mirror.state.looking"),
          message || undefined,
          tokenField,
        );
      case "token":
        return statusBody(
          "error",
          t("labels.mirror.state.token"),
          t("labels.mirror.state.tokenHint"),
          tokenField,
        );
      case "refused":
        return statusBody(
          "error",
          t("labels.mirror.state.refused"),
          message || undefined,
          tokenField,
        );
      case "unavailable":
        return statusBody(
          "error",
          capture?.status === "unavailable"
            ? capture.reason
            : t("labels.mirror.state.unavailable"),
          t("labels.mirror.state.unavailableHint"),
        );
      default:
        return statusBody(
          "spinner",
          isReadOnly
            ? t("labels.panel.code.liveNotArrived")
            : t("labels.mirror.state.waiting"),
          // which editor this is connected to - the bridge says it when it
          // says hello (D-76)
          isReadOnly ? undefined : message || undefined,
        );
    }
  })();

  const liveBody = live ? (
    <div
      className="excalidraw__panel-code-live-window"
      data-testid="code-panel-live-window"
      data-region={
        crop && mirror.region
          ? `${mirror.region.x},${mirror.region.y},${mirror.region.width},${mirror.region.height}`
          : undefined
      }
      ref={windowRef}
      // What the teacher does over the view goes into the editor's window while
      // Control is on (D-323); with it off these do nothing
      {...surface.handlers}
      onPointerMove={(event) => {
        onFollowMove(event);
        surface.handlers.onPointerMove(event);
      }}
      onPointerLeave={() => {
        followPointerRef.current = null;
      }}
      // the view takes the keyboard when it is clicked, and only while Control
      // is on (D-323)
      tabIndex={controlOn ? 0 : undefined}
      // while the window has the keyboard, the canvas's own shortcuts keep out
      // of it (D-345)
      {...(controlOn && surface.engaged
        ? { [KEYBOARD_TAKEN_ATTRIBUTE]: "true" }
        : {})}
      data-control={controlOn ? (surface.engaged ? "engaged" : "on") : "off"}
      style={{
        ...(crop
          ? {
              // The **region** the teacher chose (D-143): the picture is drawn
              // whole and the window shows only the part they cropped
              position: "absolute" as const,
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              ...(crop.windowWidth && crop.windowHeight
                ? { width: crop.windowWidth, height: crop.windowHeight }
                : {
                    maxWidth: "100%",
                    maxHeight: "100%",
                    aspectRatio: crop.aspectRatio,
                  }),
              overflow: "hidden",
            }
          : {
              position: "absolute" as const,
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }),
        // Control is on: the view says so, and says whether it has the keyboard
        // (D-323). The browser does not scroll or drag it.
        ...(controlOn
          ? {
              outline: surface.engaged
                ? `2px solid ${palette.accent}`
                : `1px dashed ${palette.accent}`,
              outlineOffset: -2,
              touchAction: "none" as const,
              userSelect: "none" as const,
            }
          : {}),
      }}
    >
      <MirrorSharpenFilter id={sharpenId} />
      <img
        className="excalidraw__panel-code-live"
        data-testid="code-panel-live-frame"
        src={live.streamUrl}
        alt=""
        draggable={false}
        style={
          crop
            ? {
                position: "absolute",
                width: crop.pictureWidth,
                height: crop.pictureHeight,
                left: crop.pictureLeft,
                top: crop.pictureTop,
                display: "block",
                filter: `url(#${sharpenId})`,
              }
            : {
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: "block",
                filter: `url(#${sharpenId})`,
              }
        }
      />
    </div>
  ) : null;

  return (
    <div
      className="excalidraw__panel-code-panel excalidraw__panel-mirror"
      data-testid="code-panel"
      data-kind="mirror"
      data-view={view}
      style={{
        position: "relative",
        background: palette.background,
        color: palette.foreground,
      }}
    >
      {isReadOnly ? null : header}
      <div
        ref={sourceRef}
        className="excalidraw__panel-code-source"
        data-testid="code-panel-source"
        style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}
      >
        {/* a change of state fades in: the body is keyed by the state */}
        <Fade key={view}>
          {view === "live" ? (
            <div style={{ position: "absolute", inset: 0 }}>{liveBody}</div>
          ) : (
            body
          )}
        </Fade>
      </div>
    </div>
  );
};
