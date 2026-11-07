// Films one clip: the real app, in the browser of this computer, doing what a teacher does.
// A clip can film one window, or two side by side (the editor and the presenter).
import fs from "node:fs";
import path from "node:path";

import { chromium } from "playwright-core";

import { findBrowser } from "../../ui/lib/app.mjs";
import { isLocalUrl } from "../../ui/lib/guard.mjs";
import { serveFolder } from "../../ui/lib/staticServer.mjs";

import { ensureAssets } from "./assets.mjs";
import {
  findFfmpeg,
  framesToFilmArgs,
  gifArgs,
  hstackArgs,
  posterArgs,
  runFfmpeg,
  webmArgs,
} from "./ffmpeg.mjs";
import { overlayScript } from "./overlay.mjs";
import {
  CLIP_SIZE,
  HALF_SIZE,
  checkClip,
  concatList,
  glidePoints,
  hostAllowed,
  manifestEntry,
  readingTime,
} from "./plan.mjs";

/** what a clip's script is given: the page, and the few things a teacher does with it */
const makeHelper = (page, assets, size) => {
  let at = { x: size.width / 2, y: size.height / 2 };

  const helper = {
    page,
    assets,
    /** a button that opens the file chooser is pressed, and the chooser is given files */
    choose: async (button, files) => {
      await helper.glide(button);
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        helper.click(button),
      ]);

      await chooser.setFiles(files);
      await page.waitForTimeout(1500);
    },
    wait: (ms) => page.waitForTimeout(ms),
    /** a caption, held long enough to read (at the bottom, or at the top with `at: "top"`) */
    say: async (text, { hold, at: where } = {}) => {
      await page.evaluate(
        ([words, place]) => window.__clipCaption?.(words, place),
        [text, where],
      );
      await page.waitForTimeout(hold ?? readingTime(text));
    },
    hush: () => page.evaluate(() => window.__clipCaption?.("")),
    /** the pointer travels to a place the way a hand does */
    glide: async (target) => {
      const to =
        "x" in target
          ? target
          : await (async () => {
              const box = await target.boundingBox();

              if (!box) {
                throw new Error("the control to point at is not on the screen");
              }

              return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            })();

      for (const point of glidePoints(at, to)) {
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(14);
      }
      at = to;
    },
    click: async (target) => {
      await helper.glide(target);
      await page.waitForTimeout(220);
      await page.mouse.down();
      await page.waitForTimeout(90);
      await page.mouse.up();
      await page.waitForTimeout(350);
    },
    /** draws a shape: press, travel, release */
    drag: async (from, to) => {
      await helper.glide(from);
      await page.mouse.down();
      await helper.glide(to);
      await page.mouse.up();
      await page.waitForTimeout(300);
    },
  };

  return helper;
};

/** the film of a window is the frames Chrome sends of it, gathered as they come */
const startCapture = async (context, page, dir, size) => {
  const cdp = await context.newCDPSession(page);
  const frames = [];

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  cdp.on("Page.screencastFrame", (frame) => {
    const file = path.join(
      dir,
      `${String(frames.length).padStart(5, "0")}.jpg`,
    );

    fs.writeFileSync(file, Buffer.from(frame.data, "base64"));
    frames.push({
      file: file.replaceAll("\\", "/"),
      at: frame.metadata.timestamp,
    });
    cdp
      .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
      .catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: size.width,
    maxHeight: size.height,
    everyNthFrame: 1,
  });

  return {
    frames,
    stop: () => cdp.send("Page.stopScreencast"),
  };
};

const openWindow = async (context, url, size) => {
  const page = await context.newPage();

  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "load" });
  await page.locator("canvas").first().waitFor({ state: "attached" });
  await page.mouse.move(size.width / 2, size.height / 2);

  return page;
};

export const recordClip = async (
  clip,
  { appDir, outDir, rawDir, withGif = false },
) => {
  const problems = checkClip(clip);

  if (problems.length) {
    throw new Error(problems.join("; "));
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const split = clip.split === true;
  const size = split ? HALF_SIZE : CLIP_SIZE;
  const server = await serveFolder(appDir, { port: 0 });
  const browser = await chromium.launch({
    executablePath: findBrowser(),
    headless: true,
  });
  const startedAt = Date.now();
  const ffmpeg = findFfmpeg();
  let seconds = 0;
  let rawFile;

  try {
    const context = await browser.newContext({
      viewport: size,
      serviceWorkers: "block",
    });

    // nothing leaves this computer while a clip is made, except at the addresses a clip names for itself
    await context.route("**/*", (route) => {
      const url = route.request().url();

      return isLocalUrl(url) || hostAllowed(url, clip.allowHosts)
        ? route.continue()
        : route.abort();
    });
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem("excalidraw-classroom-tour-seen", "yes");
      } catch {
        // storage blocked: the tour is not wanted in a clip, and cannot be told so
      }
    });
    await context.addInitScript(overlayScript);

    const page = await openWindow(context, server.url, size);
    const second = split
      ? await openWindow(context, `${server.url}/?presenter=true`, size)
      : null;

    await page.bringToFront();
    await page.waitForTimeout(1200);

    const frameDir = path.join(rawDir, clip.id);
    const left = await startCapture(
      context,
      page,
      path.join(frameDir, "left"),
      size,
    );
    const right = second
      ? await startCapture(context, second, path.join(frameDir, "right"), size)
      : null;
    const assets = ensureAssets(path.join(rawDir, "assets"));
    const helper = makeHelper(page, assets, size);

    if (second) {
      helper.right = makeHelper(second, assets, size);
    }

    try {
      await clip.run(helper);
    } catch (error) {
      // a picture of the moment it went wrong, to look at
      const shot = path.join(rawDir, `${clip.id}-FAILED.png`);

      await page.screenshot({ path: shot }).catch(() => {});
      error.message += ` (a picture: ${shot})`;
      throw error;
    }
    await helper.hush();
    await helper.right?.hush();
    await page.waitForTimeout(600);
    seconds = (Date.now() - startedAt) / 1000;

    await left.stop();
    await right?.stop();
    await context.close();

    // both windows start at the same moment, whichever sent its first picture first
    const startAt = Math.min(
      left.frames[0].at,
      right ? right.frames[0].at : Infinity,
    );
    const film = (capture, name) => {
      const list = path.join(frameDir, `${name}.txt`);
      const out = path.join(rawDir, `${clip.id}-${name}.mp4`);

      fs.writeFileSync(list, concatList(capture.frames, { startAt }));
      runFfmpeg(ffmpeg, framesToFilmArgs(list, out));

      return out;
    };

    rawFile = path.join(rawDir, `${clip.id}.mp4`);

    if (right) {
      runFfmpeg(
        ffmpeg,
        hstackArgs(film(left, "left"), film(right, "right"), rawFile),
      );
    } else {
      fs.copyFileSync(film(left, "left"), rawFile);
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const webm = path.join(outDir, `${clip.id}.webm`);
  const poster = path.join(outDir, `${clip.id}.jpg`);

  runFfmpeg(ffmpeg, webmArgs(rawFile, webm));
  runFfmpeg(ffmpeg, posterArgs(rawFile, poster, { at: clip.posterAt ?? 1.5 }));

  if (withGif) {
    runFfmpeg(ffmpeg, gifArgs(rawFile, path.join(outDir, `${clip.id}.gif`)));
  }

  return manifestEntry(clip, {
    seconds: Math.round(seconds * 10) / 10,
    bytes: fs.statSync(webm).size,
  });
};
