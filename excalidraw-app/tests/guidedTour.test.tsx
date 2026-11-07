/**
 * AC-548 - the tour of the first launch: its steps, where its card goes, how it
 * is walked and left, and that it is offered once.
 * AC-549 - the tour is not shown where it would be in the way.
 * AC-550 - the help brings up the guide of the tool in use.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { vi } from "vitest";

import { ToolGuideCard } from "@excalidraw/excalidraw/components/HelpDialog";
import {
  TOOL_GUIDES,
  guideForTool,
} from "@excalidraw/excalidraw/guides/toolGuides";

import { GuidedTour, placeCard } from "../tour/GuidedTour";
import { hasSeenTour, markTourSeen } from "../tour/tourState";
import { TOUR_STEPS } from "../tour/tourSteps";

describe("AC-548 the tour of the first launch", () => {
  it("AC-548 begins by welcoming and ends by sending the newcomer to draw", () => {
    expect(TOUR_STEPS[0].id).toBe("welcome");
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].id).toBe("done");

    // every step is told in words and the ones in between point at a control
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.text.length).toBeGreaterThan(20);
    }

    for (const step of TOUR_STEPS.slice(1, -1)) {
      expect(step.targets?.length).toBeGreaterThan(0);
    }
  });

  it("AC-548 the card goes beside the control, on the side with room, and stays on the screen", () => {
    const viewport = { width: 1600, height: 900 };
    const centered = placeCard(null, viewport, 200);

    expect(centered.left).toBeCloseTo((1600 - 340) / 2);
    expect(centered.top).toBeCloseTo((900 - 200) / 2);

    // a control at the top: the card goes below it
    const below = placeCard(
      { top: 20, left: 700, width: 200, height: 40 },
      viewport,
      200,
    );

    expect(below.top).toBeGreaterThan(60);

    // a control at the bottom: the card goes above it
    const above = placeCard(
      { top: 840, left: 700, width: 200, height: 40 },
      viewport,
      200,
    );

    expect(above.top + 200).toBeLessThan(840);

    // a control at the right edge: the card is kept on the screen
    const edge = placeCard(
      { top: 840, left: 1560, width: 36, height: 36 },
      viewport,
      200,
    );

    expect(edge.left + 340).toBeLessThanOrEqual(1600 - 16);
  });

  it("AC-548 is walked with Next and Back, and left with Skip or Escape", () => {
    const onClose = vi.fn();

    render(<GuidedTour steps={TOUR_STEPS} onClose={onClose} />);

    expect(screen.getByText("Welcome to the classroom board")).not.toBeNull();
    expect(screen.queryByTestId("guided-tour-back")).toBeNull();

    fireEvent.click(screen.getByTestId("guided-tour-next"));
    expect(screen.getByText("The tools")).not.toBeNull();

    fireEvent.click(screen.getByTestId("guided-tour-back"));
    expect(screen.getByText("Welcome to the classroom board")).not.toBeNull();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("The tools")).not.toBeNull();

    // to the last step: Next says what comes of it, and finishes
    for (let i = 0; i < TOUR_STEPS.length - 2; i += 1) {
      fireEvent.click(screen.getByTestId("guided-tour-next"));
    }

    expect(screen.getByText("You are ready")).not.toBeNull();
    fireEvent.click(screen.getByText("Start drawing"));
    expect(onClose).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByTestId("guided-tour-skip"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("AC-548 is offered once: it is remembered when seen", () => {
    window.localStorage.clear();
    expect(hasSeenTour()).toBe(false);

    markTourSeen();
    expect(hasSeenTour()).toBe(true);
  });

  it("AC-549 blocked storage does not break it: the tour is then offered each time", () => {
    const spy = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(hasSeenTour()).toBe(false);
    expect(() => markTourSeen()).not.toThrow();
    spy.mockRestore();
  });
});

describe("AC-550 the help brings up the guide of the tool in use", () => {
  it("AC-550 every tool of the toolbar has a guide with moves to follow", () => {
    for (const tool of [
      "selection",
      "rectangle",
      "diamond",
      "ellipse",
      "arrow",
      "line",
      "freedraw",
      "text",
      "image",
      "eraser",
      "hand",
      "frame",
      "laser",
      "lasso",
    ]) {
      const guide = guideForTool(tool);

      expect(guide).not.toBeNull();
      expect(guide!.steps.length).toBeGreaterThanOrEqual(3);
    }

    expect(guideForTool("not-a-tool")).toBeNull();
    expect(guideForTool(null)).toBeNull();
    expect(Object.keys(TOOL_GUIDES).length).toBeGreaterThan(10);
  });

  it("AC-550 the help shows the guide of the tool it is given, and none for one that has no guide", () => {
    const { unmount } = render(<ToolGuideCard tool="arrow" />);

    expect(screen.getByTestId("help-tool-guide").textContent).toContain(
      "Arrow",
    );
    expect(screen.getByTestId("help-tool-guide").textContent).not.toContain(
      "Rectangle",
    );
    unmount();

    render(<ToolGuideCard tool="custom-thing" />);
    expect(screen.queryByTestId("help-tool-guide")).toBeNull();
  });
});
