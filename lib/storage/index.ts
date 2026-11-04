import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { signAwsRequest } from "./sigv4";

/**
 * Private object storage for course material.
 *
 * Files are never served from a public URL. Every read goes through a route
 * handler that resolves the actor, the offering, and the item and then asks
 * this adapter for the bytes.
 *
 * Two adapters exist:
 *
 * - `local` writes under a directory outside the web root. This is the
 *   development and test mode, and the only one exercised by the test suite.
 * - `s3` talks to any S3-compatible endpoint. It is installed but unconfigured:
 *   without credentials it throws `StorageNotConfiguredError` instead of
 *   pretending an upload worked. See docs/runbooks/object-storage.md.
 */

export class StorageNotConfiguredError extends Error {
  constructor(message = "Object storage is not configured.") {
    super(message);
    this.name = "StorageNotConfiguredError";
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor() {
    super("The stored file was not found.");
    this.name = "StorageObjectNotFoundError";
  }
}

export type StorageAdapter = {
  readonly kind: "local" | "s3";
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  copy(sourceKey: string, destinationKey: string): Promise<void>;
};

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/** Rejects traversal, absolute paths, empty segments, and control characters. */
export function assertSafeStorageKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > 512 ||
    !KEY_PATTERN.test(key) ||
    key.includes("..") ||
    key.includes("//") ||
    key.startsWith("/")
  ) {
    throw new Error("Unsafe storage key.");
  }
}

function localRoot(): string {
  return path.resolve(process.env.STORAGE_LOCAL_ROOT ?? ".data/storage");
}

class LocalStorageAdapter implements StorageAdapter {
  readonly kind = "local" as const;
  private readonly root: string;

  constructor(root = localRoot()) {
    this.root = root;
  }

  private resolve(key: string): string {
    assertSafeStorageKey(key);
    const target = path.resolve(this.root, key);
    const prefix = `${this.root}${path.sep}`;
    if (!target.startsWith(prefix)) throw new Error("Unsafe storage key.");
    return target;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write-then-rename so a crash cannot leave a half-written file behind that
    // a later download would serve as if it were complete.
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, target);
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new StorageObjectNotFoundError();
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    await this.put(destinationKey, await this.get(sourceKey));
  }
}

type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
};

function readS3Config(): S3Config {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim();
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
  const region = process.env.OBJECT_STORAGE_REGION?.trim();
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();

  if (!endpoint || !bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new StorageNotConfiguredError(
      "Object storage is not configured. Set OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_REGION, OBJECT_STORAGE_ACCESS_KEY_ID, and OBJECT_STORAGE_SECRET_ACCESS_KEY.",
    );
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.OBJECT_STORAGE_SESSION_TOKEN?.trim() || undefined,
    forcePathStyle: (process.env.OBJECT_STORAGE_FORCE_PATH_STYLE ?? "true") !== "false",
  };
}

class S3StorageAdapter implements StorageAdapter {
  readonly kind = "s3" as const;
  private config: S3Config | null = null;

  private getConfig(): S3Config {
    this.config ??= readS3Config();
    return this.config;
  }

  private urlFor(key: string): URL {
    assertSafeStorageKey(key);
    const config = this.getConfig();
    const base = new URL(config.endpoint);
    const encodedKey = key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    base.pathname = config.forcePathStyle
      ? `${base.pathname.replace(/\/+$/, "")}/${config.bucket}/${encodedKey}`
      : `${base.pathname.replace(/\/+$/, "")}/${encodedKey}`;
    if (!config.forcePathStyle) base.host = `${config.bucket}.${base.host}`;
    return base;
  }

  private async send(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    key: string,
    body?: Buffer,
  ): Promise<Response> {
    const config = this.getConfig();
    const url = this.urlFor(key);
    const payload = body ?? Buffer.alloc(0);
    const headers = signAwsRequest({
      method,
      url,
      payloadHash: createHash("sha256").update(payload).digest("hex"),
      region: config.region,
      service: "s3",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    });

    return fetch(url, {
      method,
      headers: {
        ...headers,
        ...(body ? { "content-length": String(payload.byteLength) } : {}),
      },
      body: body ? new Uint8Array(payload) : undefined,
      cache: "no-store",
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const response = await this.send("PUT", key, data);
    if (!response.ok) {
      throw new StorageNotConfiguredError(
        `Object storage rejected the upload (HTTP ${response.status}).`,
      );
    }
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.send("GET", key);
    if (response.status === 404) throw new StorageObjectNotFoundError();
    if (!response.ok) {
      throw new Error(`Object storage returned HTTP ${response.status}.`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.send("DELETE", key);
    if (!response.ok && response.status !== 404) {
      throw new Error(`Object storage returned HTTP ${response.status}.`);
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    await this.put(destinationKey, await this.get(sourceKey));
  }
}

let cachedAdapter: StorageAdapter | undefined;

export type StorageInfo = { kind: "local" | "s3"; configured: boolean };

export function storageInfo(): StorageInfo {
  const driver = (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (driver === "s3" || (driver === "" && process.env.NODE_ENV === "production")) {
    const configured = Boolean(
      process.env.OBJECT_STORAGE_ENDPOINT &&
      process.env.OBJECT_STORAGE_BUCKET &&
      process.env.OBJECT_STORAGE_ACCESS_KEY_ID &&
      process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    );
    return { kind: "s3", configured };
  }
  return { kind: "local", configured: true };
}

/**
 * The active adapter, chosen by `STORAGE_DRIVER` (default: local outside
 * production, s3 in production). Constructing it does not connect anywhere.
 */
export function getStorage(): StorageAdapter {
  cachedAdapter ??=
    storageInfo().kind === "s3" ? new S3StorageAdapter() : new LocalStorageAdapter();
  return cachedAdapter;
}

/** Test helper: drops the cached adapter so a new driver/root takes effect. */
export function resetStorageCache(): void {
  cachedAdapter = undefined;
}

/** Test helper: ensures the local root exists (the adapter itself is lazy). */
export async function ensureLocalStorageRoot(): Promise<void> {
  await mkdir(localRoot(), { recursive: true });
}

export async function localFileExists(key: string): Promise<boolean> {
  try {
    await stat(path.resolve(localRoot(), key));
    return true;
  } catch {
    return false;
  }
}
