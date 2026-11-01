/**
 * Fetching from the internet, safely (D-410): which addresses are the internet's
 * and which are this computer's side, redirects, limits, and the words of a page.
 *
 * Nothing here touches the network: the lookup of a name and the request are
 * handed in.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  NetError,
  createSafeFetch,
  htmlToText,
  isPublicAddress,
} from "../src/netGuard";

import type { IncomingMessage } from "node:http";
import type { FetchDeps } from "../src/netGuard";

/** a response as the network gives it */
const response = (
  status: number,
  headers: Record<string, string>,
  body: Buffer | string = "",
  split = 1,
): IncomingMessage => {
  const stream = new PassThrough() as unknown as IncomingMessage;
  const bytes = typeof body === "string" ? Buffer.from(body) : body;

  Object.assign(stream, { statusCode: status, headers });
  setTimeout(() => {
    const size = Math.max(1, Math.ceil(bytes.length / split));

    for (let at = 0; at < bytes.length; at += size) {
      (stream as unknown as PassThrough).write(bytes.subarray(at, at + size));
    }

    (stream as unknown as PassThrough).end();
  }, 0);

  return stream;
};

const web = (
  hosts: Record<string, string[]>,
  pages: Record<string, () => IncomingMessage>,
) => {
  const seen: { url: string; address: string }[] = [];
  const deps: FetchDeps = {
    resolve: async (host) => {
      if (!hosts[host]) {
        throw new Error("ENOTFOUND");
      }

      return hosts[host].map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }));
    },
    request: async (url, { address }) => {
      seen.push({ url: url.href, address });

      const page = pages[url.href];

      if (!page) {
        throw new NetError("failed", "no such page in the test");
      }

      return page();
    },
  };

  return { fetch: createSafeFetch(deps), seen };
};

const refused = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(NetError);

    return error as NetError;
  }

  throw new Error("it was fetched");
};

describe("which addresses are the internet's", () => {
  it("AC-486 are public addresses, and not this computer's, its network's or the ones set aside", () => {
    for (const address of [
      "8.8.8.8",
      "93.184.216.34",
      "1.1.1.1",
      "172.15.0.1",
      "172.32.0.1",
      "2606:4700:4700::1111",
      "2a00:1450:4001::200e",
    ]) {
      expect(isPublicAddress(address), address).toBe(true);
    }

    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.7",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "2001:db8::1",
      "::ffff:127.0.0.1",
      "::ffff:10.1.2.3",
      "::ffff:7f00:1",
      "64:ff9b::a00:1",
      "not an address",
      "",
      "999.1.1.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }

    // an IPv4 address in an IPv6 one is judged as the IPv4 address it holds
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
  });
});

