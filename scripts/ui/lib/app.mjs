// Starts the built app in the real Chrome of this computer, as a person would see it.
import fs from "node:fs";

import { chromium } from "playwright-core";

import { isLocalUrl, realConsoleErrors } from "./guard.mjs";

const CANDIDATES = [
  process.env.UI_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

/** the browser the gate drives: the one on this computer (nothing is downloaded) */
export const findBrowser = () => {
  const found = CANDIDATES.find((candidate) => fs.existsSync(candidate));

  if (!found) {
    throw new Error(
      "no Chrome or Edge found: set UI_BROWSER to the browser's file",
    );
  }

  return found;
};

export const VIEWPORT = { width: 1600, height: 900 };

/**
 * A fresh browser with nothing remembered, the app open in it, and a watch on what
 * goes wrong while it runs: console errors, and requests that leave this computer
 * (those are refused, so a run is the same with or without the internet).
 */
export const launchApp = async ({ url, headed = false, slowMo = 0 }) => {
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: !headed,
    slowMo,
    args: headed ? ["--window-size=1700,1000", "--window-position=40,20"] : [],
  });
  const context = await browser.newContext({
    viewport: headed ? null : VIEWPORT,
    serviceWorkers: "block",
    acceptDownloads: true,
  });
  const faults = { console: [], outside: [] };

  await context.route("**/*", (route) => {
    const target = route.request().url();

    if (isLocalUrl(target)) {
      return route.continue();
    }

    faults.outside.push(target);

    return route.abort();
  });

  const watch = (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") {
        faults.console.push(message.text().slice(0, 300));
      }
    });
    page.on("pageerror", (error) =>
      faults.console.push(`uncaught: ${String(error.message).slice(0, 300)}`),
    );
  };

  context.on("page", watch);

  const page = await context.newPage();

  await page.goto(url, { waitUntil: "load" });
  // the first frame of the canvas is up
  await page
    .locator("canvas")
    .first()
    .waitFor({ state: "attached", timeout: 15000 });
  await page.waitForTimeout(800);

  return {
    browser,
    context,
    page,
    faults,
    realConsoleErrors: () => realConsoleErrors(faults.console),
    close: async () => {
      await browser.close();
    },
  };
};
