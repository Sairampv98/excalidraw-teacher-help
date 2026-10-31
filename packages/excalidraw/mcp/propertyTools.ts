/**
 * The properties panel as tools (D-402): `describe_properties` says what the
 * panel would show for some elements, and `set_properties` changes them by the
 * panel's own actions - so the side effects are the panel's: a font size re-fits
 * the text in its shape, an arrowhead keeps the arrow bound, and the change is
 * one undo step.
 */

import { FONT_FAMILY, reduceToCommonValue } from "@excalidraw/common";
import {
  canHaveInk,
  getBoundTextElement,
  hasStrokeColor,
  isTextElement,
  shouldAllowVerticalAlign,
  suppportsHorizontalAlign,
  toolIsArrow,
} from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  actionChangeArrowType,
  actionChangeArrowhead,
  actionChangeBackgroundColor,
  actionChangeFillStyle,
  actionChangeFontFamily,
  actionChangeFontSize,
  actionChangeOpacity,
  actionChangeRoundness,
  actionChangeSloppiness,
  actionChangeStrokeColor,
  actionChangeStrokeStyle,
  actionChangeStrokeWidth,
  actionChangeTextAlign,
  actionChangeVerticalAlign,
} from "../actions/actionProperties";
import {
  canChangeRoundness,
  canHaveArrowheads,
  hasBackground,
  hasStrokeStyle,
  hasStrokeWidth,
} from "../scene";

import { applyActionsToIds } from "./actionRunner";
import {
  argsOf,
  elementsFor,
  fail,
  isRecord,
  liveElementsById,
  readIds,
} from "./common";

import type { Action } from "../actions/types";
import type { McpApp } from "./common";
import type { McpActionStep } from "./actionRunner";

const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag"] as const;
const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
const TEXT_ALIGNS = ["left", "center", "right"] as const;
const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
const ARROW_TYPES = ["sharp", "round", "elbow"] as const;
const ROUNDNESS_CHOICES = ["sharp", "round"] as const;
const ARROWHEADS = [
  null,
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "cardinality_one",
  "cardinality_many",
  "cardinality_one_or_many",
  "cardinality_exactly_one",
  "cardinality_zero_or_one",
  "cardinality_zero_or_many",
] as const;

/** the colours a tool takes: a hex, "transparent", a CSS name or a function */
const COLOR_PATTERN =
  /^(#[0-9a-f]{3,8}|transparent|[a-z]{3,30}|(rgb|rgba|hsl|hsla)\([0-9a-z.,%\s/-]{1,60}\))$/i;

type Targets = {
  elements: ExcalidrawElement[];
  map: ReturnType<typeof liveElementsById>;
};

type PropertySpec = {
  key: string;
  /** whether the panel shows it for these elements */
  applies: (targets: Targets) => boolean;
  /** the value an element has now */
  read: (element: ExcalidrawElement) => unknown;
  /** the elements that value is read from, among the targets */
  readFrom?: (element: ExcalidrawElement) => boolean;
  /** what it may be, for the one who asks */
  values: unknown;
  /** the steps that change it, or an error when the value is not one of the choices */
  steps: (value: unknown) => McpActionStep[];
};

const oneOf = <T>(value: unknown, choices: readonly T[], key: string): T =>
  choices.includes(value as T)
    ? (value as T)
    : fail(
        "bad-arguments",
        `${key} must be one of ${choices.map((c) => String(c)).join(", ")}.`,
      );

const colorOf = (value: unknown, key: string): string => {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value.trim())) {
    return fail(
      "bad-arguments",
      `${key} must be a colour: a hex such as #1e1e1e, transparent, or a CSS colour name.`,
    );
  }

  return value.trim();
};

const numberIn = (
  value: unknown,
  key: string,
  min: number,
  max: number,
): number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
    ? value
    : fail("bad-arguments", `${key} must be a number from ${min} to ${max}.`);

const step = (action: Action, value: unknown): McpActionStep => ({
  action,
  value,
});

/** a font by its name or its number */
const fontFamilyOf = (value: unknown): number => {
  if (typeof value === "string") {
    const match = Object.entries(FONT_FAMILY).find(
      ([name]) => name.toLowerCase() === value.trim().toLowerCase(),
    );

    if (match) {
      return match[1];
    }
  }

  if (
    typeof value === "number" &&
    (Object.values(FONT_FAMILY) as number[]).includes(value)
  ) {
    return value;
  }

  return fail(
    "bad-arguments",
    `fontFamily must be one of ${Object.keys(FONT_FAMILY).join(", ")}.`,
  );
};

