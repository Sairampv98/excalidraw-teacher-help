/**
 * Applying an edited script to a chart that is already on the page (D-223).
 *
 * The chart is changed **in place**. A node of the new script is matched to a
 * node of the chart by its label, and a node that matches keeps everything the
 * teacher did to it - its id, its place, its size, its colours and its _Show in
 * class_ mark. A line with no match adds a node, a node with no line is removed
 * with the arrows that touched it, and the layout is run only for what was
 * added. A change of the preset, the fit mode or the shape of the chart, and a
 * chart spread over pages, is a rebuild in the same place.
 *
 * It is a pure function of the scene's elements and the new script: it returns
 * the scene's new elements, and the caller puts them in the scene in one step,
 * so one undo takes the whole change back.
 */

import { newElementWith } from "@excalidraw/element";
import { randomInteger } from "@excalidraw/common";

import type {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { chartElementsOf, readChartRecord, stampChart } from "./flowChart";
import {
  buildEdge,
  buildFlowPreset,
  createIds,
  measureFlowText,
  shapeOfNode,
  wrapFlowLabel,
} from "./flowPresets";
import { buildSettingsOfCustom } from "./flowCustomPresets";
import { parseFlowScript } from "./flowScript";

import type { FlowFitMode } from "./flowChart";
import type { FlowCustomPreset } from "./flowCustomPresets";
import type { FlowChartShape, FlowPageRect } from "./flowPresets";
import type { FlowPresetId, FlowScriptNode } from "./flowScript";

export type ApplyFlowScriptArgs = {
  /** every element of the scene, deleted ones too */
  elements: readonly ExcalidrawElement[];
  chartId: string;
  preset: FlowPresetId;
  script: string;
  fit: FlowFitMode;
  shape: FlowChartShape;
  /** the custom preset the chart is made from, when it is (D-228) */
  custom?: FlowCustomPreset;
  /** the page the chart is on */
  page: FlowPageRect;
  pageId?: string;
  pageNumber?: number;
  /** the pages a spread chart goes on, the current page first (D-226) */
  pages?: { rect: FlowPageRect; pageId?: string }[];
  /**
   * The elements of a chart that was made before charts remembered how
   * (D-221): it has no id of its own on its elements, so the caller names them.
   */
  legacyElementIds?: readonly string[];
  /** makes ids; the same seed gives the same ids */
  seed?: number;
};

export type ApplyFlowScriptResult =
  | {
      ok: true;
      /** the scene's elements after the change */
      elements: ExcalidrawElement[];
      /** the chart was rebuilt and not changed in place */
      rebuilt: boolean;
      kept: number;
      added: number;
      removed: number;
    }
  | { ok: false; error: string };

type OldNode = {
  shape: ExcalidrawElement;
  text: ExcalidrawTextElement | null;
  nodeId: string;
  label: string;
  shapeKind: string | null;
};

const flowOf = (element: ExcalidrawElement) =>
  (element.customData?.flow ?? {}) as Record<string, unknown>;

/** the colours and the direction of the custom preset a chart is made from (D-228) */
const customOptions = (args: ApplyFlowScriptArgs) =>
  args.custom
    ? { ...buildSettingsOfCustom(args.custom).options, custom: args.custom }
    : {};

/** a steps chart numbers its labels: the number is not what a node is matched by */
const bare = (label: string, preset: FlowPresetId) =>
  preset === "steps" ? label.replace(/^\d+\.\s+/, "") : label;

/** the text bound to a shape */
const textOf = (
  shape: ExcalidrawElement,
  byId: ReadonlyMap<string, ExcalidrawElement>,
): ExcalidrawTextElement | null => {
  for (const bound of shape.boundElements ?? []) {
    const element = byId.get(bound.id);

    if (element && element.type === "text" && !element.isDeleted) {
      return element;
    }
  }

  return null;
};

/** the label bound to a shape of the fresh chart */
const freshBoundText = (
  shape: ExcalidrawElement,
  byId: ReadonlyMap<string, ExcalidrawElement>,
) => textOf(shape, byId);

const readNodes = (
  chart: readonly ExcalidrawElement[],
  byId: ReadonlyMap<string, ExcalidrawElement>,
): OldNode[] =>
  chart
    .filter(
      (element) =>
        element.type !== "arrow" &&
        element.type !== "text" &&
        flowOf(element).role === "node",
    )
    .map((shape) => {
      const text = textOf(shape, byId);

      return {
        shape,
        text,
        nodeId: String(flowOf(shape).nodeId ?? ""),
        label: text ? text.originalText ?? text.text : "",
        shapeKind:
          typeof flowOf(shape).shape === "string"
            ? (flowOf(shape).shape as string)
            : null,
      };
    });

/**
 * The old node each new node is matched to: the same label in the same order
 * first, then the same label out of order (D-223).
 */
const matchNodes = (
  fresh: readonly FlowScriptNode[],
  old: readonly OldNode[],
  preset: FlowPresetId,
): Map<string, OldNode> => {
  const matched = new Map<string, OldNode>();
  const taken = new Set<OldNode>();
  let after = -1;

  for (const node of fresh) {
    const floor = after;
    const index = old.findIndex(
      (candidate, i) =>
        i > floor &&
        !taken.has(candidate) &&
        bare(candidate.label, preset) === node.label,
    );

    if (index >= 0) {
      matched.set(node.id, old[index]);
      taken.add(old[index]);
      after = index;
    }
  }

  for (const node of fresh) {
    if (matched.has(node.id)) {
      continue;
    }

    const found = old.find(
      (candidate) =>
        !taken.has(candidate) && bare(candidate.label, preset) === node.label,
    );

    if (found) {
      matched.set(node.id, found);
      taken.add(found);
    }
  }

  return matched;
};

const boxOf = (element: ExcalidrawElement) => ({
  x: element.x,
  y: element.y,
  width: element.width,
  height: element.height,
});

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number,
) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/** puts a label's text in the middle of its container */
const centred = (
  text: ExcalidrawTextElement,
  box: { x: number; y: number; width: number; height: number },
) =>
  newElementWith(text, {
    x: box.x + (box.width - text.width) / 2,
    y: box.y + (box.height - text.height) / 2,
  });

