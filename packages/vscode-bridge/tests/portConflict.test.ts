import { describe, expect, it } from "vitest";

import {
  isPortInUse,
  portConflictMessage,
} from "../extension/src/portConflict";

/**
 * What the extension says when it cannot take the bridge's port.
 *
 * The port is FIXED, so with two editors running only one of them holds it.
 * The one that loses must say so, and say what to do - a silent loss of the
 * race is what made the teacher stare at an empty panel for an hour (D-77).
 */
describe("the port conflict message", () => {
  it("AC-88 an extension that cannot take the port says so, and says what to do", () => {
    const message = portConflictMessage(47511, {
      code: "EADDRINUSE",
      message: "listen EADDRINUSE: address already in use 127.0.0.1:47511",
    });

    // it names the port ...
    expect(message).toContain("47511");
    // ... it says another editor has it ...
    expect(message).toContain("another editor");
    // ... and it gives the two ways out
    expect(message).toContain("excalidraw-bridge.port");
    expect(message).toContain("VITE_APP_BRIDGE_URL");
  });

  it("AC-88 the port-in-use failure is recognised by its code and by its text", () => {
    expect(isPortInUse({ code: "EADDRINUSE", message: "nope" })).toBe(true);
    expect(
      isPortInUse(new Error("listen EADDRINUSE: address already in use")),
    ).toBe(true);
    expect(isPortInUse(new Error("something else went wrong"))).toBe(false);
  });

  it("AC-88 a failure that is not the port says what the failure was", () => {
    const message = portConflictMessage(47511, new Error("permission denied"));

    expect(message).toContain("47511");
    expect(message).toContain("permission denied");
    // it must NOT blame another editor for something else
    expect(message).not.toContain("another editor");
  });
});
