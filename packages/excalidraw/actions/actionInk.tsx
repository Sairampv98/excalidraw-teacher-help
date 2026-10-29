import {
  INK_COLORS,
  INK_LOOKS,
  canHaveInk,
  clampInkAmount,
  customDataWithInk,
  inkOf,
  newElementWith,
} from "@excalidraw/element";

import { CaptureUpdateAction } from "@excalidraw/element";

import type { InkLookName } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getCurrentInk, setCurrentInk } from "../inkDefault";
import { Range } from "../components/Range";
import { t } from "../i18n";

import { changeProperty, getFormValue } from "./actionProperties";
import { register } from "./register";

import "./actionInk.scss";

export type InkChange = {
  look?: InkLookName;
  amount?: number;
  /** a named colour of the look: it sets the ink colour */
  color?: string;
};

const LOOK_NAMES: Record<InkLookName, string> = {
  normal: "Normal",
  neon: "Neon",
  chalk: "Chalk",
  marker: "Marker",
  pencil: "Pencil",
};

const AMOUNT_NAMES: Record<InkLookName, string> = {
  normal: "Amount",
  neon: "Glow",
  chalk: "Dust",
  marker: "Width",
  pencil: "Darkness",
};

export const actionChangeInkLook = register<InkChange>({
  name: "changeInkLook",
  label: "labels.inkLook",
  trackEvent: false,
  perform: (elements, appState, value) => {
    if (!value) {
      return false;
    }

    // what the next element is drawn with
    const before = getCurrentInk();

    setCurrentInk({
      look: value.look ?? before.look,
      amount: clampInkAmount(value.amount ?? before.amount),
    });

    return {
      // the words inside a selected shape take the look with it
      elements: changeProperty(
        elements,
        appState,
        (element) => {
          if (!canHaveInk(element)) {
            return element;
          }

          const own = inkOf(element);

          return newElementWith(
            element,
            {
              customData: customDataWithInk(element.customData, {
                look: value.look ?? own.look,
                amount: clampInkAmount(value.amount ?? own.amount),
              }),
              ...(value.color ? { strokeColor: value.color } : {}),
            },
            // Normal takes the look away, and an update to nothing is not a change
            true,
          );
        },
        true,
      ),
      appState: value.color
        ? { ...appState, currentItemStrokeColor: value.color }
        : appState,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ elements, appState, app, updateData }) => {
    const inked = (element: ExcalidrawElement) => canHaveInk(element);

    const look = getFormValue<string>(
      elements,
      app,
      (element) => inkOf(element).look,
      inked,
      (hasSelection) => (hasSelection ? "" : getCurrentInk().look),
    ) as InkLookName | "";

    const amount = getFormValue<number>(
      elements,
      app,
      (element) => inkOf(element).amount,
      inked,
      (hasSelection) => (hasSelection ? 0 : getCurrentInk().amount),
    );

    const shown = look || "normal";
    const colors = shown === "normal" ? [] : INK_COLORS[shown];

    return (
      <fieldset className="ink-look">
        <legend>{t("labels.inkLook")}</legend>
        <div className="ink-look__looks buttonList" role="radiogroup">
          {INK_LOOKS.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={look === name}
              className={`ink-look__look${look === name ? " active" : ""}`}
              data-testid={`ink-look-${name}`}
              onClick={() => updateData({ look: name })}
            >
              {LOOK_NAMES[name]}
            </button>
          ))}
        </div>
        {colors.length > 0 && (
          <div className="ink-look__colors" data-testid="ink-look-colors">
            {colors.map(({ name, color }) => (
              <button
                key={name}
                type="button"
                className="ink-look__color"
                title={name}
                aria-label={`${LOOK_NAMES[shown]} ${name}`}
                data-testid={`ink-color-${name.toLowerCase()}`}
                style={{ background: color }}
                onClick={() => updateData({ color })}
              />
            ))}
          </div>
        )}
        {shown !== "normal" && (
          <Range
            label={AMOUNT_NAMES[shown]}
            value={amount || 50}
            hasCommonValue={amount !== 0}
            onChange={(value) => updateData({ amount: value })}
            min={1}
            max={100}
            step={1}
            testId="ink-amount"
          />
        )}
      </fieldset>
    );
  },
});
