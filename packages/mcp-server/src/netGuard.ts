/**
 * Fetching from the internet, safely (D-410).
 *
 * The assistant may be asked to fetch a picture or a page, and a web address is
 * the easiest way to make a program reach what it should not: an address on this
 * computer, one on the person's own network, one that sends it on to such an
 * address. So:
 *
 *  - only https, and only a port that is not odd;
 *  - the name is resolved here, **every** address it has must be a public one, and
 *    the connection goes to the address that was checked - not to a second lookup
 *    that could answer differently;
 *  - a redirect is followed by hand, at most five times, and each is checked as
 *    the first was;
 *  - no cookies, no credentials, nothing of the person's is sent;
 *  - a time limit and a size limit, and the size is counted as the bytes arrive,
 *    not trusted from a header.
 */

import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import type { IncomingMessage } from "node:http";
import type { LookupAddress } from "node:dns";

/** a failure that says in words what went wrong */
export class NetError extends Error {
  readonly code: "bad-arguments" | "too-large" | "failed" | "timeout";

  constructor(code: NetError["code"], message: string) {
    super(message);
    this.name = "NetError";
    this.code = code;
  }
}

const v4 = (address: string): number[] | null => {
  const parts = address.split(".").map(Number);

  return parts.length === 4 &&
    parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)
    ? parts
    : null;
};

/** an IPv6 address as eight 16-bit groups, or null */
const v6 = (address: string): number[] | null => {
  let text = address.split("%")[0].toLowerCase();
  const tail = text.lastIndexOf(":");

  // ::ffff:1.2.3.4 - the last part is an IPv4 address
  if (text.includes(".")) {
    const embedded = v4(text.slice(tail + 1));

    if (!embedded) {
      return null;
    }

    text = `${text.slice(0, tail + 1)}${(
      (embedded[0] << 8) |
      embedded[1]
    ).toString(16)}:${((embedded[2] << 8) | embedded[3]).toString(16)}`;
  }

  const halves = text.split("::");

  if (halves.length > 2) {
    return null;
  }

  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;

  if (fill < 0 || (halves.length === 1 && head.length !== 8)) {
    return null;
  }

  const groups = [...head, ...Array(fill).fill("0"), ...rest].map((group) =>
    parseInt(group, 16),
  );

  return groups.length === 8 &&
    groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
};

/** whether an IPv4 address is one anyone on the internet may be sent to */
const publicV4 = ([a, b, c]: number[]): boolean => {
  if (a === 0 || a === 10 || a === 127) {
    return false;
  } // this host, private, loopback
  if (a === 100 && b >= 64 && b <= 127) {
    return false;
  } // carrier-grade NAT
  if (a === 169 && b === 254) {
    return false;
  } // link-local
  if (a === 172 && b >= 16 && b <= 31) {
    return false;
  } // private
  if (a === 192 && b === 168) {
    return false;
  } // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) {
    return false;
  } // protocol, test-net
  if (a === 198 && (b === 18 || b === 19)) {
    return false;
  } // benchmarking
  if (a === 198 && b === 51 && c === 100) {
    return false;
  } // test-net
  if (a === 203 && b === 0 && c === 113) {
    return false;
  } // test-net
  if (a >= 224) {
    return false;
  } // multicast and reserved

  return true;
};

/** whether an address is one that is out on the internet and not on this machine's side */
export const isPublicAddress = (address: string): boolean => {
  const kind = isIP(address.split("%")[0]);

  if (kind === 4) {
    return publicV4(v4(address)!);
  }

  if (kind === 6) {
    const g = v6(address);

    if (!g) {
      return false;
    }

    // ::, ::1
    if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 0 || g[7] === 1)) {
      return false;
    }
    // an IPv4 address in an IPv6 one: ::ffff:a.b.c.d and the NAT64 prefix
    const embedded = (hi: number, lo: number) => [
      hi >> 8,
      hi & 255,
      lo >> 8,
      lo & 255,
    ];

    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
      return publicV4(embedded(g[6], g[7]));
    }

    if (
      g[0] === 0x64 &&
      g[1] === 0xff9b &&
      g.slice(2, 6).every((x) => x === 0)
    ) {
      return publicV4(embedded(g[6], g[7]));
    }

    if ((g[0] & 0xfe00) === 0xfc00) {
      return false;
    } // unique local
    if ((g[0] & 0xffc0) === 0xfe80) {
      return false;
    } // link-local
    if ((g[0] & 0xff00) === 0xff00) {
      return false;
    } // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) {
      return false;
    } // documentation

    return true;
  }

  return false;
};

export type FetchResult = {
  url: string;
  status: number;
  contentType: string;
  bytes: Buffer;
};

