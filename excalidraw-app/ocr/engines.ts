import benchmark from "./benchmark-result.json";

import type { OcrEngineName } from "../../packages/vscode-bridge/bridge/src/ocr";

/**
 * The OCR engines the panel's **picker** offers, and the **measured** speed of
 * each (D-118).
 *
 * The engine was a VS Code setting, so choosing it meant leaving the
 * whiteboard. The picker lives in the panel now, and it carries each engine's
 * speed as a **colour** - the traffic lights the owner asked for: green for
 * the fastest, amber for the one in the middle, red for the slowest.
 *
 * The numbers are the project's **own record**, read from
 * `benchmark-result.json` - the file the benchmark wrote. Nothing here is
 * invented: the picker shows what was measured, and the extension says which
 * engine actually ran and how long it took (D-90).
 *
 * The engine itself never runs in the browser (D-59): this table is names,
 * numbers and colours, and the read still happens in the bridge's Node
 * process.
 */

/** one engine in the picker */
export type OcrEngineChoice = {
  /** the engine's id, as the bridge knows it */
  id: OcrEngineName;
  /** the name the teacher reads */
  label: string;
  /** the measured read, in milliseconds - the project's own record */
  measuredMs: number;
  /** the colour the engine's speed is shown in: the traffic light */
  color: string;
};

/**
 * The traffic lights (D-118).
 *
 * Green is the fastest engine, amber the one in the middle, red the slowest -
 * the same three colours the owner's own words asked for.
 */
export const OCR_SPEED_COLORS = {
  fast: "rgb(22, 163, 74)",
  middle: "rgb(202, 138, 4)",
  slow: "rgb(220, 38, 38)",
} as const;

/**
 * The measured read of each engine, in milliseconds.
 *
 * `indra` and `tesseract` are measured on the **same** frame - the 1080p
 * screencast the benchmark made - so the two numbers can be compared with each
 * other. `paddle` is measured on the **stream frame** the extension actually
 * reads (the sidecar's own record), because that is the read the teacher waits
 * for.
 *
 * The wave 5o benchmark recorded paddle's median over five runs of the 1080p
 * frame as 27,822 ms; the sidecar's own record says 30,601 ms for the second
 * read (the model already loaded) and 34,668 ms for the shipped sidecar. The
 * picker shows the **shipped** number, because that is the one the teacher's
 * machine does.
 */
const MEASURED_MS: Record<OcrEngineName, number> = {
  indra: benchmark.engines.indra.fullFrame.medianMs,
  tesseract: benchmark.engines.tesseract.fullFrame.medianMs,
  paddle: benchmark.engines.paddle.measured.shippedSidecarMs,
};

/**
 * The engines the picker offers, **fastest first**.
 *
 * The order is the measured order, so the list the teacher reads is the list
 * that is quickest to get through.
 */
export const OCR_ENGINE_CHOICES: readonly OcrEngineChoice[] = [
  {
    id: "indra",
    label: "indra",
    measuredMs: MEASURED_MS.indra,
    color: OCR_SPEED_COLORS.fast,
  },
  {
    id: "tesseract",
    label: "tesseract",
    measuredMs: MEASURED_MS.tesseract,
    color: OCR_SPEED_COLORS.middle,
  },
  {
    id: "paddle",
    label: "paddle",
    measuredMs: MEASURED_MS.paddle,
    color: OCR_SPEED_COLORS.slow,
  },
];

/**
 * The engine a panel reads with until the teacher chooses another (D-118).
 *
 * It is the **fastest measured** engine, and it is derived from the record
 * rather than written down: a default that is the slowest of the three is a
 * default nobody wants.
 */
export const DEFAULT_PANEL_OCR_ENGINE: OcrEngineName =
  OCR_ENGINE_CHOICES.reduce((fastest, engine) =>
    engine.measuredMs < fastest.measuredMs ? engine : fastest,
  ).id;

/**
 * Where a rung of the **ladder** runs (D-137).
 *
 * - `bridge` - the engine lives in the extension's Node process (D-59);
 * - `browser` - the engine would have to run in the browser.
 */
export type OcrLadderRoute = "bridge" | "browser";

/** one rung of the ladder */
export type OcrLadderRung = {
  /** the engine this rung asks for */
  engine: OcrEngineName;
  /** where the engine runs when the bridge is connected */
  withBridge: OcrLadderRoute;
  /** where the engine runs when the bridge is **not** connected */
  withoutBridge: OcrLadderRoute;
  /** what the rung needs to run at all */
  needs: string;
};

/**
 * The **ladder**, in the order the machine walks it (D-137).
 *
 * The order is not a preference - it is what the machine can actually do:
 *
 * 1. **indra** when the bridge is connected: the fastest engine there is
 *    (147 ms on this box);
 * 2. **tesseract** when the bridge is not there (278 ms): the engine the owner
 *    called the default, and the one that needs nothing but the browser;
 * 3. **paddle** only as the last resort (27,822 ms): it is the slowest by an
 *    order of magnitude and it needs the Python sidecar.
 *
 * A teacher should never have to choose an engine - the machine chooses, and
 * says what it chose.
 */
export const OCR_LADDER: readonly OcrLadderRung[] = [
  {
    engine: "indra",
    withBridge: "bridge",
    withoutBridge: "bridge",
    needs: "the bridge, with the Python sidecar",
  },
  {
    engine: "tesseract",
    withBridge: "bridge",
    withoutBridge: "browser",
    needs: "an engine in the browser",
  },
  {
    engine: "paddle",
    withBridge: "bridge",
    withoutBridge: "bridge",
    needs: "the bridge, with the Python sidecar",
  },
];

/** a rung of the ladder, with the route it takes on this machine */
export type OcrLadderStep = OcrLadderRung & {
  /** where this rung runs, on this machine */
  route: OcrLadderRoute;
};

/**
 * The rungs, for the machine as it is now.
 *
 * With the bridge connected every rung takes the bridge - the engine lives in
 * the extension's Node process (D-59). Without the bridge tesseract is the
 * rung that can still run, in the browser, and the other two say why they
 * cannot.
 */
export const ocrLadderFor = ({
  bridgeConnected,
}: {
  bridgeConnected: boolean;
}): readonly OcrLadderStep[] =>
  OCR_LADDER.map((rung) => ({
    ...rung,
    route: bridgeConnected ? rung.withBridge : rung.withoutBridge,
  }));

/**
 * The engines the **browser** can run by itself.
 *
 * The list is EMPTY, and that is the truth on this machine (D-59): the engine
 * is `tesseract.js` and it lives in the extension's Node process - a
 * multi-megabyte download is not what a classroom connection is for, and the
 * project rule is no new dependency without the owner's approval (D-11). So
 * the ladder's browser rung says it cannot run here, **with the reason**,
 * instead of pretending (D-75).
 */
export const BROWSER_OCR_ENGINES: readonly OcrEngineName[] = [];

/** why the browser rung cannot run, when it cannot */
export const BROWSER_ENGINE_REASON =
  "tesseract needs an OCR engine in the browser, and none runs there: the engine lives in the extension's Node process (D-59). Start the Excalidraw Bridge extension in VS Code.";

/**
 * Why a rung that needs the bridge cannot run, when the bridge is not there.
 *
 * It is the same sentence the bridge's own client uses (D-59, AC-74): the
 * read fails **loudly**, and it says what is missing.
 */
export const BRIDGE_NEEDED_REASON =
  "the bridge is not connected: start the Excalidraw Bridge extension in VS Code.";
