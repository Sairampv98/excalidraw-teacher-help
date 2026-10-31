/**
 * The tools that create, change and delete elements (D-401).
 *
 * Creating goes through the editor's own `convertToExcalidrawElements` - the
 * same code that turns a Mermaid diagram or a library item into elements - so a
 * label is a real bound text, an arrow is really bound to its shapes, and the
 * result is what the editor would have drawn. Changing and deleting go through
 * the scene's own functions, so the text bound to a shape follows it and the
 * arrows bound to it stay bound.
 */

import { FONT_FAMILY, ROUNDNESS } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getBoundTextElement,
  isArrowElement,
  isLinearElement,
  isTextElement,
  isUsingAdaptiveRadius,
  newFreeDrawElement,
  redrawTextBoundingBox,
  updateBoundElements,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { LocalPoint } from "@excalidraw/math";

import { stampCurrentPage } from "../scene/pages";

import { actionDeleteSelected } from "../actions/actionDeleteSelected";

import { applyActionsToIds } from "./actionRunner";
import {
  argsOf,
  elementsFor,
  fail,
  isRecord,
  liveElementsById,
  pageOfElement,
  readIds,
  readInteger,
  readNumber,
  resolvePage,
  summarize,
} from "./common";
import { MCP_MAX_ELEMENTS_PER_CALL } from "./toolSpecs";

import type { McpApp } from "./common";

import type { PageRect } from "../types";

const SHAPES = ["rectangle", "diamond", "ellipse"] as const;
const CREATABLE = [
  ...SHAPES,
  "text",
  "line",
  "arrow",
  "freedraw",
  "frame",
] as const;

const STYLE_KEYS = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "locked",
  "link",
] as const;

const FILL_STYLES = ["hachure", "cross-hatch", "solid", "zigzag"];
const STROKE_STYLES = ["solid", "dashed", "dotted"];
const ARROWHEADS = [
  "arrow",
  "bar",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
];

const text = (value: unknown, name: string) =>
  typeof value === "string"
    ? value
    : fail("bad-arguments", `${name} must be a string.`);

const color = (value: unknown, name: string) =>
  typeof value === "string" && value.length <= 64
    ? value
    : fail("bad-arguments", `${name} must be a colour.`);

const fontFamilyOf = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }

  const match = Object.entries(FONT_FAMILY).find(
    ([name]) => name.toLowerCase() === String(value).toLowerCase(),
  );

  return match
    ? match[1]
    : fail(
        "bad-arguments",
        `fontFamily must be one of ${Object.keys(FONT_FAMILY).join(", ")}.`,
      );
};

/** the style the elements of a call share, checked */
const stylesOf = (raw: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};

  for (const key of STYLE_KEYS) {
    const value = raw[key];

    if (value === undefined) {
      continue;
    }

    switch (key) {
      case "strokeColor":
      case "backgroundColor":
        out[key] = color(value, key);
        break;
      case "fillStyle":
        out[key] = FILL_STYLES.includes(value as string)
          ? value
          : fail(
              "bad-arguments",
              `fillStyle must be one of ${FILL_STYLES.join(", ")}.`,
            );
        break;
      case "strokeStyle":
        out[key] = STROKE_STYLES.includes(value as string)
          ? value
          : fail(
              "bad-arguments",
              `strokeStyle must be one of ${STROKE_STYLES.join(", ")}.`,
            );
        break;
      case "strokeWidth":
      case "roughness":
      case "opacity":
        out[key] = readNumber(value, key);
        break;
      case "locked":
        out[key] = value === true;
        break;
      case "link":
        out[key] = text(value, key);
        break;
    }
  }

  return out;
};

const roundnessOf = (type: string, value: unknown) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === "sharp" || value === null) {
    return null;
  }

  if (value === "round") {
    return {
      type: isUsingAdaptiveRadius(type)
        ? ROUNDNESS.ADAPTIVE_RADIUS
        : ROUNDNESS.PROPORTIONAL_RADIUS,
    };
  }

  return fail("bad-arguments", "roundness must be sharp or round.");
};