export type FetchDeps = {
  /** resolves a name to every address it has */
  resolve: (host: string) => Promise<LookupAddress[]>;
  /** makes one request to an address that was checked */
  request: (
    url: URL,
    options: { address: string; family: number; timeoutMs: number },
  ) => Promise<IncomingMessage>;
};

const realDeps: FetchDeps = {
  resolve: (host) =>
    new Promise((resolvePromise, reject) =>
      dnsLookup(host, { all: true }, (error, addresses) =>
        error ? reject(error) : resolvePromise(addresses),
      ),
    ),
  request: (url, { address, family, timeoutMs }) =>
    new Promise((resolvePromise, reject) => {
      const request = httpsRequest(
        {
          protocol: "https:",
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          // the connection goes to the address that was checked
          lookup: (_host, _options, callback) =>
            (callback as (e: Error | null, a: string, f: number) => void)(
              null,
              address,
              family,
            ),
          headers: {
            "User-Agent": "excalidraw-whiteboard-assistant/1",
            Accept: "*/*",
          },
          timeout: timeoutMs,
        },
        resolvePromise,
      );

      request.on("timeout", () =>
        request.destroy(
          new NetError("timeout", "The server did not answer in time."),
        ),
      );
      request.on("error", reject);
      request.end();
    }),
};

const MAX_REDIRECTS = 5;

export const createSafeFetch =
  (deps: FetchDeps = realDeps) =>
  async (
    start: string,
    { maxBytes, timeoutMs = 20_000 }: { maxBytes: number; timeoutMs?: number },
  ): Promise<FetchResult> => {
    let url: URL;

    try {
      url = new URL(start);
    } catch {
      throw new NetError("bad-arguments", "That is not a web address.");
    }

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== "https:") {
        throw new NetError(
          "bad-arguments",
          "Only https addresses are fetched.",
        );
      }

      if (url.username || url.password) {
        throw new NetError(
          "bad-arguments",
          "An address with a name and a password in it is not fetched.",
        );
      }

      if (url.port && url.port !== "443") {
        throw new NetError(
          "bad-arguments",
          "Only the usual https port is used.",
        );
      }

      const host = url.hostname.replace(/^\[|\]$/g, "");
      let addresses: LookupAddress[];

      if (isIP(host)) {
        addresses = [{ address: host, family: isIP(host) }];
      } else {
        try {
          addresses = await deps.resolve(host);
        } catch {
          throw new NetError("failed", `The name ${host} could not be found.`);
        }
      }

      if (
        !addresses.length ||
        !addresses.every((each) => isPublicAddress(each.address))
      ) {
        throw new NetError(
          "bad-arguments",
          `${host} is not on the internet: it stands for an address on this computer or its network, and that is never fetched.`,
        );
      }

      const response = await deps.request(url, {
        address: addresses[0].address,
        family: addresses[0].family,
        timeoutMs,
      });
      const status = response.statusCode ?? 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();

        try {
          url = new URL(response.headers.location, url);
        } catch {
          throw new NetError(
            "failed",
            "The server sent us to a place that is not an address.",
          );
        }

        continue;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        throw new NetError("failed", `The server answered ${status}.`);
      }

      const declared = Number(response.headers["content-length"]);

      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        throw new NetError(
          "too-large",
          `The file is ${Math.round(
            declared / 1024 / 1024,
          )} MB; the most is ${Math.round(maxBytes / 1024 / 1024)} MB.`,
        );
      }

      const chunks: Buffer[] = [];
      let received = 0;

      await new Promise<void>((done, fail) => {
        const timer = setTimeout(() => {
          response.destroy();
          fail(new NetError("timeout", "The download took too long."));
        }, timeoutMs * 3);

        response.on("data", (chunk: Buffer) => {
          received += chunk.length;

          // counted as it arrives: a header can say anything
          if (received > maxBytes) {
            response.destroy();
            clearTimeout(timer);
            fail(
              new NetError(
                "too-large",
                `The file is larger than ${Math.round(
                  maxBytes / 1024 / 1024,
                )} MB.`,
              ),
            );
            return;
          }

          chunks.push(chunk);
        });
        response.on("end", () => {
          clearTimeout(timer);
          done();
        });
        response.on("error", (error) => {
          clearTimeout(timer);
          fail(error);
        });
      });

      return {
        url: url.href,
        status,
        contentType: String(response.headers["content-type"] ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase(),
        bytes: Buffer.concat(chunks),
      };
    }

    throw new NetError("failed", "The server sent us round too many times.");
  };

/** a web page as its words: no scripts, no markup - data to read, not to obey */
export const htmlToText = (html: string): { title: string; text: string } => {
  const title =
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  const body = html
    .replace(
      /<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre|ul|ol|table|header|footer)>/gi,
      "\n",
    )
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title: title.replace(/\s+/g, " "), text: body };
};
