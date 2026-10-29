/**
 * AC-290 - the properties of a panel are its choices, and nothing that cannot
 * be pressed (D-251).
 *
 * The "Panel" section used to list the panel's kind, its state and a heading
 * "Actions": words that did nothing and took the room of what does. It is the
 * panel's choices - the camera, the reading of its text - and nothing else.
 */

import React from "react";
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import type { FileId } from "@excalidraw/element/types";

import { Excalidraw, videoPanelContent } from "../index";

import { API } from "./helpers/api";
import { render, screen, waitFor } from "./test-utils";

const panel = () =>
  API.createElement({
    type: "panel",
    x: 100,
    y: 100,
    width: 300,
    height: 200,
    panelKind: "video",
    panel: videoPanelContent({
      source: { type: "file", fileId: "f" as FileId, mimeType: "video/mp4" },
      tracks: [],
      language: "en",
      naturalWidth: 1920,
      naturalHeight: 1080,
    }),
    posterMode: false,
    posterFileId: null,
  } as never) as ExcalidrawElement;

describe("AC-290 the properties of a panel are its choices", () => {
  it("AC-290 the Panel section has its choices and no words that do nothing", async () => {
    const element = panel();

    await render(
      <Excalidraw
        initialData={{ elements: [element] as never }}
        panelScreenshot={{ onCapture: () => {} }}
        panelOcr={{ message: "Not connected.", onOcr: () => {} }}
      />,
    );
    API.setAppState({
      width: 1000,
      height: 1000,
      selectedElementIds: { [element.id]: true },
    });

    // the section is there, with the choices of the panel
    await waitFor(() =>
      expect(screen.getByTestId("panel-actions")).not.toBeNull(),
    );
    expect(screen.getByText("Panel")).not.toBeNull();
    expect(screen.getByTestId("panel-screenshot-button")).not.toBeNull();

    // and none of the words that took their room, in the Panel section
    const section = screen.getByText("Panel").closest("fieldset")!;

    for (const word of [
      "Kind",
      "State",
      "Actions",
      "Poster",
      "Live",
      "video",
    ]) {
      expect(section.textContent, word).not.toContain(word);
    }

    // what is in it is the panel's actions
    expect(section.contains(screen.getByTestId("panel-actions"))).toBe(true);
  });
});
