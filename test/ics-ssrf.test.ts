import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Auth } from "../lib/nexus.js";
import { isPublicAddress, publicFetcher } from "../lib/public-fetch.js";
import { FEED_UNREADABLE, setFeedFetcher } from "../server/adapters/ics.js";
import { createTrip } from "./fixtures.js";
import { addUser, callAs, root, seededDb } from "./helpers.js";

const tls = { key: readFileSync(join(root, "test/fixtures/tls/key.pem")), cert: readFileSync(join(root, "test/fixtures/tls/cert.pem")) };
const feed = (summary: string) =>
  `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:${summary}\nDTSTART:20261120T150000Z\nDTEND:20261120T160000Z\nSUMMARY:${summary}\nLOCATION:x\nEND:VEVENT\nEND:VCALENDAR\n`;

// Internal services on loopback that a feed URL must never reach.
const hits: string[] = [];
let internal: http.Server;
let internalTls: https.Server;
// Stands in for a public host (127.0.0.2 counts as public in these tests).
let outside: https.Server;
const port = (s: http.Server | https.Server) => (s.address() as AddressInfo).port;

beforeAll(async () => {
  internal = http.createServer((req, res) => {
    hits.push(`http ${req.url}`);
    res.end(feed("INTERNAL-ONLY-RESPONSE"));
  });
  internalTls = https.createServer(tls, (req, res) => {
    hits.push(`https ${req.url}`);
    res.end(feed("INTERNAL-ONLY-RESPONSE"));
  });
  outside = https.createServer(tls, (req, res) => {
    const to: Record<string, string> = {
      "/to-http": `http://127.0.0.1:${port(internal)}/internal/admin`,
      "/to-loopback": `https://127.0.0.1:${port(internalTls)}/internal/admin`,
      "/to-name": `https://localtest.me:${port(internalTls)}/internal/admin`,
      "/to-ok": "/ok",
      "/loop": "/loop",
    };
    if (to[req.url ?? ""]) {
      res.writeHead(302, { Location: to[req.url ?? ""] });
      return res.end();
    }
    if (req.url === "/ok") return res.end(feed("Public dinner"));
    if (req.url === "/big") return res.end(feed("x".repeat(50_000)));
    res.writeHead(404);
    res.end("no such feed on port 8443");
  });
  await new Promise<void>((r) => internal.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => internalTls.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => outside.listen(0, "127.0.0.2", r));
});
afterAll(() => {
  for (const s of [internal, internalTls, outside]) s.close();
});

const names: Record<string, string> = { "127.0.0.1.nip.io": "127.0.0.1", "localtest.me": "127.0.0.1", "feed.test": "127.0.0.2" };
const fetcher = (maxBytes?: number) =>
  publicFetcher({
    resolve: async (host) => (names[host] ? [{ address: names[host]!, family: 4 }] : []),
    allowAddress: (ip) => ip === "127.0.0.2" || isPublicAddress(ip),
    tls: { rejectUnauthorized: false },
    ...(maxBytes ? { maxBytes } : {}),
  });

let max: Auth;
let trip: string;
beforeEach(async () => {
  hits.length = 0;
  setFeedFetcher(fetcher());
  const database = await seededDb();
  max = await addUser(database, "max@example.com");
  trip = (await createTrip(max)).id;
});
afterEach(() => setFeedFetcher(null));

async function rejected(url: string) {
  const res = await callAs(max, "calendar.addIcs", { url });
  expect(res.status, url).toBe(400);
  expect(res.body.error.message).toBe(FEED_UNREADABLE);
  expect((await callAs(max, "calendar.links", {})).body).toEqual([]);
  expect(JSON.stringify((await callAs(max, "anchors.list", { trip })).body)).not.toContain("INTERNAL-ONLY-RESPONSE");
}

describe("ICS feeds reach only public https hosts", () => {
  it("refuses a name that resolves to loopback before connecting", async () => {
    await rejected(`https://127.0.0.1.nip.io:${port(internalTls)}/feed.ics`);
    expect(hits).toEqual([]);
  });

  it("refuses redirects to http, to private addresses and to names that resolve to them", async () => {
    for (const path of ["/to-http", "/to-loopback", "/to-name", "/loop"]) await rejected(`https://feed.test:${port(outside)}${path}`);
    expect(hits).toEqual([]);
  });

  it("reads a public feed, following a redirect on the same host", async () => {
    const res = await callAs(max, "calendar.addIcs", { url: `https://feed.test:${port(outside)}/to-ok` });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
  });

  it("doesn't echo the upstream status or body", async () => {
    const res = await callAs(max, "calendar.addIcs", { url: `https://feed.test:${port(outside)}/missing.ics` });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/404|8443/);
  });

  it("caps the body size", async () => {
    setFeedFetcher(fetcher(10_000));
    await rejected(`https://feed.test:${port(outside)}/big`);
    setFeedFetcher(fetcher());
    expect((await callAs(max, "calendar.addIcs", { url: `https://feed.test:${port(outside)}/big` })).status).toBe(200);
  });

  it("fails closed when the host installed no fetcher", async () => {
    setFeedFetcher(null);
    await rejected(`https://feed.test:${port(outside)}/ok`);
  });

  it("classifies addresses after resolution, including mapped and NAT64 forms", () => {
    for (const ip of ["93.184.215.14", "8.8.8.8", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
      "::1", "::", "fd00:ec2::254", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "not-an-ip",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});