const fontNameOf = (family: unknown) =>
  Object.entries(FONT_FAMILY).find(([, id]) => id === family)?.[0] ?? family;

const PROPERTIES: readonly PropertySpec[] = [
  {
    key: "strokeColor",
    applies: ({ elements }) => elements.some((el) => hasStrokeColor(el.type)),
    read: (el) => el.strokeColor,
    values: "a colour: #hex, transparent or a CSS colour name",
    steps: (value) => [
      step(actionChangeStrokeColor, {
        currentItemStrokeColor: colorOf(value, "strokeColor"),
      }),
    ],
  },
  {
    key: "backgroundColor",
    applies: ({ elements }) => elements.some((el) => hasBackground(el.type)),
    read: (el) => el.backgroundColor,
    values: "a colour: #hex, transparent or a CSS colour name",
    steps: (value) => [
      step(actionChangeBackgroundColor, {
        currentItemBackgroundColor: colorOf(value, "backgroundColor"),
      }),
    ],
  },
  {
    key: "fillStyle",
    // the panel shows the fill styles only when something has a background
    applies: ({ elements }) =>
      elements.some(
        (el) =>
          hasBackground(el.type) &&
          el.backgroundColor !== "transparent" &&
          el.backgroundColor !== "",
      ),
    read: (el) => el.fillStyle,
    values: FILL_STYLES,
    steps: (value) => [
      step(actionChangeFillStyle, oneOf(value, FILL_STYLES, "fillStyle")),
    ],
  },
  {
    key: "strokeWidth",
    applies: ({ elements }) => elements.some((el) => hasStrokeWidth(el.type)),
    read: (el) => el.strokeWidth,
    values: "a number from 0.5 to 20 (the panel offers 1, 2 and 4)",
    steps: (value) => [
      step(actionChangeStrokeWidth, numberIn(value, "strokeWidth", 0.5, 20)),
    ],
  },
  {
    key: "strokeStyle",
    applies: ({ elements }) => elements.some((el) => hasStrokeStyle(el.type)),
    read: (el) => el.strokeStyle,
    values: STROKE_STYLES,
    steps: (value) => [
      step(actionChangeStrokeStyle, oneOf(value, STROKE_STYLES, "strokeStyle")),
    ],
  },
  {
    key: "roughness",
    applies: ({ elements }) => elements.some((el) => hasStrokeStyle(el.type)),
    read: (el) => el.roughness,
    values: [0, 1, 2],
    steps: (value) => [
      step(
        actionChangeSloppiness,
        oneOf(value, [0, 1, 2] as const, "roughness"),
      ),
    ],
  },
  {
    key: "roundness",
    applies: ({ elements }) =>
      elements.some((el) => canChangeRoundness(el.type)),
    read: (el) => (el.roundness ? "round" : "sharp"),
    values: ROUNDNESS_CHOICES,
    steps: (value) => [
      step(actionChangeRoundness, oneOf(value, ROUNDNESS_CHOICES, "roundness")),
    ],
  },
  {
    key: "arrowType",
    applies: ({ elements }) => elements.some((el) => toolIsArrow(el.type)),
    read: (el) =>
      el.type === "arrow"
        ? (el as { elbowed?: boolean }).elbowed
          ? "elbow"
          : el.roundness
          ? "round"
          : "sharp"
        : undefined,
    readFrom: (el) => el.type === "arrow",
    values: ARROW_TYPES,
    steps: (value) => [
      step(actionChangeArrowType, oneOf(value, ARROW_TYPES, "arrowType")),
    ],
  },
  {
    key: "fontFamily",
    applies: ({ elements }) => elements.some(isTextElement),
    read: (el) => (isTextElement(el) ? fontNameOf(el.fontFamily) : undefined),
    readFrom: isTextElement,
    values: Object.keys(FONT_FAMILY),
    steps: (value) => [
      step(actionChangeFontFamily, {
        currentItemFontFamily: fontFamilyOf(value),
      }),
    ],
  },
  {
    key: "fontSize",
    applies: ({ elements }) => elements.some(isTextElement),
    read: (el) => (isTextElement(el) ? el.fontSize : undefined),
    readFrom: isTextElement,
    values: "a number from 4 to 400 (the panel offers 16, 20, 28 and 36)",
    steps: (value) => [
      step(actionChangeFontSize, numberIn(value, "fontSize", 4, 400)),
    ],
  },
  {
    key: "textAlign",
    applies: ({ elements, map }) =>
      elements.some(isTextElement) &&
      suppportsHorizontalAlign(elements as never, map),
    read: (el) => (isTextElement(el) ? el.textAlign : undefined),
    readFrom: isTextElement,
    values: TEXT_ALIGNS,
    steps: (value) => [
      step(actionChangeTextAlign, oneOf(value, TEXT_ALIGNS, "textAlign")),
    ],
  },
  {
    key: "verticalAlign",
    applies: ({ elements, map }) =>
      shouldAllowVerticalAlign(elements as never, map),
    read: (el) => (isTextElement(el) ? el.verticalAlign : undefined),
    readFrom: isTextElement,
    values: VERTICAL_ALIGNS,
    steps: (value) => [
      step(
        actionChangeVerticalAlign,
        oneOf(value, VERTICAL_ALIGNS, "verticalAlign"),
      ),
    ],
  },
  {
    key: "startArrowhead",
    applies: ({ elements }) =>
      elements.some((el) => canHaveArrowheads(el.type)),
    read: (el) =>
      el.type === "arrow"
        ? (el as { startArrowhead: unknown }).startArrowhead
        : undefined,
    readFrom: (el) => canHaveArrowheads(el.type),
    values: ARROWHEADS,
    steps: (value) => [
      step(actionChangeArrowhead, {
        position: "start",
        type: oneOf(value, ARROWHEADS, "startArrowhead"),
      }),
    ],
  },
  {
    key: "endArrowhead",
    applies: ({ elements }) =>
      elements.some((el) => canHaveArrowheads(el.type)),
    read: (el) =>
      el.type === "arrow"
        ? (el as { endArrowhead: unknown }).endArrowhead
        : undefined,
    readFrom: (el) => canHaveArrowheads(el.type),
    values: ARROWHEADS,
    steps: (value) => [
      step(actionChangeArrowhead, {
        position: "end",
        type: oneOf(value, ARROWHEADS, "endArrowhead"),
      }),
    ],
  },
  {
    key: "opacity",
    applies: () => true,
    read: (el) => el.opacity,
    values: "a number from 0 to 100",
    steps: (value) => [
      step(actionChangeOpacity, numberIn(value, "opacity", 0, 100)),
    ],
  },
];

