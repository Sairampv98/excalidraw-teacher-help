import { describe, expect, it } from "vitest";

import {
  pointerCollaborators,
  PRESENTER_POINTER_SOCKET_ID,
} from "../presenter/presenterChannel";

import type { PresenterPointer } from "../presenter/presenterChannel";

const POINTER: PresenterPointer = {
  x: 120,
  y: 340,
  tool: "laser",
  button: "down",
};

const only = (pointer: PresenterPointer) => {
  const collaborators = pointerCollaborators(pointer);
  expect(collaborators.size).toBe(1);

  const entry = collaborators.get(PRESENTER_POINTER_SOCKET_ID);
  expect(entry).toBeDefined();

  return entry!;
};

describe("pointerCollaborators", () => {
  it("carries the pointer through untouched", () => {
    const collaborator = only(POINTER);

    // scene coordinates travel unchanged — the trail renderer consumes them
    // directly, and the two windows scale the same page differently
    expect(collaborator.pointer?.x).toBe(120);
    expect(collaborator.pointer?.y).toBe(340);
    expect(collaborator.pointer?.tool).toBe("laser");
    expect(collaborator.button).toBe("down");
  });

  it("keeps the cursor + name overlay off the projector", () => {
    const collaborator = only(POINTER);

    // this is what leaves only the trail on screen
    expect(collaborator.pointer?.renderCursor).toBe(false);
    expect(collaborator.username).toBe(null);
  });

  it("always paints the laser in the standard colour", () => {
    expect(only(POINTER).pointer?.laserColor).toBeTruthy();
  });

  it("is never treated as the presenter's own cursor", () => {
    // LaserTrails skips `isCurrentUser` entries — that skip exists to avoid
    // drawing the local trail twice, and would hide the mirrored laser
    expect(only(POINTER).isCurrentUser).toBeUndefined();
  });

  it("keeps button-up so the trail can close", () => {
    const collaborator = only({ ...POINTER, button: "up" });
    expect(collaborator.button).toBe("up");
  });

  it("passes the plain pointer tool through without a trail", () => {
    // `LaserTrails` only strokes when the tool is "laser", so a normal cursor
    // must arrive as "pointer"
    expect(only({ ...POINTER, tool: "pointer" }).pointer?.tool).toBe("pointer");
  });

  it("reuses one stable socket id so the trail is a single continuous stroke", () => {
    const a = pointerCollaborators({ ...POINTER, x: 1 });
    const b = pointerCollaborators({ ...POINTER, x: 2 });

    // a changing key would tear the trail down and start a new one every frame
    expect([...a.keys()]).toEqual([...b.keys()]);
    expect(a.has(PRESENTER_POINTER_SOCKET_ID)).toBe(true);
  });
});
