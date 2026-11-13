// Fetches a URL a user gave us without letting it reach our own network: https only, every
// address the name resolves to must be public (checked on the address actually dialed), each
// redirect hop is checked again, and the body and time are capped. Node only; server/ code gets it
// injected (see setFeedFetcher in server/adapters/ics.ts).
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request, type RequestOptions } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { FeedFetcher } from "../server/adapters/ics.js";

export class BlockedUrl extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrl";
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7], // ULA, including AWS's fd00:ec2::254
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** IPv4 inside an IPv6 address that routes to it: ::ffff:a.b.c.d, ::a.b.c.d and NAT64 64:ff9b::/96. */
function embeddedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return null;
  const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !blocked.check(ip, "ipv4");
  if (kind !== 6) return false;
  const v4 = embeddedIpv4(ip);
  if (v4) return isPublicAddress(v4);
  return !blocked.check(ip, "ipv6");
}

export type Resolver = (hostname: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))));

export type PublicFetchOptions = {
  maxBytes?: number;
  maxRedirects?: number;
  resolve?: Resolver;
  /** Tests only: which addresses count as public. */
  allowAddress?: (ip: string) => boolean;
  /** Tests only: TLS options for a self-signed stand-in. */
  tls?: Pick<RequestOptions, "rejectUnauthorized" | "ca">;
};

/** A FeedFetcher that only reaches public https hosts. */
export function publicFetcher(options: PublicFetchOptions = {}): FeedFetcher {
  const maxBytes = options.maxBytes ?? 5_000_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const resolve = options.resolve ?? systemResolver;
  const allowed = options.allowAddress ?? isPublicAddress;

  // Runs on the connect path, so the address checked is the address dialed.
  const lookup: LookupFunction = (hostname, opts, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const bad = addresses.find((a) => !allowed(a.address));
        if (!addresses.length || bad) return callback(new BlockedUrl(`${hostname} resolves to a non-public address`), "", 0);
        if (opts.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
        callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (err: NodeJS.ErrnoException) => callback(err, "", 0),
    );
  };

  const once = (url: URL, signal: AbortSignal, accept: string) =>
    new Promise<{ status: number; location: string | null; body: string }>((done, fail) => {
      if (url.protocol !== "https:") return fail(new BlockedUrl("only https is allowed"));
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(host) && !allowed(host)) return fail(new BlockedUrl("non-public address"));
      const req = request(
        url,
        { method: "GET", headers: { Accept: accept, "User-Agent": "Wayfare calendar reader" }, lookup, agent: false, signal, ...options.tls },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            return done({ status, location: res.headers.location ?? null, body: "" });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy(new BlockedUrl(`larger than ${maxBytes} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => done({ status, location: null, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", fail);
        },
      );
      req.on("error", fail);
      req.end();
    });

  return async (start, { signal, accept }) => {
    let url = start;
    for (let hop = 0; ; hop++) {
      const res = await once(url, signal, accept);
      if (!res.location) return { status: res.status, body: res.body };
      if (hop >= maxRedirects) throw new BlockedUrl("too many redirects");
      url = new URL(res.location, url);
    }
  };
}