/** the chart's own first shape holds the record (D-221) */
const withRecordOnFirstShape = (
  chart: readonly ExcalidrawElement[],
  record: {
    id: string;
    preset: string;
    script: string;
    fit: FlowFitMode;
    shape: FlowChartShape;
  },
) => {
  const stamped = stampChart(
    chart.map((element) => {
      const flow = { ...flowOf(element) };

      // the old record is dropped: exactly one shape carries the new one
      delete flow.chart;

      return element.customData?.flow
        ? newElementWith(element, {
            customData: { ...element.customData, flow },
          })
        : element;
    }),
    record,
  );

  return stamped;
};

/** a rebuild in the same place: the chart is made again from the script */
const rebuild = (
  args: ApplyFlowScriptArgs,
  old: readonly ExcalidrawElement[],
): ApplyFlowScriptResult => {
  const oldIds = new Set(old.map((element) => element.id));
  const alive = old.filter((element) => !element.isDeleted);
  const left = Math.min(...alive.map((element) => element.x));
  const top = Math.min(...alive.map((element) => element.y));
  const right = Math.max(...alive.map((element) => element.x + element.width));
  const bottom = Math.max(
    ...alive.map((element) => element.y + element.height),
  );

  const built = buildFlowPreset(args.preset, args.script, {
    page: args.page,
    pageId: args.pageId,
    pageNumber: args.pageNumber,
    pages: args.pages,
    seed: args.seed ?? randomInteger(),
    chartId: args.chartId,
    fit: args.fit,
    ...customOptions(args),
    shape: args.shape,
    center:
      alive.length > 0
        ? { x: (left + right) / 2, y: (top + bottom) / 2 }
        : undefined,
  });

  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  // the animation's settings stay with the chart (D-183)
  const mark = alive
    .map((element) => flowOf(element).class)
    .find((entry) => entry !== undefined);

  const made = mark
    ? built.elements.map((element) =>
        flowOf(element).role === "node" && element.type !== "text"
          ? {
              ...element,
              customData: {
                ...element.customData,
                flow: { ...flowOf(element), class: mark },
              },
            }
          : element,
      )
    : built.elements;

  const elements = [
    ...args.elements.map((element) =>
      oldIds.has(element.id) && !element.isDeleted
        ? newElementWith(element, { isDeleted: true })
        : element,
    ),
    ...made,
  ];

  return {
    ok: true,
    elements,
    rebuilt: true,
    kept: 0,
    added: made.filter((e) => flowOf(e).role === "node" && e.type !== "text")
      .length,
    removed: alive.filter((e) => flowOf(e).role === "node" && e.type !== "text")
      .length,
  };
};

