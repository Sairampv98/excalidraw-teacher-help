/**
 * AC-241 - the laser pointer is a neon tube (D-215).
 *
 * The lasers are drawn in the editor's SVG layer; what is checked is what is in
 * that layer: a halo path and a core path above it, and the colours on them.
 */

import React from "react";

import { describe, expect, it, vi } from "vitest";

import { AnimatedTrail } from "../animatedTrail";
import { Excalidraw } from "../index";

import { Pointer } from "./helpers/ui";
import { act, render, waitFor } from "./test-utils";

import type { Collaborator, SocketId } from "../types";

const { h } = window;

const mouse = new Pointer("mouse");

/** a collaborator whose laser is down at (x, y), in `color` */
const collaborator = (
  x: number,
  y: number,
  color: string,
  button: "down" | "up" = "down",
): Collaborator => ({
  pointer: { x, y, tool: "laser", laserColor: color },
  button,
});

const lasers = (list: [string, Collaborator][]) =>
  new Map(list.map(([id, c]) => [id as SocketId, c]));

const layer = () => document.querySelector(".SVGLayer svg")!;

const halos = () => [...layer().querySelectorAll("path[data-neon-halo]")];
const cores = () => [...layer().querySelectorAll("path[data-neon-core]")];

describe("AC-241 the laser trail is a neon tube", () => {
  it("AC-241 the laser trail has a bright core and a halo", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.updateScene({
        collaborators: lasers([["a", collaborator(10, 10, "#ff0000")]]),
      });
    });

    expect(halos()).toHaveLength(1);
    expect(cores()).toHaveLength(1);

    // the core is drawn above the halo
    expect(
      halos()[0].compareDocumentPosition(cores()[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // both are the same stroke, so the core is inside the halo
    expect(cores()[0].getAttribute("d")).toBe(halos()[0].getAttribute("d"));
  });

  it("AC-241 the core is the colour lightened toward white", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.updateScene({
        collaborators: lasers([["a", collaborator(10, 10, "#ff0000")]]),
      });
    });

    const fill = cores()[0].getAttribute("fill")!;

    // a mix of the laser colour and white, mostly white
    expect(fill).toMatch(/^color-mix\(in srgb, #ff0000 \d+%, #fff\)$/);
    expect(Number(/(\d+)%/.exec(fill)![1])).toBeLessThan(50);

    // and no outline of its own: its edge is the halo's
    expect(cores()[0].getAttribute("stroke")).toBe("none");
  });

  it("AC-241 the halo has layered shadows in the laser colour", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.updateScene({
        collaborators: lasers([["a", collaborator(10, 10, "#ff0000")]]),
      });
    });

    const halo = halos()[0] as SVGPathElement;

    expect(halo.getAttribute("fill")).toBe("#ff0000");
    expect(halo.getAttribute("stroke")).toBe("#ff0000");

    const shadows = [
      ...halo.style.filter.matchAll(/drop-shadow\(0(?:px)? 0(?:px)? (\d+)px/g),
    ].map((match) => Number(match[1]));

    // soft shadows of growing reach, so that it blooms
    expect(shadows.length).toBeGreaterThanOrEqual(3);
    expect([...shadows].sort((a, b) => a - b)).toEqual(shadows);
  });

  it("AC-241 the pointer's own laser is neon too", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.setActiveTool({ type: "laser" });
    });

    mouse.downAt(100, 100);
    mouse.moveTo(140, 130);
    mouse.moveTo(190, 150);

    expect(halos()).toHaveLength(1);
    expect(cores()).toHaveLength(1);

    mouse.upAt(190, 150);
  });

  it("AC-241 a collaborator's laser is neon in its own colour", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.updateScene({
        collaborators: lasers([
          ["a", collaborator(10, 10, "#ff0000")],
          ["b", collaborator(60, 60, "#00aaff")],
        ]),
      });
    });

    expect(halos()).toHaveLength(2);
    expect(cores()).toHaveLength(2);

    const colours = halos().map((halo) => halo.getAttribute("fill"));

    expect(colours.sort()).toEqual(["#00aaff", "#ff0000"]);

    for (const core of cores()) {
      expect(core.getAttribute("fill")).toMatch(
        /^color-mix\(in srgb, #(ff0000|00aaff) \d+%, #fff\)$/,
      );
    }
  });

  it("AC-241 the trail still fades", async () => {
    await render(<Excalidraw />);

    act(() => {
      h.app.updateScene({
        collaborators: lasers([["a", collaborator(10, 10, "#ff0000")]]),
      });
    });

    expect(halos()).toHaveLength(1);

    // long after, the trail has decayed away, as it always did
    const clock = vi
      .spyOn(performance, "now")
      .mockReturnValue(performance.now() + 5000);

    act(() => {
      h.app.updateScene({
        collaborators: lasers([["a", collaborator(10, 10, "#ff0000", "up")]]),
      });
    });

    await waitFor(
      () => {
        expect(halos()).toHaveLength(0);
        expect(cores()).toHaveLength(0);
      },
      { timeout: 3000 },
    );

    clock.mockRestore();
  });

  it("AC-241 other trails are unchanged", async () => {
    await render(<Excalidraw />);

    // only the lasers ask for the tube
    const app = h.app as unknown as Record<string, any>;

    expect(app.laserTrails.localTrail.options.neon).toBe(true);

    for (const name of ["eraserTrail", "lassoTrail"]) {
      const trail = app[name];

      expect(trail, name).toBeInstanceOf(AnimatedTrail);
      expect(trail.options.neon).toBeUndefined();
      expect(trail.coreElement).toBeUndefined();
    }
  });
});
