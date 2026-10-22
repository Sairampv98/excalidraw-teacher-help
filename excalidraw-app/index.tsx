import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";

import ExcalidrawApp from "./App";

// the grammars the app owns: the library reaches them through its registry
// (D-84). The import registers them, so it happens before any editor mounts.
import "./codeLanguages";

import { registerMediaStore } from "./data/mediaStore";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;

// The app's resolver for a **media-backed** panel (D-95): the library owns the
// shape and the app owns the bytes. It is registered here, before anything
// mounts, because the presenter window is the **same origin** and reads the
// same store (D-96) — so one registration serves both windows.
registerMediaStore();

const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
