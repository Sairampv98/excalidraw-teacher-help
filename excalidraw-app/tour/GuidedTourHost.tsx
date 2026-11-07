import React, { useEffect } from "react";

import { useAtomValue } from "../app-jotai";
import { isPresenterWindow } from "../presenter/presenterChannel";

import { GuidedTour } from "./GuidedTour";
import {
  closeTour,
  hasSeenTour,
  markTourSeen,
  openTour,
  tourOpenAtom,
} from "./tourState";
import { TOUR_STEPS } from "./tourSteps";

/** shows the tour on the first launch (never in the presenter window or in a shared room) and when it is asked for */
export const GuidedTourHost = () => {
  const open = useAtomValue(tourOpenAtom);

  useEffect(() => {
    if (
      hasSeenTour() ||
      isPresenterWindow() ||
      /[#&]room=/.test(window.location.hash)
    ) {
      return;
    }

    // after the first frame, so the controls it points at are on the screen
    const timer = window.setTimeout(openTour, 1200);

    return () => window.clearTimeout(timer);
  }, []);

  if (!open) {
    return null;
  }

  return (
    <GuidedTour
      steps={TOUR_STEPS}
      onClose={() => {
        markTourSeen();
        closeTour();
      }}
    />
  );
};