describe("fetching", () => {
  it("AC-486 fetches an https address that is on the internet, with nothing of the person's, and gives the bytes and the type", async () => {
    const { fetch, seen } = web(
      { "example.com": ["93.184.216.34"] },
      {
        "https://example.com/a.png": () =>
          response(200, { "content-type": "image/PNG; charset=x" }, "abc"),
      },
    );
    const result = await fetch("https://example.com/a.png", { maxBytes: 100 });

    expect(result).toMatchObject({
      status: 200,
      contentType: "image/png",
      url: "https://example.com/a.png",
    });
    expect(result.bytes.toString()).toBe("abc");
    // the connection went to the address that was checked
    expect(seen[0].address).toBe("93.184.216.34");
  });

  it("AC-486 refuses an address that is not https, has a name and a password, or an odd port", async () => {
    const { fetch } = web({ "example.com": ["93.184.216.34"] }, {});

    for (const url of [
      "http://example.com/",
      "ftp://example.com/",
      "file:///etc/passwd",
      ["https://me", "word@example.com/"].join(":"),
      "https://example.com:8443/",
      ["javascript", "1"].join(":"),
      "not a url",
    ]) {
      expect((await refused(fetch(url, { maxBytes: 10 }))).code).toBe(
        "bad-arguments",
      );
    }
  });

  it("AC-486 refuses a name that stands for an address on this computer's side - even when only one of its addresses does - and an address given as it is", async () => {
    const { fetch, seen } = web(
      {
        localhost: ["127.0.0.1", "::1"],
        "intranet.example": ["10.0.0.7"],
        "sneaky.example": ["93.184.216.34", "192.168.0.10"],
        "metadata.example": ["169.254.169.254"],
      },
      {},
    );

    for (const url of [
      "https://localhost/",
      "https://intranet.example/",
      "https://sneaky.example/",
      "https://metadata.example/latest/meta-data/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://192.168.1.1/",
    ]) {
      const error = await refused(fetch(url, { maxBytes: 10 }));

      expect(error.code).toBe("bad-arguments");
      expect(error.message).toMatch(/not on the internet/);
    }

    // nothing was asked of any of them
    expect(seen).toEqual([]);
    expect(
      (await refused(fetch("https://nowhere.example/", { maxBytes: 10 })))
        .message,
    ).toMatch(/could not be found/);
  });

  it("AC-486 follows a redirect by hand and looks at the place it leads to as it looked at the first", async () => {
    const { fetch, seen } = web(
      {
        "a.example": ["93.184.216.34"],
        "b.example": ["93.184.216.35"],
        "evil.example": ["127.0.0.1"],
      },
      {
        "https://a.example/": () =>
          response(302, { location: "https://b.example/final" }),
        "https://b.example/final": () =>
          response(200, { "content-type": "text/plain" }, "ok"),
        "https://a.example/trap": () =>
          response(301, { location: "https://evil.example/" }),
        "https://a.example/to-http": () =>
          response(301, { location: "http://b.example/" }),
      },
    );

    expect((await fetch("https://a.example/", { maxBytes: 10 })).url).toBe(
      "https://b.example/final",
    );
    expect(
      (await refused(fetch("https://a.example/trap", { maxBytes: 10 })))
        .message,
    ).toMatch(/not on the internet/);
    expect(
      (await refused(fetch("https://a.example/to-http", { maxBytes: 10 })))
        .message,
    ).toMatch(/Only https/);
    expect(seen.map((each) => each.url)).not.toContain("https://evil.example/");
  });

  it("AC-486 gives up on a redirect that goes round, and on an answer that is not a success", async () => {
    const { fetch, seen } = web(
      { "a.example": ["93.184.216.34"] },
      {
        "https://a.example/loop": () =>
          response(302, { location: "https://a.example/loop" }),
        "https://a.example/gone": () => response(404, {}),
        "https://a.example/broken": () => response(500, {}),
      },
    );

    expect(
      (await refused(fetch("https://a.example/loop", { maxBytes: 10 })))
        .message,
    ).toMatch(/too many times/);
    // the first place and five redirects, and not one more
    expect(seen).toHaveLength(6);
    expect(
      (await refused(fetch("https://a.example/gone", { maxBytes: 10 })))
        .message,
    ).toMatch(/answered 404/);
    expect(
      (await refused(fetch("https://a.example/broken", { maxBytes: 10 })))
        .message,
    ).toMatch(/answered 500/);
  });

  it("AC-486 stops a file that is larger than allowed: by what the header says, and by what arrives, whatever the header says", async () => {
    const { fetch } = web(
      { "a.example": ["93.184.216.34"] },
      {
        "https://a.example/declared": () =>
          response(200, { "content-length": "5000" }, "x"),
        "https://a.example/liar": () =>
          response(200, { "content-length": "3" }, "y".repeat(500), 10),
        "https://a.example/fine": () => response(200, {}, "z".repeat(50), 5),
      },
    );

    expect(
      (await refused(fetch("https://a.example/declared", { maxBytes: 100 })))
        .code,
    ).toBe("too-large");
    expect(
      (await refused(fetch("https://a.example/liar", { maxBytes: 100 }))).code,
    ).toBe("too-large");
    expect(
      (await fetch("https://a.example/fine", { maxBytes: 100 })).bytes,
    ).toHaveLength(50);
  });
});

describe("the words of a web page", () => {
  it("AC-486 are the text, without scripts, styles or markup, with the title, and a list as its items", () => {
    const page = htmlToText(
      "<html><head><title> A  lesson\n</title><style>p{color:red}</style></head><body><script>steal()</script><h1>Plan</h1><p>First &amp; <b>second</b> &lt;ok&gt;&nbsp;now</p><ul><li>one</li><li>two</li></ul><!-- hidden --><svg><text>no</text></svg></body></html>",
    );

    expect(page.title).toBe("A lesson");
    expect(page.text).toBe("Plan\nFirst & second <ok> now\n- one\n- two");
    expect(page.text).not.toMatch(/steal|color|hidden|no$/);
  });
});
