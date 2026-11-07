import React, { useCallback, useEffect, useState } from "react";

import "./GuidedTour.scss";

import type { TourStep } from "./tourSteps";

type Box = { top: number; left: number; width: number; height: number };

const PAD = 8;
const CARD_WIDTH = 340;

/** the box of the first control of the step that is on the screen, or null */
export const findTarget = (step: TourStep): Box | null => {
  for (const selector of step.targets ?? []) {
    const element = document.querySelector(selector);

    if (element) {
      const rect = element.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        return {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      }
    }
  }

  return null;
};

/** where the card goes: beside the control, on the side with more room, kept on the screen */
export const placeCard = (
  box: Box | null,
  viewport: { width: number; height: number },
  cardHeight: number,
) => {
  if (!box) {
    return {
      top: Math.max(16, (viewport.height - cardHeight) / 2),
      left: Math.max(16, (viewport.width - CARD_WIDTH) / 2),
    };
  }

  const below = viewport.height - (box.top + box.height);
  const top =
    below >= cardHeight + 24 + PAD
      ? box.top + box.height + PAD + 12
      : box.top - cardHeight - PAD - 12;
  const left = box.left + box.width / 2 - CARD_WIDTH / 2;

  return {
    top: Math.min(Math.max(16, top), viewport.height - cardHeight - 16),
    left: Math.min(Math.max(16, left), viewport.width - CARD_WIDTH - 16),
  };
};

export const GuidedTour = (props: {
  steps: TourStep[];
  onClose: (finished: boolean) => void;
}) => {
  const { steps, onClose } = props;
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(200);
  const step = steps[index];
  const last = index === steps.length - 1;

  const next = useCallback(() => {
    if (last) {
      onClose(true);
    } else {
      setIndex((i) => i + 1);
    }
  }, [last, onClose]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // the control may move (the window changes size, a panel opens): look again
  useEffect(() => {
    const look = () => setBox(findTarget(step));

    look();

    const timer = window.setInterval(look, 300);

    window.addEventListener("resize", look);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", look);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(false);
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };

    window.addEventListener("keydown", onKey, true);

    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, back, onClose]);

  const place = placeCard(
    box,
    { width: window.innerWidth, height: window.innerHeight },
    cardHeight,
  );

  return (
    <div
      className="GuidedTour"
      data-testid="guided-tour"
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
    >
      <div className="GuidedTour__shield" />
      {box ? (
        <div
          className="GuidedTour__spot"
          data-testid="guided-tour-spot"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        />
      ) : (
        <div className="GuidedTour__dim" />
      )}
      <div
        className="GuidedTour__card"
        style={{ top: place.top, left: place.left, width: CARD_WIDTH }}
        ref={(element) => {
          if (element && element.offsetHeight !== cardHeight) {
            setCardHeight(element.offsetHeight);
          }
        }}
      >
        <div className="GuidedTour__count">
          {index + 1} / {steps.length}
        </div>
        <div className="GuidedTour__title">{step.title}</div>
        <div className="GuidedTour__text">{step.text}</div>
        <div className="GuidedTour__buttons">
          <button
            type="button"
            className="GuidedTour__skip"
            data-testid="guided-tour-skip"
            onClick={() => onClose(false)}
          >
            {last ? "Close" : "Skip tour"}
          </button>
          <span className="GuidedTour__spacer" />
          {index > 0 && (
            <button
              type="button"
              className="GuidedTour__back"
              data-testid="guided-tour-back"
              onClick={back}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="GuidedTour__next"
            data-testid="guided-tour-next"
            onClick={next}
            autoFocus
          >
            {last ? "Start drawing" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
};