/** the elements the panel works on: the selected ones, with the text bound to them */
const targetsFor = (app: McpApp, ids: readonly string[]): Targets => {
  const map = liveElementsById(app);
  const elements: ExcalidrawElement[] = [];
  const seen = new Set<string>();

  for (const element of elementsFor(app, ids)) {
    for (const each of [element, getBoundTextElement(element, map)]) {
      if (each && !seen.has(each.id)) {
        seen.add(each.id);
        elements.push(each);
      }
    }
  }

  return { elements, map };
};

export const describeProperties = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const ids = readIds(args, "ids", { required: true })!;
  const targets = targetsFor(app, ids);
  const properties: Record<string, { value: unknown; values: unknown }> = {};

  for (const property of PROPERTIES) {
    if (!property.applies(targets)) {
      continue;
    }

    const readFrom = property.readFrom ?? (() => true);
    const sources = targets.elements.filter(readFrom);
    const common = reduceToCommonValue(sources, property.read);

    properties[property.key] = {
      value:
        common === null && sources.length > 1
          ? "mixed"
          : sources.length === 0
          ? null
          : common ?? property.read(sources[0]),
      values: property.values,
    };
  }

  return {
    elements: ids.length,
    properties,
    ...(targets.elements.some(canHaveInk)
      ? { note: "The ink look of drawn elements is set with set_ink." }
      : {}),
  };
};

export const setProperties = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const ids = readIds(args, "ids", { required: true })!;
  const requested = args.properties;

  if (!isRecord(requested) || !Object.keys(requested).length) {
    return fail("bad-arguments", "properties must say what to change.");
  }

  const targets = targetsFor(app, ids);
  const steps: McpActionStep[] = [];
  const changed: string[] = [];

  for (const [key, value] of Object.entries(requested)) {
    const property = PROPERTIES.find((each) => each.key === key);

    if (!property) {
      return fail(
        "bad-arguments",
        `${key} is not a property. The properties are: ${PROPERTIES.map(
          (each) => each.key,
        ).join(", ")}.`,
      );
    }

    if (!property.applies(targets)) {
      return fail(
        "bad-arguments",
        `The properties panel would not show ${key} for these elements, so it cannot be changed. Use describe_properties to see what can.`,
      );
    }

    steps.push(...property.steps(value));
    changed.push(key);
  }

  await applyActionsToIds(
    app,
    targets.elements.map((el) => el.id),
    steps,
  );

  return { changed, elements: ids.length };
};
