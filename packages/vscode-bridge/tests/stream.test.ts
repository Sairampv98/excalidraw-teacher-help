/**
 * The **MJPEG stream** - the live view of the editor's own window (D-85).
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 *
 * The frames do not travel over the websocket: the extension serves them from
 * the HTTP server it already has, and the panel plays that stream in a plain
 * `<img>`. The stream is authorised by a per-connection capability that is
 * issued in the `bridge:hello` (D-86).
 */

import { get as httpGet } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  encodeBridgeMessage,
  parseBridgeMessage,
  type BridgeMessage,
} from "../bridge/src/protocol";
import {
  createBridgeServer,
  type BridgeServer,
  type BridgeServerOptions,
} from "../extension/src/bridge";

import { RawWsClient } from "./helpers/rawWsClient";

// A fixture, not a credential: the name says so, and the kit's secret scan
// recognises a `test-` prefixed value as the placeholder it is.
const TOKEN = "test-per-session-token-that-must-never-leak";

const servers: BridgeServer[] = [];
const clients: RawWsClient[] = [];

const startServer = async (
  options: Partial<BridgeServerOptions> = {},
): Promise<BridgeServer> => {
  const server = createBridgeServer({
    port: 0,
    token: TOKEN,
    workspace: "excalidraw",
    version: "0.1.0",
    ...options,
  });
  servers.push(server);
  await server.listen();
  return server;
};

const connect = async (server: BridgeServer): Promise<RawWsClient> => {
  const client = new RawWsClient({ port: server.port });
  clients.push(client);
  await client.waitForHandshake();
  return client;
};

const auth = (client: RawWsClient, token = TOKEN) => {
  client.send(encodeBridgeMessage({ v: 1, type: "bridge:auth", token }));
};

/** The `bridge:hello` of a connection, with the stream's URL in it. */
const helloOf = async (client: RawWsClient): Promise<BridgeMessage> => {
  const frame = await client.waitForMessage((candidate) =>
    candidate.payload.toString("utf8").includes("bridge:hello"),
  );
  const parsed = parseBridgeMessage(frame.payload.toString("utf8"));

  if (!parsed) {
    throw new Error("the hello did not parse");
  }

  return parsed;
};

/** Waits for a condition - the frames arrive on the next tick. */
const until = async (condition: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("the condition was not met in time");
};

/** An open HTTP response, collected as it arrives. */
interface OpenedStream {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  close: () => void;
}

const openStream = (url: string): Promise<OpenedStream> =>
  new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const stream: OpenedStream = {
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: "",
        close: () => {
          request.destroy();
        },
      };

      response.setEncoding("binary");
      response.on("data", (chunk: string) => {
        stream.body += chunk;
      });
      response.on("end", () => {
        // nothing to do: the body is complete
      });

      resolve(stream);
    });

    request.on("error", (error) => {
      reject(error);
    });
  });

/** A request that is answered and finished - a refusal, for instance. */
const fetchToEnd = async (
  url: string,
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      let body = "";

      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body }),
      );
    });

    request.on("error", reject);
  });

/** A JPEG, small and real enough. */
const jpeg = (marker = 0): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, marker]);

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.close();
  }
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

describe("the MJPEG stream", () => {
  it("AC-113 the extension serves the frames as MJPEG on its own HTTP server", async () => {
    const server = await startServer();
    const client = await connect(server);

    auth(client);

    const hello = await helloOf(client);

    expect(hello.type).toBe("bridge:hello");

    const streamUrl = (hello as { streamUrl?: string }).streamUrl;

    // the hello carries the stream's URL, and it is on the extension's own
    // HTTP server - the same port the websocket is on (D-85)
    expect(streamUrl).toBeTruthy();
    expect(streamUrl!.startsWith(`http://127.0.0.1:${server.port}/s/`)).toBe(
      true,
    );

    // a frame is published to the stream
    const picture = jpeg(1);
    server.publishFrame({ bytes: picture, seq: 1 });

    const stream = await openStream(streamUrl!);

    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toBe(
      "multipart/x-mixed-replace; boundary=frame",
    );

    // The LAST frame goes out immediately, so a panel that opens the live
    // view is never blank.
    await until(() => stream.body.includes("X-Seq: 1"));

    // and the part is the boundary, the JPEG's headers and the bytes
    expect(stream.body).toContain("--frame\r\nContent-Type: image/jpeg\r\n");
    expect(stream.body).toContain(`Content-Length: ${picture.length}\r\n`);
    expect(stream.body).toContain("X-Seq: 1\r\n\r\n");
    expect(stream.body).toContain(picture.toString("binary"));

    // a NEW frame reaches the stream that is already open
    const second = jpeg(2);
    server.publishFrame({ bytes: second, seq: 2 });

    await until(() => stream.body.includes("X-Seq: 2"));

    expect(stream.body).toContain(second.toString("binary"));

    stream.close();
  });

  it("AC-115 the stream endpoint refuses a request without the connection's capability, and two connections get different capabilities", async () => {
    const server = await startServer();

    const first = await connect(server);
    auth(first);
    const firstHello = await helloOf(first);

    const second = await connect(server);
    auth(second);
    const secondHello = await helloOf(second);

    const firstUrl = (firstHello as { streamUrl?: string }).streamUrl;
    const secondUrl = (secondHello as { streamUrl?: string }).streamUrl;

    // TWO connections, TWO capabilities (D-86)
    expect(firstUrl).toBeTruthy();
    expect(secondUrl).toBeTruthy();
    expect(firstUrl).not.toBe(secondUrl);

    // and the capability is 32 hex characters: unguessable
    const capability = firstUrl!.split("/s/")[1]?.split("/")[0] ?? "";

    expect(capability).toMatch(/^[0-9a-f]{32}$/);

    // The session TOKEN is never in a URL (D-50): the two secrets have
    // different jobs, different lifetimes and different places.
    expect(firstUrl).not.toContain(TOKEN);
    expect(secondUrl).not.toContain(TOKEN);

    // a request with a capability that was NEVER issued is refused
    const refused = await fetchToEnd(
      `http://127.0.0.1:${server.port}/s/${"0".repeat(32)}/frame`,
    );

    expect(refused.status).toBe(404);

    // and a request with NO capability at all is refused too
    const noCapability = await fetchToEnd(
      `http://127.0.0.1:${server.port}/s//frame`,
    );

    expect(noCapability.status).toBe(404);

    // the capability dies with its connection: the connection is closed, and
    // the URL that was issued for it stops working (D-86)
    first.close();

    await until(() => server.clientCount === 1);

    const afterClose = await fetchToEnd(firstUrl!);

    expect(afterClose.status).toBe(404);

    // while the OTHER connection's capability still works
    const stillWorks = await openStream(secondUrl!);

    expect(stillWorks.status).toBe(200);

    stillWorks.close();
  });
});