const pointsOf = (value: unknown, name: string): [number, number][] => {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    !value.every(
      (point) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        typeof point[0] === "number" &&
        typeof point[1] === "number" &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    )
  ) {
    return fail(
      "bad-arguments",
      `${name} must be a list of at least two [x, y] points.`,
    );
  }

  return value.map((point) => [point[0], point[1]] as [number, number]);
};

/** a shape an arrow starts or ends at: an id, or a shape to make there */
const endOf = (value: unknown, rect: PageRect, name: string) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    return fail("bad-arguments", `${name} must be an object.`);
  }

  if (typeof value.id === "string" && value.type === undefined) {
    return { id: value.id };
  }

  if (SHAPES.includes(value.type as typeof SHAPES[number])) {
    return {
      type: value.type,
      x: (readNumber(value.x, `${name}.x`) ?? 0) + rect.x,
      y: (readNumber(value.y, `${name}.y`) ?? 0) + rect.y,
      width: readNumber(value.width, `${name}.width`),
      height: readNumber(value.height, `${name}.height`),
      ...(typeof value.id === "string" ? { id: value.id } : {}),
    };
  }

  return fail(
    "bad-arguments",
    `${name} must be {id} of an element made in this call, or a rectangle, diamond or ellipse to make.`,
  );
};

type Skeleton = Record<string, unknown>;

/** one element of a call, as the editor's converter takes it - or a freedraw to build */
const skeletonOf = (
  raw: unknown,
  rect: PageRect,
  index: number,
): {
  skeleton?: Skeleton;
  freedraw?: ReturnType<typeof newFreeDrawElement>;
} => {
  const where = `elements[${index}]`;

  if (!isRecord(raw)) {
    return fail("bad-arguments", `${where} must be an object.`);
  }

  const type = raw.type;

  if (!CREATABLE.includes(type as typeof CREATABLE[number])) {
    return fail(
      "bad-arguments",
      `${where}.type must be one of ${CREATABLE.join(", ")}.`,
    );
  }

  const t = type as typeof CREATABLE[number];
  const x = (readNumber(raw.x, `${where}.x`) ?? 0) + rect.x;
  const y = (readNumber(raw.y, `${where}.y`) ?? 0) + rect.y;
  const style = stylesOf(raw);
  const roundness = roundnessOf(t, raw.roundness);
  const id = raw.id === undefined ? undefined : text(raw.id, `${where}.id`);
  const base = {
    type: t,
    x,
    y,
    ...(id ? { id } : {}),
    ...style,
    ...(roundness !== undefined ? { roundness } : {}),
    ...(raw.width !== undefined
      ? { width: readNumber(raw.width, `${where}.width`) }
      : {}),
    ...(raw.height !== undefined
      ? { height: readNumber(raw.height, `${where}.height`) }
      : {}),
    ...(raw.angle !== undefined
      ? { angle: readNumber(raw.angle, `${where}.angle`) }
      : {}),
  };

  if (t === "freedraw") {
    const points = pointsOf(raw.points, `${where}.points`);
    const element = newFreeDrawElement({
      type: "freedraw",
      x,
      y,
      points: points.map(([px, py]) => pointFrom<LocalPoint>(px, py)),
      simulatePressure: raw.pressures === undefined,
      ...(Array.isArray(raw.pressures)
        ? { pressures: raw.pressures as number[] }
        : {}),
      ...(id ? { id } : {}),
      ...style,
    } as Parameters<typeof newFreeDrawElement>[0]);
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);

    Object.assign(element, {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    });

    return { freedraw: element };
  }

  if (t === "text") {
    return {
      skeleton: {
        ...base,
        text: text(raw.text, `${where}.text`),
        ...(raw.fontSize !== undefined
          ? { fontSize: readNumber(raw.fontSize, `${where}.fontSize`) }
          : {}),
        ...(raw.fontFamily !== undefined
          ? { fontFamily: fontFamilyOf(raw.fontFamily) }
          : {}),
        ...(raw.textAlign !== undefined ? { textAlign: raw.textAlign } : {}),
        ...(raw.verticalAlign !== undefined
          ? { verticalAlign: raw.verticalAlign }
          : {}),
      },
    };
  }

  if (t === "line" || t === "arrow") {
    const points =
      raw.points !== undefined
        ? pointsOf(raw.points, `${where}.points`)
        : undefined;
    const start =
      t === "arrow" ? endOf(raw.start, rect, `${where}.start`) : undefined;
    const end =
      t === "arrow" ? endOf(raw.end, rect, `${where}.end`) : undefined;
    const arrowType = raw.arrowType;

    return {
      skeleton: {
        ...base,
        ...(points ? { points } : {}),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        ...(t === "arrow" && arrowType === "elbow" ? { elbowed: true } : {}),
        ...(t === "arrow" && ARROWHEADS.includes(raw.startArrowhead as string)
          ? { startArrowhead: raw.startArrowhead }
          : {}),
        ...(t === "arrow" && ARROWHEADS.includes(raw.endArrowhead as string)
          ? { endArrowhead: raw.endArrowhead }
          : {}),
        ...(isRecord(raw.label) && typeof raw.label.text === "string"
          ? { label: { text: raw.label.text } }
          : {}),
      },
    };
  }

  if (t === "frame") {
    return {
      skeleton: {
        ...base,
        children: Array.isArray(raw.children) ? raw.children : [],
        ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      },
    };
  }

  // a rectangle, a diamond or an ellipse, with words in it if it has a label
  const label = raw.label;

  return {
    skeleton: {
      ...base,
      ...(isRecord(label) && typeof label.text === "string"
        ? {
            label: {
              text: label.text,
              ...(label.fontSize !== undefined
                ? {
                    fontSize: readNumber(
                      label.fontSize,
                      `${where}.label.fontSize`,
                    ),
                  }
                : {}),
              ...(label.fontFamily !== undefined
                ? { fontFamily: fontFamilyOf(label.fontFamily) }
                : {}),
              ...(typeof label.strokeColor === "string"
                ? { strokeColor: label.strokeColor }
                : {}),
              ...(typeof label.textAlign === "string"
                ? { textAlign: label.textAlign }
                : {}),
            },
          }
        : {}),
    },
  };
};

