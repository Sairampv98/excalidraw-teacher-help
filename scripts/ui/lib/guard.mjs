// What a scenario treats as a fault of its own, whatever it was asked to check:
// an error in the console, and a request that leaves this computer.

/** an address that stays on this computer (the app, a data or blob address) */
export const isLocalUrl = (url) =>
  /^(?:https?:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(
    url,
  ) || /^(?:data|blob|about|chrome-extension|devtools):/i.test(url);

/** the host of an address, for a report that names where a request went */
export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
};

/** the requests that left this computer, counted by host, in the order they were first seen */
export const outsideByHost = (urls) => {
  const counts = new Map();

  for (const url of urls) {
    if (!isLocalUrl(url)) {
      counts.set(hostOf(url), (counts.get(hostOf(url)) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([host, count]) => ({ host, count }));
};

/** console messages that are noise of the browser and not a fault of the app */
const BENIGN_CONSOLE = [
  /Failed to load resource: net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|BLOCKED_BY_CLIENT|FAILED)/i,
  /\[Violation\]/i,
];

/** the console errors that count: the ones that are not the browser's own noise */
export const realConsoleErrors = (messages) =>
  messages.filter((message) => !BENIGN_CONSOLE.some((re) => re.test(message)));
