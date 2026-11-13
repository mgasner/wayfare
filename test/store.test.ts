import { afterEach, describe, expect, it, vi } from "vitest";
import { R2Store } from "../lib/store.js";

const store = new R2Store({ accountId: "acct", bucket: "dp", accessKeyId: "AK", secretAccessKey: "SK", key: "dev.db" });
const requests: Request[] = [];

function respond(...responses: Response[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return responses.shift()!;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  requests.length = 0;
});

describe("R2Store", () => {
  it("signs a conditional GET and maps 200 and 304", async () => {
    respond(new Response(new Uint8Array([1, 2]), { headers: { ETag: '"e1"' } }), new Response(null, { status: 304 }));
    expect(await store.get()).toEqual({ status: "ok", body: new Uint8Array([1, 2]), etag: '"e1"' });
    expect(await store.get('"e1"')).toEqual({ status: "not_modified" });
    expect(requests[0]!.url).toBe("https://acct.r2.cloudflarestorage.com/dp/dev.db");
    expect(requests[0]!.headers.get("Authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d+\/auto\/s3\/aws4_request/);
    expect(requests[1]!.headers.get("If-None-Match")).toBe('"e1"');
  });

  it("maps a missing object", async () => {
    respond(new Response("NoSuchKey", { status: 404 }));
    expect(await store.get()).toEqual({ status: "missing" });
  });

  it("PUTs with If-Match, or If-None-Match: * to create, and maps 412 to a conflict", async () => {
    respond(
      new Response(null, { headers: { ETag: '"e2"' } }),
      new Response(null, { headers: { ETag: '"e1"' } }),
      new Response("PreconditionFailed", { status: 412 }),
    );
    expect(await store.put(new Uint8Array([3]), '"e1"')).toEqual({ status: "ok", etag: '"e2"' });
    expect(await store.put(new Uint8Array([3]), null)).toEqual({ status: "ok", etag: '"e1"' });
    expect(await store.put(new Uint8Array([3]), '"old"')).toEqual({ status: "conflict" });
    expect(requests[0]!.method).toBe("PUT");
    expect(requests[0]!.headers.get("If-Match")).toBe('"e1"');
    expect(requests[0]!.headers.get("Authorization")).toContain("if-match");
    expect(requests[1]!.headers.get("If-None-Match")).toBe("*");
  });

  it("throws on other failures", async () => {
    respond(new Response("denied", { status: 403 }));
    await expect(store.put(new Uint8Array([3]), '"e1"')).rejects.toThrow(/PUT 403/);
  });
});