/**
 * Applies a script to the chart `chartId`. See the top of this file for what is
 * kept and what is changed.
 */
export const applyFlowScript = (
  args: ApplyFlowScriptArgs,
): ApplyFlowScriptResult => {
  const parsed = parseFlowScript(args.preset, args.script);

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const byId = new Map(args.elements.map((element) => [element.id, element]));
  const legacy = new Set(args.legacyElementIds ?? []);
  const chart = [
    ...chartElementsOf(args.chartId, args.elements),
    ...args.elements.filter(
      (element) =>
        !element.isDeleted &&
        legacy.has(element.id) &&
        flowOf(element).chartId !== args.chartId,
    ),
  ];

  const record = chart
    .map((element) => readChartRecord(element))
    .find((found) => found !== null);

  // the things that mean the pages or the layout are cut again
  const sameKind =
    !!record &&
    record.preset === (args.custom?.id ?? args.preset) &&
    record.fit === args.fit &&
    record.shape === args.shape &&
    args.fit !== "spread";

  if (!sameKind || chart.length === 0) {
    return rebuild(args, chart);
  }

  const oldNodes = readNodes(chart, byId);
  const matched = matchNodes(parsed.nodes, oldNodes, args.preset);

  // the fresh chart is only a source of sizes and places for what is new
  const seed = args.seed ?? randomInteger();
  const fresh = buildFlowPreset(args.preset, args.script, {
    page: args.page,
    pageId: args.pageId,
    seed,
    fit: args.fit,
    ...customOptions(args),
    shape: args.shape,
  });

  if (!fresh.ok) {
    return { ok: false, error: fresh.error };
  }

  const freshById = new Map(fresh.elements.map((e) => [e.id, e]));
  const freshShape = new Map<string, ExcalidrawElement>();

  for (const element of fresh.elements) {
    if (element.type !== "arrow" && element.type !== "text") {
      freshShape.set(String(flowOf(element).nodeId), element);
    }
  }

  // how far the chart has moved from where it would be built: its matched
  // nodes say, and a new node with no neighbour is put by the average
  const offsets = [...matched].map(([id, old]) => ({
    x: old.shape.x - freshShape.get(id)!.x,
    y: old.shape.y - freshShape.get(id)!.y,
  }));
  const shift = offsets.length
    ? {
        x: offsets.reduce((sum, o) => sum + o.x, 0) / offsets.length,
        y: offsets.reduce((sum, o) => sum + o.y, 0) / offsets.length,
      }
    : { x: 0, y: 0 };

  const updated = new Map<string, ExcalidrawElement>();
  const removedIds = new Set<string>();
  const added: ExcalidrawElement[] = [];

  // a matched node: it keeps what it has, with the new id of its line and, if
  // its shape or its number changed, the new shape or number
  const nodeBoxes = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  const shapeIdOf = new Map<string, string>();

  for (const node of parsed.nodes) {
    const old = matched.get(node.id);

    if (!old) {
      continue;
    }

    const wanted = shapeOfNode(node, args.shape);
    const wantedFresh = freshShape.get(node.id)!;
    let shape = old.shape;
    let box = boxOf(shape);

    if (old.shapeKind !== wanted) {
      // the shape was changed: it takes the type and the size the builder gives it
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;

      shape = newElementWith(shape, {
        type: wantedFresh.type,
        roundness: wantedFresh.roundness,
        width: wantedFresh.width,
        height: wantedFresh.height,
        x: cx - wantedFresh.width / 2,
        y: cy - wantedFresh.height / 2,
      } as never);
      box = boxOf(shape);
    }

    shape = newElementWith(shape, {
      customData: {
        ...shape.customData,
        flow: { ...flowOf(shape), nodeId: node.id, shape: wanted },
      },
    });
    updated.set(shape.id, shape);

    if (old.text) {
      let text = old.text;
      const label = freshById.get(
        freshBoundText(wantedFresh, freshById)?.id ?? "",
      ) as ExcalidrawTextElement | undefined;

      // a steps chart is numbered again when a step comes or goes
      if (label && (text.originalText ?? text.text) !== label.originalText) {
        const wrapped = wrapFlowLabel(label.originalText);
        const size = measureFlowText(wrapped, text.fontSize);

        text = newElementWith(text, {
          text: wrapped,
          originalText: label.originalText,
          width: size.width,
          height: size.height,
        });
      }

      text = newElementWith(text, {
        customData: {
          ...text.customData,
          flow: { ...flowOf(text), nodeId: node.id },
        },
      });
      updated.set(text.id, centred(text, box));
    }

    nodeBoxes.set(node.id, box);
    shapeIdOf.set(node.id, shape.id);
  }

  // a node with no line goes, with the arrows that touched it
  const matchedOld = new Set([...matched.values()]);

  for (const old of oldNodes) {
    if (!matchedOld.has(old)) {
      removedIds.add(old.shape.id);

      if (old.text) {
        removedIds.add(old.text.id);
      }
    }
  }

  // a new node: its size from the builder, its place by what it is joined to
  const classEntry = oldNodes
    .map((old) => flowOf(old.shape).class)
    .find((entry) => entry !== undefined);
  const placedBoxes = [...nodeBoxes.values()];
  const GAP = 24;

  for (const node of parsed.nodes) {
    if (matched.has(node.id)) {
      continue;
    }

    const source = freshShape.get(node.id)!;
    const sourceBox = boxOf(source);
    const neighbour = parsed.edges
      .map((edge) =>
        edge.from === node.id
          ? edge.to
          : edge.to === node.id
          ? edge.from
          : null,
      )
      .find((other) => other !== null && nodeBoxes.has(other));

    let target =
      neighbour !== undefined && neighbour !== null
        ? (() => {
            const there = freshShape.get(neighbour)!;
            const own = nodeBoxes.get(neighbour)!;

            return {
              x: own.x + (sourceBox.x - there.x),
              y: own.y + (sourceBox.y - there.y),
            };
          })()
        : { x: sourceBox.x + shift.x, y: sourceBox.y + shift.y };

    // never on top of a shape that is there
    for (let tries = 0; tries < 80; tries++) {
      const box = {
        ...target,
        width: sourceBox.width,
        height: sourceBox.height,
      };

      if (!placedBoxes.some((other) => overlaps(box, other, GAP))) {
        break;
      }

      target = { x: target.x, y: target.y + sourceBox.height + GAP };
    }

    const box = { ...target, width: sourceBox.width, height: sourceBox.height };
    const sourceText = freshBoundText(source, freshById);

    // the new shape names only its label: its arrows are made below
    const shape: ExcalidrawElement = newElementWith(source, {
      x: box.x,
      y: box.y,
      boundElements: sourceText ? [{ id: sourceText.id, type: "text" }] : [],
      customData: {
        ...source.customData,
        flow: {
          ...flowOf(source),
          ...(classEntry !== undefined ? { class: classEntry } : {}),
        },
      },
      ...(args.pageId ? { pageId: args.pageId } : {}),
    } as never);

    added.push(shape);

    if (sourceText) {
      added.push(centred(sourceText as ExcalidrawTextElement, box));
    }

    nodeBoxes.set(node.id, box);
    shapeIdOf.set(node.id, shape.id);
    placedBoxes.push(box);
  }

  // the arrows: an arrow that still joins the same two nodes stays; the others go
  const nodeIdOfOld = new Map<string, string>();

  for (const [id, old] of matched) {
    nodeIdOfOld.set(old.nodeId, id);
  }

  const oldArrows = chart.filter(
    (element): element is ExcalidrawArrowElement =>
      element.type === "arrow" && flowOf(element).role === "edge",
  );
  const wanted = parsed.edges.map((edge) => ({ ...edge, used: false }));
  const boundTo = new Map<string, { id: string; type: "arrow" }[]>();
  const addBound = (shapeId: string, arrowId: string) =>
    boundTo.set(shapeId, [
      ...(boundTo.get(shapeId) ?? []),
      { id: arrowId, type: "arrow" },
    ]);

  for (const arrow of oldArrows) {
    const from = nodeIdOfOld.get(String(flowOf(arrow).from));
    const to = nodeIdOfOld.get(String(flowOf(arrow).to));
    const edge = wanted.find(
      (e) =>
        !e.used &&
        from !== undefined &&
        to !== undefined &&
        e.from === from &&
        e.to === to,
    );

    if (!edge) {
      removedIds.add(arrow.id);

      for (const bound of arrow.boundElements ?? []) {
        removedIds.add(bound.id);
      }

      continue;
    }

    edge.used = true;
    updated.set(
      arrow.id,
      newElementWith(arrow, {
        customData: {
          ...arrow.customData,
          flow: { ...flowOf(arrow), from: edge.from, to: edge.to },
        },
      }),
    );
  }

  const ids = createIds(seed, "a");

  for (const edge of wanted) {
    if (edge.used) {
      continue;
    }

    const made = buildEdge(
      nodeBoxes.get(edge.from)!,
      nodeBoxes.get(edge.to)!,
      shapeIdOf.get(edge.from)!,
      shapeIdOf.get(edge.to)!,
      edge,
      fresh.fontSize,
      ids,
      { pageId: args.pageId },
    );

    added.push(
      ...made.elements.map((element) =>
        args.pageId ? { ...element, pageId: args.pageId } : element,
      ),
    );
    addBound(shapeIdOf.get(edge.from)!, made.arrowId);
    addBound(shapeIdOf.get(edge.to)!, made.arrowId);
  }

  // the shapes name the arrows that are new, and no longer the ones that went
  const finalise = (element: ExcalidrawElement) => {
    const more = boundTo.get(element.id);
    const bound = (element.boundElements ?? []).filter(
      (b) => !removedIds.has(b.id),
    );

    if (!more && bound.length === (element.boundElements ?? []).length) {
      return element;
    }

    return newElementWith(element, {
      boundElements: [...bound, ...(more ?? [])],
    });
  };

  const next: ExcalidrawElement[] = [];

  for (const element of args.elements) {
    if (removedIds.has(element.id)) {
      next.push(
        element.isDeleted
          ? element
          : newElementWith(element, { isDeleted: true }),
      );
      continue;
    }

    next.push(finalise(updated.get(element.id) ?? element));
  }

  for (const element of added) {
    next.push(finalise(element));
  }

  // the chart's id is on everything that is new, and exactly one shape holds the
  // new script
  const inChart = (element: ExcalidrawElement) =>
    !element.isDeleted &&
    (flowOf(element).chartId === args.chartId ||
      added.some((a) => a.id === element.id) ||
      legacy.has(element.id));
  const members = next.filter(inChart);
  const restamped = withRecordOnFirstShape(members, {
    id: args.chartId,
    preset: args.custom?.id ?? args.preset,
    script: args.script,
    fit: args.fit,
    shape: args.shape,
    ...(args.custom ? { custom: args.custom } : {}),
  });
  const byRestamped = new Map(
    restamped.map((element) => [element.id, element]),
  );

  return {
    ok: true,
    elements: next.map((element) => byRestamped.get(element.id) ?? element),
    rebuilt: false,
    kept: matched.size,
    added: parsed.nodes.length - matched.size,
    removed: oldNodes.length - matched.size,
  };
};
