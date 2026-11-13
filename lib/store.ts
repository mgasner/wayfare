import { AwsClient } from "aws4fetch";

/** Where the database file lives between requests: one object, written with If-Match. */
export type BlobStore = {
  readonly name: string;
  get(ifNoneMatch?: string): Promise<
    { status: "ok"; body: Uint8Array; etag: string } | { status: "not_modified" } | { status: "missing" }
  >;
  /** `ifMatch: null` creates the object only if it does not exist. */
  put(body: Uint8Array, ifMatch: string | null): Promise<{ status: "ok"; etag: string } | { status: "conflict" }>;
};

export class MemoryStore implements BlobStore {
  readonly name = "memory";
  body: Uint8Array | null = null;
  etag: string | null = null;
  private version = 0;

  async get(ifNoneMatch?: string) {
    if (!this.body || !this.etag) return { status: "missing" as const };
    if (ifNoneMatch === this.etag) return { status: "not_modified" as const };
    return { status: "ok" as const, body: this.body.slice(), etag: this.etag };
  }

  async put(body: Uint8Array, ifMatch: string | null) {
    if (ifMatch !== this.etag) return { status: "conflict" as const };
    this.body = body.slice();
    this.etag = `"v${++this.version}"`;
    return { status: "ok" as const, etag: this.etag };
  }
}

export type R2Env = { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; key: string };

export class R2Store implements BlobStore {
  readonly name: string;
  private client: AwsClient;
  private url: string;

  constructor(env: R2Env) {
    this.name = `r2:${env.bucket}/${env.key}`;
    this.client = new AwsClient({
      accessKeyId: env.accessKeyId,
      secretAccessKey: env.secretAccessKey,
      service: "s3",
      region: "auto",
    });
    this.url = `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${encodeURIComponent(env.key)}`;
  }

  async get(ifNoneMatch?: string) {
    const headers: Record<string, string> = ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {};
    const res = await this.client.fetch(this.url, { method: "GET", headers, signal: AbortSignal.timeout(20_000) });
    if (res.status === 304) return { status: "not_modified" as const };
    if (res.status === 404) return { status: "missing" as const };
    if (!res.ok) throw new Error(`${this.name}: GET ${res.status} ${await res.text()}`);
    const etag = res.headers.get("ETag");
    if (!etag) throw new Error(`${this.name}: GET returned no ETag`);
    return { status: "ok" as const, body: new Uint8Array(await res.arrayBuffer()), etag };
  }

  async put(body: Uint8Array, ifMatch: string | null) {
    const headers: Record<string, string> = ifMatch ? { "If-Match": ifMatch } : { "If-None-Match": "*" };
    const res = await this.client.fetch(this.url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/vnd.sqlite3" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    // 409 is S3's answer when two conditional writes race.
    if (res.status === 412 || res.status === 409) return { status: "conflict" as const };
    if (!res.ok) throw new Error(`${this.name}: PUT ${res.status} ${await res.text()}`);
    const etag = res.headers.get("ETag");
    if (!etag) throw new Error(`${this.name}: PUT returned no ETag`);
    return { status: "ok" as const, etag };
  }
}
