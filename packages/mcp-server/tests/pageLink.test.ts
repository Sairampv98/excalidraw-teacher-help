/**
 * The MCP server's link to the page (D-397, D-398): the pairing code, the origin
 * check, one page at a time, and a call that goes to the page and comes back.
 *
 * The rows named in the test titles are the rows of SPEC.md - the kit's SPEC
 * lint reads this file and fails if a row id is missing.
 */

import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WS_OPCODE,
  createFrameDecoder,
  encodeFrame,
} from "../../vscode-bridge/bridge/src/ws-frame";
import { MCP_CLOSE_UNAUTHORIZED } from "../../excalidraw/mcp/protocol";
import {
  McpCallError,
  createPageLink,
  isLoopbackOrigin,
} from "../src/pageLink";
import {
  PAIRING_CODE_LENGTH,
  isPairingCode,
  makePairingCode,
  normalizePairingCode,
  pairingCodesMatch,
  readOrCreatePairingCode,
} from "../src/pairing";

import type { Socket } from "node:net";
import type { PageLink } from "../src/pageLink";

const CODE = "ABCD2345";

/** a page as the browser is: a raw client that sends the origin it was given */
const connectPage = (
  port: number,
  origin: string | null,
): Promise<{
  status: number;
  socket: Socket;
  messages: unknown[];
  closed: Promise<number | null>;
  send: (message: unknown) => void;
}> =>
  new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    const messages: unknown[] = [];
    let upgraded = false;
    let head = Buffer.alloc(0);
    let closeCode: number | null = null;
    let resolveClosed: (code: number | null) => void = () => undefined;
    const closed = new Promise<number | null>((done) => {
      resolveClosed = done;
    });
    const decoder = createFrameDecoder((frame) => {
      if (frame.opcode === WS_OPCODE.close) {
        closeCode =
          frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : null;
      } else if (frame.opcode === WS_OPCODE.text) {
        messages.push(JSON.parse(frame.payload.toString("utf8")));
      }
    });

    socket.on("connect", () => {
      socket.write(
        [
          "GET / HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          ...(origin ? [`Origin: ${origin}`] : []),
          "",
          "",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      if (!upgraded) {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");

        if (end < 0) {
          return;
        }

        const status = Number(head.toString("utf8", 0, end).split(" ")[1]);

        upgraded = status === 101;
        resolve({
          status,
          socket,
          messages,
          closed,
          send: (message) =>
            socket.write(
              encodeFrame(
                WS_OPCODE.text,
                Buffer.from(JSON.stringify(message)),
                true,
              ),
            ),
        });

        if (upgraded && head.length > end + 4) {
          decoder.push(head.subarray(end + 4));
        }

        return;
      }

      decoder.push(chunk);
    });
    socket.on("close", () => resolveClosed(closeCode));
    socket.on("error", (error) => reject(error));
  });

const until = async (check: () => boolean, ms = 2000) => {
  const start = Date.now();

  while (!check()) {
    if (Date.now() - start > ms) {
      throw new Error("timed out waiting");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

let link: PageLink | null = null;
const sockets: Socket[] = [];

const startLink = async (options: { authWindowMs?: number } = {}) => {
  link = createPageLink({
    code: CODE,
    serverName: "test",
    version: "0",
    port: 0,
    ...options,
  });

  return link.start();
};

const page = async (
  port: number,
  origin: string | null = "http://localhost:3000",
) => {
  const client = await connectPage(port, origin);

  sockets.push(client.socket);

  return client;
};

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }

  await link?.stop();
  link = null;
});