export const createElements = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const entry = resolvePage(app, readInteger(args, "page", { min: 1 }));
  const list = args.elements;

  if (!Array.isArray(list) || !list.length) {
    return fail(
      "bad-arguments",
      "elements must be a list of at least one element.",
    );
  }

  if (list.length > MCP_MAX_ELEMENTS_PER_CALL) {
    return fail(
      "too-large",
      `${list.length} elements; a call takes at most ${MCP_MAX_ELEMENTS_PER_CALL}.`,
    );
  }

  const taken = new Set(
    app.scene.getElementsIncludingDeleted().map((element) => element.id),
  );
  const skeletons: Skeleton[] = [];
  const freedraws: ReturnType<typeof newFreeDrawElement>[] = [];

  list.forEach((raw, index) => {
    const { skeleton, freedraw } = skeletonOf(raw, entry.rect, index);
    const id = (skeleton?.id ?? freedraw?.id) as string | undefined;

    if (id && skeleton?.id !== undefined && taken.has(id)) {
      fail(
        "bad-arguments",
        `elements[${index}].id ${id} is already in the document.`,
      );
    }

    if (skeleton) {
      skeletons.push(skeleton);
    }

    if (freedraw) {
      freedraws.push(freedraw);
    }
  });

  const made = [
    ...convertToExcalidrawElements(skeletons as never, {
      regenerateIds: false,
    }),
    ...freedraws,
  ] as ExcalidrawElement[];

  stampCurrentPage(made, entry.page.id);

  app.updateScene({
    elements: [...app.scene.getElementsIncludingDeleted(), ...made],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return {
    page: entry.number,
    created: made.map((element) => summarize(app, element)),
  };
};

/** the things update_elements may change on an element */
const UPDATABLE = [
  "x",
  "y",
  "width",
  "height",
  "angle",
  "text",
  "points",
  "locked",
  "link",
] as const;

export const updateElements = (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const updates = args.updates;

  if (!Array.isArray(updates) || !updates.length) {
    return fail(
      "bad-arguments",
      "updates must be a list of at least one update.",
    );
  }

  if (updates.length > MCP_MAX_ELEMENTS_PER_CALL) {
    return fail(
      "too-large",
      `${updates.length} updates; a call takes at most ${MCP_MAX_ELEMENTS_PER_CALL}.`,
    );
  }

  const changed: string[] = [];

  updates.forEach((raw, index) => {
    const where = `updates[${index}]`;

    if (!isRecord(raw) || typeof raw.id !== "string") {
      fail("bad-arguments", `${where} must be an object with an id.`);
      return;
    }

    const unknown = Object.keys(raw).filter(
      (key) => key !== "id" && !(UPDATABLE as readonly string[]).includes(key),
    );

    if (unknown.length) {
      fail(
        "bad-arguments",
        `${where}: ${unknown.join(
          ", ",
        )} cannot be changed here. Styles are changed with set_properties. These can: ${UPDATABLE.join(
          ", ",
        )}.`,
      );
    }

    const [element] = elementsFor(app, [raw.id]);
    const entry = pageOfElement(app, element);
    const patch: Record<string, unknown> = {};

    if (raw.x !== undefined || raw.y !== undefined) {
      patch.x =
        (readNumber(raw.x, `${where}.x`) ?? element.x - (entry?.rect.x ?? 0)) +
        (entry?.rect.x ?? 0);
      patch.y =
        (readNumber(raw.y, `${where}.y`) ?? element.y - (entry?.rect.y ?? 0)) +
        (entry?.rect.y ?? 0);
    }

    for (const key of ["width", "height", "angle"] as const) {
      if (raw[key] !== undefined) {
        patch[key] = readNumber(raw[key], `${where}.${key}`);
      }
    }

    if (raw.locked !== undefined) {
      patch.locked = raw.locked === true;
    }

    if (raw.link !== undefined) {
      patch.link = raw.link === null ? null : text(raw.link, `${where}.link`);
    }

    if (raw.points !== undefined) {
      if (!isLinearElement(element) && element.type !== "freedraw") {
        fail(
          "bad-arguments",
          `${where}: only lines, arrows and freedraw have points.`,
        );
      }

      patch.points = pointsOf(raw.points, `${where}.points`).map(([px, py]) =>
        pointFrom<LocalPoint>(px, py),
      );
    }

    // the words: a text changes its own, a shape changes the text bound to it
    let textTarget: ExcalidrawElement | null = null;

    if (raw.text !== undefined) {
      const words = text(raw.text, `${where}.text`);

      textTarget = isTextElement(element)
        ? element
        : getBoundTextElement(element, liveElementsById(app));

      if (!textTarget || !isTextElement(textTarget)) {
        fail("bad-arguments", `${where}: this element has no text to change.`);
      } else {
        app.scene.mutateElement(textTarget, {
          text: words,
          originalText: words,
        });
      }
    }

    if (Object.keys(patch).length) {
      app.scene.mutateElement(element, patch as never);
    }

    // the text is laid out again for its shape, and what is bound follows
    const bound = isTextElement(element)
      ? element
      : getBoundTextElement(element, liveElementsById(app));

    if (bound && isTextElement(bound)) {
      redrawTextBoundingBox(
        bound,
        isTextElement(element)
          ? app.scene.getContainerElement(element)
          : element,
        app.scene,
      );
    }

    if (!isTextElement(element) || element.containerId === null) {
      updateBoundElements(element as never, app.scene);
    }

    if (isArrowElement(element) && patch.points) {
      // an arrow whose points were moved is no longer held by what it was bound to
      app.scene.mutateElement(element, {
        startBinding: null,
        endBinding: null,
      } as never);
    }

    changed.push(element.id);
  });

  // the changes are one step for the history
  app.syncActionResult({
    // the elements were changed where they are: the history compares them with
    // what it last held, and sees by their versions that they differ
    elements: app.scene.getElementsIncludingDeleted(),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { changed };
};

export const deleteElements = async (app: McpApp, rawArgs: unknown) => {
  const args = argsOf(rawArgs);
  const ids = readIds(args, "ids", { required: true })!;

  elementsFor(app, ids);

  await applyActionsToIds(
    app,
    ids,
    [{ action: actionDeleteSelected, value: null }],
    { keepSelection: false },
  );

  return { deleted: ids };
};
