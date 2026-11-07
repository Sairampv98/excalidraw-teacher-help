/**
 * AC-547 - the app opens without asking another computer for anything: the
 * fonts are its own files and the page holds no analytics script.
 */

import fs from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  woff2BrowserPlugin,
} = require("../../scripts/woff2/woff2-vite-plugins");

const page = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");

const built = () => {
  const plugin = woff2BrowserPlugin();

  plugin.config({}, { command: "build" });

  return plugin;
};

const OTHER_COMPUTER = /https?:\/\/(?!localhost|127\.0\.0\.1)/;

describe("AC-547 the app asks no other computer for its fonts or for analytics", () => {
  it("the fonts of the built page come from the app's own root", () => {
    const html = built().transform(
      "<!-- PLACEHOLDER:EXCALIDRAW_APP_FONTS -->",
      "/x/excalidraw-app/index.html",
    );

    expect(html).toContain('window.EXCALIDRAW_ASSET_PATH = "/"');
    expect(html).toContain('href="/fonts/Excalifont/');
    expect(html).not.toMatch(OTHER_COMPUTER);
  });

  it("the font faces of the interface are left to the build, which bundles the package files", () => {
    expect(
      built().transform("", "/x/excalidraw/fonts/fonts.css"),
    ).toBeUndefined();
  });

  it("the page holds no analytics script and no connection to a font host", () => {
    expect(page).not.toMatch(
      /simpleanalytics|google-analytics|googletagmanager/i,
    );
    expect(page).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });
});
