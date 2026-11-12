// Starts the built app in a Chromium of its own, as a person would see it (D-543).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright-core";

import { isLocalUrl, realConsoleErrors } from "./guard.mjs";

/** the browsers of the person's computer, used only when no Chromium of Playwright's is there */
const FALLBACKS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** the number at the end of a folder's name, so that chromium-1243 is newer than chromium-999 */
const buildOf = (name) => Number(name.match(/-(\d+)$/)?.[1] ?? 0);

/**
 * The Chromium builds Playwright keeps on this computer, newest first. A headless
 * run takes the headless shell (it is lighter); a run with a window needs the whole
 * Chromium. Only the Windows layout of the folders is read; anywhere else the
 * fall-back browsers below are used.
 */
const bundledChromium = ({ env, listDir, headed }) => {
  const root =
    env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(
      env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "ms-playwright",
    );
  let names;

  try {
    names = listDir(root);
  } catch {
    return [];
  }

  const newest = (prefix) =>
    names
      .filter((name) => name.startsWith(prefix))
      .sort((a, b) => buildOf(b) - buildOf(a));
  const shells = newest("chromium_headless_shell-").map((name) =>
    path.join(
      root,
      name,
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe",
    ),
  );
  const full = newest("chromium-").map((name) =>
    path.join(root, name, "chrome-win64", "chrome.exe"),
  );

  return headed ? full : [...shells, ...full];
};

/** every browser the gate may drive, best first: the person's own choice, Playwright's Chromium, then Chrome or Edge */
export const browserCandidates = ({
  env = process.env,
  listDir = fs.readdirSync,
  headed = false,
} = {}) =>
  [
    env.UI_BROWSER,
    ...bundledChromium({ env, listDir, headed }),
    ...FALLBACKS,
  ].filter(Boolean);

/**
 * The browser the gate and the clips drive. It is a Chromium of Playwright's own
 * when the computer has one, so the person's Chrome (and its open tabs) is never
 * used; the run starts it with a fresh profile and closes it. Nothing is downloaded.
 */
export const findBrowser = ({
  headed = false,
  env = process.env,
  exists = fs.existsSync,
  listDir = fs.readdirSync,
} = {}) => {
  const found = browserCandidates({ env, listDir, headed }).find((candidate) =>
    exists(candidate),
  );

  if (!found) {
    throw new Error(
      "no Chromium, Chrome or Edge found: install Playwright's Chromium, or set UI_BROWSER to the browser's file",
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
export const launchApp = async ({
  url,
  headed = false,
  slowMo = 0,
  showTour = false,
}) => {
  const browser = await chromium.launch({
    executablePath: findBrowser({ headed }),
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

  // the first-launch tour covers the board: a scenario sees it only when it asks to
  if (!showTour) {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("excalidraw-classroom-tour-seen", "yes");
      } catch {
        // storage blocked: nothing to set
      }
    });
  }

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
