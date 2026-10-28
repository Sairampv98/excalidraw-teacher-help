import clsx from "clsx";
import React from "react";

import { actionChangePage } from "../actions/actionProperties";
import { setCurrentInk } from "../inkDefault";
import { t } from "../i18n";
import {
  CANVAS_PAPER_COLOR,
  PAPER_COLORS,
  PAPER_LOOKS,
  PAPER_TYPES,
  PAPER_TYPE_LABELS,
  paperOf,
} from "../scene/paper";
import {
  PAGE_SIZE_PRESETS,
  getPageSize,
  getPageSizeForPreset,
  getPageSizePresetForPage,
} from "../scene/pages";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../types";

import {
  useAppProps,
  useExcalidrawActionManager,
  useExcalidrawAppState,
  useExcalidrawSetAppState,
} from "./App";
import { CheckboxItem } from "./CheckboxItem";
import { Dialog } from "./Dialog";

import "./PageLookDialog.scss";

import type { PageChange } from "../actions/actionProperties";
import type { PagePaper } from "../scene/paper";

/**
 * The page and its paper (D-243, D-244), opened from the main menu.
 *
 * Three parts: the page itself (its frame, its number, its size), the paper it
 * is written on (type, colour, grain, age) and the one-click looks that set a
 * paper and the ink that goes with it. They are facts about the current page,
 * so every change is a change of the page, made by the `changePage` action and
 * undone with it.
 */
export const PageLookDialog = ({ onClose }: { onClose: () => void }) => {
  const appState = useExcalidrawAppState();
  const setAppState = useExcalidrawSetAppState();
  const actionManager = useExcalidrawActionManager();
  const appProps = useAppProps();

  const page = appState.pages.find(
    (candidate) => candidate.id === appState.currentPageId,
  );

  if (!appProps.pagesEnabled || !page) {
    return null;
  }

  const change = (value: PageChange) =>
    actionManager.executeAction(actionChangePage, "ui", value);

  const { width, height } = getPageSize(page);
  const preset = getPageSizePresetForPage(page);
  const paper = paperOf(page);
  const setPaper = (next: Partial<PagePaper>) =>
    change({ paper: { ...paper, ...next } });

  const applyLook = (id: string) => {
    const look = PAPER_LOOKS.find((candidate) => candidate.id === id);

    if (!look) {
      return;
    }

    change({ paper: look.paper });
    // the ink of the next elements goes with the paper; what is drawn already
    // is not recoloured
    setCurrentInk({ look: look.ink.look, amount: look.ink.amount });
    setAppState({ currentItemStrokeColor: look.ink.color });
  };

  return (
    <Dialog
      onCloseRequest={onClose}
      title={t("labels.pageLook")}
      size="small"
      className="PageLookDialog"
    >
      <div className="PageLookDialog__body" data-testid="page-look-dialog">
        <section>
          <h3>{t("labels.pages.title")}</h3>
          <CheckboxItem
            checked={!!page.frame}
            onChange={(checked) => change({ frame: checked })}
          >
            {t("labels.pages.frame")}
          </CheckboxItem>
          <CheckboxItem
            checked={!!page.number}
            onChange={(checked) => change({ number: checked })}
          >
            {t("labels.pages.number")}
          </CheckboxItem>
          <label>
            <span>{t("labels.pages.size")}</span>
            <select
              data-testid="page-size-preset"
              value={preset?.id ?? ""}
              onChange={(event) => {
                const chosen = PAGE_SIZE_PRESETS.find(
                  (candidate) => candidate.id === event.target.value,
                );

                if (chosen) {
                  // the page remembers the preset it was picked from, not only
                  // the size it ended up with
                  change({
                    ...getPageSizeForPreset(chosen),
                    sizePreset: chosen.id,
                  });
                }
              }}
            >
              <option value="">{t("labels.pages.custom")}</option>
              {PAGE_SIZE_PRESETS.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {t(candidate.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <div className="PageLookDialog__pair">
            <label>
              <span>{t("labels.pages.width")}</span>
              <input
                data-testid="page-width"
                type="number"
                value={width}
                min={PAGE_WIDTH}
                onChange={(event) => {
                  const next = Number(event.target.value);

                  if (Number.isFinite(next) && next > 0) {
                    // a size of the teacher's own is not a preset's size any
                    // more
                    change({ width: next, sizePreset: undefined });
                  }
                }}
              />
            </label>
            <label>
              <span>{t("labels.pages.height")}</span>
              <input
                data-testid="page-height"
                type="number"
                value={height}
                min={PAGE_HEIGHT}
                onChange={(event) => {
                  const next = Number(event.target.value);

                  if (Number.isFinite(next) && next > 0) {
                    change({ height: next, sizePreset: undefined });
                  }
                }}
              />
            </label>
          </div>
        </section>

        <section>
          <h3>Looks</h3>
          <div className="PageLookDialog__looks">
            {PAPER_LOOKS.map((look) => (
              <button
                key={look.id}
                type="button"
                data-testid={`paper-look-${look.id}`}
                onClick={() => applyLook(look.id)}
              >
                {look.name}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Paper</h3>
          <label>
            <span>Type</span>
            <select
              data-testid="paper-type"
              value={paper.type}
              onChange={(event) =>
                setPaper({ type: event.target.value as PagePaper["type"] })
              }
            >
              {PAPER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PAPER_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <div className="PageLookDialog__colors" data-testid="paper-colors">
            <button
              type="button"
              title="Canvas colour"
              data-testid={`paper-color-${CANVAS_PAPER_COLOR}`}
              aria-pressed={paper.color === CANVAS_PAPER_COLOR}
              className={clsx("PageLookDialog__color", "is-canvas", {
                "is-active": paper.color === CANVAS_PAPER_COLOR,
              })}
              onClick={() => setPaper({ color: CANVAS_PAPER_COLOR })}
            />
            {PAPER_COLORS.map((color) => (
              <button
                key={color.id}
                type="button"
                title={color.name}
                data-testid={`paper-color-${color.id}`}
                aria-pressed={paper.color === color.id}
                className={clsx("PageLookDialog__color", {
                  "is-active": paper.color === color.id,
                })}
                style={{ background: color.color }}
                onClick={() => setPaper({ color: color.id })}
              />
            ))}
          </div>
          <label>
            <span>Grain</span>
            <input
              data-testid="paper-grain"
              type="range"
              min={0}
              max={100}
              value={paper.grain}
              onChange={(event) =>
                setPaper({ grain: Number(event.target.value) })
              }
            />
          </label>
          <label>
            <span>Age</span>
            <input
              data-testid="paper-age"
              type="range"
              min={0}
              max={100}
              value={paper.age}
              onChange={(event) =>
                setPaper({ age: Number(event.target.value) })
              }
            />
          </label>
          <button
            type="button"
            className="PageLookDialog__all"
            data-testid="paper-apply-all"
            onClick={() => change({ paper, paperOnAllPages: true })}
          >
            Use this paper on every page
          </button>
        </section>
      </div>
    </Dialog>
  );
};