describe("the pairing code", () => {
  it("AC-458 is eight letters and digits that are not easy to mix up, and is kept for the next run", () => {
    const directory = mkdtempSync(join(tmpdir(), "mcp-pairing-"));
    const code = readOrCreatePairingCode(directory);

    expect(code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(isPairingCode(code)).toBe(true);
    expect(code).not.toMatch(/[01OIL]/);
    expect(readOrCreatePairingCode(directory)).toBe(code);

    // the file is the person's own: not readable by others where the system says so
    if (process.platform !== "win32") {
      expect(statSync(join(directory, "pairing.json")).mode & 0o077).toBe(0);
    }

    expect(
      JSON.parse(readFileSync(join(directory, "pairing.json"), "utf8")).code,
    ).toBe(code);
    expect(makePairingCode()).not.toBe(makePairingCode());
  });

  it("AC-458 is matched as typed - upper or lower case, spaces and dashes - and a wrong one never matches", () => {
    expect(normalizePairingCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(pairingCodesMatch("abcd 2345", CODE)).toBe(true);
    expect(pairingCodesMatch("ABCD2346", CODE)).toBe(false);
    expect(pairingCodesMatch("", CODE)).toBe(false);
    expect(pairingCodesMatch("ABCD23456", CODE)).toBe(false);
  });
});

describe("the link to the page", () => {
  it("AC-458 only a page served from this machine may connect: another origin and none are refused before the upgrade", async () => {
    const port = await startLink();

    expect((await page(port, "http://evil.example")).status).toBe(403);
    expect((await page(port, null)).status).toBe(403);
    expect((await page(port, "http://localhost:3061")).status).toBe(101);
    expect((await page(port, "http://127.0.0.1:3061")).status).toBe(101);

    expect(isLoopbackOrigin("http://localhost.evil.example")).toBe(false);
    expect(isLoopbackOrigin("file:///x")).toBe(false);
    expect(isLoopbackOrigin("http://[::1]:3000")).toBe(true);
  });

  it("AC-458 a wrong code is closed with 1008, and so is a connection that says anything else first", async () => {
    const port = await startLink();
    const wrong = await page(port);

    wrong.send({ v: 1, type: "mcp:auth", code: "WRONG234" });
    expect(await wrong.closed).toBe(MCP_CLOSE_UNAUTHORIZED);

    const rude = await page(port);

    rude.send({ v: 1, type: "pong" });
    expect(await rude.closed).toBe(MCP_CLOSE_UNAUTHORIZED);
    expect(link!.status().connected).toBe(false);
  });

  it("AC-458 a connection that does not pair in time is closed", async () => {
    const port = await startLink({ authWindowMs: 50 });
    const silent = await page(port);

    expect(await silent.closed).toBe(MCP_CLOSE_UNAUTHORIZED);
  });

  it("AC-458 the right code pairs the page, and the server says it is ready", async () => {
    const port = await startLink();
    const client = await page(port);

    client.send({ v: 1, type: "mcp:auth", code: "abcd-2345" });
    await until(() => client.messages.length > 0);

    expect(client.messages[0]).toMatchObject({
      type: "mcp:ready",
      server: "test",
    });
    expect(link!.status()).toEqual({ connected: true, state: null });

    client.send({
      v: 1,
      type: "mcp:state",
      allowChanges: true,
      app: "whiteboard 1",
      features: ["canvas"],
    });
    await until(() => link!.status().state !== null);

    expect(link!.status().state).toEqual({
      allowChanges: true,
      app: "whiteboard 1",
      features: ["canvas"],
    });
  });
});

describe("a call to the page", () => {
  const pair = async (port: number) => {
    const client = await page(port);

    client.send({ v: 1, type: "mcp:auth", code: CODE });
    await until(() => client.messages.length > 0);

    return client;
  };

  it("AC-459 goes to the page and the page's answer comes back", async () => {
    const port = await startLink();
    const client = await pair(port);
    const answer = link!.call("list_pages", { page: 2 });

    await until(() => client.messages.length > 1);

    const call = client.messages[1] as {
      id: string;
      tool: string;
      args: unknown;
    };

    expect(call).toMatchObject({
      type: "mcp:call",
      tool: "list_pages",
      args: { page: 2 },
    });

    client.send({
      v: 1,
      type: "mcp:result",
      id: call.id,
      ok: true,
      result: { pages: [] },
    });
    expect(await answer).toEqual({ pages: [] });
  });

  it("AC-459 an error the page gives is an error with its code, and a call with no page says so", async () => {
    await expect(
      createPageLink({
        code: CODE,
        serverName: "x",
        version: "0",
        port: 0,
      }).call("t", {}),
    ).rejects.toMatchObject({
      name: "McpCallError",
      code: "not-connected",
    });

    const port = await startLink();
    const client = await pair(port);
    const answer = link!.call("delete_elements", {});

    await until(() => client.messages.length > 1);

    const call = client.messages[1] as { id: string };

    client.send({
      v: 1,
      type: "mcp:result",
      id: call.id,
      ok: false,
      error: { code: "changes-not-allowed", message: "off" },
    });

    const error = await answer.catch((caught) => caught);

    expect(error).toBeInstanceOf(McpCallError);
    expect(error).toMatchObject({
      code: "changes-not-allowed",
      message: "off",
    });
  });

  it("AC-459 a page that does not answer in time ends the call with a timeout", async () => {
    const port = await startLink();

    await pair(port);

    await expect(link!.call("list_pages", {}, 50)).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("AC-459 a page that goes away ends the calls that wait for it", async () => {
    const port = await startLink();
    const client = await pair(port);
    const answer = link!.call("list_pages", {});

    await until(() => client.messages.length > 1);
    client.socket.destroy();

    await expect(answer).rejects.toMatchObject({ code: "not-connected" });
    await until(() => !link!.status().connected);
  });

  it("AC-459 one page is paired at a time: a page that pairs later takes over, and the one before is closed", async () => {
    const port = await startLink();
    const first = await pair(port);
    const second = await pair(port);

    expect(await first.closed).toBe(1000);

    const answer = link!.call("list_pages", {});

    await until(() => second.messages.length > 1);

    const call = second.messages[1] as { id: string };

    second.send({
      v: 1,
      type: "mcp:result",
      id: call.id,
      ok: true,
      result: "second",
    });
    expect(await answer).toBe("second");
  });
});
